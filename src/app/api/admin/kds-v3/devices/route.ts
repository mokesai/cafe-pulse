/**
 * MOK-162 / KDS Pi Deployment phase 6 — admin devices collection routes.
 *
 * Spec: https://linear.app/mokesai/issue/MOK-162
 * Plan: .planning/kds-v3-pi/PHASE-6-PLAN.md (T1)
 *
 *   GET  /api/admin/kds-v3/devices  — list tenant's devices + screen names +
 *                                     computed_status
 *   POST /api/admin/kds-v3/devices  — create pending device (returns plaintext
 *                                     setup_code; enforces 1-per-tenant cap)
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'

/** Locked design decision D1 — one Pi per location. */
export const MAX_KDS_DEVICES_PER_TENANT = 1

/**
 * D3 — status freshness thresholds derived in the API. Pi heartbeats every
 * 5 minutes (see src/app/api/kds/heartbeat/route.ts), so:
 *   online   = last heartbeat within 8 min (one full beat + buffer)
 *   stale    = 8–20 min (1–3 missed beats — could be a network blip)
 *   offline  = > 20 min
 *   pending  = never registered (no last_heartbeat_at)
 */
const ONLINE_MS = 8 * 60 * 1000
const STALE_MS = 20 * 60 * 1000

type ComputedStatus = 'online' | 'stale' | 'offline' | 'pending'

function computeStatus(
  status: string,
  lastHeartbeatAt: string | null,
  now = Date.now(),
): ComputedStatus {
  if (status === 'pending' || !lastHeartbeatAt) return 'pending'
  const age = now - new Date(lastHeartbeatAt).getTime()
  if (age <= ONLINE_MS) return 'online'
  if (age <= STALE_MS) return 'stale'
  return 'offline'
}

/**
 * D2 — generate a friendly setup code: 8 hex chars formatted XXXX-XXXX
 * (uppercase). Collisions are astronomically unlikely (4.3B values) and the
 * column has a UNIQUE constraint; retry up to 5 times before failing.
 */
