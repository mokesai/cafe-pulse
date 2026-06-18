# KDS Pi Deployment — Phase 6 plan

**Spec:** [MOK-162](https://linear.app/mokesai/issue/MOK-162) — Device manager rebuild as 4th tab
**Branch:** `kds-v3-pi-p6-devices` (base: `kds-v3` @ `498955c`)
**Depends on:** Phase 5 (MOK-161) — merged 2026-05-22 (`498955c`)
**Project memory:** [project_kds_v3_pi_deployment.md](../../) — locked decisions #2 (4th tab), #3 (one Pi per location), #5 (v1 + iterate)

## Goal

Operator-facing UI to register, monitor, rename, assign screens to, and revoke KDS Pi devices. Lands as a 4th tab (`Devices`) in the existing KDS Setup shell (`/admin/kds-v3`). Replaces the (never-built) v2 admin UI for `kds_devices`. Surfaces "Unassigned" so an operator knows when a Pi will boot to a blank second screen.

## Non-goals

- No SD-image flow changes (the existing `POST /api/kds/sd-image` route already handles bundle generation; we just call it from the new "Add device" UI).
- No heartbeat protocol changes (still 5-min cadence; we only consume `last_heartbeat_at`).
- No multi-Pi-per-location yet (per decision #3 — v1 enforces 1-device cap per tenant).
- No legacy `screen_1` / `screen_2` text column UI — those stay populated by their CHECK-defaulted values (`drinks` / `food`) for sd-image README labels, but are NOT displayed in the manager. They quietly retire in a post-Phase-7 cleanup.
- No telemetry / audit-log writes for device admin actions (v1+iterate; add if needed later).

## T0 — audit findings (done)

| Area | Finding |
|---|---|
| Existing admin UI for devices | None. Nothing under `/api/admin/kds-v3/devices`; no `/admin/(protected)/kds-v3/devices`. Build fresh. |
| `kds_devices` columns | id, tenant_id, name, setup_code (UNIQUE, cleared on register), setup_code_expires_at, auth_token (sha256), status enum (`pending`/`registered`/`offline`), legacy `screen_1`/`screen_2` text CHECK (`drinks`/`food`), `screen_1_id`/`screen_2_id` UUID FK→`kds_screens` ON DELETE SET NULL, last_heartbeat_at, ip_address, created_at, registered_at |
| RLS | Already in place (`tenant_memberships` for `owner`/`admin`/`staff` SELECT; `owner`/`admin` write). Service role bypass for Pi-side routes. Admin routes use `createServiceClient` + `getCurrentTenantId()` so the existing policies aren't on the path — pattern matches the rest of `/api/admin/kds-v3/*`. |
| Heartbeat cadence | Pi pings `/api/kds/heartbeat` every 300s. Status thresholds derive from this. |
| Pi-side empty URL handling | `jq -r '... // empty'` skips empty URLs — second Chromium not launched. Phase 6's "Unassigned" badge is the operator-visible signal that needs action. |
| sd-image route | Reads legacy `screen_1`/`screen_2` text only for README labels — leave alone. |
| Layout tab strip | `src/app/admin/(protected)/kds-v3/layout.tsx` has 3 entries; adding a 4th is a config change. |
| API conventions | `requireAdminAuth` + `createServiceClient` + `getCurrentTenantId()`; `{ success, data, cap?, error?, code? }`. |

## Design decisions baked into this plan

| # | Decision | Rationale |
|---|---|---|
| D1 | One device per tenant cap, enforced on POST | Locked decision #3 (one Pi per location). Mirrors `MAX_KDS_SCREENS_PER_TENANT = 2` cap pattern. Cap constant: `MAX_KDS_DEVICES_PER_TENANT = 1`. Operator hits 422 with helpful message if they try to add a second. Easy to raise later. |
| D2 | Setup code = 6 char `XXXX-XX` uppercase, no expiry in v1 | Existing `kds_devices.setup_code` is UNIQUE text. Existing migration comment says e.g. `BIGCAFE-7X4K`. v1: drop the tenant-slug prefix (UI shows tenant context elsewhere), generate `crypto.randomBytes(4).toString('hex').toUpperCase()` → 8-char hex, format `XXXX-XXXX`. No expiry in v1 — keep it operator-friendly. Schema column `setup_code_expires_at` stays nullable; add expiry in iterate-2 if needed. |
| D3 | Status freshness derived in API, not stored | `last_heartbeat_at` is the source of truth. API derives a `computed_status`: `online` (< 8 min), `stale` (8–20 min), `offline` (> 20 min), `pending` (never registered). The stored `status` enum stays as-is for now; UI consumes `computed_status`. Keeps thresholds in one place (admin route) and survives the schema check constraint. |
| D4 | Screen binding via inline `<select>` of tenant's screens | Each row gets two selects (screen_1_id, screen_2_id) listing the tenant's `kds_screens` plus an "— Unassigned —" option. Auto-saves on change. No modal — v1+iterate. |
| D5 | Rename inline, revoke = DELETE row | Click pencil → input + save (PATCH). Delete confirms in browser `confirm()` (matches the screens admin pattern at `src/app/admin/(protected)/kds-v3/screens/page.tsx:69`). Revoking just deletes the row (auth_token implicitly invalidated; Pi heartbeats start returning 401). The Pi is then "bricked" until the operator re-registers — acceptable per v1 scope. |
| D6 | "Add device" inline (not modal) | Just two fields (device name + reveal setup code on success). Inline form at the top of the table is simpler than a modal. After create, the setup code is rendered with a "Download SD bundle" button that opens the existing `POST /api/kds/sd-image` flow (passing the device_id + wifi prompts inline). |
| D7 | Don't backfill legacy `screen_1`/`screen_2` text | Phase 5 verification report already locked this. Existing devices keep their `'drinks'`/`'food'` defaults; new devices also get the CHECK-defaulted values. UI never displays them. |
| D8 | Auth: `requireAdminAuth` everywhere | Same pattern as `/api/admin/kds-v3/screens`. Both `owner` and `admin` roles can do everything; `staff` blocked (matches the migration's RLS but enforced via middleware on the admin route, not via RLS, because admin routes use service-role client). |

## Task breakdown

### T1 — Admin API: list + create devices

**File:** `src/app/api/admin/kds-v3/devices/route.ts` (new)

```ts
GET  /api/admin/kds-v3/devices    → { success, data: DeviceRow[], cap: { current, max, reached } }
POST /api/admin/kds-v3/devices    → { success, data: DeviceRow } (with setup_code revealed once)
```

`GET` joins `kds_screens` to surface `screen_1_name` and `screen_2_name` (null when unassigned). Derives `computed_status` per D3. Lists in `created_at ASC` order.

`POST` body: `{ name: string }`. Validates non-empty + dedup-by-name within tenant. Generates setup code per D2. Inserts with `tenant_id` from `getCurrentTenantId()`, `status='pending'`, defaults for screen_1/screen_2 text columns. Enforces `MAX_KDS_DEVICES_PER_TENANT = 1` cap (422 with `KDS_DEVICE_LIMIT_REACHED` if hit). Returns the inserted row with the **plaintext** setup code (this is the only time the operator sees it; subsequent GETs return the column but it'll be the same value until registration clears it).

**Commit:** `feat(kds-v3-pi): MOK-162 T1 — admin devices list + create routes`

### T2 — Admin API: rename + screen binding + revoke

**File:** `src/app/api/admin/kds-v3/devices/[deviceId]/route.ts` (new)

```ts
PATCH  /api/admin/kds-v3/devices/[deviceId]  → { success, data: DeviceRow }
DELETE /api/admin/kds-v3/devices/[deviceId]  → { success }
```

`PATCH` body (all optional, partial update):
- `name?: string` — rename, dedup-within-tenant
- `screen_1_id?: string | null` — bind / unbind screen slot 1 (validates ownership: target screen must belong to caller's tenant)
- `screen_2_id?: string | null` — same for slot 2

Tenant-scopes the WHERE clause on both the device and the target screen — prevents cross-tenant screen binding via FK manipulation.

`DELETE` just removes the row (tenant-scoped). On success the Pi will fail its next heartbeat (401), which is the v1 "revoke" semantics — operator must SD-image-flash-and-register again.

**Commit:** `feat(kds-v3-pi): MOK-162 T2 — admin device rename + bind + revoke`

### T3 — Add `Devices` tab to KDS v3 layout

**File:** `src/app/admin/(protected)/kds-v3/layout.tsx` (edit)

Add a 4th entry to the `TABS` array:
```ts
{ name: 'Devices', href: '/admin/kds-v3/devices', match: (p) => p.startsWith('/admin/kds-v3/devices') }
```

**Commit:** `feat(kds-v3-pi): MOK-162 T3 — Devices tab in KDS Setup`

### T4 — Devices page (list + status + bind + rename + revoke + add)

**File:** `src/app/admin/(protected)/kds-v3/devices/page.tsx` (new)

Single client component, plain Tailwind, matches the screens admin inlined-component pattern from `/admin/kds-v3/screens/page.tsx`. Sections top-to-bottom:

1. **Header** with cap indicator (`1 of 1 devices`).
2. **Add device form** (inline, hidden when cap reached): name input + "Add device" button. On success shows a "Setup code: ABCD-1234 — [Download SD bundle]" panel; clicking the bundle button opens the existing `POST /api/kds/sd-image` modal (collects wifi_ssid/wifi_password, then triggers a download/copy-to-clipboard flow — keep it simple, JSON-as-text download via Blob).
3. **Devices table** with columns: Name (with pencil-rename), Status dot + label, Last seen, Screen 1 binding (select), Screen 2 binding (select), Actions (Revoke).
   - Status dot: green=online, amber=stale, blue=pending, grey=offline. Label includes "Last seen 2m ago" relative time.
   - Inline `<select>` for each screen slot, options pulled from `/api/admin/kds-v3/screens` GET; auto-saves on change via PATCH. Optimistic UI; rollback on error.
   - "Unassigned" badge inside the select row when null.
4. **Empty state** when no devices yet.

Optionally auto-refresh status every 30s with `setInterval` (cheap — at most 1 device this round).

**Commit:** `feat(kds-v3-pi): MOK-162 T4 — devices admin page`

### T5 — Integration tests

**File:** `tests/integration/kds-v3-pi-p6-devices-admin.test.ts` (new)

Cases:
1. `GET /devices` lists tenant's devices with screen names + computed_status
2. `POST /devices` creates pending device + returns setup_code
3. `POST /devices` hits cap (1) → 422 `KDS_DEVICE_LIMIT_REACHED`
4. `POST /devices` dedup name → 409
5. `PATCH /devices/[id]` renames
6. `PATCH /devices/[id]` binds screen_1_id (and screen_2_id) to valid screens
7. `PATCH /devices/[id]` rejects cross-tenant screen IDs
8. `PATCH /devices/[id]` unbinds via `screen_*_id: null`
9. `DELETE /devices/[id]` removes row + subsequent heartbeat returns 401
10. Tenant isolation: tenant A admin cannot read/modify tenant B's device (returns 404)

Reuses `tests/integration/helpers/tenant.ts` (`createTenantForTest`, `cleanupTenant`, `buildAuthedRequest`).

**Commit:** `test(kds-v3-pi): MOK-162 T5 — phase 6 admin integration tests`

### T6 — Verification

**File:** `.planning/kds-v3-pi/PHASE-6-VERIFICATION.md` (new)

- Acceptance map: MOK-162 acceptance criteria → evidence.
- Smoke test: in dev, full end-to-end via the existing dev device — add → bind screens → rename → confirm Pi-side config call returns v3 URLs → revoke → confirm heartbeat 401.
- Quality gates: `npm run lint`, `npm run build`, `npm run test:unit`, `npm run test:integration` (KDS subset at minimum).
- PR opened against `kds-v3`.

**Commit:** `verify(kds-v3-pi): MOK-162 T6 — phase 6 verification`

## Acceptance criteria (from MOK-162)

| Acceptance | Met by |
|---|---|
| 4th `Devices` tab visible in KDS Setup | T3 |
| Operator can register a new Pi (name → setup code → SD bundle download) | T1 + T4 (Add device + sd-image integration) |
| Operator can see device status: online / stale / pending / offline | T1 (`computed_status`) + T4 (dot + label) |
| Operator can bind/unbind each screen slot | T2 (PATCH `screen_*_id`) + T4 (selects) |
| "Unassigned" badge visible when no screen bound | T4 |
| Operator can rename a device | T2 (PATCH name) + T4 (inline edit) |
| Operator can revoke a device | T2 (DELETE) + T4 (button) |
| Tenant isolation enforced | T5 case #10 |
| One-device cap enforced | T1 + T5 case #3 |
| Screen binding rejects cross-tenant IDs | T2 + T5 case #7 |

## Risks / open questions

- **R1 — Setup code re-display after first POST**: We return the plaintext setup code in the POST response. If the operator misses it, can they retrieve it later? *Decision: yes — `setup_code` stays on the row until registration clears it. The GET response includes it. UI shows "Setup code: XXXX-XXXX" in the pending row until the Pi registers. Once registered, the column is null and the row goes from "Pending" to "Online".* Documented in T1.
- **R2 — Re-binding screens while Pi is running**: The Pi fetches `/device/[id]/config` only on boot. Re-binding screens mid-session won't take effect until reboot. *v1 acceptable; iterate could add a SIGHUP-style refresh endpoint.* Surface this in the verification report's "known limitations" section.
- **R3 — Status thresholds tuning**: Pi heartbeats every 5min, so 8min `online`/20min `offline` thresholds are an educated guess. Watch the real device in verification and tune if needed.
- **R4 — Setup code collision**: 8-char hex = 4B values. Negligible. UNIQUE constraint catches anything anyway — POST retries the generation up to 5 times before 500.

## Rollback

No schema changes in Phase 6. To roll back: revert the PR. The `kds_devices` table stays as Phase 5 left it. No data is destroyed.

## Out of scope (later phases / iterations)

- Device-side change-notification protocol (Phase 7 territory or iterate-1)
- Multi-device support per tenant (raise the cap; nothing else needed)
- Audit log of admin actions on devices
- Detailed device telemetry (uptime, last IP history, etc.)
- Manual screen-assignment of legacy `screen_1`/`screen_2` text columns (those will get dropped post-Phase-7)
