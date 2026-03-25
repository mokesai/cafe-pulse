import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

interface PipelineSettingsPayload {
  no_po_match_behavior?: 'always_create' | 'auto_dismiss' | 'notify_continue'
  price_variance_threshold_pct?: number
  total_variance_threshold_pct?: number
  match_confidence_threshold_pct?: number
  vision_confidence_threshold_pct?: number
}

const VALID_NO_PO_MATCH_BEHAVIORS = ['always_create', 'auto_dismiss', 'notify_continue'] as const

function validateSettings(settings: PipelineSettingsPayload): string | null {
  if (
    settings.no_po_match_behavior !== undefined &&
    !VALID_NO_PO_MATCH_BEHAVIORS.includes(settings.no_po_match_behavior)
  ) {
    return `no_po_match_behavior must be one of: ${VALID_NO_PO_MATCH_BEHAVIORS.join(', ')}`
  }

  if (settings.price_variance_threshold_pct !== undefined) {
    if (
      !Number.isInteger(settings.price_variance_threshold_pct) ||
      settings.price_variance_threshold_pct < 1 ||
      settings.price_variance_threshold_pct > 100
    ) {
      return 'price_variance_threshold_pct must be an integer between 1 and 100'
    }
  }

  if (settings.total_variance_threshold_pct !== undefined) {
    if (
      !Number.isInteger(settings.total_variance_threshold_pct) ||
      settings.total_variance_threshold_pct < 1 ||
      settings.total_variance_threshold_pct > 100
    ) {
      return 'total_variance_threshold_pct must be an integer between 1 and 100'
    }
  }

  if (settings.match_confidence_threshold_pct !== undefined) {
    if (
      !Number.isInteger(settings.match_confidence_threshold_pct) ||
      settings.match_confidence_threshold_pct < 50 ||
      settings.match_confidence_threshold_pct > 100
    ) {
      return 'match_confidence_threshold_pct must be an integer between 50 and 100'
    }
  }

  if (settings.vision_confidence_threshold_pct !== undefined) {
    if (
      !Number.isInteger(settings.vision_confidence_threshold_pct) ||
      settings.vision_confidence_threshold_pct < 10 ||
      settings.vision_confidence_threshold_pct > 100
    ) {
      return 'vision_confidence_threshold_pct must be an integer between 10 and 100'
    }
  }

  return null
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select(`
        invoice_no_po_match_behavior,
        invoice_price_variance_threshold_pct,
        invoice_total_variance_threshold_pct,
        invoice_match_confidence_threshold_pct,
        invoice_vision_confidence_threshold_pct
      `)
      .eq('id', tenantId)
      .single()

    if (error) {
      console.error('Error fetching pipeline settings:', error)
      return NextResponse.json(
        { error: 'Failed to fetch pipeline settings', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        no_po_match_behavior: tenant.invoice_no_po_match_behavior,
        price_variance_threshold_pct: tenant.invoice_price_variance_threshold_pct,
        total_variance_threshold_pct: tenant.invoice_total_variance_threshold_pct,
        match_confidence_threshold_pct: tenant.invoice_match_confidence_threshold_pct,
        vision_confidence_threshold_pct: tenant.invoice_vision_confidence_threshold_pct
      }
    })
  } catch (error) {
    console.error('Failed to fetch pipeline settings:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch pipeline settings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    let body: PipelineSettingsPayload
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const validationError = validateSettings(body)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    // Build update payload (only provided fields)
    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (body.no_po_match_behavior !== undefined) {
      updatePayload.invoice_no_po_match_behavior = body.no_po_match_behavior
    }
    if (body.price_variance_threshold_pct !== undefined) {
      updatePayload.invoice_price_variance_threshold_pct = body.price_variance_threshold_pct
    }
    if (body.total_variance_threshold_pct !== undefined) {
      updatePayload.invoice_total_variance_threshold_pct = body.total_variance_threshold_pct
    }
    if (body.match_confidence_threshold_pct !== undefined) {
      updatePayload.invoice_match_confidence_threshold_pct = body.match_confidence_threshold_pct
    }
    if (body.vision_confidence_threshold_pct !== undefined) {
      updatePayload.invoice_vision_confidence_threshold_pct = body.vision_confidence_threshold_pct
    }

    if (Object.keys(updatePayload).length === 1) {
      // Only updated_at was set — no actual fields to update
      return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 })
    }

    const { data: updatedTenant, error } = await supabase
      .from('tenants')
      .update(updatePayload)
      .eq('id', tenantId)
      .select(`
        invoice_no_po_match_behavior,
        invoice_price_variance_threshold_pct,
        invoice_total_variance_threshold_pct,
        invoice_match_confidence_threshold_pct,
        invoice_vision_confidence_threshold_pct
      `)
      .single()

    if (error) {
      console.error('Error updating pipeline settings:', error)
      return NextResponse.json(
        { error: 'Failed to update pipeline settings', details: error.message },
        { status: 500 }
      )
    }

    console.log(`✅ Updated pipeline settings for tenant ${tenantId}`)

    return NextResponse.json({
      success: true,
      data: {
        no_po_match_behavior: updatedTenant.invoice_no_po_match_behavior,
        price_variance_threshold_pct: updatedTenant.invoice_price_variance_threshold_pct,
        total_variance_threshold_pct: updatedTenant.invoice_total_variance_threshold_pct,
        match_confidence_threshold_pct: updatedTenant.invoice_match_confidence_threshold_pct,
        vision_confidence_threshold_pct: updatedTenant.invoice_vision_confidence_threshold_pct
      }
    })
  } catch (error) {
    console.error('Failed to update pipeline settings:', error)
    return NextResponse.json(
      {
        error: 'Failed to update pipeline settings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
