import { NextRequest, NextResponse } from 'next/server'
import { deleteCustomerCard, searchSquareCustomerByEmail } from '@/lib/square/customers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getTenantSquareConfig } from '@/lib/square/config'

interface DeleteCardRequest {
  cardId: string
}

export async function DELETE(request: NextRequest) {
  try {
    const body: DeleteCardRequest = await request.json()
    const { cardId } = body

    // Validate required fields
    if (!cardId) {
      return NextResponse.json(
        { error: 'Card ID is required' },
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

    // Resolve tenant and load Square config
    const tenantId = await getCurrentTenantId()
    const squareConfig = await getTenantSquareConfig(tenantId)
    if (!squareConfig) {
      return NextResponse.json(
        { error: 'Square integration not configured for this tenant' },
        { status: 503 }
      )
    }

    // Get user's Square customer ID
    const { data: profile } = await supabase
      .from('profiles')
      .select('square_customer_id')
      .eq('id', session.user.id)
      .single()

    let customerId = profile?.square_customer_id

    // If no customer ID in database, try to find by email
    if (!customerId && session.user.email) {
      customerId = await searchSquareCustomerByEmail(squareConfig, session.user.email)
    }

    if (!customerId) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }

    // Delete the card
    await deleteCustomerCard(squareConfig, customerId, cardId)

    return NextResponse.json({
      success: true
    })

  } catch (error) {
    console.error('Delete card error:', error)
    
    if (error instanceof Error) {
      if (error.message.includes('Failed to delete payment method')) {
        return NextResponse.json(
          { error: 'Unable to delete payment method. Please try again.' },
          { status: 400 }
        )
      }
    }

    return NextResponse.json(
      { error: 'An unexpected error occurred while deleting payment method' },
      { status: 500 }
    )
  }
}