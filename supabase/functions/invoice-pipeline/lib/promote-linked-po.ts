/**
 * MOK-145 — promote linked POs and match rows when an invoice transitions
 * to `confirmed`. Called from stage 5 (happy-path auto-confirm) and from
 * `tryAutoConfirmInvoice` (Node-side mirror lives in
 * src/lib/invoice-confirmation/promote-linked-po.ts) so both confirmation
 * paths advance the PO/match state consistently.
 *
 * Why this isn't a single shared module: stage 5 is Deno (edge function),
 * the resolve route is Node (Next.js). Two parallel implementations against
 * the same Postgres tables; integration tests assert end-state parity.
 *
 * Idempotent: filters PO updates by `status IN ('sent','approved','received')`
 * so re-running on an already-confirmed invoice is a no-op (doesn't reset
 * `confirmed_at`). `received_at` is left alone to preserve the operator's
 * real receipt timestamp from the log-receipt UI.
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any

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

  const matchIds = (matches as Array<{ id: string }>).map((m) => m.id)
  const poIds = Array.from(
    new Set(
      (matches as Array<{ purchase_order_id: string | null }>)
        .map((m) => m.purchase_order_id)
        .filter((id): id is string => Boolean(id)),
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
