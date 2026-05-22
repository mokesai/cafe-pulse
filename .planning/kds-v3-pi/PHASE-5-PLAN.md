# KDS Pi Deployment — Phase 5: v3 schema integration on `kds_devices`

**Spec:** [MOK-161](https://linear.app/mokesai/issue/MOK-161)
**Branch:** `kds-v3-pi-p5-schema` → `kds-v3` (long-lived trunk, also hosting Pi Phases 6–10)
**Status:** Planning

## Goal

Bring `kds_devices` into the v3 world. Today the table has `screen_1` / `screen_2` as text columns holding `'drinks'` / `'food'` (the v2 names). The v3 Pi route addresses `kds_screens` by UUID, so device records need UUID references.

After Phase 5:
- `kds_devices` has new `screen_1_id` / `screen_2_id` UUID columns referencing `kds_screens(id)` ON DELETE SET NULL.
- Three Pi-side API routes (register / device-config / sd-image) return `/kds/v3/<deviceId>/<screen_uuid>` URLs when the UUID columns are set; null URL when not (operator hasn't assigned a screen yet).
- A shared helper `getDeviceScreenUrls(device)` is the single source of truth for URL construction.
- Old `screen_1` / `screen_2` text columns **stay** through one release for migration safety; drop in a follow-up cleanup.

## T0 — Audit findings (complete)

### Schema (today)
13 columns on `kds_devices`. Relevant ones:
```
screen_1  text NOT NULL DEFAULT 'drinks'
screen_2  text NOT NULL DEFAULT 'food'
```

### API route consumers (all build v2-shaped URLs — broken since PR #124)
| Route | What it does |
|---|---|
| `POST /api/kds/register` | First-time device registration. Returns `screen_1` + `screen_2` + `screen_1_url` + `screen_2_url`. |
| `GET /api/kds/device/[deviceId]/config` | Pi fetches latest config on boot. Same response shape. |
| `POST /api/kds/sd-image` | Generates SD card config bundle. Bakes the screen names into the README. |

### Pi-side script consumers
| File | Usage |
|---|---|
| `scripts/pi/kds-kiosk.sh` | Reads `screen_1_url` / `screen_2_url` from the config-fetch response (already handles empty values via `// empty`). |
| `scripts/pi/kds-register.sh` | Displays the screen text fields to the user. |

### Existing data
4 devices in dev (mostly test residue). All have `screen_1='drinks'`, `screen_2='food'`. None have v3 UUIDs. **No automatic backfill** — operator re-assigns in Phase 6's device manager.

## Task breakdown (each task = one commit unless noted)

### T1 — Forward migration: add UUID columns + FKs
**Files:**
- `supabase/migrations/<CLI-timestamp>_kds_v3_pi_p5_device_screen_ids.sql` (via `supabase migration new`)

**Scope:**
```sql
ALTER TABLE public.kds_devices
  ADD COLUMN IF NOT EXISTS screen_1_id uuid,
  ADD COLUMN IF NOT EXISTS screen_2_id uuid;

ALTER TABLE public.kds_devices
  DROP CONSTRAINT IF EXISTS kds_devices_screen_1_id_fkey;
ALTER TABLE public.kds_devices
  ADD CONSTRAINT kds_devices_screen_1_id_fkey
    FOREIGN KEY (screen_1_id) REFERENCES public.kds_screens(id) ON DELETE SET NULL;

ALTER TABLE public.kds_devices
  DROP CONSTRAINT IF EXISTS kds_devices_screen_2_id_fkey;
ALTER TABLE public.kds_devices
  ADD CONSTRAINT kds_devices_screen_2_id_fkey
    FOREIGN KEY (screen_2_id) REFERENCES public.kds_screens(id) ON DELETE SET NULL;
```

**Acceptance — 4-case battery:**
1. Both columns added; FKs present; existing rows have `screen_*_id IS NULL`.
2. INSERT with valid `screen_1_id` UUID referencing `kds_screens` → PASS.
3. INSERT with fabricated UUID not in `kds_screens` → FK_VIOLATION.
4. DELETE the referenced screen → device's `screen_1_id` set to NULL (cascade-ish SET NULL).

### T2 — Rollback SQL
**Files:**
- `.planning/kds-v3-pi/PHASE-5-ROLLBACK.sql`

**Scope:** drop the two FKs + two columns + the migration row. No structural change beyond removing the new bits. The old `screen_1` / `screen_2` text columns are untouched.

### T3 — Update three API routes + add `getDeviceScreenUrls` helper
**Files:**
- `src/lib/kds/devices.ts` (new — shared helper)
- `src/app/api/kds/register/route.ts` (extend SELECT + response)
- `src/app/api/kds/device/[deviceId]/config/route.ts` (extend SELECT + response)
- `src/app/api/kds/sd-image/route.ts` (extend SELECT + README)

**Scope:**

New helper `getDeviceScreenUrls(device)`:
```ts
export interface DeviceScreenRow {
  id: string
  screen_1_id: string | null
  screen_2_id: string | null
  // legacy text columns (transition; remove in follow-up)
  screen_1: string
  screen_2: string
}

export function getDeviceScreenUrls(device: DeviceScreenRow): {
  screen_1_url: string | null
  screen_2_url: string | null
} {
  return {
    screen_1_url: device.screen_1_id ? `/kds/v3/${device.id}/${device.screen_1_id}` : null,
    screen_2_url: device.screen_2_id ? `/kds/v3/${device.id}/${device.screen_2_id}` : null,
  }
}
```

Single source of truth: all three routes call this. v2 URL construction (`/kds/display/<id>/<name>`) is **gone** — those routes 404 anyway.

Response shape (all three routes):
```json
{
  "screen_1_id": "<uuid or null>",
  "screen_2_id": "<uuid or null>",
  "screen_1_url": "/kds/v3/<deviceId>/<uuid>" | null,
  "screen_2_url": "/kds/v3/<deviceId>/<uuid>" | null,
  "screen_1": "drinks",     // legacy text; kept for backward compat with already-deployed Pi scripts
  "screen_2": "food",
  "tenant_slug": "...",
  "status": "..."
}
```

`scripts/pi/kds-kiosk.sh` already does `jq -r '.screen_1_url // empty'`, so null URLs become empty strings — the script handles that gracefully (skips the second Chromium when empty).

### T4 — Integration tests
**Files:**
- `tests/integration/kds-v3-pi-p5-devices.test.ts` (new — 4–5 cases)

**Cases:**
1. `GET /api/kds/device/<id>/config` returns `screen_1_url = "/kds/v3/<deviceId>/<screen_1_id>"` when both UUID and text columns are set.
2. Same endpoint returns `screen_1_url = null` when `screen_1_id IS NULL`.
3. `POST /api/kds/register` returns the same shape on a freshly-registered device.
4. FK SET NULL: delete a `kds_screen` referenced by `kds_devices.screen_1_id` → device row's column becomes NULL.
5. (Optional) Cross-tenant guard: device-config with a token whose tenant doesn't own the referenced screen — defense in depth.

### T5 — Verification report
**Files:**
- `.planning/kds-v3-pi/PHASE-5-VERIFICATION.md`

**Scope:** acceptance-criteria map, T1 battery results, rollback rehearsal results, T4 sweep, sign-off block.

## Dependencies / ordering rationale
- T0 done.
- T1 must precede T3 (routes read the new columns).
- T2 paired with T1.
- T3 needs T1.
- T4 needs T3.
- T5 last.

## Risk areas

### 1. Existing Pi scripts in the wild (LOW — no production Pis on v2 anyway)
The user confirmed v2 was set up only once in dev. The bigcafe dev Pi (if reachable) gets a config response with null URLs until the operator assigns screens via Phase 6's device manager — that's expected behavior, not a regression.

### 2. FK SET NULL surprise (LOW — explicit acceptance criterion)
Deleting a v3 screen leaves devices alive with NULL `screen_*_id`. The Phase 6 device manager surfaces this state ("Unassigned") so operators reassign. Acceptance #4 verifies the cascade.

### 3. Legacy text columns drift (LOW — transition only)
`screen_1` / `screen_2` are kept temporarily. Phase 7 (MOK-163, Pi script updates) is the natural follow-up that removes the dependence on those text columns from the Pi side. A separate follow-up ticket then DROPs them. Through Phase 5–7 they're harmless dead-weight.

## Verification checkpoints

| MOK-161 acceptance | Evidence |
|---|---|
| Migration adds `screen_1_id` + `screen_2_id` UUID columns | T1 |
| FKs with ON DELETE SET NULL | T1 battery #3, #4 |
| `device/[deviceId]/config` returns new fields | T3 + T4 #1, #2 |
| `getDeviceScreenUrls` helper exists | T3 |
| Integration tests: device-config + tenant isolation + FK SET NULL | T4 |
| Rollback drops columns cleanly | T5 |

## Out of scope (deferred)
- Dropping the legacy `screen_1` / `screen_2` text columns (separate cleanup ticket post-Phase-7).
- Device manager UI (Phase 6 — MOK-162).
- Pi-script consumption of the new URL shape (Phase 7 — MOK-163; works gracefully via `// empty` in the meantime).
- Auto-backfill of `screen_*_id` from `screen_*` text via name matching against `kds_screens.name` — explicitly out: operator re-assigns in Phase 6.

## Done criteria for Phase 5
- All T1–T5 commits on `kds-v3-pi-p5-schema`, each with green CI.
- `PHASE-5-VERIFICATION.md` filled in with sign-off.
- PR `kds-v3-pi-p5-schema` → `kds-v3` opened, reviewed, merged.
