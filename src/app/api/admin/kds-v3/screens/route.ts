/**
 * MOK-152 / KDS v3 phase 2 — admin screens collection routes.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-152
 * Plan: .planning/kds-v3/PHASE-2-PLAN.md (T4)
 *
 *   GET  /api/admin/kds-v3/screens         — list tenant's screens + box counts
 *   POST /api/admin/kds-v3/screens         — create (enforces MAX_KDS_SCREENS_PER_TENANT)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

export const MAX_KDS_SCREENS_PER_TENANT = 2

const VALID_THEMES = new Set(['warm', 'dark', 'wps'])

interface CreateBody {
  name?: string
  grid_rows?: number
  grid_cols?: number
  theme?: string
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { data: screens, error } = await supabase
    .from('kds_screens')
    .select(
      'id, name, grid_rows, grid_cols, theme, square_menu_id, created_at, updated_at, draft_updated_at',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'KDS_SCREENS_LIST_FAILED' },
      { status: 500 },
    )
  }

  // Add box_count per screen via one extra query (small N — at most 2 screens).
  const screenIds = (screens ?? []).map((s: { id: string }) => s.id)
  const boxCounts = new Map<string, number>()
  if (screenIds.length > 0) {
    const { data: boxes } = await supabase
      .from('kds_grid_boxes')
      .select('screen_id')
      .eq('tenant_id', tenantId)
      .in('screen_id', screenIds)
    for (const row of (boxes ?? []) as Array<{ screen_id: string }>) {
      boxCounts.set(row.screen_id, (boxCounts.get(row.screen_id) ?? 0) + 1)
    }
  }

  // MOK-159 — published_at per screen so the list page can render the
  // "Unpublished changes" badge. One batched query, joined in JS.
  const publishedAtById = new Map<string, string>()
  if (screenIds.length > 0) {
    const { data: pubs } = await supabase
      .from('kds_published_screens')
      .select('id, published_at')
      .eq('tenant_id', tenantId)
      .in('id', screenIds)
    for (const row of (pubs ?? []) as Array<{ id: string; published_at: string }>) {
      publishedAtById.set(row.id, row.published_at)
    }
  }

  const data = (screens ?? []).map(
    (s: { id: string; draft_updated_at?: string }) => {
      const published_at = publishedAtById.get(s.id) ?? null
      const unpublished =
        published_at == null ||
        (typeof s.draft_updated_at === 'string' && s.draft_updated_at > published_at)
      return {
        ...s,
        box_count: boxCounts.get(s.id) ?? 0,
        published_at,
        unpublished,
      }
    },
  )

  return NextResponse.json({
    success: true,
    data,
    cap: {
      current: data.length,
      max: MAX_KDS_SCREENS_PER_TENANT,
      reached: data.length >= MAX_KDS_SCREENS_PER_TENANT,
    },
  })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  let body: CreateBody = {}
  try {
    body = (await request.json()) as CreateBody
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body must be valid JSON.', code: 'KDS_SCREEN_BAD_REQUEST' },
      { status: 400 },
    )
  }

  const errors: string[] = []
  const name = body.name?.trim() ?? ''
  if (!name) errors.push('name is required')
  const grid_rows = Number(body.grid_rows)
  if (!Number.isInteger(grid_rows) || grid_rows < 1 || grid_rows > 24) {
    errors.push('grid_rows must be an integer between 1 and 24')
  }
  const grid_cols = Number(body.grid_cols)
  if (!Number.isInteger(grid_cols) || grid_cols < 1 || grid_cols > 24) {
    errors.push('grid_cols must be an integer between 1 and 24')
  }
  const theme = body.theme ?? 'warm'
  if (!VALID_THEMES.has(theme)) {
    errors.push(`theme must be one of: ${[...VALID_THEMES].join(', ')}`)
  }
  if (errors.length > 0) {
    return NextResponse.json(
      { success: false, error: errors.join('; '), code: 'KDS_SCREEN_BAD_REQUEST' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  // Cap enforcement — count existing screens, reject before INSERT if at cap.
  const { count } = await supabase
    .from('kds_screens')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  if ((count ?? 0) >= MAX_KDS_SCREENS_PER_TENANT) {
    return NextResponse.json(
      {
        success: false,
        error:
          `This tenant already has ${count} screens, which is the configured maximum ` +
          `of ${MAX_KDS_SCREENS_PER_TENANT}. Delete an existing screen to add a new one.`,
        code: 'KDS_SCREEN_LIMIT_REACHED',
      },
      { status: 422 },
    )
  }

  const { data: created, error: insertError } = await supabase
    .from('kds_screens')
    .insert({
      tenant_id: tenantId,
      name,
      grid_rows,
      grid_cols,
      theme,
    })
    .select('id, name, grid_rows, grid_cols, theme, square_menu_id, created_at, updated_at')
    .single()

  if (insertError) {
    // Unique violation on (tenant_id, name) → 409
    if (insertError.code === '23505') {
      return NextResponse.json(
        {
          success: false,
          error: `A screen named "${name}" already exists for this tenant.`,
          code: 'KDS_SCREEN_NAME_TAKEN',
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      {
        success: false,
        error: insertError.message,
        code: 'KDS_SCREEN_CREATE_FAILED',
      },
      { status: 500 },
    )
  }

  return NextResponse.json(
    { success: true, data: { ...created, box_count: 0 } },
    { status: 201 },
  )
}
