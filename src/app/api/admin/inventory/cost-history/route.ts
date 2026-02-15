import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const auth = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(auth)) return auth

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const limit = Number(searchParams.get('limit') || 5)

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('inventory_item_cost_history')
    .select('*')
    .eq('inventory_item_id', id)
    .order('changed_at', { ascending: false })
    .limit(Math.min(limit, 20))

  if (error) {
    console.error('Failed to fetch cost history:', error)
    return NextResponse.json({ error: 'Failed to fetch cost history', details: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, history: data || [] })
}
