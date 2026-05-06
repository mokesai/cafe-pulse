/**
 * Stage 04 — Item Matching
 *
 * For each invoice line item:
 * 1. Check alias cache (fast path, no AI needed)
 * 2. If no alias: AI fuzzy match against inventory items
 * 3. If confidence >= threshold: auto-accept, upsert alias
 * 4. If confidence < threshold: create no_item_match exception, skip item
 * 5. If matched: check price variance vs inventory unit_cost
 * 6. If matched + PO: check quantity variance vs PO line
 *
 * Never halts on single item failure — creates exception and continues.
 *
 * Architecture: §2.4, §2.8 (idempotency)
 * Runtime: Deno (Supabase Edge Function)
 *
 * Note: Fuse.js and string-similarity are NOT used here.
 * After evaluation, OpenRouter AI fuzzy matching is used instead
 * (more accurate for supplier description variations, Deno-compatible).
 */

import type { PipelineContext } from '../context.ts'
import type { StageResult } from '../orchestrator.ts'
import {
  createException,
  checkForDuplicateItemException,
  sanitizeError,
} from '../exceptions.ts'
import { getAllAliasesForSupplier, upsertAlias } from '../alias-service.ts'

const STAGE = 'matching_items'

interface InvoiceItem {
  id: string
  invoice_id: string
  tenant_id: string
  line_number: number
  item_description: string
  supplier_item_code: string | null
  quantity: number
  unit_price: number
  total_price: number
}

interface InventoryItem {
  id: string
  item_name: string
  unit_cost: number
  tenant_id: string
  /** MOK-133: pack-aware variance. Inventory has unit_cost (per individual);
   *  the implied pack price is unit_cost * pack_size. pack_size > 1 means
   *  invoice lines might be priced per-pack instead of per-unit. */
  pack_size: number
  /** MOK-144: pack-pair sibling lookup. Pack pairs share the same
   *  square_item_id (e.g. a pack_size=4 row + its pack_size=1 sibling). */
  square_item_id: string | null
  /** MOK-144: supplier preference tiebreaker — when multiple pack-pair
   *  siblings tie on price-mode variance, prefer the one whose supplier
   *  matches the invoice's resolved supplier (handles Aspen→Bluepoint
   *  transitions where the pack=1 sits on the old supplier and pack=4 on
   *  the new one). */
  supplier_id: string | null
}

interface FuzzyItemMatch {
  inventory_item_id: string
  item_name: string
  confidence: number
  unit_cost: number
}

