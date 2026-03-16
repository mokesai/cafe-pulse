# Tenant Admin KDS Onboarding — Specification

## Overview

Self-service KDS (Kitchen Display System) configuration for tenant admins on the Cafe Pulse SaaS platform. Replaces the current CLI-driven CSV/Google Sheets workflow with an in-app experience consisting of Google Sheets integration, an in-app grid editor, and a live preview system.

## Problem Statement

Newly onboarded tenants have no ability to populate and configure KDS screens remotely. The current procedure requires:
1. CLI access to run `export-kds-menu-to-sheets.js` (generates CSV files to filesystem)
2. Manual import of CSVs into Google Sheets
3. Long, detailed editing session in Google Sheets
4. Setting environment variables with published sheet URLs
5. CLI access to run `import-kds-menu-from-sheets.js`

This workflow does not support remote tenant admins on a SaaS platform.

## Solution

Three complementary capabilities delivered in 4 phases:

1. **Google Sheets integration** — bulk data population, editing, and Square catalog sync with smart merge
2. **In-app grid editor** — visual layout control, section sizing, image placement, and quick edits
3. **Preview** — separate preview page to validate screen appearance before deploying

## Target Users

Tenant admins (owner/admin/staff — configurable per tenant via `kds_settings.config_access_roles`).

## Phased Delivery

| Phase | Name | Description |
|-------|------|-------------|
| 1 | Google Sheets Integration | Generate, import, export, merge with Square catalog |
| 2 | Layout JSON & Dynamic Renderer | Layout schema, `tenant_kds_layouts` table, `KDSDynamicScreen` component |
| 3 | In-App Grid Editor | Visual editor with drag-and-drop, section resizing, image placement |
| 4 | Preview & Access Control | Preview page with draft/publish, KDS config role permissions |

---

## Phase 1: Google Sheets Integration

### Google Cloud Setup
- Shared Mokesai OAuth client with Sheets API + Drive API enabled
- Credentials stored as env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
- All sheets created under the Mokesai Google Workspace account's Drive
- OAuth tokens auto-refresh — no re-authentication needed

### Sheet Management

**Database table: `tenant_kds_sheets`**
```
id                  uuid PK
tenant_id           uuid FK → tenants (UNIQUE)
google_spreadsheet_id text
google_sheet_url    text
created_at          timestamptz
last_synced_at      timestamptz
last_imported_at    timestamptz
```

Single spreadsheet per tenant with 4 tabs: Menu Items, Categories, Images, Settings.
Sheets shared via "anyone with the link can edit" — no Google account required.
Sheets persist indefinitely as living documents.

### Admin UI Pages

```
/admin/kds-config/                → KDS Configuration hub
/admin/kds-config/sheets/         → Google Sheets management
```

**KDS Configuration Hub** shows:
- Status cards: sheet existence, last import date, last Square sync date
- Quick actions: Generate Setup Sheet, Import from Sheet, Sync from Square
- Current screens thumbnail

### Generate Setup Sheet Flow

1. Tenant admin clicks "Generate Setup Sheet"
2. Server action:
   - Fetches Square catalog for the tenant
   - Creates Google Spreadsheet via Sheets API
   - Populates 4 tabs with headers and data (menu items with smart category suggestions, default categories, image/settings templates)
   - Sets "anyone with the link can edit" via Drive API
   - Stores spreadsheet ID and URL in `tenant_kds_sheets`
3. Returns sheet URL to the UI
4. If sheet already exists → "Regenerate Sheet" with confirmation warning

**Prerequisite**: Square credentials must be connected. If not, show prompt.

### Import from Sheet Flow (Sheet → Database)

**Default mode: Clean Import**
- Confirmation prompt: "This will delete all existing KDS data and replace it with the sheet contents."
- Deletes all rows in `kds_categories`, `kds_menu_items`, `kds_images`, `kds_settings` for tenant
- Inserts fresh from sheet

**Optional mode: Merge Import**
- Upserts sheet data into existing DB records
- Existing items not in the sheet are left alone

