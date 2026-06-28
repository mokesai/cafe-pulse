/**
 * B1 / MOK-173 — computeCogsStatus turns weekly COGS + revenue into a percentage, a
 * week-over-week trend, and a good/bad signal against the tenant target.
 */
import { describe, expect, it } from 'vitest'

import { computeCogsStatus } from '../dashboard-status'

const base = { priorWeeklyCogs: 0, priorWeeklyRevenue: 0, targetPct: 30 }

describe('computeCogsStatus (MOK-173)', () => {
  it('good when COGS% is at or below target', () => {
    const s = computeCogsStatus({ ...base, weeklyCogs: 280, weeklyRevenue: 1000 })
    expect(s.cogsPct).toBe(28)
    expect(s.signal).toBe('good')
  })

  it('good exactly at target', () => {
    const s = computeCogsStatus({ ...base, weeklyCogs: 300, weeklyRevenue: 1000 })
    expect(s.cogsPct).toBe(30)
    expect(s.signal).toBe('good')
  })

  it('warning within 3 pp over target', () => {
    const s = computeCogsStatus({ ...base, weeklyCogs: 320, weeklyRevenue: 1000 })
    expect(s.cogsPct).toBe(32)
    expect(s.signal).toBe('warning')
  })

  it('alert beyond target + 3 pp', () => {
    const s = computeCogsStatus({ ...base, weeklyCogs: 400, weeklyRevenue: 1000 })
    expect(s.cogsPct).toBe(40)
    expect(s.signal).toBe('alert')
  })

  it('no_sales with null cogsPct when there is no revenue', () => {
    const s = computeCogsStatus({ ...base, weeklyCogs: 200, weeklyRevenue: 0 })
    expect(s.cogsPct).toBeNull()
    expect(s.signal).toBe('no_sales')
    expect(s.trendPp).toBeNull()
  })

  it('computes the week-over-week trend in percentage points', () => {
    const s = computeCogsStatus({
      weeklyCogs: 320,
      weeklyRevenue: 1000,
      priorWeeklyCogs: 260,
      priorWeeklyRevenue: 1000,
      targetPct: 30,
    })
    expect(s.cogsPct).toBe(32)
    expect(s.priorCogsPct).toBe(26)
    expect(s.trendPp).toBe(6)
  })
})
