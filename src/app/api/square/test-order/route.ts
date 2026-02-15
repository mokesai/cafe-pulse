import { NextResponse } from 'next/server'
import { createOrder } from '@/lib/square/fetch-client'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

export async function POST() {
  // Resolve tenant and load Square config
  const tenantId = await getCurrentTenantId()
  const squareConfig = await getTenantSquareConfig(tenantId)
  if (!squareConfig) {
    return NextResponse.json(
      { error: 'Square integration not configured for this tenant' },
      { status: 503 }
    )
  }

  try {
    console.log('Testing Square order creation...')

    // Test with the exact same structure as the payment flow
    const orderData = {
      order: {
        lineItems: [{
          quantity: '1',
          catalogObjectId: 'V6O4NECF3WU5TOBQHGR45GIO'
        }],
        source: {
          name: 'Little Cafe Website'
        },
        fulfillments: [{
          type: 'PICKUP',
          state: 'PROPOSED',
          pickup_details: {
            recipient: {
              email_address: 'test@example.com'
            }
          }
        }]
      }
    }

    console.log('Order data:', JSON.stringify(orderData, null, 2))

    const result = await createOrder(squareConfig, orderData)
    
    return NextResponse.json({
      success: true,
      orderId: result.order?.id,
      result: result
    })
    
  } catch (error) {
    console.error('Test order creation failed:', error)
    
    return NextResponse.json({
      error: 'Order creation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : null
    }, { status: 500 })
  }
}