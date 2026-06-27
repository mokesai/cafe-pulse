# KDS (Kitchen Display System)

KDS pages are displayed on TVs in the cafe via Raspberry Pi + Chromium in kiosk mode.

Post-phase-7 (MOK-160): v3 is the only live KDS surface. v2 admin + public routes deleted.

## Display Environment
- Target resolution: 1920x1080 (TV display)
- Managed by the Pi project's pm2/cage setup (see `ecosystem.config.js` and the **KDS Raspberry Pi Deployment** Linear project)
- 30s polling refresh on `/kds/v3/[deviceId]/[screenId]` picks up operator edits

## Routes (post-v2-cutover)
- `page.tsx` — bare `/kds` redirects to `/admin/kds-v3/screens`
- `v3/[deviceId]/[screenId]/page.tsx` — Pi-facing renderer. Reads from
  `kds_published_screens` + `kds_published_grid_boxes` via the
  `resolveScreenForRender(supabase, tenantId, screenId, { source: 'published' })`
  helper in `src/lib/kds/v3-render.ts`. Reuses `KDSDisplayWrapper` + `KDSHeartbeat`
  from `src/components/kds/v3/`.

## Themes
Three themes: `warm`, `dark`, `wps`. CSS variables defined in `kds-themes.css`.
v3 sets the theme class (`theme-warm` / `theme-dark` / `theme-wps`) inside
`KDSv3GridCanvas` per `kds_screens.theme`. No wrapper component needed.

## Layout
`layout.tsx` is intentionally minimal: imports `kds-themes.css` and passes
children through. v3 owns its own theming + scaling (canvas wrapper).

## Schema
v3 tables under `kds_screens` + `kds_grid_boxes` + their `_published_` snapshot
counterparts (phase 6.5). Plus `kds_aesthetic_images` (phase 4),
`kds_display_overrides` (phase 5).

**Legacy v2 tables (`kds_categories`, `kds_menu_items`, `kds_settings`, `kds_images`)**
are marked DEPRECATED (see `COMMENT ON TABLE`); drop in phase 7.5.

## Do NOT
- Don't use `revalidate` on KDS pages — use `dynamic = 'force-dynamic'` to prevent stale data
- Don't reintroduce v2 components (`KDSThemeWrapper`, `KDSScreen`, etc.) — deleted in phase 7
- Don't read from v2 tables — the deprecation comment is the runtime signal; phase 7.5 drops them entirely
