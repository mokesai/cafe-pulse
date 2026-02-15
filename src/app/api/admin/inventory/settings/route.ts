import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const supabase = createServiceClient()

    // Fetch settings (there should only be one row)
    const { data: settings, error } = await supabase
      .from('inventory_settings')
      .select('*')
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      console.error('Database error fetching inventory settings:', error)
      return NextResponse.json(
        { error: 'Failed to fetch inventory settings', details: error.message },
        { status: 500 }
      )
    }

    // If no settings exist, return default values
    const defaultSettings = {
      global_low_stock_threshold: 10,
      global_critical_stock_threshold: 5,
      default_reorder_point_multiplier: 2.0,
      auto_create_alerts: true,
      alert_email_notifications: false,
      alert_email: '',
      default_unit_type: 'each',
      default_location: 'main',
      currency: 'USD',
      enable_barcode_scanning: false,
      enable_expiry_tracking: false,
      require_purchase_orders: false,
      auto_update_costs: true
    }

    return NextResponse.json({
      success: true,
      settings: settings || defaultSettings,
      message: 'Inventory settings fetched successfully'
    })

  } catch (error) {
    console.error('Failed to fetch inventory settings:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch inventory settings', 
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
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const body = await request.json()
    const { 
      global_low_stock_threshold,
      global_critical_stock_threshold,
      default_reorder_point_multiplier,
      auto_create_alerts,
      alert_email_notifications,
      alert_email,
      default_unit_type,
      default_location,
      currency,
      enable_barcode_scanning,
      enable_expiry_tracking,
      require_purchase_orders,
      auto_update_costs
    } = body

    console.log('Saving inventory settings:', body)

    const supabase = createServiceClient()

    // Check if settings already exist
    const { data: existingSettings } = await supabase
      .from('inventory_settings')
      .select('id')
      .limit(1)
      .single()

    const settingsData = {
      global_low_stock_threshold: global_low_stock_threshold || 10,
      global_critical_stock_threshold: global_critical_stock_threshold || 5,
      default_reorder_point_multiplier: default_reorder_point_multiplier || 2.0,
      auto_create_alerts: auto_create_alerts !== undefined ? auto_create_alerts : true,
      alert_email_notifications: alert_email_notifications !== undefined ? alert_email_notifications : false,
      alert_email: alert_email || '',
      default_unit_type: default_unit_type || 'each',
      default_location: default_location || 'main',
      currency: currency || 'USD',
      enable_barcode_scanning: enable_barcode_scanning !== undefined ? enable_barcode_scanning : false,
      enable_expiry_tracking: enable_expiry_tracking !== undefined ? enable_expiry_tracking : false,
      require_purchase_orders: require_purchase_orders !== undefined ? require_purchase_orders : false,
      auto_update_costs: auto_update_costs !== undefined ? auto_update_costs : true
    }

    let result
    if (existingSettings) {
      // Update existing settings
      const { data: updatedSettings, error } = await supabase
        .from('inventory_settings')
        .update(settingsData)
        .eq('id', existingSettings.id)
        .select()
        .single()

      if (error) {
        console.error('Database error updating inventory settings:', error)
        return NextResponse.json(
          { error: 'Failed to update inventory settings', details: error.message },
          { status: 500 }
        )
      }

      result = updatedSettings
    } else {
      // Create new settings
      const { data: newSettings, error } = await supabase
        .from('inventory_settings')
        .insert(settingsData)
        .select()
        .single()

      if (error) {
        console.error('Database error creating inventory settings:', error)
        return NextResponse.json(
          { error: 'Failed to create inventory settings', details: error.message },
          { status: 500 }
        )
      }

      result = newSettings
    }

    console.log('✅ Successfully saved inventory settings')

    return NextResponse.json({
      success: true,
      settings: result,
      message: 'Inventory settings saved successfully'
    })

  } catch (error) {
    console.error('Failed to save inventory settings:', error)
    return NextResponse.json(
      { 
        error: 'Failed to save inventory settings', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}