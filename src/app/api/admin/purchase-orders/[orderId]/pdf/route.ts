import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createCurrentTenantClient } from '@/lib/supabase/server'
import { fetchPurchaseOrderForIssuance } from '@/lib/purchase-orders/load'
import { generatePurchaseOrderPdf } from '@/lib/purchase-orders/pdf'
import { canonicalStatus } from '../../status-utils'

const ALLOWED_STATUSES = new Set(['approved', 'confirmed', 'sent', 'received'])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await params
    const { orderId } = resolvedParams

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createCurrentTenantClient()
    const { order, error } = await fetchPurchaseOrderForIssuance(supabase, orderId)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to load purchase order', details: error.message },
        { status: 500 }
      )
    }

    if (!order) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    const status = canonicalStatus(order.status) || order.status
    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json(
        { error: 'Purchase order must be approved before generating supplier documents' },
        { status: 400 }
      )
    }

    const pdfBytes = await generatePurchaseOrderPdf(order)
    const fileName = `PO-${order.order_number || order.id}.pdf`

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': pdfBytes.length.toString(),
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    })
  } catch (error) {
    console.error('Failed to generate purchase order PDF:', error)
    return NextResponse.json(
      {
        error: 'Failed to generate purchase order PDF',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
