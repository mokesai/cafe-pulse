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
  const modifierSetId = normalizeText(url.searchParams.get('modifierSetId'))

  const supabase = createServiceClient()
  let query = supabase
    .from('cogs_modifier_options')
    .select('id, modifier_set_id, square_modifier_id, name, is_active, created_at, updated_at, cogs_modifier_sets(name, square_modifier_list_id)')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })

  if (!includeInactive) {
    query = query.eq('is_active', true)
  }
  if (modifierSetId) {
    query = query.eq('modifier_set_id', modifierSetId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ modifierOptions: data ?? [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const tenantId = await getCurrentTenantId()

  const body = (await request.json().catch(() => ({}))) as {
    modifier_set_id?: unknown
    square_modifier_id?: unknown
    name?: unknown
    is_active?: unknown
  }

  const modifierSetId = normalizeText(body.modifier_set_id)
  const squareModifierId = normalizeText(body.square_modifier_id)
  const name = normalizeText(body.name)
  const isActive = typeof body.is_active === 'boolean' ? body.is_active : true

  if (!modifierSetId || !squareModifierId || !name) {
    return NextResponse.json({ error: 'modifier_set_id, square_modifier_id, and name are required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('cogs_modifier_options')
    .insert([{
      tenant_id: tenantId,
      modifier_set_id: modifierSetId,
      square_modifier_id: squareModifierId,
      name,
      is_active: isActive,
    }])
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create modifier option' }, { status: 500 })
  }

  return NextResponse.json({ modifierOption: data })
}
