import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createCurrentTenantClient } from '@/lib/supabase/server'

interface RouteContext {
  params: Promise<{ orderId: string; matchId: string }>
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { orderId, matchId } = await context.params

    if (!orderId || !matchId) {
      return NextResponse.json(
        { error: 'Order ID and match ID are required' },
        { status: 400 }
      )
    }

    const supabase = await createCurrentTenantClient()

    const { data: match, error: fetchError } = await supabase
      .from('order_invoice_matches')
      .select('id, invoice_id, purchase_order_id')
      .eq('id', matchId)
      .single()

    if (fetchError || !match || match.purchase_order_id !== orderId) {
      return NextResponse.json(
        { error: 'Invoice match not found for this purchase order' },
        { status: 404 }
      )
    }

    const { error: deleteError } = await supabase
      .from('order_invoice_matches')
      .delete()
      .eq('id', matchId)

    if (deleteError) {
      console.error('Failed to delete invoice match:', deleteError)
      return NextResponse.json(
        { error: 'Failed to remove invoice link', details: deleteError.message },
        { status: 500 }
      )
    }

    const { data: remainingMatches } = await supabase
      .from('order_invoice_matches')
      .select('id')
      .eq('invoice_id', match.invoice_id)
      .limit(1)

    if (!remainingMatches || remainingMatches.length === 0) {
      await supabase
        .from('invoices')
        .update({
          status: 'uploaded',
          processed_at: null,
          processed_by: null,
          confirmed_at: null
        })
        .eq('id', match.invoice_id)
    }

    return NextResponse.json({
      success: true,
      message: 'Invoice unlinked from purchase order'
    })
  } catch (error) {
    console.error('Failed to delete invoice match:', error)
    return NextResponse.json(
      {
        error: 'Failed to remove invoice link',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