**Both modes offer sub-options:**
- **Quick Import** — import immediately, show success/error summary
- **Preview First** — show diff (new/changed/removed items, validation warnings), then Apply or Cancel

**Validation:**
- Errors shown inline per row
- Partial import not allowed — all or nothing per tab
- Google Sheets API errors show retry prompt

### Export / Square Re-sync Flow (Square → Sheet)

**Default mode: Merge Export**
- Fetches fresh Square catalog
- Reads current Menu Items tab from Google Sheet via Sheets API
- Server-side merge:
  - **Existing items**: Update `price_cents`, `display_price`, `square_category` from Square. Preserve `display_name`, `kds_category`, `sort_order`, `is_visible`, `featured`, `bullet_color`, `description` from sheet.
  - **New items**: Inserted grouped by Square category, `is_visible = false` by default
  - **Removed from Square**: Flagged with "REMOVED" marker (not deleted)
- Writes merged data back to sheet
- Updates `last_synced_at`
- Returns summary

**Optional mode: Clean Export (with warning)**
- Warning: "This will discard all your KDS edits. Are you sure?"
- Overwrites entire sheet with fresh Square catalog data

**Categories, Images, and Settings tabs are NOT affected by Square sync.**

### Merge Rules (Field Ownership)

| Owner | Fields |
|-------|--------|
| Square | `price_cents`, `display_price`, `square_category` |
| Sheet | `display_name`, `kds_category`, `sort_order`, `is_visible`, `featured`, `bullet_color`, `description`, all other KDS-only fields |

---

## Phase 2: Layout JSON & Dynamic Renderer

### Database table: `tenant_kds_layouts`

```
id              uuid PK
tenant_id       uuid FK → tenants
screen          text ('drinks' | 'food')
layout          jsonb
is_draft        boolean DEFAULT false
created_at      timestamptz
updated_at      timestamptz
UNIQUE(tenant_id, screen, is_draft)
```

### Layout JSON Schema (v2 — Hierarchical Column Model)

The layout uses a hierarchical column → row → division model. Each column has independent rows with adjustable heights. Rows can optionally be split into two horizontal divisions.

```typescript
interface KDSLayoutV2 {
  version: 2
  theme?: KDSTheme
  columns: KDSColumn[]
  overlays?: KDSLayoutOverlay[]   // free-positioned, unchanged
  header?: KDSLayoutHeader        // unchanged
  footer?: KDSLayoutFooter        // unchanged
}

interface KDSColumn {
  id: string              // stable ID for drag tracking
  width: number           // percentage of screen width (columns sum to 100)
  rows: KDSRow[]
}

interface KDSRow {
  id: string
  height: number          // percentage of column height (rows in column sum to 100)
  content?: KDSCellContent        // present when row is NOT split
  divisions?: [KDSDivision, KDSDivision]  // present when row IS split (exactly 2)
}

interface KDSDivision {
  id: string
  width: number           // percentage of row width (two divisions sum to 100)
  content: KDSCellContent
}

interface KDSCellContent {
  type: 'category' | 'image' | 'empty'
  category_slug?: string
  display_type?: KDSDisplayType
  image_url?: string
  image_fit?: 'cover' | 'contain' | 'fill'
}
```

**Example: 3 columns, left has 3 rows, middle has 2, right has 1:**

```json
{
  "version": 2,
  "columns": [
    {
      "id": "col-1", "width": 40,
      "rows": [
        { "id": "r1", "height": 40, "content": { "type": "category", "category_slug": "hot-drinks", "display_type": "price-grid" } },
        { "id": "r2", "height": 30, "content": { "type": "category", "category_slug": "cold-drinks", "display_type": "simple-list" } },
        { "id": "r3", "height": 30, "divisions": [
          { "id": "d1", "width": 50, "content": { "type": "category", "category_slug": "pastries", "display_type": "featured" } },
          { "id": "d2", "width": 50, "content": { "type": "image", "image_url": "/images/promo.png", "image_fit": "cover" } }
        ]}
      ]
    },
    {
      "id": "col-2", "width": 35,
      "rows": [
        { "id": "r4", "height": 60, "content": { "type": "category", "category_slug": "espresso", "display_type": "price-grid" } },
        { "id": "r5", "height": 40, "content": { "type": "category", "category_slug": "teas", "display_type": "simple-list" } }
      ]
    },
    {
      "id": "col-3", "width": 25,
      "rows": [
        { "id": "r6", "height": 100, "content": { "type": "image", "image_url": "/images/hero.png", "image_fit": "cover" } }
      ]
    }
  ],
  "overlays": [
    { "id": "logo-1", "type": "image", "image_url": "/images/logo.png", "position": { "x": "85%", "y": "5%" }, "size": { "width": "120px", "height": "auto" } }
  ]
}
```

