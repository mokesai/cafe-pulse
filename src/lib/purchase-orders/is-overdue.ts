/**
 * MOK-146 — overdue check shared by the PO list UI and the `?dateFilter=overdue`
 * API filter. Two things this gets right that the inline version did not:
 *
 * 1. `confirmed` is a terminal status (post-invoice-reconciliation) and must
 *    be excluded alongside `received` and `cancelled`.
 * 2. `expected_delivery_date` is SQL `date` (no time/TZ). `new Date('YYYY-MM-DD')`
 *    in JS treats it as UTC midnight, which is ~6PM the prior day in Mountain
 *    time. Comparing that against `new Date()` makes a PO scheduled for "today"
 *    flip overdue all day for west-of-UTC operators. Compare YYYY-MM-DD strings
 *    in the operator's local TZ instead.
 */

export const TERMINAL_PO_STATUSES = ['received', 'confirmed', 'cancelled'] as const

export interface OverdueCandidate {
  status: string
  expected_delivery_date: string | null
}

/** Today's date as a YYYY-MM-DD string in the operator's local TZ. */
export function todayLocalDateString(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isPurchaseOrderOverdue(
  order: OverdueCandidate,
  now: Date = new Date(),
): boolean {
  if (!order.expected_delivery_date) return false
  if ((TERMINAL_PO_STATUSES as readonly string[]).includes(order.status)) return false
  return order.expected_delivery_date < todayLocalDateString(now)
}
