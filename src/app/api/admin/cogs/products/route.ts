import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { cookies } from 'next/headers'

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const url = new URL(request.url)
  const includeInactive = url.searchParams.get('includeInactive') === '1'

  // Get tenant ID from cookie
  const cookieStore = await cookies()
  const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'

  const supabase = createServiceClient()
  let query = supabase
    .from('cogs_products')
    .select('id, square_item_id, name, category, is_active, product_code, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })

  if (!includeInactive) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ products: data ?? [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const body = (await request.json().catch(() => ({}))) as {
    square_item_id?: unknown
    name?: unknown
    category?: unknown
    is_active?: unknown
  }

  const squareItemId = normalizeText(body.square_item_id)
  const name = normalizeText(body.name)
  const category = normalizeText(body.category) || null
  const isActive = typeof body.is_active === 'boolean' ? body.is_active : true

  if (!squareItemId || !name) {
    return NextResponse.json({ error: 'square_item_id and name are required' }, { status: 400 })
  }

  // Get tenant ID from cookie
  const cookieStore = await cookies()
  const tenantId = cookieStore.get('x-tenant-id')?.value || '00000000-0000-0000-0000-000000000001'

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('cogs_products')
    .insert([{
      tenant_id: tenantId,
      square_item_id: squareItemId,
      name,
      category,
      is_active: isActive,
    }])
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create product' }, { status: 500 })
  }

  return NextResponse.json({ product: data })
}
