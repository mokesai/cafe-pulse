import { describe, expect, it } from 'vitest'
import {
  isPurchaseOrderOverdue,
  todayLocalDateString,
  TERMINAL_PO_STATUSES,
} from '../is-overdue'

// Fix "now" so tests are deterministic across timezones. Use a noon-local
// instant on 2026-05-03 so todayLocalDateString returns '2026-05-03'.
const NOON_2026_05_03 = new Date('2026-05-03T18:00:00Z') // ~noon Mountain (MDT)

describe('todayLocalDateString', () => {
  it('returns YYYY-MM-DD in local TZ', () => {
    expect(todayLocalDateString(NOON_2026_05_03)).toBe('2026-05-03')
  })
})

describe('isPurchaseOrderOverdue', () => {
  it('terminal statuses are never overdue', () => {
    for (const status of TERMINAL_PO_STATUSES) {
      expect(
        isPurchaseOrderOverdue({ status, expected_delivery_date: '2025-01-01' }, NOON_2026_05_03),
      ).toBe(false)
    }
  })

  it('confirmed PO whose expected delivery is in the past is NOT overdue (regression for MOK-146)', () => {
    expect(
      isPurchaseOrderOverdue(
        { status: 'confirmed', expected_delivery_date: '2026-04-21' },
        NOON_2026_05_03,
      ),
    ).toBe(false)
  })

  it('sent PO past expected delivery IS overdue', () => {
    expect(
      isPurchaseOrderOverdue(
        { status: 'sent', expected_delivery_date: '2026-05-01' },
        NOON_2026_05_03,
      ),
    ).toBe(true)
  })

  it('sent PO with expected = today is NOT overdue (timezone fix)', () => {
    // Pre-fix this returned true: new Date('2026-05-03') is UTC midnight which
    // is ~6PM 2026-05-02 in Mountain, before noon Mountain 2026-05-03 → overdue.
    expect(
      isPurchaseOrderOverdue(
        { status: 'sent', expected_delivery_date: '2026-05-03' },
        NOON_2026_05_03,
      ),
    ).toBe(false)
  })

  it('sent PO with expected in the future is NOT overdue', () => {
    expect(
      isPurchaseOrderOverdue(
        { status: 'sent', expected_delivery_date: '2026-05-10' },
        NOON_2026_05_03,
      ),
    ).toBe(false)
  })

  it('null expected_delivery_date is NOT overdue', () => {
    expect(
      isPurchaseOrderOverdue(
        { status: 'sent', expected_delivery_date: null },
        NOON_2026_05_03,
      ),
    ).toBe(false)
  })
})
