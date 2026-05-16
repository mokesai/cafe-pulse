/**
 * MOK-155 / KDS v3 phase 3 — admin route returning the tenant's mirrored
 * Square menu groups for use in the editor's box-binding picker.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-155
 * Plan: .planning/kds-v3/PHASE-3-PLAN.md (T1)
 *
 *   GET /api/admin/kds-v3/menu-groups
 *
 * Returns every MENU_CATEGORY menu group (is_top_level=false) for the current
 * tenant — including soft-deleted rows, so the editor can surface stale
 * bindings as "(deleted) <name>" rather than silently dropping operator intent.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: [
 *       {
 *         id: string,
 *         name: string,
 *         ordinal: number,
 *         item_count: number,         // non-deleted item rows joined to this group
 *         is_deleted: boolean,
 *         parent_menu_id: string | null,
 *         parent_menu_name: string | null
 *       },
 *       ...
 *     ]
 *   }
 *
 * Order: parent_menu_id, ordinal, name (deterministic for the editor's dropdown).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  // 1. Menu groups: MENU_CATEGORY rows that aren't the top-level "menu" row.
  //    Include is_deleted=true so stale bindings stay visible in the editor.
  const { data: groups, error: groupsError } = await supabase
    .from('square_menu_categories')
    .select('id, name, ordinal, is_deleted, parent_id')
    .eq('tenant_id', tenantId)
    .eq('is_top_level', false)
    .order('parent_id', { ascending: true })
    .order('ordinal', { ascending: true })
    .order('name', { ascending: true })

  if (groupsError) {
    return NextResponse.json(
      { success: false, error: groupsError.message, code: 'KDS_MENU_GROUPS_LIST_FAILED' },
      { status: 500 },
    )
  }

  const rows = groups ?? []
  if (rows.length === 0) {
    return NextResponse.json({ success: true, data: [] })
  }

  // 2. Parent menu names. The same table holds the top-level "menu" rows;
  //    one query keyed by id gives us a lookup table.
  const parentIds = Array.from(
    new Set(
      (rows as Array<{ parent_id: string | null }>)
        .map((r) => r.parent_id)
        .filter((v): v is string => typeof v === 'string'),
    ),
  )
  const parentNameById = new Map<string, string>()
  if (parentIds.length > 0) {
    const { data: parents } = await supabase
      .from('square_menu_categories')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_top_level', true)
      .in('id', parentIds)
    for (const p of (parents ?? []) as Array<{ id: string; name: string }>) {
      parentNameById.set(p.id, p.name)
    }
  }

  // 3. Item counts per group. Count non-deleted item rows joined to the
  //    membership table. Two queries (memberships + items) + JS aggregation
  //    is cleaner than a nested PostgREST select because we need to filter
  //    on `square_menu_items.is_deleted` after the join.
  const groupIds = (rows as Array<{ id: string }>).map((r) => r.id)
  const itemCountByGroup = new Map<string, number>()
  if (groupIds.length > 0) {
    const { data: memberships } = await supabase
      .from('square_menu_item_categories')
      .select('item_id, category_id')
      .eq('tenant_id', tenantId)
      .in('category_id', groupIds)

    const membershipRows = (memberships ?? []) as Array<{ item_id: string; category_id: string }>
    const referencedItemIds = Array.from(new Set(membershipRows.map((m) => m.item_id)))

    // Resolve which referenced items are not soft-deleted.
    const liveItems = new Set<string>()
    if (referencedItemIds.length > 0) {
      const { data: items } = await supabase
        .from('square_menu_items')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('is_deleted', false)
        .in('id', referencedItemIds)
      for (const it of (items ?? []) as Array<{ id: string }>) {
        liveItems.add(it.id)
      }
    }

    for (const m of membershipRows) {
      if (!liveItems.has(m.item_id)) continue
      itemCountByGroup.set(m.category_id, (itemCountByGroup.get(m.category_id) ?? 0) + 1)
    }
  }

  // 4. Compose the response.
  const data = (rows as Array<{
    id: string
    name: string
    ordinal: number
    is_deleted: boolean
    parent_id: string | null
  }>).map((g) => ({
    id: g.id,
    name: g.name,
    ordinal: g.ordinal,
    item_count: itemCountByGroup.get(g.id) ?? 0,
    is_deleted: g.is_deleted,
    parent_menu_id: g.parent_id,
    parent_menu_name: g.parent_id ? parentNameById.get(g.parent_id) ?? null : null,
  }))

  return NextResponse.json({ success: true, data })
}
