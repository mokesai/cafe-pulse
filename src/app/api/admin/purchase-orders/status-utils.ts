import type { SupabaseClient } from '@supabase/supabase-js'

const RAW_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'received',
  'cancelled',
  'confirmed'
] as const

export type PurchaseOrderStatus = (typeof RAW_STATUSES)[number]

export const VALID_STATUSES = new Set<string>(RAW_STATUSES)

const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_approval', 'approved', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['sent', 'received', 'confirmed', 'cancelled'],
  confirmed: ['cancelled'],
  sent: ['received', 'approved', 'confirmed', 'cancelled'],
  received: ['confirmed', 'cancelled'],
  cancelled: [],
}

export function canonicalStatus(status: string | null | undefined): string | null {
  if (!status) return null
  return status
}

export function isValidStatus(status: string | null | undefined): boolean {
  if (!status) return false
  return VALID_STATUSES.has(status)
}

export function canTransition(fromStatus: string, toStatus: string): boolean {
  const from = canonicalStatus(fromStatus) || fromStatus
  const to = canonicalStatus(toStatus)
  if (!to) return false
  if (from === toStatus || from === to) return true
  const allowed = STATUS_TRANSITIONS[from] || []
  return allowed.includes(to)
}

export async function insertStatusHistory(
  supabase: SupabaseClient,
  tenantId: string,
  purchaseOrderId: string,
  previousStatus: string | null,
  newStatus: string,
  changedBy?: string | null,
  note?: string | null
) {
  const canonicalPrevious = previousStatus ? canonicalStatus(previousStatus) || previousStatus : null
  const canonicalNew = canonicalStatus(newStatus) || newStatus

  const payload = {
    tenant_id: tenantId,
    purchase_order_id: purchaseOrderId,
    previous_status: canonicalPrevious,
    new_status: canonicalNew,
    changed_by: changedBy || null,
    note: note || null
  }

  const { error } = await supabase
    .from('purchase_order_status_history')
    .insert(payload)

  if (error) {
    console.error('Failed to insert purchase order status history:', error)
  }
}
