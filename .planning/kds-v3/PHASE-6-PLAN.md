# KDS v3 — Phase 6: Public renderer + group layout modes + formatting controls

**Spec:** [MOK-158](https://linear.app/mokesai/issue/MOK-158/kds-v3-phase-6-public-renderer-group-layout-modes-formatting-controls)
**Branch:** `kds-v3-p6-renderer` → `kds-v3` (integration trunk) → `staging` (post-all-phases) → `main`
**Status:** Planning

## Goal

The first phase where a v3 KDS screen actually renders on a TV. Consumes every schema layer phases 1–5 set up — `kds_screens`, `kds_grid_boxes`, the Square mirror, `kds_aesthetic_images`, `kds_display_overrides` — and composes a live grid display with four group-layout modes, four price-display modes, and basic operator-controlled whitespace.

Public route at `/kds/v3/[deviceId]/[screen_id]` reuses v2's device-paired auth flow (`KDSHeartbeat` + `KDSDisplayWrapper` + device-token cookie). v2 routes left untouched — coexists with v3 through phase 7's cutover.

## Task breakdown (each task = one commit unless noted)

### T0 — Seed-script expansion (prereq)
**Files:**
- `scripts/seed-square-test-menu.ts` (extend)

**Scope:**
Grow the seed from 1 menu + 3 menu groups + 6 items to ~14 menu groups + ~50 items + ~80 variations, per the MOK-158 spec table. Implementation:

- Preserve the existing `BatchUpsertCatalogObjects` pattern with temp IDs so the seed stays idempotent on re-run.
- Existing groups (Hot Drinks, Cold Drinks, Pastries) expand or stay; new groups (Frappuccinos — Coffee, Frappuccinos — Crème, Seasonal Specials, Teas, Energy Drinks, Smoothies, Muffins, Savory Croissants, Panini Sandwiches, Other Sandwiches, Burritos) added.
- All size-variation groups (Hot Drinks, both Frappuccinos, Seasonal, Teas) use a **consistent variation name set**: Tall, Grande, Venti. Distinct prices per size to exercise the column-pricing render.
- Frappuccinos — Coffee: 7 items × 3 sizes = 21 variations. **Deliberately overstuffed** for hide-testing in T11.
- Muffins: ONE Square `ITEM` with multiple `ITEM_VARIATION` children (Blueberry / Banana Walnut / Lemon Poppyseed / Chocolate Chip), all same price — canonical `flavor_list` shape.
- Energy Drinks / Smoothies: multiple items, one variation each, all sharing the same price — canonical `compact_list` shape.

**Apply + verify:**
```bash
npx tsx scripts/seed-square-test-menu.ts                            # against bigcafe sandbox
curl -X POST http://bigcafe.localhost:3000/api/admin/square/menu-sync \
  -d '{"fullResync": true}'                                         # mirror it
```

Then SQL-verify the mirror:
```sql
SELECT count(*) FROM square_menu_categories
  WHERE tenant_id='<bigcafe>' AND is_top_level=false AND NOT is_deleted;
-- expect: ~14
```

**Acceptance:**
- Seed runs idempotently against a clean sandbox + on top of an already-seeded sandbox.
- Mirror reflects the new shape after sync (~14 groups, ~50 items, ~80 variations).
- Existing menu-groups + items the operator may have bound to in prior phase testing are preserved (the seed's idempotent upserts don't delete out-of-band data).

### T1 — Forward migration: layout/price/whitespace columns on `kds_grid_boxes`
**Files:**
- `supabase/migrations/<CLI-timestamp>_kds_v3_phase_6_renderer.sql` (authored via `supabase migration new`)

**Scope:**
Add 10 new columns to `kds_grid_boxes` per MOK-158's schema block:
- Slot A: `layout_mode`, `price_display_mode`, `density`, `title_size`, `title_align` (all NOT NULL with defaults)
- Slot B (NULL when undivided): `layout_mode_b`, `price_display_mode_b`, `density_b`, `title_size_b`, `title_align_b`

Plus enum CHECK constraints on each column and a cross-slot-B invariant CHECK ensuring slot-B columns are NULL ↔ `box_type_b IS NULL`:

```sql
ALTER TABLE public.kds_grid_boxes
  ADD CONSTRAINT kds_grid_boxes_slot_b_formatting_invariant CHECK (
    (box_type_b IS NULL
     AND layout_mode_b IS NULL
     AND price_display_mode_b IS NULL
     AND density_b IS NULL
     AND title_size_b IS NULL
     AND title_align_b IS NULL)
    OR
    (box_type_b IS NOT NULL
     AND layout_mode_b IS NOT NULL
     AND price_display_mode_b IS NOT NULL
     AND density_b IS NOT NULL
     AND title_size_b IS NOT NULL
     AND title_align_b IS NOT NULL)
  );
```

**Acceptance — 6-case CHECK corner battery:**

| # | Case | Expected |
|---|---|---|
| 1 | Undivided box (box_type_b NULL), all slot-A fields default, all slot-B fields NULL | PASS |
| 2 | Divided box (box_type_b='menu_group'), slot-B layout_mode_b='simple_list', other slot-B fields set | PASS |
| 3 | Undivided box but slot-B layout_mode_b='simple_list' (partial slot-B) | CHECK_VIOLATION (slot-B invariant) |
| 4 | Divided box but slot-B layout_mode_b NULL (partial slot-B) | CHECK_VIOLATION (slot-B invariant) |
| 5 | Slot-A layout_mode='not_a_real_layout' | CHECK_VIOLATION (enum) |
| 6 | Slot-A price_display_mode='not_real' | CHECK_VIOLATION (enum) |

Plus an upgrade probe: existing phase-2 boxes (which have no slot-B set) should land at slot-A defaults (layout_mode='simple_list', price_display_mode='lowest', density='normal', title_size='medium', title_align='left') and slot-B all NULL. Verified via post-migration query.

### T2 — Rollback SQL
**Files:**
- `.planning/kds-v3/PHASE-6-ROLLBACK.sql`

**Scope:**
- DROP the slot-B invariant CHECK + per-column enum CHECKs
- DROP the 10 new columns from `kds_grid_boxes`
- DELETE the schema_migrations row for this version

Existing phase 1-5 schema untouched. Seed script (T0) is NOT part of rollback — operator re-runs the seed to restore the menu data.

**Acceptance:**
- Lives outside `supabase/migrations/`.
- Rehearsed in T12.

### T3 — Editor extensions: layout / price / whitespace controls in `renderSlotControls`
**Files:**
- `src/components/admin/kds-v3/GridEditor.tsx` (extend `renderSlotControls` + EditableBox type)
- `src/app/admin/(protected)/kds-v3/screens/[id]/edit/page.tsx` (extend ApiBox + hydration mapping)

**Scope:**
Add five new controls per slot in `renderSlotControls`:

1. **Layout mode** — segmented control (4 buttons): `simple_list` / `variation_column_header` / `flavor_list` / `compact_list`. Only surfaces when `boxType === 'menu_group'` (image_only slots don't need layouts).
2. **Price display** — dropdown (4 values: none / lowest / range / base). **Disabled with a `(not used by this layout)` tooltip** when layout is `variation_column_header` or `compact_list`.
3. **Density** — dropdown (compact / normal / loose).
4. **Title size** — dropdown (small / medium / large).
5. **Title align** — segmented control (left / center / right).

`EditableBox` grows the 10 new fields (5 slot-A + 5 slot-B). Edit-page `ApiBox` interface + hydration mapping propagates them through.

Helper functions in `GridEditor`:
- `updateLayoutMode(position, slot, mode)`
- `updatePriceDisplayMode(position, slot, mode)`
- `updateDensity(position, slot, value)`
- `updateTitleSize(position, slot, value)`
- `updateTitleAlign(position, slot, value)`

Per-slot defense (same pattern as phases 3/4): when toggling `boxType` from `menu_group` to `image_only`, leave layout/price/density/etc. at their values (they're harmless when unused). When toggling division off (slot B disappears), the existing setBoxDivision helper already clears slot-B fields via the spread + null pattern — extend to clear the new `_b` columns too.

**Acceptance:**
- Manual: pick a layout mode on a menu_group slot, save, reload — selection persists.
- Manual: pick `variation_column_header` — price-display dropdown disables with the tooltip.
- Manual: toggle a box to divided + back to undivided — slot-B fields clear correctly (no DB CHECK violations on save).
- Lint + build clean.

### T4 — Single-batched render-fetch helper
**Files:**
- `src/lib/kds/v3-render.ts` (new — pure server-side data fetcher)

**Scope:**
Given a `screen_id` + `tenant_id`, return a fully-resolved object with everything the renderer needs:

```ts
interface ResolvedScreen {
  screen: { id, name, grid_rows, grid_cols, theme, ... }
  boxes: Array<{
    // ...all kds_grid_boxes columns including the new phase-6 ones
    // PLUS pre-resolved content per slot:
    slotA: ResolvedSlotContent
    slotB: ResolvedSlotContent | null  // null when undivided
  }>
}

type ResolvedSlotContent =
  | { kind: 'menu_group'; group: MenuGroup; items: ItemWithVariations[]; header_override: string | null }
  | { kind: 'image_only'; image: AestheticImage | null; thumbnail_url: string | null; header_override: string | null }
  | { kind: 'unbound' }

interface ItemWithVariations {
  id: string
  name: string                       // post-override
  is_deleted: boolean
  hidden_from_kds: boolean            // post-override
  alt_image: { id, signed_url } | null
  variations: VariationResolved[]
}

interface VariationResolved {
  id: string
  name: string                        // post-override
  price_cents: number | null
  hidden_from_kds: boolean
  alt_image: { id, signed_url } | null
}
```

Implementation queries in ONE round-trip (Promise.all of independent queries, no N+1):
1. `kds_screens` + `kds_grid_boxes` for the screen
2. Collected `square_menu_group_id` set → `square_menu_categories`
3. `square_menu_item_categories` rows for those groups → item_ids set
4. `square_menu_items` + `square_menu_item_variations` for those item_ids
5. `kds_display_overrides` for those item_ids and variation_ids
6. `kds_aesthetic_images` for collected `aesthetic_image_id` set (across boxes + overrides)
7. Batched signed-URL lookup for uploaded images

Then in JS: apply override precedence (variation > item > Square default) using helpers from T5, attach signed URLs / external URLs to image references.

This is THE central data dependency for every renderer. Keep it well-typed and unit-testable.

**Acceptance:**
- Returns the full `ResolvedScreen` shape for a real bigcafe screen.
- Includes `is_deleted` items but with `hidden_from_kds=true` so the renderer can drop them.
- Tenant-scoped: returns nothing for a wrong-tenant `screen_id`.
- Integration tests cover this in T11.

### T5 — Override-resolution + layout-resolution helpers (pure functions)
**Files:**
- `src/lib/kds/v3-render-helpers.ts` (new)
- `src/lib/kds/__tests__/v3-render-helpers.test.ts` (new — vitest unit)

**Scope:**

Pure functions, no I/O, vitest-unit-testable:

- `resolveDisplayForItem(item, variations, overrides) → { display_name, image, hidden }` — applies item-level overrides
- `resolveDisplayForVariation(variation, overrides) → { display_name, hidden }` — applies variation-level overrides (called once per variation; item-level alt_name doesn't propagate to variations — variations keep their Square names unless they have their own override)
- `derivePriceText(price_display_mode, variations) → string | null` — for simple_list / flavor_list; returns "from $4.50" / "$4.50 – $6.50" / "$5.50" / null
- `deriveCanonicalVariationSet(items) → string[]` — union of variation names across items, sorted by frequency (desc). Used by `variation_column_header`.
- `derivePriceRangeForGroup(items) → string` — for `compact_list`. "$5.95 – $7.95" or just "$5.95" if all same.
- `formatPriceCents(cents) → string` — "$5.50" formatting helper. Single source of truth for currency rendering.

**Unit-test coverage targets** (~15 cases):
- resolveDisplayForItem: no overrides / alt_name only / alt_image only / hidden / all three
- resolveDisplayForVariation: same shape
- derivePriceText: each of the 4 modes × items-with-one-vs-many-variations
- deriveCanonicalVariationSet: empty / single-variation items / mixed / all-same
- derivePriceRangeForGroup: empty / single price / range
- formatPriceCents: zero / cents-only / dollars-only / normal / large

**Acceptance:**
- `npm run test:unit` adds ~15 cases all green.

### T6 — `simple_list` renderer component
**Files:**
- `src/components/kds/v3/SimpleListRenderer.tsx` (new client component)

**Scope:**
Renders a `menu_group` slot in `simple_list` mode. Inputs:
- `group: { name }` (with optional `header_override`)
- `items: ItemWithVariations[]` (already filtered for `hidden_from_kds=true`)
- `price_display_mode`, `density`, `title_size`, `title_align`

Render shape: group title at top (sized + aligned per controls), then each item on its own line with `name` (after override) and the derived price text (via `derivePriceText`). Density controls vertical padding per item.

**Acceptance:**
- Visually inspectable via the public route in T11.

### T7 — `variation_column_header` renderer component
**Files:**
- `src/components/kds/v3/VariationColumnHeaderRenderer.tsx`

**Scope:**
For groups where items share size variations:
1. Compute canonical variation set via `deriveCanonicalVariationSet`.
2. Header row: group name on left + variation names on the right (right-aligned columns).
3. Each item row: item name on left + prices in each column (blank cell if item lacks that variation).
4. Density controls row padding; title-size controls header row text; title-align is N/A for this layout (always anchored to columns) — but we still honor the operator's choice on the group name placement.

**Acceptance:**
- With the seeded Hot Drinks group bound to a 4×6 box and `variation_column_header` mode, render shows clean `Tall  Grande  Venti` columns.

### T8 — `flavor_list` renderer component
**Files:**
- `src/components/kds/v3/FlavorListRenderer.tsx`

**Scope:**
For items with flavor variations sharing one price:
- Per item: bold name on line 1, then flavor variations joined with ` • ` on line 2.
- Price rendered per `price_display_mode` (typically `base` or `lowest`).
- Density controls vertical spacing between items.

**Acceptance:**
- Seeded Muffins group renders as `Muffin / Blueberry • Banana Walnut • Lemon Poppyseed • Chocolate Chip / $4.25`.

### T9 — `compact_list` renderer component
**Files:**
- `src/components/kds/v3/CompactListRenderer.tsx`

**Scope:**
For narrow-column item lists with a group-level price range:
- Header: `<group name> · <price range>` (range derived via `derivePriceRangeForGroup`).
- Body: vertical bulleted list of item names (after overrides).
- Density controls bullet spacing.

**Acceptance:**
- Seeded Energy Drinks group renders as `Energy Drinks · $5.95–$7.95 / • Peach Energy / • Berry Energy / ...`.

### T10 — Public route + auth + polling
**Files:**
- `src/app/kds/v3/[deviceId]/[screen_id]/page.tsx` (new server component)
- `src/app/kds/v3/[deviceId]/[screen_id]/KDSv3Client.tsx` (new client wrapper — handles polling + theme application)
- Reuses existing `KDSHeartbeat` + `KDSDisplayWrapper` + device-token cookie helpers from v2's `/kds/display/...` path

**Scope:**

Server component:
- Resolves `deviceId` + `screen_id` from params.
- Authenticates via v2's device-token cookie flow (extract token from cookie/searchParam, look up the device, verify the device's tenant owns the screen).
- 404 if device/screen not found or cross-tenant access.
- Calls T4's `resolveScreenForRender(screen_id, tenant_id)` to get the full ResolvedScreen.
- Passes to `KDSv3Client` for rendering.

Client wrapper:
- Renders the grid using the same 16:9 layout math + `ceil/floor` division as the editor (frozen in phase 2.5).
- Theme class on the root (`theme-warm` / `theme-dark` / `theme-wps`) from `kds_screens.theme`.
- Each box: route to the right renderer component based on `layout_mode`. For `image_only` slots, render the bound aesthetic image full-bleed with optional `header_override` caption.
- For divided boxes: render slot A + slot B at their respective half-rectangles using the same division-rendering pattern as the editor preview.
- 30-second polling: `setInterval(() => router.refresh(), 30_000)` to re-fetch server data. Force-dynamic on the page so the refresh hits the DB.

**Acceptance:**
- Navigate to `/kds/v3/<device>/<screen>` with a valid device-token cookie → screen renders.
- Wrong tenant → 404.
- Operator edits a screen in the admin UI → render updates within 30s on the public route.

### T11 — Integration tests + manual walk on bigcafe
**Files:**
- `tests/integration/kds-v3-render-fetch.test.ts` (new — covers T4's `resolveScreenForRender` helper)
- Possibly extend existing `kds-v3-screens-routes.test.ts` with a "PUT a box with the new layout/price/density columns and round-trip" case (~3 new cases, file gets to ~32 total)
- T5's unit tests already landed; T11 doesn't duplicate

**Integration test cases for T4 helper (~6 cases):**
1. Resolves a screen with one undivided menu_group box bound to Hot Drinks; returns items + variations + applies overrides.
2. Resolves a divided box with slot A = Frappuccinos — Coffee + slot B = Frappuccinos — Crème.
3. Items with `hidden_from_kds=true` via `kds_display_overrides` are excluded from the resolved items list.
4. Items with `alt_display_name` show the override name in resolved output.
5. Cross-tenant guard: tenant A's call with tenant B's `screen_id` returns null / 404-equivalent.
6. `image_only` slot resolves to the image with a signed_url for uploaded source_kind.

**New screens-routes cases (~3 cases) for T3 round-trip:**
1. PUT with non-default layout_mode + price_display_mode + density values; GET back returns the same values.
2. PUT a divided box with distinct slot-A and slot-B layout/density combinations; round-trips.
3. PUT with an invalid layout_mode value → 422 (route validation catches it before DB).

**Manual walk on bigcafe (12 steps):**

Prereqs: T0 seed already applied + mirror synced. At least one aesthetic image in the library. A device exists in `kds_devices` for bigcafe (reuse the v2 setup or create one for v3 testing).

1. Sign in to bigcafe admin.
2. Create a new screen via the v3 editor (or reuse an existing test screen). Pick a 4×6 warm grid.
3. Add a box, bind to **Hot Drinks**, pick `variation_column_header` layout.
4. Save. Navigate to `/kds/v3/<device>/<screen>` (with the device token cookie). Render shows Tall/Grande/Venti columns with the espresso drinks.
5. Add a second box, bind to **Muffins**, pick `flavor_list`. Save. Reload public render — flavor list shows `Blueberry • Banana Walnut • Lemon Poppyseed • Chocolate Chip` line 2.
6. Add a third box, bind to **Energy Drinks**, pick `compact_list`. Save. Render shows the group with price range header + bulleted item list.
7. Add an `image_only` box, bind to one of the aesthetic images. Save. Render shows the image full-bleed with the optional caption.
8. Add a divided box, slot A = `Frappuccinos — Coffee` (`variation_column_header`) + slot B = `Frappuccinos — Crème` (same). Save. Public render shows both halves side-by-side.
9. Navigate to overrides page. Hide 2–3 less-relevant items from `Frappuccinos — Coffee` (e.g. "Mocha Cookie Crumble" and "Caramel Brulée"). Save. Reload public render within 30s — the hidden items are gone, the box content fits better.
10. Set an `alt_display_name` override on one Hot Drinks item (e.g. "Latte" → "Café Latte"). Reload — the alt name renders.
11. Set an `alt_image_aesthetic_image_id` on a Muffin variation. Reload — the alt image appears next to that variation (or replaces it, per the layout's rendering decision).
12. Wait 30 seconds with the public render open + change a box's `density` setting in the editor → the live render reflects it within 30s.

**Acceptance:**
- All 12 manual steps pass.
- All integration tests green.
- Unit tests (T5) green.
- Captured in `.planning/kds-v3/PHASE-6-VERIFICATION.md` (T12).

### T12 — Rollback rehearsal + verification report
**Files:**
- `.planning/kds-v3/PHASE-6-VERIFICATION.md` (new)

**Procedure:**
1. Pre-snapshot dev state (screens, boxes, overrides, images counts).
2. Execute `PHASE-6-ROLLBACK.sql` against cafe-pulse-dev.
3. Confirm: 0 new columns on `kds_grid_boxes`, 0 phase-6 schema_migrations rows. Phase 1-5 schema + data preserved.
4. Re-apply via `supabase db push`. Confirm clean.
5. Idempotency test: re-execute T1 SQL once more; verify no errors, no schema changes.
6. Document run with timestamps + sign-off in PHASE-6-VERIFICATION.md.
7. Note the seed-script expansion (T0) is NOT part of rollback — its effect is in Square sandbox + the mirror, which the rollback doesn't touch.

**Acceptance:**
- Rollback SQL produces clean state on first try.
- Migration re-apply is idempotent.
- Verification doc filled in.

## Dependencies / ordering rationale

- T0 must precede T11 (manual walk needs the seeded data).
- T1 must precede T3, T4, T5+ (everything reads/writes the new columns).
- T2 paired with T1.
- T3 (editor) needs T1.
- T4 (render-fetch) needs T1.
- T5 (helpers) is pure functions; can land anywhere after T1. Doing it before T6-T9 since the renderers consume the helpers.
- T6/T7/T8/T9 (renderers) need T4 + T5. Can land in parallel; doing them sequentially for cleaner reviewability.
- T10 (public route) needs T4 + T5 + all four renderers (T6-T9).
- T11 needs all prior tasks.
- T12 last.

## Risk areas

### 1. Render-fetch performance (MEDIUM — mitigated by batching + unit-testable helpers)

The single-fetch helper does a lot in one round-trip. Mitigations:
- Promise.all the independent queries.
- Use Set-based collected-ID arrays to avoid duplicate fetches.
- T11 integration tests should include a "screen with N=12 boxes bound to varied groups" case to surface any N+1 regressions early.

If performance becomes a problem at TV render time, candidate optimizations: PostgreSQL function that consolidates the lookup, or Supabase RPC. Defer until measured.

### 2. Canonical variation set drift (LOW — explicit auto-detect)

For `variation_column_header`, the canonical variation set is auto-derived from the union of variation names sorted by frequency. If item names drift (e.g. operator renames "Tall" → "T" on one item), the column header includes both — looks messy but doesn't break the renderer. T0's seed ensures consistency; production operators get a "(deleted) Tall" warning surface in 6.5 if this becomes a problem.

### 3. Theme application reuse (LOW — existing v2 CSS)

Phase 6 reuses v2's `kds-themes.css` via the same `.theme-warm` / `.theme-dark` / `.theme-wps` class names. Risk: v2 CSS includes elements specific to v2's render shape that don't apply to v3. Mitigation: T10 includes a smoke pass on each theme; any obvious leakage gets called out as a phase-6.5 follow-up.

### 4. Hidden item filtering vs render performance (LOW — server-side resolution)

Items with `hidden_from_kds=true` are filtered server-side in T4 — they never reach the client. Cleaner than client-side filtering. T11's hide-test scenario verifies the round-trip.

### 5. 30-second polling vs operator feedback latency (LOW — accepted)

Operator edits a screen → up to 30s before the TV shows the change. Operators rarely edit during peak hours; 30s is acceptable. If real-time feel is wanted later, Supabase subscriptions are a 6.5 polish.

## Verification checkpoints

| MOK-158 acceptance | Verified by |
|---|---|
| Migration + cross-slot-B CHECK | T1 + 6-case battery |
| T0 seed expansion ~14 groups | T0 + DB count probe |
| Editor controls per slot | T3 + T11 #2-7 (manual) |
| Public route renders | T10 + T11 #4 onwards |
| `simple_list` render correct | T6 + T11 #5 |
| `variation_column_header` render correct | T7 + T11 #4 |
| `flavor_list` render correct | T8 + T11 #5 |
| `compact_list` render correct | T9 + T11 #6 |
| Display overrides honored | T11 #9, #10, #11 (hide / alt_name / alt_image) |
| Hide-testing on overstuffed Frappuccinos | T11 #9 |
| `image_only` slot renders bound image | T11 #7 |
| Divided box with both Frappuccinos halves | T11 #8 |
| Theme honored | T10 + T11 (visual inspection per theme) |
| 30s polling refresh | T11 #12 |
| Single batched data-fetch | T4 + integration test perf-shape probe |
| Integration tests | T11 |
| Rollback drops new columns cleanly | T12 |

## Out of scope (per MOK-158)
- Combo group rendering → 6.5
- Header / footer subsystem → 6.5
- Advanced typography controls → 6.5
- Operator-defined canonical variation set → 6.5
- Real-time Supabase subscriptions → 6.5
- More layout modes → 6.5
- In-menu-group sub-headers → 6.5+
- Phase 7 v2 cutover → Phase 7

## Rollback contract
Drops 10 columns + the cross-slot-B invariant CHECK + per-column enum CHECKs from `kds_grid_boxes`. Phase 1-5 schema + data preserved. Seed-script expansion is NOT part of rollback — its effect lives in Square sandbox + the local mirror, which a code rollback doesn't touch.

Rollback window remains open through phase 7 cutover (the renderer can be retired and v2 routes used until phase 7 makes v3 mandatory).

## Done criteria for phase 6
- All T0–T12 commits on `kds-v3-p6-renderer`, each with green CI.
- `PHASE-6-VERIFICATION.md` filled in with sign-off.
- PR `kds-v3-p6-renderer` → `kds-v3` opened, reviewed, merged.
- Phase 7 spec drafting begins (v2 cutover + Little Cafe migration).