**Constraints:**
- Max 6 columns
- Max 6 rows per column
- Column widths sum to 100%
- Row heights sum to 100% within their column
- Division widths sum to 100% within their row
- Minimum column width: 15%
- Minimum row height: 10%
- Minimum division width: 20%

**V1 → V2 migration:** No runtime fallback needed. Existing `tenant_kds_layouts` rows will be deleted via migration. Tenants start fresh with the v2 editor. The `KDSDynamicScreen` default fallback (hardcoded `KDSDrinksMagazine`/`KDSFoodMagazine`) remains for tenants with no custom layout.

### Dynamic Renderer: `KDSDynamicScreen` (v2)

1. Checks `tenant_kds_layouts` for current tenant + screen (where `is_draft = false`)
2. If layout exists → renders from v2 JSON using nested flexbox:
   - Outer container: `display: flex; flex-direction: row` (columns)
   - Each column: `flex: 0 0 {width}%`; inner `display: flex; flex-direction: column` (rows)
   - Each row: `flex: 0 0 {height}%`
   - If row has divisions: inner `display: flex; flex-direction: row`
   - Each division: `flex: 0 0 {width}%`
   - Content rendering (category sections, images) reuses existing KDS display components
3. Overlays rendered as absolutely-positioned elements on top (unchanged)
4. If no layout → falls back to existing `KDSDrinksMagazine` / `KDSFoodMagazine`

---

## Phase 3: In-App Grid Editor

### Pages

```
/admin/kds-config/editor/             → Editor entry (redirects to drinks)
/admin/kds-config/editor/drinks/      → Edit drinks screen layout
/admin/kds-config/editor/food/        → Edit food screen layout
```

### Editor Layout

**Left panel (70%, expandable to 100%) — Canvas:**
- Visual KDS screen at 35% scale (1920×1080 → 672×378)
- Renders the same nested flexbox structure as the live renderer
- Columns, rows, and divisions rendered as labeled blocks with content type indicators
- Click any element to select → properties in right panel
- Drop images/logos anywhere outside the column structure (becomes overlay)

**Right panel (30%, collapsible) — Properties:**
- Collapse/expand toggle (chevron button on panel edge)
- When collapsed, canvas expands to fill full width
- Context-sensitive controls based on selection (see Properties Panel section)

**Top toolbar:**
- Screen toggle: Drinks / Food
- Save (writes draft), Publish (draft → published), Reset to Default
- Preview (opens preview in new tab)

### Column-Based Layout Model

The editor manages a hierarchy: **columns → rows → divisions**.

**Columns (horizontal):**
- 1–6 columns displayed side by side
- Each column has an independent width percentage (sum to 100%)
- Column count adjustable via properties panel (screen settings)
- Adding a column redistributes all widths equally
- Removing a column (with confirmation if it has content) redistributes remaining widths proportionally

**Rows (vertical, per column):**
- Each column has 1–6 rows stacked vertically
- Each row has an independent height percentage within its column (sum to 100%)
- "+" button at bottom of each column adds a new row, redistributing heights equally
- Delete button (top-right on hover) removes a row, redistributing remaining heights proportionally

**Divisions (horizontal split within a row):**
- Any row can be split into exactly 2 divisions (left | right)
- Split icon appears on hover over unsplit rows
- Splitting moves existing content to the left division, right starts as `empty`
- Merge icon collapses divisions back to a single row, keeping left division's content
- Division widths adjustable independently (sum to 100%)