export async function runItemMatching(ctx: PipelineContext): Promise<StageResult> {
  console.log(JSON.stringify({
    event: 'stage_start',
    stage: STAGE,
    invoice_id: ctx.invoiceId,
    tenant_id: ctx.tenantId,
  }))

  // ── Load invoice items from DB (written by Stage 1) ───────────────────────
  const { data: invoiceItems, error: itemsError } = await ctx.supabase
    .from('invoice_items')
    .select('id, invoice_id, tenant_id, line_number, item_description, supplier_item_code, quantity, unit_price, total_price')
    .eq('invoice_id', ctx.invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .order('line_number')

  if (itemsError) {
    // MOK-119: surface load failures via exception so stage 5 routes the
    // invoice to pending_exceptions instead of silently auto-confirming.
    await createException(ctx, {
      type: 'parse_error',
      message: `Item matching could not load invoice line items from the database: ${itemsError.message}`,
      context: { stage: STAGE, error_message: itemsError.message },
      pipelineStage: STAGE,
    })
    return { ok: false, fatal: true, error: `Failed to load invoice items: ${itemsError.message}` }
  }

  const items = (invoiceItems ?? []) as InvoiceItem[]

  if (items.length === 0) {
    console.log('[04-match-items] No invoice items to match')
    ctx.matchedItemCount = 0
    ctx.skippedItemCount = 0
    return { ok: true }
  }

  // ── Load all inventory items for this tenant ──────────────────────────────
  // MOK-119: inventory_items uses soft-delete (deleted_at IS NULL), not
  // is_active. Earlier code referenced both `is_active` and `sku` which don't
  // exist on the schema — the query errored on every run.
  const { data: inventoryItems, error: invError } = await ctx.supabase
    .from('inventory_items')
    .select('id, item_name, unit_cost, tenant_id, pack_size, square_item_id, supplier_id')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)

  if (invError) {
    await createException(ctx, {
      type: 'parse_error',
      message: `Item matching could not load inventory items from the database: ${invError.message}`,
      context: { stage: STAGE, error_message: invError.message },
      pipelineStage: STAGE,
    })
    return { ok: false, fatal: true, error: `Failed to load inventory items: ${invError.message}` }
  }

  const inventoryAll = (inventoryItems ?? []) as InventoryItem[]

  // MOK-149: scope the matcher's candidate pool to the invoice's supplier.
  // Pre-MOK-149 the matcher fuzzy-matched against the entire tenant inventory,
  // so a Lulala "Bacon" line could land on Odeko's "Sammies Bacon Sandwich"
  // purely on literal word overlap — supplier-blind. Filtering up front means
  // short-form descriptions resolve correctly within their own supplier's
  // catalog. The full inventory list is preserved separately for
  // `promoteToPackPairSibling` (MOK-144), since a pack-pair sibling can
  // legitimately live on a different supplier (Aspen→Bluepoint transitions).
  const inventory = selectCandidatePool(inventoryAll, ctx.resolvedSupplierId ?? null)

  // ── Pre-load alias map (avoid N+1 queries) ────────────────────────────────
  let aliasMap = new Map<string, Awaited<ReturnType<typeof getAllAliasesForSupplier>> extends Map<string, infer V> ? V : never>()
  if (ctx.resolvedSupplierId) {
    aliasMap = await getAllAliasesForSupplier(ctx, ctx.resolvedSupplierId) as typeof aliasMap
  }

  const matchThreshold = ctx.tenantSettings.matchConfidenceThresholdPct / 100
  let matchedCount = 0
  let skippedCount = 0

  // ── Process each invoice item ─────────────────────────────────────────────
  for (const item of items) {
    try {
      await processInvoiceItem(ctx, item, inventory, inventoryAll, aliasMap, matchThreshold)
      matchedCount++
    } catch (err) {
      // Item-level exception — create exception and continue
      const errorMessage = sanitizeError(err)
      console.error(
        `[04-match-items] Error processing item ${item.id}:`,
        errorMessage
      )

      // Avoid duplicate exceptions on retry
      const hasDuplicate = await checkForDuplicateItemException(
        ctx,
        item.id,
        'no_item_match'
      )

      if (!hasDuplicate) {
        await createException(ctx, {
          type: 'no_item_match',
          message: `Failed to process line item "${item.item_description}": ${errorMessage}`,
          context: {
            invoice_description: item.item_description,
            invoice_unit_price: item.unit_price,
            invoice_quantity: item.quantity,
            invoice_line_total: item.total_price,
            best_fuzzy_matches: [],
          },
          invoiceItemId: item.id,
          pipelineStage: STAGE,
        })
      }

      skippedCount++
    }
  }

  ctx.matchedItemCount = matchedCount
  ctx.skippedItemCount = skippedCount

  console.log(JSON.stringify({
    event: 'stage_complete',
    stage: STAGE,
    invoice_id: ctx.invoiceId,
    matched: matchedCount,
    skipped: skippedCount,
    total: items.length,
  }))

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Process single invoice item
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MOK-149: select the inventory candidate pool for matching.
 *
 * When the invoice has a resolved supplier, restrict the candidate pool to
 * inventory items that belong to that supplier. This fixes Lulala-style
 * cross-supplier mis-matches where a short invoice description ("Bacon")
 * landed on a name-similar item from a different supplier ("Sammies Bacon
 * Sandwich" from Odeko) before the right same-supplier item ("Loly's Burrito
 * (bacon)") was even considered.
 *
 * If the resolved supplier has no inventory rows, returns an empty array; the
 * caller will fall through to the existing no_item_match exception path,
 * which is the right signal — better to flag than silently false-match.
 *
 * Falls back to the full pool when no supplier is resolved (rare; means stage
 * 3 supplier resolution failed).
 *
 * Pure function — exported for unit tests.
 */
export function selectCandidatePool<T extends { supplier_id: string | null }>(
  inventory: T[],
  resolvedSupplierId: string | null,
): T[] {
  if (!resolvedSupplierId) return inventory
  return inventory.filter((i) => i.supplier_id === resolvedSupplierId)
}

async function processInvoiceItem(
  ctx: PipelineContext,
  item: InvoiceItem,
  inventory: InventoryItem[],     // MOK-149: filtered to invoice supplier
  inventoryAll: InventoryItem[],  // MOK-144: full pool, used for pack-pair sibling promotion
  aliasMap: Map<string, { inventory_item_id: string; confidence: number }>,
  matchThreshold: number
): Promise<void> {
  // ── Step 1: Alias cache lookup ─────────────────────────────────────────────
  const cachedAlias = aliasMap.get(item.item_description)
  if (cachedAlias) {
    const inventoryItem = inventory.find((i) => i.id === cachedAlias.inventory_item_id)
    if (inventoryItem) {
      // MOK-144: alias may point to a stale sibling after a supplier
      // transition (e.g. Aspen → Bluepoint). Promote to the better pack-pair
      // sibling before recording the match.
      const promoted = promoteToPackPairSibling(
        inventoryItem,
        inventoryAll,
        item.unit_price,
        ctx.resolvedSupplierId ?? null,
      )
      await applyItemMatch(ctx, item, promoted, cachedAlias.confidence, 'alias')
      return
    }
  }

  // ── Step 2: Exact name match ───────────────────────────────────────────────
  // MOK-119: removed the prior SKU-based match path. inventory_items has no
  // supplier-SKU column to compare invoice_item.supplier_item_code against.
  // Supplier→inventory mapping persists via supplier_item_aliases (the alias
  // path above) plus the AI fuzzy match below.
  //
  // MOK-134: when multiple inventory rows share a name (e.g. the pack-pair
  // pattern: a pack_size=4 row plus a paired pack_size=1 row sharing the same
  // square_item_id), pick the candidate whose detectPriceMode variance is
  // smallest against the invoice's unit_price. Without this, we'd take the
  // first row (often the per-individual one) and produce false +N00%
  // variances on per-pack invoices. $0 unit_cost stubs are excluded — they're
  // skeleton/legacy rows, never legitimate match candidates.
  const exactNameCandidates = inventory.filter(
    (i) =>
      i.item_name.toLowerCase() === item.item_description.toLowerCase() &&
      i.unit_cost > 0,
  )
  if (exactNameCandidates.length > 0) {
    const exactNameMatch = pickBestPackAwareMatch(exactNameCandidates, item.unit_price)
    // MOK-144: exact-name match may not include the pack-pair sibling
    // (different name). Promote across siblings before recording.
    const promoted = promoteToPackPairSibling(
      exactNameMatch,
      inventoryAll,
      item.unit_price,
      ctx.resolvedSupplierId ?? null,
    )
    await applyItemMatch(ctx, item, promoted, 1.0, 'exact')
    if (ctx.resolvedSupplierId) {
      await upsertAlias(ctx, {
        supplierId: ctx.resolvedSupplierId,
        supplierDescription: item.item_description,
        inventoryItemId: promoted.id,
        confidence: 1.0,
        source: 'auto',
      })
    }
    return
  }

  // ── Step 4: AI fuzzy match ─────────────────────────────────────────────────
  const fuzzyMatches = await fuzzyMatchItemsWithAI(item.item_description, inventory)

  if (fuzzyMatches.length === 0 || fuzzyMatches[0].confidence < matchThreshold) {
    // Below threshold — skip item, create exception
    const hasDuplicate = await checkForDuplicateItemException(
      ctx,
      item.id,
      'no_item_match'
    )

    if (!hasDuplicate) {
      await createException(ctx, {
        type: 'no_item_match',
        message: `Could not match "${item.item_description}" to an inventory item with sufficient confidence (${(matchThreshold * 100).toFixed(0)}% threshold). Best match: ${fuzzyMatches[0]?.item_name ?? 'none'} (${fuzzyMatches[0] ? (fuzzyMatches[0].confidence * 100).toFixed(0) + '%' : '0%'}).`,
        context: {
          invoice_description: item.item_description,
          invoice_unit_price: item.unit_price,
          invoice_quantity: item.quantity,
          invoice_line_total: item.total_price,
          best_fuzzy_matches: fuzzyMatches.slice(0, 5).map((m) => ({
            inventory_item_id: m.inventory_item_id,
            item_name: m.item_name,
            confidence: m.confidence,
            unit_cost: m.unit_cost,
          })),
        },
        invoiceItemId: item.id,
        pipelineStage: STAGE,
      })
    }

    // Skip this item — pipeline continues
    return
  }

  // ── Auto-accept top fuzzy match ────────────────────────────────────────────
  const topMatch = fuzzyMatches[0]
  const matchedInventoryItem = inventory.find((i) => i.id === topMatch.inventory_item_id)!

  // MOK-144: fuzzy match almost certainly returned the named-similar row
  // (e.g. "Butter Croissant") not the pack-pair sibling ("Croissant 3oz 4pk").
  // Promote across siblings + supplier preference before recording.
  const promoted = promoteToPackPairSibling(
    matchedInventoryItem,
    inventoryAll,
    item.unit_price,
    ctx.resolvedSupplierId ?? null,
  )

  await applyItemMatch(ctx, item, promoted, topMatch.confidence, 'fuzzy')

  // Upsert alias for future fast lookups — point at the promoted row so
  // subsequent invoices skip the fuzzy step entirely.
  if (ctx.resolvedSupplierId) {
    await upsertAlias(ctx, {
      supplierId: ctx.resolvedSupplierId,
      supplierDescription: item.item_description,
      inventoryItemId: promoted.id,
      confidence: topMatch.confidence,
      source: 'auto',
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply item match — update invoice_item + check variances
// ─────────────────────────────────────────────────────────────────────────────

async function applyItemMatch(
  ctx: PipelineContext,
  item: InvoiceItem,
  inventoryItem: InventoryItem,
  confidence: number,
  method: 'exact' | 'fuzzy' | 'manual' | 'sku' | 'ai' | 'alias'
): Promise<void> {
  // Update invoice_item with match result
  const { error: updateError } = await ctx.supabase
    .from('invoice_items')
    .update({
      matched_item_id: inventoryItem.id,
      match_confidence: confidence,
      match_method: method,
      is_reviewed: method === 'manual' || confidence >= 0.95,
    })
    .eq('id', item.id)
    .eq('tenant_id', ctx.tenantId)

  if (updateError) {
    throw new Error(`Failed to update invoice_item match: ${updateError.message}`)
  }

  console.log(JSON.stringify({
    event: 'item_matched',
    invoice_item_id: item.id,
    inventory_item_id: inventoryItem.id,
    item_name: inventoryItem.item_name,
    confidence,
    method,
    invoice_id: ctx.invoiceId,
  }))

  // ── Check price variance (MOK-121 severity, MOK-133 pack-aware) ───────────
  // detectPriceMode picks the smaller of two interpretations: invoice
  // unit_price as per-individual cost vs as per-pack cost. For packed
  // inventory items this kills the "$1.50 → $6.19, +312.7%" false alarm
  // when the supplier prices in packs.
  const priceMode = detectPriceMode(
    item.unit_price,
    inventoryItem.unit_cost,
    inventoryItem.pack_size,
  )
  const priceThresholdPct = ctx.tenantSettings.priceVarianceThresholdPct

  if (priceMode.variancePct > 0 && inventoryItem.unit_cost > 0) {
    const severity = priceMode.variancePct > priceThresholdPct ? 'block' : 'info'
    const direction = severity === 'block'
      ? `Exceeds the ${priceThresholdPct}% threshold.`
      : `Below the ${priceThresholdPct}% threshold — informational only.`
    const modeNote = priceMode.mode === 'per_pack'
      ? ` (matched per pack of ${priceMode.packSize}: $${item.unit_price.toFixed(2)}/pack vs $${priceMode.comparatorCost.toFixed(2)}/pack)`
      : ''

    const signedVariance = (item.unit_price - priceMode.comparatorCost) / priceMode.comparatorCost * 100

    const exceptionId = await createException(ctx, {
      type: 'price_variance',
      severity,
      message:
        `${priceMode.mode === 'per_pack' ? 'Pack' : 'Unit'} price for "${inventoryItem.item_name}" ` +
        `changed ${signedVariance > 0 ? '+' : ''}${priceMode.variancePct.toFixed(1)}% ` +
        `(from $${priceMode.comparatorCost.toFixed(2)} to $${item.unit_price.toFixed(2)})${modeNote}. ${direction}`,
      context: {
        item_description: item.item_description,
        inventory_item_id: inventoryItem.id,
        inventory_item_name: inventoryItem.item_name,
        previous_unit_cost: inventoryItem.unit_cost,
        invoice_unit_price: item.unit_price,
        variance_pct: signedVariance,
        threshold_pct: priceThresholdPct,
        po_unit_cost: null,
        // MOK-133: surface the mode + derived per-unit price so downstream
        // consumers (resolve route, COGS report) don't have to re-derive.
        price_mode: priceMode.mode,
        pack_size: priceMode.packSize,
        comparator_cost: priceMode.comparatorCost,
        effective_unit_price: priceMode.effectiveUnitPrice,
      },
      invoiceItemId: item.id,
      pipelineStage: STAGE,
    })

    // MOK-122: persist to variance history shadow table.
    // poUnitCost reflects the comparator (unit_cost in per-unit mode,
    // pack_cost in per-pack mode). invoiceUnitPrice is the raw invoice
    // value so historic queries can re-derive whichever they need.
    await recordVariance(ctx, {
      varianceType: 'price_variance',
      severity,
      invoiceItemId: item.id,
      poUnitCost: priceMode.comparatorCost,
      invoiceUnitPrice: item.unit_price,
      invoiceDescription: item.item_description,
      variancePct: priceMode.variancePct,
      thresholdPct: priceThresholdPct,
      relatedExceptionId: exceptionId,
    })
  }

  // ── MOK-124: replacement-item detection ───────────────────────────────────
  // If the invoice line's description differs from the matched inventory
  // item's canonical name, record a 'replacement' row in variance history.
  // No exception is created — replacements are routine supplier behavior
  // (e.g., "Brand A bagels" on the PO, "Brand B bagels" on the invoice).
  // The history row enables supplier-performance reporting on substitution
  // rates without flooding the exception queue.
  if (ctx.poMatchId && isReplacement(item.item_description, inventoryItem.item_name)) {
    await recordVariance(ctx, {
      varianceType: 'replacement',
      severity: 'info',
      invoiceItemId: item.id,
      poDescription: inventoryItem.item_name,
      invoiceDescription: item.item_description,
    })
  }

  // ── Check quantity variance vs PO ─────────────────────────────────────────
  // MOK-133: pass priceMode so quantity comparison can normalize. When the
  // invoice is per-pack, item.quantity is in pack count and the PO's
  // quantity_ordered is in individuals — they need a × pack_size to align.
  if (ctx.poMatchId) {
    await checkQuantityVariance(ctx, item, inventoryItem, priceMode)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOK-133: pack-aware price-mode detection
// ─────────────────────────────────────────────────────────────────────────────

export type PriceMode = 'per_unit' | 'per_pack'

export interface PriceModeResult {
  /** Whether the invoice line is priced per individual unit or per pack. */
  mode: PriceMode
  /** The inventory-side comparator used: unit_cost (per_unit) or
   *  unit_cost * pack_size (per_pack). */
  comparatorCost: number
  /** |invoice_unit_price - comparatorCost| / comparatorCost * 100 */
  variancePct: number
  /** Resolved per-individual-unit price for the invoice line — useful for
   *  COGS / cost-history writes that always want the canonical per-unit value.
   *  In per_pack mode this is invoice_unit_price / pack_size. */
  effectiveUnitPrice: number
  /** The pack size used in the calculation (≥ 1). */
  packSize: number
}

/**
 * Decide whether the invoice line's `unit_price` represents a per-individual
 * cost or a per-pack cost, by picking whichever interpretation produces the
 * smaller variance against the matched inventory item.
 *
 * Inventory has `unit_cost` (per individual) and `pack_size`. The implied
 * pack price is `unit_cost * pack_size`. If the invoice's unit_price is
 * closer to the pack price, the invoice is priced per-pack — typical for
 * bakeries (a "4-pack croissant @ $6.19" invoice line vs an inventory item
 * with unit_cost=$1.55, pack_size=4).
 *
 * Caveats:
 *   - Returns mode='per_unit' when pack_size ≤ 1 (no pack interpretation
 *     possible).
 *   - When unit_cost ≤ 0, mode is forced to 'per_unit' and variancePct is
 *     0 (avoid division-by-zero; can't sensibly compare).
 *
 * Pure function — exported for unit tests.
 */
export function detectPriceMode(
  invoiceUnitPrice: number,
  inventoryUnitCost: number,
  inventoryPackSize: number,
): PriceModeResult {
  const packSize = Math.max(1, inventoryPackSize || 1)

  if (inventoryUnitCost <= 0) {
    return {
      mode: 'per_unit',
      comparatorCost: 0,
      variancePct: 0,
      effectiveUnitPrice: invoiceUnitPrice,
      packSize,
    }
  }

  const variancePerUnit = Math.abs(invoiceUnitPrice - inventoryUnitCost) / inventoryUnitCost * 100

  if (packSize === 1) {
    return {
      mode: 'per_unit',
      comparatorCost: inventoryUnitCost,
      variancePct: variancePerUnit,
      effectiveUnitPrice: invoiceUnitPrice,
      packSize: 1,
    }
  }

  const inventoryPackCost = inventoryUnitCost * packSize
  const variancePerPack = Math.abs(invoiceUnitPrice - inventoryPackCost) / inventoryPackCost * 100

  if (variancePerPack < variancePerUnit) {
    return {
      mode: 'per_pack',
      comparatorCost: inventoryPackCost,
      variancePct: variancePerPack,
      effectiveUnitPrice: invoiceUnitPrice / packSize,
      packSize,
    }
  }

  return {
    mode: 'per_unit',
    comparatorCost: inventoryUnitCost,
    variancePct: variancePerUnit,
    effectiveUnitPrice: invoiceUnitPrice,
    packSize,
  }
}

/**
 * MOK-134: among multiple same-name inventory candidates, pick the one whose
 * `detectPriceMode` variance is smallest against the invoice's unit_price.
 *
 * Domain invariant (per `project_inventory_pack_pair_invariant.md`): for every
 * inventory item with `pack_size > 1`, the tenant's catalog has a paired
 * `pack_size = 1` row sharing the same `square_item_id`. So when an invoice
 * line description matches multiple inventory rows by name, the right pick
 * is whichever row's price interpretation (per-unit or per-pack) lands
 * closest to the invoice's unit_price.
 *
 * Pure function — exported for unit tests. Caller filters out unsuitable
 * candidates ($0 stubs etc.); this function always returns one.
 */
export function pickBestPackAwareMatch<T extends { unit_cost: number; pack_size: number }>(
  candidates: T[],
  invoiceUnitPrice: number,
): T {
  if (candidates.length === 1) return candidates[0]
  let best = candidates[0]
  let bestVariance = detectPriceMode(invoiceUnitPrice, best.unit_cost, best.pack_size).variancePct
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]
    const v = detectPriceMode(invoiceUnitPrice, c.unit_cost, c.pack_size).variancePct
    if (v < bestVariance) {
      best = c
      bestVariance = v
    }
  }
  return best
}

/**
 * MOK-144: after the initial alias/exact/fuzzy match picks an inventory row,
 * promote to a pack-pair sibling (rows sharing the matched row's
 * `square_item_id`) when a sibling is a strictly better price-mode match.
 * Optional supplier-match tiebreaker resolves ties in favor of the row whose
 * supplier matches the invoice's resolved supplier — important after a
 * supplier transition (Aspen→Bluepoint) where the pack=1 sibling lives on
 * the old supplier and the pack=4 on the new one.
 *
 * Returns the original row when:
 *   - no `square_item_id` (no group to promote within)
 *   - no other live pack-pair siblings exist
 *   - the original is already the lowest-variance member
 *
 * Pure function — exported for unit tests. Caller is responsible for filtering
 * the inventory list (deleted_at IS NULL is applied at load).
 */
export interface PackPairCandidate {
  id: string
  unit_cost: number
  pack_size: number
  square_item_id: string | null
  supplier_id: string | null
}

export function promoteToPackPairSibling<T extends PackPairCandidate>(
  initial: T,
  inventory: T[],
  invoiceUnitPrice: number,
  invoiceSupplierId: string | null,
): T {
  if (!initial.square_item_id) return initial

  const siblings = inventory.filter(
    (i) =>
      i.square_item_id === initial.square_item_id &&
      i.unit_cost > 0 && // skeleton/legacy stubs (MOK-110) excluded
      i.id !== initial.id,
  )
  if (siblings.length === 0) return initial

  const group: T[] = [initial, ...siblings]

  // Score each by detectPriceMode variance.
  const scored = group.map((row) => ({
    row,
    variance: detectPriceMode(invoiceUnitPrice, row.unit_cost, row.pack_size).variancePct,
  }))

  // Within numerical noise (0.001%), treat variances as tied.
  const minVariance = Math.min(...scored.map((s) => s.variance))
  const tied = scored.filter((s) => Math.abs(s.variance - minVariance) < 0.001)

  // Tiebreaker: prefer supplier match if the invoice resolved a supplier.
  if (invoiceSupplierId && tied.length > 1) {
    const supplierMatch = tied.find((s) => s.row.supplier_id === invoiceSupplierId)
    if (supplierMatch) return supplierMatch.row
  }

  // No tie or no supplier preference resolved — return the lowest-variance row.
  return tied[0].row
}

/**
 * MOK-124: did the invoice line use a description meaningfully different
 * from the matched inventory item's canonical name? Heuristic:
 *   - normalize both sides (lowercase, strip non-alphanumeric)
 *   - if the normalized strings are identical → not a replacement
 *   - if either is a substring of the other → not a replacement
 *     (handles "Bagels" → "Plain bagels" — same product, more detail)
 *   - otherwise → replacement candidate
 *
 * This is the conservative "option a" from the MOK-124 ticket. False
 * positives are tolerable since replacement rows are informational; we'll
 * tighten with AI semantic similarity in a follow-up if noise becomes a
 * problem.
 */
function isReplacement(invoiceDescription: string, inventoryItemName: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const a = normalize(invoiceDescription)
  const b = normalize(inventoryItemName)
  if (a.length === 0 || b.length === 0) return false
  if (a === b) return false
  if (a.includes(b) || b.includes(a)) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Quantity variance check
// ─────────────────────────────────────────────────────────────────────────────

async function checkQuantityVariance(
  ctx: PipelineContext,
  item: InvoiceItem,
  inventoryItem: InventoryItem,
  priceMode: PriceModeResult,
): Promise<void> {
  if (!ctx.poMatchId) return

  // Load the PO match to get the purchase_order_id
  const { data: poMatch } = await ctx.supabase
    .from('order_invoice_matches')
    .select('purchase_order_id')
    .eq('id', ctx.poMatchId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!poMatch) return

  // Look for a PO line item matching this inventory item.
  // MOK-119: column is `quantity_ordered`, not `quantity` — the prior code
  // would error here even when the column-existence check upstream passed.
  const { data: poItem } = await ctx.supabase
    .from('purchase_order_items')
    .select('id, quantity_ordered, inventory_item_id')
    .eq('purchase_order_id', poMatch.purchase_order_id)
    .eq('inventory_item_id', inventoryItem.id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!poItem || !poItem.quantity_ordered) return

  // MOK-133: normalize invoice quantity to individuals when priced per-pack.
  // PO `quantity_ordered` is canonically in individuals; invoice quantity
  // mirrors the priced unit. When matched per-pack, multiply through.
  const effectiveInvoiceQty = priceMode.mode === 'per_pack'
    ? item.quantity * priceMode.packSize
    : item.quantity

  const variancePct =
    Math.abs((effectiveInvoiceQty - poItem.quantity_ordered) / poItem.quantity_ordered) * 100
  const thresholdPct = ctx.tenantSettings.totalVarianceThresholdPct

  // MOK-121: any non-zero variance produces an exception. Severity is 'info'
  // (notify but don't block) below the threshold and 'block' (gate
  // confirmation) at/above it. Stage 5 only gates on 'block' exceptions.
  if (variancePct > 0) {
    const severity = variancePct > thresholdPct ? 'block' : 'info'

    // Get PO number for message
    const { data: po } = await ctx.supabase
      .from('purchase_orders')
      .select('order_number')
      .eq('id', poMatch.purchase_order_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()

    const direction = severity === 'block'
      ? `Exceeds the ${thresholdPct}% threshold.`
      : `Below the ${thresholdPct}% threshold — informational only.`
    const packNote = priceMode.mode === 'per_pack'
      ? ` (invoice ${item.quantity} packs × ${priceMode.packSize} = ${effectiveInvoiceQty} units)`
      : ''

    const exceptionId = await createException(ctx, {
      type: 'quantity_variance',
      severity,
      message:
        `Quantity for "${inventoryItem.item_name}" differs from PO by ${variancePct.toFixed(1)}% ` +
        `(PO: ${poItem.quantity_ordered}, Invoice: ${effectiveInvoiceQty})${packNote}. ${direction}`,
      context: {
        item_description: item.item_description,
        inventory_item_id: inventoryItem.id,
        po_quantity: poItem.quantity_ordered,
        invoice_quantity: effectiveInvoiceQty,
        invoice_quantity_raw: item.quantity,
        variance_pct: variancePct,
        threshold_pct: thresholdPct,
        purchase_order_id: poMatch.purchase_order_id,
        purchase_order_number: po?.order_number ?? 'Unknown',
        // MOK-133: surface the normalization for downstream consumers.
        price_mode: priceMode.mode,
        pack_size: priceMode.packSize,
      },
      invoiceItemId: item.id,
      pipelineStage: STAGE,
    })

    // MOK-122: persist to variance history shadow table.
    // invoice_quantity is stored in the same canonical unit (individuals)
    // as po_quantity so analytics queries can compare them directly.
    await recordVariance(ctx, {
      varianceType: 'quantity_variance',
      severity,
      invoiceItemId: item.id,
      purchaseOrderId: poMatch.purchase_order_id,
      poQuantity: poItem.quantity_ordered,
      invoiceQuantity: effectiveInvoiceQty,
      invoiceDescription: item.item_description,
      variancePct,
      thresholdPct,
      relatedExceptionId: exceptionId,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Variance history (MOK-122)
// ─────────────────────────────────────────────────────────────────────────────

interface RecordVarianceInput {
  varianceType: 'quantity_variance' | 'price_variance' | 'replacement'
  severity: 'info' | 'block'
  invoiceItemId?: string
  purchaseOrderId?: string
  poQuantity?: number
  invoiceQuantity?: number
  poUnitCost?: number
  invoiceUnitPrice?: number
  poDescription?: string
  invoiceDescription?: string
  variancePct?: number
  thresholdPct?: number
  relatedExceptionId?: string
}

/**
 * MOK-122: write a row to invoice_variance_history. Called for every variance
 * encountered by stage 4, regardless of severity. The history table is the
 * permanent record — even if the related invoice_exceptions row is dismissed
 * or resolved later, the history persists for supplier-performance reporting.
 *
 * Failures here are logged but non-fatal: a missed history row shouldn't
 * block the pipeline (the exception itself was already created). MOK-119's
 * lesson — surface stage 4 failures via createException — applies if the
 * exception step succeeded but history failed; in that case the user sees
 * the exception, the history is just incomplete.
 */
async function recordVariance(
  ctx: PipelineContext,
  input: RecordVarianceInput,
): Promise<void> {
  const { error } = await ctx.supabase
    .from('invoice_variance_history')
    .insert({
      tenant_id: ctx.tenantId,
      invoice_id: ctx.invoiceId,
      invoice_item_id: input.invoiceItemId ?? null,
      purchase_order_id: input.purchaseOrderId ?? null,
      supplier_id: ctx.resolvedSupplierId ?? null,
      variance_type: input.varianceType,
      severity: input.severity,
      po_quantity: input.poQuantity ?? null,
      invoice_quantity: input.invoiceQuantity ?? null,
      po_unit_cost: input.poUnitCost ?? null,
      invoice_unit_price: input.invoiceUnitPrice ?? null,
      po_description: input.poDescription ?? null,
      invoice_description: input.invoiceDescription ?? null,
      variance_pct: input.variancePct ?? null,
      threshold_pct: input.thresholdPct ?? null,
      related_exception_id: input.relatedExceptionId ?? null,
    })

  if (error) {
    console.warn('[04-match-items] Failed to record variance history:', error.message)
    // Non-fatal — the related exception (if any) is already created
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI fuzzy item matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Use OpenRouter GPT-4o to fuzzy-match an invoice line item description
 * against the inventory item list.
 *
 * Returns candidates sorted by confidence descending.
 *
 * Design note: Fuse.js and string-similarity were evaluated for Deno compatibility.
 * Both require npm: specifier and have been replaced with AI-based matching
 * which provides superior accuracy for supplier-specific naming conventions.
 */
async function fuzzyMatchItemsWithAI(
  description: string,
  inventory: InventoryItem[]
): Promise<FuzzyItemMatch[]> {
  if (inventory.length === 0) return []

  const apiKey = Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) {
    console.warn('[04-match-items] OPENROUTER_API_KEY not set, cannot fuzzy match')
    return []
  }

  // Batch inventory list — truncate if too many items to avoid token limits
  const maxItems = 200
  const inventorySlice = inventory.slice(0, maxItems)
  const inventoryListText = inventorySlice
    .map((i) => `ID:${i.id}|Name:${i.item_name}|Cost:${i.unit_cost}`)
    .join('\n')

  const prompt = `You are an inventory item matching assistant for a coffee shop/cafe.

Match the invoice line item description to the best inventory items.

Invoice description: "${description}"

Inventory items (ID|Name|UnitCost):
${inventoryListText}

Return ONLY a JSON array of the best matches (up to 5), best first:
[{"inventory_item_id":"uuid","item_name":"string","confidence":0.0-1.0,"unit_cost":number}]

Matching rules:
- 0.95+: Near-identical (spelling variation, abbreviation)
- 0.85-0.94: Strong match (same product, different naming convention)
- 0.70-0.84: Plausible match (similar product, brand variant)
- Below 0.70: Uncertain — include but confidence reflects uncertainty
- Consider: product category, brand names, package sizes, common cafe/restaurant items
- Return [] if no reasonable match exists
- Return ONLY the JSON array`

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://cafe-pulse.mokesai.com',
        'X-Title': 'CafePulse Invoice Pipeline',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 512,
      }),
    })

    if (!response.ok) return []

    const responseJson = await response.json()
    const content = responseJson?.choices?.[0]?.message?.content ?? '[]'

    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return []

    const matches = JSON.parse(jsonMatch[0]) as FuzzyItemMatch[]
    return matches
      .filter((m) => m.inventory_item_id && typeof m.confidence === 'number')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
  } catch (err) {
    console.warn('[04-match-items] AI fuzzy match error:', sanitizeError(err))
    return []
  }
}
