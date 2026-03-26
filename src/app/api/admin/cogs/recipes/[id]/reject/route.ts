/**
 * POST /api/admin/cogs/recipes/[id]/reject
 *
 * Marks an ai_recipe_estimates record as rejected.
 * The AI estimate is dismissed without being promoted to cogs_product_recipes.
 *
 * Body: { review_notes?: string }
 *
 * FR-17
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) return authResult

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing estimate id' }, { status: 400 })
    }

    const tenantId = await getCurrentTenantId()
    const supabase = createServiceClient()

    // Parse optional review notes
    let reviewNotes: string | null = null
    try {
      const body = await request.json().catch(() => ({})) as { review_notes?: unknown }
      if (typeof body.review_notes === 'string' && body.review_notes.trim()) {
        reviewNotes = body.review_notes.trim()
      }
    } catch {
      // No body
    }

    // Verify the estimate exists and belongs to this tenant
    const { data: estimate, error: fetchError } = await supabase
      .from('ai_recipe_estimates')
      .select('id, review_status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError || !estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    if (estimate.review_status === 'approved') {
      return NextResponse.json(
        { error: 'Cannot reject an already approved estimate' },
        { status: 409 }
      )
    }

    // Mark as rejected
    const { error: updateError } = await supabase
      .from('ai_recipe_estimates')
      .update({
        review_status: 'rejected',
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[cogs/recipes/reject] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
