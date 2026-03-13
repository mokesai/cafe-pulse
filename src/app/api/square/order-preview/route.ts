import { NextRequest, NextResponse } from 'next/server'
import { previewSquareOrder } from '@/lib/square/orders'
import { TaxConfigurationError } from '@/lib/square/tax-validation'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

interface CartItem {
  id: string
  name: string
  quantity: number
  price: number
  variationId?: string
  variationName?: string
}

interface PreviewRequest {
  items: CartItem[]
}

export async function POST(request: NextRequest) {
  try {
    // Resolve tenant and load Square config
    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return NextResponse.json(
        { error: 'Square not configured for this tenant' },
        { status: 503 }
      )
    }

    const body: PreviewRequest = await request.json()
    const { items } = body

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Items array is required and cannot be empty' },
        { status: 400 }
      )
    }

    // Validate each item has required fields
    for (const item of items) {
      if (!item.id || !item.name || !item.quantity || typeof item.price !== 'number') {
        return NextResponse.json(
          { error: 'Each item must have id, name, quantity, and price' },
          { status: 400 }
        )
      }
    }

    console.log('Creating order preview for', items.length, 'items')

    // Get Square's calculated totals
    const totals = await previewSquareOrder(squareConfig, tenantId, items)

    console.log('Order preview totals:', totals)

    return NextResponse.json({
      success: true,
      totals
    })

  } catch (error) {
    console.error('Order preview error:', error)

    // Handle tax configuration errors specifically
    if (error instanceof TaxConfigurationError) {
      return NextResponse.json(
        { 
          error: 'Tax configuration required',
          details: error.message,
          taxConfigurationRequired: true
        },
        { status: 422 } // Unprocessable Entity - configuration issue
      )
    }

    // Enhanced error logging for debugging
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }

    return NextResponse.json(
      { 
        error: 'Order preview failed', 
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}