import { NextRequest, NextResponse } from 'next/server'
import { createOrder } from '@/lib/supabase/database'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { rateLimiters } from '@/lib/security/rate-limiter'
import { validateOrderItem, validateCustomerInfo, ValidationError } from '@/lib/security/input-validation'
import { addSecurityHeaders } from '@/lib/security/headers'

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitResult = rateLimiters.api(request)
    if (!rateLimitResult.success) {
      const response = NextResponse.json(
        { error: rateLimitResult.error },
        { status: 429 }
      )
      Object.entries(rateLimitResult.headers || {}).forEach(([key, value]) => {
        response.headers.set(key, value)
      })
      return addSecurityHeaders(response)
    }

    const body = await request.json()
    console.log('Received order data:', JSON.stringify(body, null, 2))
    
    // Enhanced validation using security utilities
    try {
      // Validate customer info if provided
      if (body.customerInfo && !validateCustomerInfo(body.customerInfo)) {
        throw new ValidationError('Invalid customer information')
      }
      
      // Validate required fields
      if (!body.totalAmount || !body.items || !Array.isArray(body.items) || body.items.length === 0) {
        throw new ValidationError('Invalid order data: totalAmount and items are required')
      }
      
      // Validate each item
      for (let i = 0; i < body.items.length; i++) {
        if (!validateOrderItem(body.items[i])) {
          throw new ValidationError(`Invalid item data at index ${i}`)
        }
      }
      
    } catch (validationError) {
      if (validationError instanceof ValidationError) {
        console.log('Validation failed:', validationError.message)
        return addSecurityHeaders(NextResponse.json(
          { error: validationError.message },
          { status: 400 }
        ))
      }
      throw validationError
    }
    
    
    // Resolve current tenant
    const tenantId = await getCurrentTenantId()

    // Create the order directly with database function
    console.log('Calling createOrder with data:', body)
    const order = await createOrder({ ...body, tenantId })
    
    return addSecurityHeaders(NextResponse.json(order))
  } catch (error) {
    console.error('Error creating order:', error)
    
    // Handle Supabase errors specifically
    if (error && typeof error === 'object' && 'message' in error) {
      return NextResponse.json(
        { 
          error: 'Failed to create order', 
          message: error.message,
          details: error 
        },
        { status: 500 }
      )
    }
    
    return addSecurityHeaders(NextResponse.json(
      { 
        error: 'Failed to create order', 
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    ))
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get query parameters for filtering/pagination
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    
    // This would typically fetch orders from database
    // For now, return an empty array as a placeholder
    return NextResponse.json({
      orders: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0
      }
    })
  } catch (error) {
    console.error('Error fetching orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    )
  }
}
