/**
 * MOK-183 — bulk "Mark Resolved" maps each variance type to the same approve action the per-item
 * form sends, so accepting in bulk applies the value instead of the old no-op approve_and_continue.
 */
import { describe, expect, it } from 'vitest'

import { bulkResolveAction, bulkResolveApplies } from '../bulk-resolve-action'

describe('bulkResolveAction (MOK-183)', () => {
  it('price_variance → approve_cost_update (applies the cost)', () => {
    expect(bulkResolveAction('price_variance')).toEqual({ type: 'approve_cost_update' })
  })

  it('quantity_variance → confirm_quantity', () => {
    expect(bulkResolveAction('quantity_variance')).toEqual({ type: 'confirm_quantity' })
  })

  it('non-variance types → approve_and_continue (no-op clear)', () => {
    expect(bulkResolveAction('no_item_match')).toEqual({ type: 'approve_and_continue' })
    expect(bulkResolveAction('no_supplier_match')).toEqual({ type: 'approve_and_continue' })
    expect(bulkResolveAction('duplicate_invoice')).toEqual({ type: 'approve_and_continue' })
  })

  it('bulkResolveApplies is true only for variance types', () => {
    expect(bulkResolveApplies('price_variance')).toBe(true)
    expect(bulkResolveApplies('quantity_variance')).toBe(true)
    expect(bulkResolveApplies('no_item_match')).toBe(false)
  })
})
