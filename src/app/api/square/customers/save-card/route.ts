import { NextRequest, NextResponse } from 'next/server'
import { findOrCreateCustomer, saveCustomerCard } from '@/lib/square/customers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

interface SaveCardRequest {
  paymentToken: string
  customerEmail: string
  customerName?: string
  cardholderName?: string
  billingAddress?: {
    street?: string
    city?: string
    state?: string
    zipCode?: string
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: SaveCardRequest = await request.json()
    const { paymentToken, customerEmail, customerName, cardholderName, billingAddress } = body

    // Validate required fields
    if (!paymentToken || !customerEmail) {
      return NextResponse.json(
        { error: 'Payment token and customer email are required' },
        { status: 400 }
      )
    }

    // Get authenticated user
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Ensure the email matches the authenticated user
    if (session.user.email !== customerEmail) {
      return NextResponse.json(
        { error: 'Unauthorized: Email mismatch' },
        { status: 403 }
      )
    }

    // Resolve tenant and load Square config
    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return NextResponse.json(
        { error: 'Square integration not configured for this tenant' },
        { status: 503 }
      )
    }

    // Find or create Square customer
    const customerId = await findOrCreateCustomer(squareConfig, customerEmail, customerName)

    // Convert billing address format
    const squareBillingAddress = billingAddress ? {
      addressLine1: billingAddress.street,
      locality: billingAddress.city,
      administrativeDistrictLevel1: billingAddress.state,
      postalCode: billingAddress.zipCode
    } : undefined

    // Save the card to Square
    const cardId = await saveCustomerCard(squareConfig, customerId, {
      sourceId: paymentToken,
      cardholderName,
      billingAddress: squareBillingAddress
    })

    // Store customer mapping in our database
    const { error: dbError } = await supabase
      .from('profiles')
      .upsert({
        id: session.user.id,
        square_customer_id: customerId
      }, {
        onConflict: 'id'
      })

    if (dbError) {
      console.error('Failed to store customer mapping:', dbError)
      // Don't fail the request if database update fails
    }

    return NextResponse.json({
      success: true,
      cardId,
      customerId
    })

  } catch (error) {
    console.error('Save card error:', error)
    
    if (error instanceof Error) {
      if (error.message.includes('Authentication required')) {
        return NextResponse.json(
          { error: 'Please log in to save payment methods' },
          { status: 401 }
        )
      }
      if (error.message.includes('Failed to save payment method')) {
        return NextResponse.json(
          { error: 'Unable to save payment method. Please try again.' },
          { status: 400 }
        )
      }
    }

    return NextResponse.json(
      { error: 'An unexpected error occurred while saving payment method' },
      { status: 500 }
    )
  }
}