import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, apiError, unexpectedError } from '@/lib/api/errors'

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const tenantId = await getCurrentTenantId()

    const body = await request.json().catch(() => ({}))
    const { id } = body

    if (!id) {
      return apiError('Inventory item ID is required to restore an archived item.')
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('inventory_items')
      .update({ deleted_at: null })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return formatApiError('restore inventory item', error)
    }

    return NextResponse.json({
      success: true,
      item: data,
      message: 'Inventory item restored'
    })
  } catch (error) {
    return unexpectedError('restore inventory item', error)
  }
}
