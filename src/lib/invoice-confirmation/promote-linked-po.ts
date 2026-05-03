import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * MOK-145 — Node-side mirror of the Deno helper at
 * `supabase/functions/invoice-pipeline/lib/promote-linked-po.ts`.
 * Called from `tryAutoConfirmInvoice` in the resolve-exception route so
 * invoices that clear via exception resolution promote their linked POs +
 * match rows to `confirmed`, mirroring stage 5's happy-path behavior.
 *
 * Idempotent. Filters PO updates by `status IN ('sent','approved','received')`
 * so re-running on an already-confirmed PO is a no-op. `received_at` is left
 * alone to preserve the operator's real receipt timestamp.
 */

export interface PromoteLinkedPoResult {
  matchesUpdated: number
  posUpdated: number
}

const PO_PROMOTABLE_STATUSES = ['sent', 'approved', 'received']

export async function promoteLinkedPo(
  supabase: SupabaseClient,
  invoiceId: string,
  tenantId: string,
): Promise<PromoteLinkedPoResult> {
  const { data: matches, error: matchesError } = await supabase
    .from('order_invoice_matches')
    .select('id, purchase_order_id')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)

  if (matchesError) {
    console.warn('[promote-linked-po] Failed to load matches:', matchesError.message)
    return { matchesUpdated: 0, posUpdated: 0 }
  }

  if (!matches || matches.length === 0) {
    return { matchesUpdated: 0, posUpdated: 0 }
  }

  const matchIds = matches.map((m: { id: string }) => m.id)
  const poIds = Array.from(
    new Set(
      matches
        .map((m: { purchase_order_id: string | null }) => m.purchase_order_id)
        .filter((id: string | null): id is string => Boolean(id)),
    ),
  )

  const nowIso = new Date().toISOString()

  const { error: matchUpdateError } = await supabase
    .from('order_invoice_matches')
    .update({ status: 'confirmed', updated_at: nowIso })
    .in('id', matchIds)
    .eq('tenant_id', tenantId)

  if (matchUpdateError) {
    console.warn('[promote-linked-po] Failed to update matches:', matchUpdateError.message)
    return { matchesUpdated: 0, posUpdated: 0 }
  }

  let posUpdated = 0
  if (poIds.length > 0) {
    const { data: updatedPos, error: poUpdateError } = await supabase
      .from('purchase_orders')
      .update({ status: 'confirmed', confirmed_at: nowIso, updated_at: nowIso })
      .in('id', poIds)
      .eq('tenant_id', tenantId)
      .in('status', PO_PROMOTABLE_STATUSES)
      .select('id')

    if (poUpdateError) {
      console.warn('[promote-linked-po] Failed to update POs:', poUpdateError.message)
    } else {
      posUpdated = updatedPos?.length ?? 0
    }
  }

  return { matchesUpdated: matchIds.length, posUpdated }
}
