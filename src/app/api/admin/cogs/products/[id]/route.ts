import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeProductCode(value: unknown) {
  const raw = normalizeText(value)
  if (!raw) return null
  const normalized = raw.toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9_]{0,63}$/.test(normalized)) {
    return { error: 'product_code must match ^[A-Z0-9][A-Z0-9_]{0,63}$ (uppercase letters, numbers, underscore)' }
  }
  return normalized
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()
  const { id } = await params
  const productId = normalizeText(id)
  if (!productId) return NextResponse.json({ error: 'Missing product id' }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as { product_code?: unknown }
  const normalized = normalizeProductCode(body.product_code)
  if (normalized && typeof normalized === 'object' && 'error' in normalized) {
    return NextResponse.json({ error: normalized.error }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('cogs_products')
    .update({ product_code: normalized })
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .select('id, square_item_id, name, category, is_active, product_code, created_at, updated_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to update product' }, { status: 500 })
  }

  return NextResponse.json({ product: data })
}
