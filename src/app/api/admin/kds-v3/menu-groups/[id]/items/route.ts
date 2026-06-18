/**
 * MOK-157 / KDS v3 phase 5 — items + variations for a menu group.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-157
 * Plan: .planning/kds-v3/PHASE-5-PLAN.md (T4 helper)
 *
 *   GET /api/admin/kds-v3/menu-groups/[id]/items
 *
 * Returns the items in the given menu group (joined via
 * square_menu_item_categories) along with their variations, tenant-scoped.
 * Used by the display-overrides admin page to build the nested
 * item-variation table.
 *
 * Shape:
 *   {
 *     success: true,
 *     data: {
 *       group_id: "...",
 *       group_name: "...",
 *       items: [
 *         {
 *           id, name, is_deleted, ordinal,
 *           variations: [{ id, name, price_cents, is_deleted, ordinal }]
 *         }
 *       ]
 *     }
 *   }
 *
 * 404 if the group doesn't exist for the current tenant.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const { id: groupId } = await context.params
  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  // 1. Verify the group exists for this tenant + capture its name.
  const { data: group, error: groupErr } = await supabase
    .from('square_menu_categories')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('id', groupId)
    .eq('is_top_level', false)
    .maybeSingle()
  if (groupErr) {
    return NextResponse.json(
      { success: false, error: groupErr.message, code: 'KDS_MENU_GROUP_ITEMS_LOOKUP_FAILED' },
      { status: 500 },
    )
  }
  if (!group) {
    return NextResponse.json(
      { success: false, error: 'Menu group not found.', code: 'KDS_MENU_GROUP_NOT_FOUND' },
      { status: 404 },
    )
  }

  // 2. Fetch memberships for the group, scoped to tenant. Each row gives
  //    an item_id + ordinal (the item's position within the group).
  const { data: memberships } = await supabase
    .from('square_menu_item_categories')
    .select('item_id, ordinal')
    .eq('tenant_id', tenantId)
    .eq('category_id', groupId)
    .order('ordinal', { ascending: true })

  const membershipRows = (memberships ?? []) as Array<{ item_id: string; ordinal: number }>
  const itemIds = membershipRows.map((m) => m.item_id)
  if (itemIds.length === 0) {
    return NextResponse.json({
      success: true,
      data: { group_id: group.id, group_name: group.name, items: [] },
    })
  }

  // 3. Fetch the items themselves (non-deleted; include is_deleted=true rows
  //    so the operator can still surface stale overrides). Tenant-scoped.
  const { data: items } = await supabase
    .from('square_menu_items')
    .select('id, name, is_deleted')
    .eq('tenant_id', tenantId)
    .in('id', itemIds)

  // 4. Fetch variations for those items.
  const { data: variations } = await supabase
    .from('square_menu_item_variations')
    .select('id, item_id, name, price_cents, ordinal, is_deleted')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds)
    .order('ordinal', { ascending: true })

  // 5. Compose nested response.
  const variationsByItem = new Map<string, Array<{ id: string; name: string | null; price_cents: number | null; ordinal: number; is_deleted: boolean }>>()
  for (const v of (variations ?? []) as Array<{ id: string; item_id: string; name: string | null; price_cents: number | null; ordinal: number; is_deleted: boolean }>) {
    if (!variationsByItem.has(v.item_id)) variationsByItem.set(v.item_id, [])
    variationsByItem.get(v.item_id)!.push({
      id: v.id,
      name: v.name,
      price_cents: v.price_cents,
      ordinal: v.ordinal,
      is_deleted: v.is_deleted,
    })
  }

  const itemById = new Map<string, { id: string; name: string | null; is_deleted: boolean }>()
  for (const it of (items ?? []) as Array<{ id: string; name: string | null; is_deleted: boolean }>) {
    itemById.set(it.id, it)
  }

  const ordered = membershipRows.flatMap((m) => {
    const it = itemById.get(m.item_id)
    if (!it) return []
    return [
      {
        id: it.id,
        name: it.name,
        is_deleted: it.is_deleted,
        ordinal: m.ordinal,
        variations: variationsByItem.get(it.id) ?? [],
      },
    ]
  })

  return NextResponse.json({
    success: true,
    data: { group_id: group.id, group_name: group.name, items: ordered },
  })
}
