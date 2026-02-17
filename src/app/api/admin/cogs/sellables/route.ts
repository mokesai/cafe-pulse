import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { getCurrentTenantId } from '@/lib/tenant/context'

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()
  const url = new URL(request.url)
  const includeInactive = url.searchParams.get('includeInactive') === '1'
  const productId = normalizeText(url.searchParams.get('productId'))

  const supabase = createServiceClient()
  let query = supabase
    .from('cogs_sellables')
    .select('id, square_variation_id, product_id, name, is_active, created_at, updated_at, cogs_products(name, square_item_id)')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })

  if (!includeInactive) {
    query = query.eq('is_active', true)
  }
  if (productId) {
    query = query.eq('product_id', productId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ sellables: data ?? [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()

  const body = (await request.json().catch(() => ({}))) as {
    square_variation_id?: unknown
    product_id?: unknown
    name?: unknown
    is_active?: unknown
  }

  const squareVariationId = normalizeText(body.square_variation_id)
  const productId = normalizeText(body.product_id)
  const name = normalizeText(body.name)
  const isActive = typeof body.is_active === 'boolean' ? body.is_active : true

  if (!squareVariationId || !productId || !name) {
    return NextResponse.json({ error: 'square_variation_id, product_id, and name are required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('cogs_sellables')
    .insert([{
      tenant_id: tenantId,
      square_variation_id: squareVariationId,
      product_id: productId,
      name,
      is_active: isActive,
    }])
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create sellable' }, { status: 500 })
  }

  return NextResponse.json({ sellable: data })
}
