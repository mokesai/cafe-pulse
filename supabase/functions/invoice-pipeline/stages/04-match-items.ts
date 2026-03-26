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
  sku: string | null
  unit_cost: number
  tenant_id: string
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
  const { data: inventoryItems, error: invError } = await ctx.supabase
    .from('inventory_items')
    .select('id, item_name, sku, unit_cost, tenant_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('is_active', true)

  if (invError) {
    return { ok: false, fatal: true, error: `Failed to load inventory items: ${invError.message}` }
  }

  const inventory = (inventoryItems ?? []) as InventoryItem[]

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
      await processInvoiceItem(ctx, item, inventory, aliasMap, matchThreshold)
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

async function processInvoiceItem(
  ctx: PipelineContext,
  item: InvoiceItem,
  inventory: InventoryItem[],
  aliasMap: Map<string, { inventory_item_id: string; confidence: number }>,
  matchThreshold: number
): Promise<void> {
  // ── Step 1: Alias cache lookup ─────────────────────────────────────────────
  const cachedAlias = aliasMap.get(item.item_description)
  if (cachedAlias) {
    const inventoryItem = inventory.find((i) => i.id === cachedAlias.inventory_item_id)
    if (inventoryItem) {
      await applyItemMatch(ctx, item, inventoryItem, cachedAlias.confidence, 'alias')
      return
    }
  }

  // ── Step 2: SKU match ──────────────────────────────────────────────────────
  if (item.supplier_item_code) {
    const skuMatch = inventory.find(
      (i) => i.sku && i.sku.toLowerCase() === item.supplier_item_code!.toLowerCase()
    )
    if (skuMatch) {
      await applyItemMatch(ctx, item, skuMatch, 1.0, 'sku')
      if (ctx.resolvedSupplierId) {
        await upsertAlias(ctx, {
          supplierId: ctx.resolvedSupplierId,
          supplierDescription: item.item_description,
          inventoryItemId: skuMatch.id,
          confidence: 1.0,
          source: 'auto',
        })
      }
      return
    }
  }

  // ── Step 3: Exact name match ───────────────────────────────────────────────
  const exactNameMatch = inventory.find(
    (i) => i.item_name.toLowerCase() === item.item_description.toLowerCase()
  )
  if (exactNameMatch) {
    await applyItemMatch(ctx, item, exactNameMatch, 1.0, 'exact')
    if (ctx.resolvedSupplierId) {
      await upsertAlias(ctx, {
        supplierId: ctx.resolvedSupplierId,
        supplierDescription: item.item_description,
        inventoryItemId: exactNameMatch.id,
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

  await applyItemMatch(ctx, item, matchedInventoryItem, topMatch.confidence, 'fuzzy')

  // Upsert alias for future fast lookups
  if (ctx.resolvedSupplierId) {
    await upsertAlias(ctx, {
      supplierId: ctx.resolvedSupplierId,
      supplierDescription: item.item_description,
      inventoryItemId: matchedInventoryItem.id,
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

  // ── Check price variance ──────────────────────────────────────────────────
  const priceVariancePct = inventoryItem.unit_cost > 0
    ? Math.abs((item.unit_price - inventoryItem.unit_cost) / inventoryItem.unit_cost) * 100
    : 0

  const priceThresholdPct = ctx.tenantSettings.priceVarianceThresholdPct

  if (priceVariancePct > priceThresholdPct && inventoryItem.unit_cost > 0) {
    await createException(ctx, {
      type: 'price_variance',
      message: `Unit price for "${inventoryItem.item_name}" changed ${priceVariancePct > 0 ? '+' : ''}${priceVariancePct.toFixed(1)}% (from $${inventoryItem.unit_cost.toFixed(2)} to $${item.unit_price.toFixed(2)}). Exceeds the ${priceThresholdPct}% threshold.`,
      context: {
        item_description: item.item_description,
        inventory_item_id: inventoryItem.id,
        inventory_item_name: inventoryItem.item_name,
        previous_unit_cost: inventoryItem.unit_cost,
        invoice_unit_price: item.unit_price,
        variance_pct: ((item.unit_price - inventoryItem.unit_cost) / inventoryItem.unit_cost) * 100,
        threshold_pct: priceThresholdPct,
        po_unit_cost: null, // Could be enriched from PO match if available
      },
      invoiceItemId: item.id,
      pipelineStage: STAGE,
    })
  }

  // ── Check quantity variance vs PO ─────────────────────────────────────────
  if (ctx.poMatchId) {
    await checkQuantityVariance(ctx, item, inventoryItem)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Quantity variance check
// ─────────────────────────────────────────────────────────────────────────────

async function checkQuantityVariance(
  ctx: PipelineContext,
  item: InvoiceItem,
  inventoryItem: InventoryItem
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

  // Look for a PO line item matching this inventory item
  const { data: poItem } = await ctx.supabase
    .from('purchase_order_items')
    .select('id, quantity, inventory_item_id')
    .eq('purchase_order_id', poMatch.purchase_order_id)
    .eq('inventory_item_id', inventoryItem.id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!poItem || !poItem.quantity) return

  const variancePct = Math.abs((item.quantity - poItem.quantity) / poItem.quantity) * 100
  const thresholdPct = ctx.tenantSettings.totalVarianceThresholdPct

  if (variancePct > thresholdPct) {
    // Get PO number for message
    const { data: po } = await ctx.supabase
      .from('purchase_orders')
      .select('po_number')
      .eq('id', poMatch.purchase_order_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()

    await createException(ctx, {
      type: 'quantity_variance',
      message: `Quantity for "${inventoryItem.item_name}" differs from PO by ${variancePct.toFixed(1)}% (PO: ${poItem.quantity}, Invoice: ${item.quantity}). Exceeds the ${thresholdPct}% threshold.`,
      context: {
        item_description: item.item_description,
        inventory_item_id: inventoryItem.id,
        po_quantity: poItem.quantity,
        invoice_quantity: item.quantity,
        variance_pct: variancePct,
        threshold_pct: thresholdPct,
        purchase_order_id: poMatch.purchase_order_id,
        purchase_order_number: po?.po_number ?? 'Unknown',
      },
      invoiceItemId: item.id,
      pipelineStage: STAGE,
    })
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
    .map((i) => `ID:${i.id}|Name:${i.item_name}|SKU:${i.sku ?? 'none'}|Cost:${i.unit_cost}`)
    .join('\n')

  const prompt = `You are an inventory item matching assistant for a coffee shop/cafe.

Match the invoice line item description to the best inventory items.

Invoice description: "${description}"

Inventory items (ID|Name|SKU|UnitCost):
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
