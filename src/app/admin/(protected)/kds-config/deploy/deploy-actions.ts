'use server'

import { createServiceClient } from '@/lib/supabase/server'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KDSDevice {
  id: string
  name: string
  status: 'pending' | 'registered' | 'offline'
  screen_1: string
  screen_2: string
  setup_code: string | null
  setup_code_expires_at: string | null
  last_heartbeat_at: string | null
  ip_address: string | null
  created_at: string
  registered_at: string | null
}

export type DeviceActionResult =
  | { success: true; device: KDSDevice }
  | { success: false; error: string }

export type DeviceListResult =
  | { success: true; devices: KDSDevice[] }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// Setup code generator
// ---------------------------------------------------------------------------

function generateSetupCode(tenantSlug: string): string {
  const prefix = tenantSlug.toUpperCase().slice(0, 8).replace(/[^A-Z0-9]/g, '')
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `${prefix}-${suffix}`
}

// ---------------------------------------------------------------------------
// List devices
// ---------------------------------------------------------------------------

export async function listDevices(tenantId: string): Promise<DeviceListResult> {
  try {
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('kds_devices')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) return { success: false, error: error.message }

    return { success: true, devices: data as KDSDevice[] }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Create device (generates setup code)
// ---------------------------------------------------------------------------

export async function createDevice(
  tenantId: string,
  name: string,
  screen1: string,
  screen2: string
): Promise<DeviceActionResult> {
  try {
    const supabase = createServiceClient()

    // Get tenant slug for setup code prefix
    const { data: tenant } = await supabase
      .from('tenants')
      .select('slug')
      .eq('id', tenantId)
      .single()

    const setupCode = generateSetupCode(tenant?.slug ?? 'KDS')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours

    const { data, error } = await supabase
      .from('kds_devices')
      .insert({
        tenant_id: tenantId,
        name,
        screen_1: screen1,
        screen_2: screen2,
        setup_code: setupCode,
        setup_code_expires_at: expiresAt,
        status: 'pending',
      })
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    return { success: true, device: data as KDSDevice }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Update device (rename, change screens)
// ---------------------------------------------------------------------------

export async function updateDevice(
  deviceId: string,
  tenantId: string,
  updates: { name?: string; screen_1?: string; screen_2?: string }
): Promise<DeviceActionResult> {
  try {
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('kds_devices')
      .update(updates)
      .eq('id', deviceId)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    return { success: true, device: data as KDSDevice }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Revoke device (delete)
// ---------------------------------------------------------------------------

export async function revokeDevice(
  deviceId: string,
  tenantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createServiceClient()

    const { error } = await supabase
      .from('kds_devices')
      .delete()
      .eq('id', deviceId)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ---------------------------------------------------------------------------
// Get device status (for polling during registration)
// ---------------------------------------------------------------------------

export async function getDeviceStatus(
  deviceId: string,
  tenantId: string
): Promise<{ status: string } | null> {
  try {
    const supabase = createServiceClient()

    const { data } = await supabase
      .from('kds_devices')
      .select('status')
      .eq('id', deviceId)
      .eq('tenant_id', tenantId)
      .single()

    return data
  } catch {
    return null
  }
}
