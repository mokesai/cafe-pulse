/**
 * B1 / MOK-173 — pure helper that turns weekly COGS + revenue into the dashboard's COGS status
 * (percentage of sales, week-over-week trend, and a good/bad signal against the tenant target).
 *
 * COGS% is null when there are no sales in the window (so the dashboard shows "—" rather than a
 * misleading ratio). The signal is graded against the tenant's target_cogs_percentage_pct.
 */
export type CogsSignal = 'good' | 'warning' | 'alert' | 'no_sales'

export interface CogsStatusInput {
  weeklyCogs: number
  weeklyRevenue: number
  priorWeeklyCogs: number
  priorWeeklyRevenue: number
  targetPct: number
}

export interface CogsStatus {
  weeklyCogs: number
  weeklyRevenue: number
  /** COGS as % of sales, or null when there were no sales this week. */
  cogsPct: number | null
  priorCogsPct: number | null
  /** Change in COGS% vs. the prior week, in percentage points (null if either week lacked sales). */
  trendPp: number | null
  targetPct: number
  signal: CogsSignal
}

const r = (n: number, dp = 2): number => Number((Number.isFinite(n) ? n : 0).toFixed(dp))

export function computeCogsStatus(input: CogsStatusInput): CogsStatus {
  const cogsPct = input.weeklyRevenue > 0 ? (input.weeklyCogs / input.weeklyRevenue) * 100 : null
  const priorCogsPct =
    input.priorWeeklyRevenue > 0 ? (input.priorWeeklyCogs / input.priorWeeklyRevenue) * 100 : null
  const trendPp = cogsPct != null && priorCogsPct != null ? r(cogsPct - priorCogsPct, 1) : null

  let signal: CogsSignal
  if (cogsPct == null) signal = 'no_sales'
  else if (cogsPct <= input.targetPct) signal = 'good'
  else if (cogsPct <= input.targetPct + 3) signal = 'warning'
  else signal = 'alert'

  return {
    weeklyCogs: r(input.weeklyCogs),
    weeklyRevenue: r(input.weeklyRevenue),
    cogsPct: cogsPct == null ? null : r(cogsPct, 1),
    priorCogsPct: priorCogsPct == null ? null : r(priorCogsPct, 1),
    trendPp,
    targetPct: input.targetPct,
    signal,
  }
}

/** Compact label for the always-visible app-shell COGS chip (B2 / MOK-174). */
export function cogsChipLabel(cogsPct: number | null): string {
  return cogsPct == null ? 'COGS —' : `COGS ${cogsPct}%`
}
