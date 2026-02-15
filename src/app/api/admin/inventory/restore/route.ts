import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createCurrentTenantClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const body = await request.json().catch(() => ({}))
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })
    }

    const supabase = await createCurrentTenantClient()
    const { data, error } = await supabase
      .from('inventory_items')
      .update({ deleted_at: null })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Failed to restore inventory item:', error)
      return NextResponse.json(
        { error: 'Failed to restore inventory item', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      item: data,
      message: 'Inventory item restored'
    })
  } catch (error) {
    console.error('Failed to restore inventory item:', error)
    return NextResponse.json(
      {
        error: 'Failed to restore inventory item',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