### Resize Handles

All sizing is adjustable via drag handles and optional dimension inputs:

**Column width handles:**
- Vertical drag bars between adjacent columns
- Dragging adjusts the two neighboring columns inversely (left grows → right shrinks)
- Minimum: 15% per column
- Snaps to 1% increments

**Row height handles:**
- Horizontal drag bars between adjacent rows within a column
- Same inverse adjustment pattern
- Minimum: 10% per row
- Snaps to 1% increments

**Division split handles:**
- Horizontal drag bar between the two divisions
- Same inverse adjustment pattern
- Minimum: 20% per division
- Snaps to 1% increments

### Properties Panel

Context-sensitive right panel:

**Column selected:**
- Width % input
- Number of rows (read-only)
- Delete column button

**Row selected:**
- Height % input
- Content controls: category dropdown, display type, image URL, image fit
- "Split Row" button (if not split)
- "Merge Divisions" button (if split)
- Delete row button

**Division selected:**
- Width % input
- Content controls: category dropdown, display type, image URL, image fit
- Parent row height % (read-only)

**Overlay selected:**
- Image URL, position (x%, y%), size (width, height), delete

**Nothing selected (screen settings):**
- Number of columns (1–6) — changing adds/removes columns with equal redistribution
- Theme dropdown (warm / dark / wps)
- Show header / Show footer checkboxes

### Empty State

New layout starts with 3 equal columns (33.3% each), 1 row each (100%), all with `empty` content.

### Image Uploads

Supabase storage bucket: `kds-assets` (tenant-scoped via RLS).

### Technology

`dnd-kit` for drag-and-drop (lightweight, accessible, React-native).

### Data Separation

Editor writes to `tenant_kds_layouts` (layout JSON). Google Sheets writes to `kds_*` tables (menu data). These are independent — Square sync only touches menu data.

---

## Phase 4: Preview & Access Control

### Preview Page

```
/admin/kds-config/preview/drinks/
/admin/kds-config/preview/food/
```

- Renders at 1920×1080 in a scaled container
- Uses `KDSDynamicScreen` v2 renderer (same as live KDS)
- Draft mode: reads layout where `is_draft = true`
- Toolbar overlay: Back to Editor, Switch Screen, resolution badge, Full Screen button
- **Layout summary** in toolbar: brief structure display (e.g., "3 columns: 40% / 35% / 25%")
- No auto-refresh

### Draft/Publish Workflow

- Editor "Save" → writes to `tenant_kds_layouts` with `is_draft = true`
- Preview reads draft layout
- Editor "Publish" → copies draft to published (`is_draft = false`)
- Live KDS pages only read `is_draft = false`

### Access Permissions

**Stored in `kds_settings`:**
```
key: 'config_access_roles'
value: ["owner", "admin"]   ← default
```

- KDS config pages check this setting on load
- Owner can always access (cannot be removed)
- Owner manages access via Settings page

### Settings Page: `/admin/kds-config/settings/`

- Access permissions: role checkboxes
- Theme: dropdown (warm / dark / wps)
- Display: taglines, subtitles, cafe name, hours, location
- Refresh interval, image rotation interval

---

## Edge Cases

1. **No Square catalog** — config hub prompts to connect Square first
2. **Sheet deleted externally** — API returns 404, app clears reference, prompts regeneration
3. **Concurrent editors** — Google Sheets handles natively; in-app editor uses optimistic concurrency (`updated_at` check)
4. **Empty Square catalog** — sheet created with headers only and guidance message
5. **Zero visible items** — import allowed with warning about empty screens
6. **Layout references deleted category** — renderer skips, editor shows broken reference indicator
7. **Removed Square items** — flagged as REMOVED in sheet, not auto-deleted
8. **Column/row minimum sizing** — drag handles enforce minimums (15% column, 10% row, 20% division); dragging past limit stops
9. **Redistribution on add/remove** — adding a column/row redistributes all siblings to equal widths/heights; removing redistributes proportionally to fill 100%
10. **Column count decrease** — removing rightmost column; confirmation dialog if it contains content
11. **Split row with existing content** — content moves to left division; right starts as `empty`
12. **Merge divisions** — left division content kept; right discarded (with confirmation if right has content)

