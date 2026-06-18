/**
 * MOK-161 / KDS Pi Deployment phase 5 — shared device URL helpers.
 *
 * Plan: .planning/kds-v3-pi/PHASE-5-PLAN.md (T3)
 *
 * Single source of truth for building Pi-facing v3 screen URLs. Returns
 * null when the operator hasn't assigned a screen yet (Phase 6's device
 * manager surfaces "Unassigned"; Pi kiosk script skips empty URLs via
 * `jq -r '... // empty'`).
 *
 * Legacy `screen_1` / `screen_2` text columns are still returned in the
 * API response shape for backward compatibility with already-deployed
 * Pi scripts (which read them just to display device info to the
 * operator). Remove in a follow-up post-Phase-7.
 */

export interface DeviceScreenRow {
  id: string
  /** v3 UUID reference into `kds_screens`. Null when unassigned. */
  screen_1_id: string | null
  screen_2_id: string | null
  /** Legacy v2 text columns. Kept for transition; do not consume in new code. */
  screen_1?: string | null
  screen_2?: string | null
}

export interface DeviceScreenUrls {
  screen_1_url: string | null
  screen_2_url: string | null
}

export function getDeviceScreenUrls(device: DeviceScreenRow): DeviceScreenUrls {
  return {
    screen_1_url: device.screen_1_id ? `/kds/v3/${device.id}/${device.screen_1_id}` : null,
    screen_2_url: device.screen_2_id ? `/kds/v3/${device.id}/${device.screen_2_id}` : null,
  }
}
