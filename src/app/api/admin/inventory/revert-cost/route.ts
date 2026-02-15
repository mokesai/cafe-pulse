import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const auth = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(auth)) return auth
  const { userId } = auth

  const body = await request.json()
  const { item_id, target_cost, note } = body

  if (!item_id || target_cost === undefined) {
    return NextResponse.json({ error: 'item_id and target_cost are required' }, { status: 400 })
  }

  const newCost = Number(target_cost)
  if (!Number.isFinite(newCost) || newCost < 0) {
    return NextResponse.json({ error: 'target_cost must be a non-negative number' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: existing, error: fetchError } = await supabase
    .from('inventory_items')
    .select('unit_cost, pack_size')
    .eq('id', item_id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Item not found', details: fetchError?.message }, { status: 404 })
  }

  const previous = Number(existing.unit_cost) || 0
  const packSize = Number(existing.pack_size) || 1

  const { error: updateError } = await supabase
    .from('inventory_items')
    .update({ unit_cost: newCost, updated_at: new Date().toISOString() })
    .eq('id', item_id)

  if (updateError) {
    console.error('Failed to revert cost:', updateError)
    return NextResponse.json({ error: 'Failed to revert cost', details: updateError.message }, { status: 500 })
  }

  await supabase
    .from('inventory_item_cost_history')
    .insert({
      inventory_item_id: item_id,
      previous_unit_cost: previous,
      new_unit_cost: newCost,
      pack_size: packSize,
      source: 'revert',
      source_ref: null,
      notes: note || 'Reverted to prior value',
      changed_by: userId
    })

  return NextResponse.json({ success: true, item_id, new_cost: newCost })
}
