import type { InvoiceExceptionType } from '@/types/invoice-exceptions'

/**
 * MOK-183 — bulk "Mark Resolved" must send the SAME approve action the per-item form sends, so
 * accepting a variance in bulk actually applies its value instead of the old no-op
 * `approve_and_continue` (which silently skipped cost reconciliation, leaving inventory cost
 * stale). Bulk resolve is same-type-only, so the selected type maps unambiguously.
 *
 *  - price_variance    → approve_cost_update  (applies the accepted cost to inventory)
 *  - quantity_variance → confirm_quantity     (accept the invoice quantity)
 *  - everything else   → approve_and_continue (no-op clear; those need a per-item decision)
 */
export function bulkResolveAction(type: InvoiceExceptionType): { type: string } {
  switch (type) {
    case 'price_variance':
      return { type: 'approve_cost_update' }
    case 'quantity_variance':
      return { type: 'confirm_quantity' }
    default:
      return { type: 'approve_and_continue' }
  }
}

/** Whether bulk-resolve will apply a value (vs. just clear) for the given type — drives copy. */
export function bulkResolveApplies(type: InvoiceExceptionType): boolean {
  return type === 'price_variance' || type === 'quantity_variance'
}
