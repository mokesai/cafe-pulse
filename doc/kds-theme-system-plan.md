# KDS Theme System Implementation Plan

## Context

The KDS (Kitchen Display System) currently has two CSS theme files -- `kds-warm.css` (active, 2371 lines) and `kds.css` (dark, incomplete) -- but themes are hardcoded via a static CSS import in the layout files. The goal is to make themes switchable at runtime via a database setting, admin UI, or URL query parameter (for Raspberry Pi kiosk mode). A new "WPS" theme inspired by the Starbucks brand guidelines (green `#00704A` on light background) will be added alongside the existing warm and dark themes.

## Approach: Class-Based CSS Variable Scoping

Instead of statically importing one CSS file, **import all theme files** and scope each theme's CSS variables under a class selector (`.theme-warm`, `.theme-dark`, `.theme-wps`). Apply the class dynamically to the root element based on the active theme.

## Steps

### 1. Update Type Definitions
**File:** `src/lib/kds/types.ts`
- Change `theme: 'dark' | 'warm'` to `theme: 'dark' | 'warm' | 'wps'`
- Add `KDS_THEMES` constant and `KDSTheme` type

### 2. Refactor CSS: Extract Base Styles from `kds-warm.css`
**Create:** `src/app/kds/kds-base.css`
- Extract all structural styles (layout, grid, magazine, panel, animations, responsive breakpoints) from `kds-warm.css`
- Replace all hardcoded color values with CSS variable references (`var(--kds-bg)`, etc.)
- This is the largest task (~2000 lines of layout/structure CSS)

### 3. Create Scoped Theme Files
**Create:** `src/app/kds/kds-theme-warm.css` -- warm variables under `.theme-warm { ... }`
**Create:** `src/app/kds/kds-theme-dark.css` -- dark variables under `.theme-dark { ... }` (extend with all missing vars for magazine layout)
**Create:** `src/app/kds/kds-theme-wps.css` -- new WPS theme under `.theme-wps { ... }`

WPS theme palette:
- Background: `#F8F9FA` (light gray/white)
- Header/Footer: `#00704A` (Starbucks Green)
- Text: `#1E3932` (Starbucks Dark Green)
- Accent: `#00704A`
- Font: Lato (clean, modern sans-serif)

### 4. Create Theme Entry Point
**Create:** `src/app/kds/kds-themes.css`
- Imports `kds-base.css` + all three theme files
- Sets `:root` fallback to warm theme defaults

### 5. Remove Old Theme Files
**Delete:** `src/app/kds/kds-warm.css` (replaced by kds-base.css + kds-theme-warm.css)
**Delete:** `src/app/kds/kds.css` (replaced by kds-base.css + kds-theme-dark.css)

### 6. Create KDSThemeWrapper Component
**Create:** `src/app/kds/components/KDSThemeWrapper.tsx` (client component)
- Reads `?theme=` URL query param (kiosk override) via `useSearchParams()`
- Falls back to database theme setting passed as prop
- Applies `theme-{name}` class to root div
- Sets `document.documentElement.style.backgroundColor` via `useEffect` to handle `html/body` background

### 7. Update Layout Files
**Modify:** `src/app/kds/layout.tsx`
- Replace `import './kds-warm.css'` with `import './kds-themes.css'`
- Use `KDSThemeWrapper` instead of plain `<div className="kds-root">`

**Modify:** `src/app/admin/(kds)/layout.tsx`
- Replace `import '@/app/kds/kds-warm.css'` with `import '@/app/kds/kds-themes.css'`
- Fetch theme setting server-side via `getSetting('theme')`
- Use `KDSThemeWrapper` with Suspense boundary (required for `useSearchParams`)
- Remove hardcoded `style={{ backgroundColor: '#8b6847' }}`

### 8. Create KDS Settings API Endpoint
**Create:** `src/app/api/admin/kds/settings/route.ts`
- GET: returns all KDS settings
- PATCH: updates specific settings (with theme validation)
- Protected by admin auth
- Follow pattern from `src/app/api/admin/settings/site/route.ts`

### 9. Build Admin Theme Selector
**Create:** `src/components/admin/KDSThemeSelector.tsx` (client component)
- Three theme preview swatches showing colors for each theme
- Calls PATCH `/api/admin/kds/settings` to update theme
- Shows active state and success feedback

**Modify:** `src/app/admin/(protected)/settings/page.tsx`
- Add "KDS Display" card with `<KDSThemeSelector>`
- Fetch KDS settings via `getSettings()` for initial state
- Remove "Theme and branding options" from Coming Soon list

### 10. Update Settings CSV
**Modify:** `data/kds-settings-template.csv` -- ensure `theme` row exists with value `warm`

### 11. Create Kiosk Script
**Create:** `scripts/kiosk.sh`
- Usage: `./kiosk.sh [drinks|food] [warm|dark|wps]`
- Launches Chromium in kiosk mode pointing to `/admin/kds/{screen}?theme={theme}`
- Disables screen blanking, hides cursor

### 12. Update Component Exports
**Modify:** `src/app/kds/components/index.ts` -- export `KDSThemeWrapper`

## Implementation Order
1. Types (Step 1) -- quick, unblocks everything
2. CSS refactor (Steps 2-5) -- largest task, core of the change
3. Theme wrapper + layout updates (Steps 6-7) -- wire up dynamic switching
4. Visual verification -- test warm theme has no regressions, test dark and WPS
5. API + Admin UI (Steps 8-9) -- settings management
6. CSV + kiosk (Steps 10-11) -- configuration options

## Key Risks
- **CSS extraction is error-prone**: The 2371-line warm CSS has interleaved structure and color. Must carefully replace every hardcoded color with a variable reference.
- **Dark theme incomplete**: `kds.css` lacks magazine/panel layout -- after refactoring, dark theme inherits structure from `kds-base.css` but needs all CSS variable definitions.
- **SSR flash**: `:root` fallback in `kds-themes.css` prevents flash of unstyled content.
- **Suspense boundary**: `useSearchParams()` in `KDSThemeWrapper` requires `<Suspense>` wrapper in Next.js 15.

## Verification
1. Run `npm run dev:webpack` and visit `/admin/kds/drinks` and `/admin/kds/food` -- verify warm theme looks identical to current
2. Append `?theme=dark` -- verify dark theme renders correctly with magazine layout
3. Append `?theme=wps` -- verify WPS theme with green/white palette
4. Go to `/admin/settings` -- verify theme selector works and persists to database
5. Change theme in admin, reload KDS pages -- verify database-driven theme applies
6. Test kiosk script: `bash scripts/kiosk.sh drinks wps`
