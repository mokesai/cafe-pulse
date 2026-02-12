# KDS (Kitchen Display System)

KDS pages are displayed on TVs in the cafe via Raspberry Pi + Chromium in kiosk mode.

## Display Environment
- Target resolution: 1920x1080 (TV display)
- Managed by pm2 (see `ecosystem.config.js` in project root)
- Auto-refreshes via KDSAutoRefresh component

## Pages
- `page.tsx` — KDS index/redirect
- `drinks/page.tsx` — Redirect only (actual drinks page is at `/admin/(kds)/kds/drinks/page.tsx`)
- `food/page.tsx` — Food display screen

## Themes
Three themes: `warm`, `dark`, `wps` — controlled via `KDSThemeWrapper` component.
- All theme CSS lives in `kds-themes.css` (the single entry point)
- CSS variable scoping: `.theme-warm`, `.theme-dark`, `.theme-wps`

## Do NOT
- Don't use `revalidate` — always use `dynamic = 'force-dynamic'` to prevent stale data
- Don't import from `kds-warm.css` or `kds.css` — these are deprecated and not imported
- Don't use CSS `display: none` for theme-conditional elements — use component-level props
- Don't forget that food screen uses banner header style (hides subtitle by design)

## Components
All KDS components are prefixed with `KDS` and live in `./components/`:
- `KDSScreen` — Main layout wrapper
- `KDSHeader` / `KDSPanelHeader` — Screen headers (banner vs standard)
- `KDSFooter` / `KDSPromoFooter` — Footer variants
- `KDSCategorySection` / `KDSCategoryGrid` / `KDSCategoryCompact` — Category layouts
- `KDSMenuItem` / `KDSSizedItemRow` — Item display
- `KDSDrinksMagazine` / `KDSFoodMagazine` — Magazine-style layouts
- `KDSFlexGrid` / `KDSDualPanelScreen` — Grid layouts

## Data
KDS data comes from four Supabase tables:
- `kds_categories` — Display sections per screen
- `kds_menu_items` — Items with prices and Square IDs
- `kds_settings` — Key-value config (hours, taglines, refresh interval)
- `kds_images` — Rotating footer images
