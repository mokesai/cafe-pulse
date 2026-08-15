/**
 * B3 / MOK-175 — detect inventory items whose supplier cost jumped recently, so operators get a
 * proactive "review your menu price" signal. Computed from inventory_item_cost_history; no margin
 * (margin needs a sale price the app doesn't store yet — deferred to the Theoretical COGS project).
 */
import type { createServiceClient } from '@/lib/supabase/server'

type SupabaseClient = ReturnType<typeof createServiceClient>

/** Flag an item when its unit cost rose at least this much over the window. */
export const COST_JUMP_THRESHOLD_PCT = 10
export const COST_JUMP_WINDOW_DAYS = 30

export interface CostHistoryRow {
  inventory_item_id: string
  previous_unit_cost: number | null
  new_unit_cost: number
  changed_at: string
}

export interface InventoryCostItem {
  id: string
  item_name: string
  unit_cost: number
}

export interface PriceReviewItem {
  id: string
  item_name: string
  baseline_cost: number
  current_cost: number
  pct_change: number
  changed_at: string
}

const round = (n: number, dp = 2): number => Number((Number.isFinite(n) ? n : 0).toFixed(dp))

/**
 * Pure computation: for each item with cost changes in the window, compare the cost *before* the
 * earliest in-window change (baseline) against the item's current unit_cost. Flag items whose
 * cumulative increase meets the threshold. Sorted by largest jump first.
 */
export function computeCostJumps(
  items: InventoryCostItem[],
  history: CostHistoryRow[],
  opts: { thresholdPct?: number } = {},
): PriceReviewItem[] {
  const threshold = opts.thresholdPct ?? COST_JUMP_THRESHOLD_PCT

  const byItem = new Map<string, CostHistoryRow[]>()
  for (const h of history) {
    const arr = byItem.get(h.inventory_item_id) ?? []
    arr.push(h)
    byItem.set(h.inventory_item_id, arr)
  }
  const itemById = new Map(items.map((i) => [i.id, i]))

  const flagged: PriceReviewItem[] = []
  for (const [itemId, rows] of byItem) {
    const item = itemById.get(itemId)
    if (!item) continue

    const sorted = [...rows].sort((a, b) => a.changed_at.localeCompare(b.changed_at))
    const baseline = sorted[0].previous_unit_cost
    if (baseline == null || baseline <= 0) continue // no comparable prior cost

    const current = Number(item.unit_cost) || 0
    const pct = ((current - baseline) / baseline) * 100
    if (pct >= threshold) {
      flagged.push({
        id: item.id,
        item_name: item.item_name,
        baseline_cost: round(baseline, 4),
        current_cost: round(current, 4),
        pct_change: round(pct, 1),
        changed_at: sorted[sorted.length - 1].changed_at,
      })
    }
  }

  return flagged.sort((a, b) => b.pct_change - a.pct_change)
}

/** Fetch cost history for the window + the affected items, then compute the flagged set. */
export async function getCostJumpItems(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { thresholdPct?: number; windowDays?: number } = {},
): Promise<PriceReviewItem[]> {
  const windowDays = opts.windowDays ?? COST_JUMP_WINDOW_DAYS
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - windowDays)

  const { data: history } = await supabase
    .from('inventory_item_cost_history')
    .select('inventory_item_id, previous_unit_cost, new_unit_cost, changed_at')
    .eq('tenant_id', tenantId)
    .gte('changed_at', since.toISOString())

  const itemIds = [...new Set((history ?? []).map((h) => h.inventory_item_id as string))]
  if (itemIds.length === 0) return []

  const { data: items } = await supabase
    .from('inventory_items')
    .select('id, item_name, unit_cost')
    .eq('tenant_id', tenantId)
    .in('id', itemIds)
    .is('deleted_at', null)

  return computeCostJumps(
    (items ?? []) as InventoryCostItem[],
    (history ?? []) as CostHistoryRow[],
    { thresholdPct: opts.thresholdPct },
  )
}
