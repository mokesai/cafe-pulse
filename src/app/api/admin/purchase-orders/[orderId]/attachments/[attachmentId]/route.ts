import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createCurrentTenantClient } from '@/lib/supabase/server'

const STORAGE_BUCKET = 'purchase-order-attachments'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string; attachmentId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await params
    const { orderId, attachmentId } = resolvedParams

    if (!orderId || !attachmentId) {
      return NextResponse.json(
        { error: 'Order ID and attachment ID are required' },
        { status: 400 }
      )
    }

    const supabase = await createCurrentTenantClient()

    const { data: attachment, error: fetchError } = await supabase
      .from('purchase_order_attachments')
      .select('*')
      .eq('id', attachmentId)
      .eq('purchase_order_id', orderId)
      .single()

    if (fetchError) {
      console.error('Failed to fetch purchase order attachment:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch attachment', details: fetchError.message },
        { status: 500 }
      )
    }

    if (!attachment) {
      return NextResponse.json(
        { error: 'Attachment not found' },
        { status: 404 }
      )
    }

    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([attachment.storage_path])

    if (storageError) {
      console.warn('Attachment file missing during delete, continuing cleanup:', storageError.message)
    }

    const { error: deleteError } = await supabase
      .from('purchase_order_attachments')
      .delete()
      .eq('id', attachmentId)

    if (deleteError) {
      console.error('Failed to delete attachment record:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete attachment record', details: deleteError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      attachmentId
    })
  } catch (error) {
    console.error('Error deleting purchase order attachment:', error)
    return NextResponse.json(
      {
        error: 'Failed to delete purchase order attachment',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
