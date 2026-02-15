import { NextRequest, NextResponse } from 'next/server'
import { createCurrentTenantClient } from '@/lib/supabase/server'

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await context.params
    const { skip_reason } = await request.json()
    
    console.log('⏭️ Skipping invoice item:', {
      itemId,
      skip_reason
    })

    const supabase = await createCurrentTenantClient()

    // Update the invoice item to mark as skipped
    const { error: skipError } = await supabase
      .from('invoice_items')
      .update({
        matched_item_id: null, // Clear any existing match
        match_confidence: null,
        match_method: 'skipped',
        notes: skip_reason || 'Manually skipped during review',
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)

    if (skipError) {
      console.error('Failed to skip invoice item:', skipError)
      return NextResponse.json({
        success: false,
        error: `Failed to skip invoice item: ${skipError.message}`
      }, { status: 500 })
    }

    console.log('✅ Invoice item marked as skipped')

    return NextResponse.json({
      success: true,
      data: {
        message: 'Invoice item skipped successfully'
      }
    })

  } catch (error) {
    console.error('Error skipping item:', error)
    return NextResponse.json({
      success: false,
      error: `Server error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 })
  }
}