function generateSetupCode(): string {
  const hex = crypto.randomBytes(4).toString('hex').toUpperCase()
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`
}

interface DeviceRow {
  id: string
  name: string
  status: string
  computed_status: ComputedStatus
  setup_code: string | null
  setup_code_expires_at: string | null
  last_heartbeat_at: string | null
  ip_address: string | null
  registered_at: string | null
  created_at: string
  screen_1_id: string | null
  screen_2_id: string | null
  screen_1_name: string | null
  screen_2_name: string | null
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  const { data: devices, error } = await supabase
    .from('kds_devices')
    .select(
      'id, name, status, setup_code, setup_code_expires_at, last_heartbeat_at, ip_address, registered_at, created_at, screen_1_id, screen_2_id',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'KDS_DEVICES_LIST_FAILED' },
      { status: 500 },
    )
  }

  // Resolve screen names in a single batched query (tenant-scoped — defense in
  // depth even though FK already enforces ownership).
  const screenIds = new Set<string>()
  for (const d of devices ?? []) {
    if (d.screen_1_id) screenIds.add(d.screen_1_id as string)
    if (d.screen_2_id) screenIds.add(d.screen_2_id as string)
  }
  const nameById = new Map<string, string>()
  if (screenIds.size > 0) {
    const { data: screens } = await supabase
      .from('kds_screens')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .in('id', [...screenIds])
    for (const s of (screens ?? []) as Array<{ id: string; name: string }>) {
      nameById.set(s.id, s.name)
    }
  }

  const now = Date.now()
  const data: DeviceRow[] = (devices ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    status: d.status as string,
    computed_status: computeStatus(d.status as string, d.last_heartbeat_at as string | null, now),
    setup_code: (d.setup_code as string | null) ?? null,
    setup_code_expires_at: (d.setup_code_expires_at as string | null) ?? null,
    last_heartbeat_at: (d.last_heartbeat_at as string | null) ?? null,
    ip_address: (d.ip_address as string | null) ?? null,
    registered_at: (d.registered_at as string | null) ?? null,
    created_at: d.created_at as string,
    screen_1_id: (d.screen_1_id as string | null) ?? null,
    screen_2_id: (d.screen_2_id as string | null) ?? null,
    screen_1_name: d.screen_1_id ? (nameById.get(d.screen_1_id as string) ?? null) : null,
    screen_2_name: d.screen_2_id ? (nameById.get(d.screen_2_id as string) ?? null) : null,
  }))

  return NextResponse.json({
    success: true,
    data,
    cap: {
      current: data.length,
      max: MAX_KDS_DEVICES_PER_TENANT,
      reached: data.length >= MAX_KDS_DEVICES_PER_TENANT,
    },
  })
}

interface CreateBody {
  name?: string
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminAuth(request)
  if (!isAdminAuthSuccess(authResult)) return authResult

  let body: CreateBody = {}
  try {
    body = (await request.json()) as CreateBody
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body must be valid JSON.', code: 'KDS_DEVICE_BAD_REQUEST' },
      { status: 400 },
    )
  }

  const name = body.name?.trim() ?? ''
  if (!name) {
    return NextResponse.json(
      { success: false, error: 'name is required', code: 'KDS_DEVICE_BAD_REQUEST' },
      { status: 400 },
    )
  }
  if (name.length > 80) {
    return NextResponse.json(
      { success: false, error: 'name must be 80 characters or fewer', code: 'KDS_DEVICE_BAD_REQUEST' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()
  const tenantId = await getCurrentTenantId()

  // Cap enforcement — count first, fail fast before generating a code.
  const { count } = await supabase
    .from('kds_devices')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  if ((count ?? 0) >= MAX_KDS_DEVICES_PER_TENANT) {
    return NextResponse.json(
      {
        success: false,
        error:
          `This tenant already has ${count} device(s), which is the configured maximum ` +
          `of ${MAX_KDS_DEVICES_PER_TENANT}. Revoke the existing device to add a new one.`,
        code: 'KDS_DEVICE_LIMIT_REACHED',
      },
      { status: 422 },
    )
  }

  // Retry generation on UNIQUE collision (astronomically rare; bound it).
  let inserted: Record<string, unknown> | null = null
  let lastError: string | null = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const setupCode = generateSetupCode()
    const { data, error: insertError } = await supabase
      .from('kds_devices')
      .insert({
        tenant_id: tenantId,
        name,
        setup_code: setupCode,
        status: 'pending',
      })
      .select(
        'id, name, status, setup_code, setup_code_expires_at, last_heartbeat_at, ip_address, registered_at, created_at, screen_1_id, screen_2_id',
      )
      .single()
    if (!insertError) {
      inserted = data
      break
    }
    // Setup code collision — only UNIQUE constraint on kds_devices is on
    // setup_code. Retry with a fresh code.
    if (insertError.code === '23505') {
      lastError = insertError.message
      continue
    }
    return NextResponse.json(
      { success: false, error: insertError.message, code: 'KDS_DEVICE_CREATE_FAILED' },
      { status: 500 },
    )
  }
  if (!inserted) {
    return NextResponse.json(
      {
        success: false,
        error: lastError ?? 'Failed to generate a unique setup code after retries',
        code: 'KDS_DEVICE_CREATE_FAILED',
      },
      { status: 500 },
    )
  }

  const now = Date.now()
  const data: DeviceRow = {
    id: inserted.id as string,
    name: inserted.name as string,
    status: inserted.status as string,
    computed_status: computeStatus(
      inserted.status as string,
      inserted.last_heartbeat_at as string | null,
      now,
    ),
    setup_code: (inserted.setup_code as string | null) ?? null,
    setup_code_expires_at: (inserted.setup_code_expires_at as string | null) ?? null,
    last_heartbeat_at: (inserted.last_heartbeat_at as string | null) ?? null,
    ip_address: (inserted.ip_address as string | null) ?? null,
    registered_at: (inserted.registered_at as string | null) ?? null,
    created_at: inserted.created_at as string,
    screen_1_id: (inserted.screen_1_id as string | null) ?? null,
    screen_2_id: (inserted.screen_2_id as string | null) ?? null,
    screen_1_name: null,
    screen_2_name: null,
  }

  return NextResponse.json({ success: true, data }, { status: 201 })
}
