import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }
    console.log('Admin fetching stock alerts...')

    const supabase = createServiceClient()

    // Fetch current stock alerts
    const { data: alerts, error } = await supabase
      .from('low_stock_alerts')
      .select(`
        *,
        inventory_items (
          item_name,
          current_stock
        )
      `)
      .eq('is_acknowledged', false)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Database error fetching alerts:', error)
      return NextResponse.json(
        { error: 'Failed to fetch stock alerts', details: error.message },
        { status: 500 }
      )
    }

    // Process alerts to include item name
    const processedAlerts = alerts?.map(alert => ({
      ...alert,
      item_name: alert.inventory_items?.item_name || 'Unknown Item'
    })) || []

    return NextResponse.json({
      success: true,
      alerts: processedAlerts,
      total: processedAlerts.length,
      message: 'Stock alerts fetched successfully'
    })

  } catch (error) {
    console.error('Failed to fetch stock alerts:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch stock alerts', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const { userId } = authResult
    const body = await request.json()
    const { alertIds, acknowledged } = body

    if (!alertIds || !Array.isArray(alertIds)) {
      return NextResponse.json(
        { error: 'Alert IDs array is required' },
        { status: 400 }
      )
    }

    console.log('Updating alert acknowledgment:', { alertIds, acknowledged })

    const supabase = createServiceClient()

    // Update alert acknowledgment status
    const { data: updatedAlerts, error } = await supabase
      .from('low_stock_alerts')
      .update({
        is_acknowledged: acknowledged,
        acknowledged_by: acknowledged ? userId : null,
        acknowledged_at: acknowledged ? new Date().toISOString() : null
      })
      .in('id', alertIds)
      .select()

    if (error) {
      console.error('Database error updating alerts:', error)
      return NextResponse.json(
        { error: 'Failed to update alerts', details: error.message },
        { status: 500 }
      )
    }

    console.log('✅ Successfully updated alerts:', updatedAlerts?.length)

    return NextResponse.json({
      success: true,
      updated: updatedAlerts?.length || 0,
      message: `${updatedAlerts?.length || 0} alerts ${acknowledged ? 'acknowledged' : 'unacknowledged'}`
    })

  } catch (error) {
    console.error('Failed to update alerts:', error)
    return NextResponse.json(
      { 
        error: 'Failed to update alerts', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
