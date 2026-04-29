import type { createServiceClient } from '@/lib/supabase/server'

type SupabaseClient = ReturnType<typeof createServiceClient>

/**
 * MOK-130 — apply a price-variance acceptance to inventory.
 *
 * Called from both /resolve (action='approve_cost_update') and /acknowledge
 * when the exception is type='price_variance'. Both actions mean the admin
 * accepted the new price; the inventory should reflect it.
 *
 * Pack-aware (MOK-133): when the exception was raised in per-pack mode,
 * `effective_unit_price` is the per-individual equivalent (invoice price ÷
 * pack_size). That's what gets written to `inventory_items.unit_cost` —
 * NOT the raw invoice unit_price, which would be the pack price for
 * pack-priced invoices and would corrupt all future per-unit comparisons.
 *
 * Falls back to `invoice_unit_price` for legacy exceptions written before
 * MOK-133 added the pack-mode context fields.
 *
 * Side effects:
 *  - UPDATE inventory_items SET unit_cost = <new value>
 *  - INSERT inventory_item_cost_history audit row
 *
 * Failures here are logged and returned via the result so the caller can
 * decide whether to surface them. The caller has already applied its own
 * status transition (resolve / acknowledge); this is the inventory-side
 * follow-up.
 */
export interface PriceVarianceCostInput {
  invoiceId: string
  invoiceItemId?: string | null
  exceptionContext: Record<string, unknown>
  /** Used in cost_history.notes; e.g. 'approve_cost_update' or 'acknowledge'. */
  source: string
  changedBy?: string | null
}

export interface PriceVarianceCostResult {
  applied: boolean
  inventoryItemId?: string
  previousUnitCost?: number
  newUnitCost?: number
  error?: string
}

export async function applyPriceVarianceCostUpdate(
  supabase: SupabaseClient,
  tenantId: string,
  input: PriceVarianceCostInput,
): Promise<PriceVarianceCostResult> {
  const ctx = input.exceptionContext

  const inventoryItemId =
    typeof ctx.inventory_item_id === 'string' ? ctx.inventory_item_id : null
  if (!inventoryItemId) {
    return { applied: false, error: 'No inventory_item_id in exception context' }
  }

  // Prefer the MOK-133 per-individual equivalent if present; fall back to the
  // raw invoice unit price for legacy (pre-MOK-133) exceptions.
  const newUnitCostRaw =
    typeof ctx.effective_unit_price === 'number'
      ? ctx.effective_unit_price
      : typeof ctx.invoice_unit_price === 'number'
        ? ctx.invoice_unit_price
        : null
  if (newUnitCostRaw == null || !Number.isFinite(newUnitCostRaw)) {
    return { applied: false, error: 'No usable price in exception context' }
  }

  const previousUnitCost =
    typeof ctx.previous_unit_cost === 'number' ? ctx.previous_unit_cost : null

  // Round to 4 decimal places to match the rest of the cost-history pipeline.
  const newUnitCost = Math.round(newUnitCostRaw * 10000) / 10000

  const { error: updateError } = await supabase
    .from('inventory_items')
    .update({
      unit_cost: newUnitCost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', inventoryItemId)
    .eq('tenant_id', tenantId)

  if (updateError) {
    return {
      applied: false,
      inventoryItemId,
      error: `Failed to update inventory cost: ${updateError.message}`,
    }
  }

  // Audit row. Matches the schema used by stage 5's distributeFeesToCostHistory:
  // (previous_unit_cost, new_unit_cost, source, source_ref [uuid], notes,
  //  changed_by, changed_at, fee_amount).
  const priceMode =
    ctx.price_mode === 'per_pack' ? 'per_pack' : 'per_unit'
  const packSizeNote =
    typeof ctx.pack_size === 'number' && ctx.pack_size > 1
      ? ` (pack of ${ctx.pack_size})`
      : ''

  const { error: historyError } = await supabase
    .from('inventory_item_cost_history')
    .insert({
      tenant_id: tenantId,
      inventory_item_id: inventoryItemId,
      previous_unit_cost: previousUnitCost,
      new_unit_cost: newUnitCost,
      pack_size:
        typeof ctx.pack_size === 'number' ? ctx.pack_size : 1,
      source: input.source,
      source_ref: input.invoiceId,
      notes: `Applied via ${input.source} on price-variance exception (${priceMode}${packSizeNote})`,
      changed_by: input.changedBy ?? null,
    })

  if (historyError) {
    // Inventory updated, but audit row failed. Surface the error but consider
    // the cost update applied — the audit miss is recoverable; a wrong
    // inventory cost is not.
    return {
      applied: true,
      inventoryItemId,
      previousUnitCost: previousUnitCost ?? undefined,
      newUnitCost,
      error: `Cost updated but cost_history insert failed: ${historyError.message}`,
    }
  }

  return {
    applied: true,
    inventoryItemId,
    previousUnitCost: previousUnitCost ?? undefined,
    newUnitCost,
  }
}