---

## Non-Functional Requirements

- **Google Sheets API**: graceful error handling, clear retry prompts, no app breakage
- **Performance**: sheet generation and import should complete within 30 seconds for typical catalogs (< 200 items)
- **Security**: sheets use link sharing (no auth required); tenant data isolated via tenant_id scoping
- **Concurrency**: optimistic locking for editor, Google handles sheet concurrency natively

---

## Assumptions

1. Google Cloud OAuth client with Sheets API + Drive API is already configured for the Mokesai workspace (using existing OpenClaw credentials — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`)
2. Existing export/import script logic can be adapted into server actions or API routes
3. "Anyone with the link can edit" is acceptable for Google Sheet security
4. Each tenant gets their own spreadsheet
5. KDS access permission is a per-tenant setting in `kds_settings`
6. Layout JSON coexists with current fixed components — no custom layout = defaults
7. Square catalog sync (webhook or manual) keeps available items current
8. Merge is non-destructive — tenant's KDS-specific edits are never overwritten by Square sync

---

## Decision Log

| # | Decision | Alternatives | Rationale |
|---|----------|-------------|-----------|
| 1 | Phased: KDS first, inventory/COGS later | All-at-once | Reduces scope, delivers value incrementally |
| 2 | TV-first, not hard-coded | TV-only; responsive | Pragmatic for real use case |
| 3 | Shared Mokesai OAuth client (existing OpenClaw credentials) | Service account; per-tenant; tenant provides own | Already configured, no new GCP setup needed |
| 4 | Sheets via link (no Google account) | Share to email; iframe | Lowest friction |
| 5 | Sheets persist indefinitely | Auto-delete; regenerate | Tenants revisit over time |
| 6 | Manual import only | Auto-sync; polling | Tenant controls when changes go live |
| 7 | Optional preview/diff | Always; never | Speed for power users, safety for cautious |
| 8 | Clean import default, merge opt-in | Merge default | Sheet is master source |
| 9 | Merge export default, clean opt-in with warning | Merge only | Preserves KDS edits; clean is destructive |
| 10 | Square owns price/category, sheet owns display | Configurable; all one way | Clear, predictable |
| 11 | Server-side merge (no Apps Script) | Apps Script per sheet | Simpler architecture |
| 12 | New items grouped by Square category, hidden | Appended; auto-visible | Organized, safe default |
| 13 | Single spreadsheet with 4 tabs | Separate per type | One link, cleaner |
| 14 | Items from Square only (no manual entry) | Allow manual items | Square as source of truth |
| 15 | Coarse grid (4-6 sections) | 12-column; pixel-level | Sufficient, avoids complexity |
| 16 | Default templates, editor overrides via JSON | Replace entirely | Zero impact on existing tenants |
| 17 | Editor and sheet are independent paths | Both write same data | Clean separation |
| 18 | Draft/publish with explicit publish step | Save goes live | Prevents accidental TV changes |
| 19 | Access roles in `kds_settings` | Separate table; hardcoded | Simple, uses existing infra |
| 20 | `dnd-kit` for drag-and-drop | react-beautiful-dnd; custom | Lightweight, accessible |
| 21 | Supabase `kds-assets` bucket | S3; Cloudinary | Already using Supabase |
| 22 | Optimistic concurrency for editor | Locking; real-time collab | Simple, sufficient |
| 23 | Sheets-first, editor-second (Approach A) | Editor-first; parallel | Fastest to value, lowest risk |
| 24 | Hierarchical column model (v2 schema) | Extended CSS Grid with merged cells; Absolute positioning | Directly maps to admin mental model; CSS Grid can't express different row counts per column without LCM hacks; absolute positioning too unstructured |
| 25 | Percentage-based sizing at all levels | Pixels; proportional ratios | Resolution-agnostic, maps to any display, simple validation (sum to 100) |
| 26 | Nested flexbox rendering | CSS Grid; CSS subgrid | Flexbox naturally expresses column→row→division hierarchy; CSS Grid fights the asymmetric row model |
| 27 | Exactly 2 divisions per row split | Unlimited divisions; no splits | Covers text+image use case without overcomplicating; can revisit if needed |
| 28 | Horizontal-only division split (left\|right) | Vertical split option | KDS rows already short; horizontal split is the natural expectation |
| 29 | "+" buttons and hover split icons | Context menus; toolbar mode buttons | Most discoverable, no mode switching, matches modern editors (Notion, Figma) |
| 30 | Clean cutover — drop v1 entirely | Runtime fallback; dual-format support | No production tenants using v1; migration complexity not justified |
| 31 | Max 6 columns, max 6 rows per column | Higher limits; no limits | KDS screens viewed from distance; too many sections become unreadable |
| 32 | Drag handles with 1% snap + dimension inputs | Drag only; input only; 5% snap | Drag for speed, inputs for precision; 1% gives fine control |
| 33 | Collapsible properties panel | Always visible; floating panel | Gives admin more canvas space for complex layouts |

---

## Test Scenarios

### Google Sheets Integration
- [ ] Generate sheet for new tenant → created with Square data, link works
- [ ] Regenerate with warning → old sheet replaced
- [ ] Import (clean) → DB wiped and repopulated
- [ ] Import (merge) → existing data preserved, sheet changes applied
- [ ] Import with preview → diff accurate, apply works, cancel discards
- [ ] Import with validation errors → errors displayed, no partial import
- [ ] Sync from Square (merge) → prices updated, KDS fields preserved, new items hidden
- [ ] Sync from Square (clean) → warning shown, sheet overwritten
- [ ] Sheets API unavailable → graceful error, retry option
- [ ] Sheet deleted externally → detected, prompts regeneration
- [ ] Tenant with no Square catalog → disabled with prompt
- [ ] Empty Square catalog → headers-only sheet with guidance

### In-App Grid Editor
- [ ] Add/remove columns (1–6), widths redistribute equally on add, proportionally on remove
- [ ] Add/remove rows per column (1–6), heights redistribute within column
- [ ] Drag column width handles — neighboring columns adjust inversely, minimum 15% enforced
- [ ] Drag row height handles — neighboring rows adjust inversely, minimum 10% enforced
- [ ] Split row into two divisions — existing content moves to left, right starts empty
- [ ] Merge divisions — left content kept, right discarded with confirmation
- [ ] Drag division split handle — divisions adjust inversely, minimum 20% enforced
- [ ] Dimension inputs in properties panel match drag state and vice versa
- [ ] Assign category/image content to rows and divisions
- [ ] Change display type on category content
- [ ] Drag image overlay to arbitrary position (free-positioned)
- [ ] Collapse/expand properties panel — canvas fills available width
- [ ] Save draft → preview shows draft
- [ ] Publish → live KDS updates
- [ ] Reset to default → custom layout deleted, fallback to hardcoded components
- [ ] Upload image to kds-assets bucket
- [ ] Concurrent edit warning (optimistic concurrency)
- [ ] Layout references deleted category → broken indicator
- [ ] New layout default: 3 equal columns, 1 row each, all empty
- [ ] 60fps drag interactions with 6 columns × 6 rows

### Preview
- [ ] Matches live KDS at 1920×1080 using nested flexbox renderer
- [ ] Draft changes visible before publish
- [ ] Full-screen mode works
- [ ] Layout summary shown in toolbar (e.g., "3 columns: 40% / 35% / 25%")

### Access Control
- [ ] Owner can always access KDS config
- [ ] Staff denied when not in config_access_roles
- [ ] Owner adds staff → staff gains access

### Merge Logic
- [ ] Price change in Square → sheet/DB updated, display-name preserved
- [ ] Item removed from Square → flagged REMOVED, not deleted
- [ ] New item in Square → appears grouped by category, hidden
- [ ] Tenant renames display-name → survives Square re-sync
