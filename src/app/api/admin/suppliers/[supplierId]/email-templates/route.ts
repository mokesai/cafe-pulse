import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { PURCHASE_ORDER_TEMPLATE_TYPE } from '@/lib/purchase-orders/templates'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) {
    return authResult
  }

  const resolvedParams = await params
  const supplierId = resolvedParams.supplierId

  if (!supplierId) {
    return NextResponse.json({ error: 'Supplier ID is required' }, { status: 400 })
  }

  try {
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Verify supplier belongs to this tenant
    const { data: supplier, error: supplierError } = await supabase
      .from('suppliers')
      .select('id')
      .eq('id', supplierId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (supplierError || !supplier) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }

    const { data: template, error } = await supabase
      .from('supplier_email_templates')
      .select('*')
      .eq('supplier_id', supplierId)
      .eq('template_type', PURCHASE_ORDER_TEMPLATE_TYPE)
      .maybeSingle()

    if (error) {
      console.error('Failed to fetch supplier email template:', error)
      return NextResponse.json(
        { error: 'Failed to load template', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ template })
  } catch (error) {
    console.error('Error loading supplier email template:', error)
    return NextResponse.json(
      {
        error: 'Failed to load template',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) {
    return authResult
  }

  const resolvedParams = await params
  const supplierId = resolvedParams.supplierId

  if (!supplierId) {
    return NextResponse.json({ error: 'Supplier ID is required' }, { status: 400 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const subjectTemplate = body.subject_template?.trim()
    const bodyTemplate = body.body_template?.trim()

    if (!subjectTemplate) {
      return NextResponse.json(
        { error: 'Subject template is required' },
        { status: 400 }
      )
    }

    if (!bodyTemplate) {
      return NextResponse.json(
        { error: 'Body template is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Verify supplier belongs to this tenant
    const { data: supplier, error: supplierError } = await supabase
      .from('suppliers')
      .select('id')
      .eq('id', supplierId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (supplierError || !supplier) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }

    const { data: existingTemplate, error: loadError } = await supabase
      .from('supplier_email_templates')
      .select('id, created_by')
      .eq('supplier_id', supplierId)
      .eq('template_type', PURCHASE_ORDER_TEMPLATE_TYPE)
      .maybeSingle()

    if (loadError) {
      console.error('Failed to load existing template before upsert:', loadError)
      return NextResponse.json(
        { error: 'Failed to save template', details: loadError.message },
        { status: 500 }
      )
    }

    const upsertPayload: Record<string, unknown> = {
      supplier_id: supplierId,
      template_type: PURCHASE_ORDER_TEMPLATE_TYPE,
      subject_template: subjectTemplate,
      body_template: bodyTemplate,
      updated_at: new Date().toISOString(),
    }

    if (!existingTemplate) {
      upsertPayload.created_by = authResult.userId
    }

    const { data: template, error } = await supabase
      .from('supplier_email_templates')
      .upsert(upsertPayload, { onConflict: 'supplier_id,template_type' })
      .select()
      .single()

    if (error) {
      console.error('Failed to upsert supplier email template:', error)
      return NextResponse.json(
        { error: 'Failed to save template', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      template,
      message: 'Template saved successfully',
    })
  } catch (error) {
    console.error('Error saving supplier email template:', error)
    return NextResponse.json(
      {
        error: 'Failed to save template',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
