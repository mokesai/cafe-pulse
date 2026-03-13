---
phase: 85-multi-tenant-schema-constraints
verified: 2026-02-17T04:01:54Z
status: passed
score: 18/18 must-haves verified
re_verification: false
---

# Phase 85: Multi-Tenant Schema Constraints Verification Report

**Phase Goal:** Replace single-column UNIQUE constraints with composite (tenant_id, field) constraints across 12 tables (plus cogs_sellable_aliases) so two tenants can simultaneously store data with the same names/codes without conflicts. Update all ON CONFLICT upsert clauses in app code and scripts to reference the new composite constraints.
**Verified:** 2026-02-17T04:01:54Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Two tenants can each have a kds_settings row with key='logo_url' without conflict | VERIFIED | `kds_settings_tenant_key_unique UNIQUE(tenant_id, key)` in migration 20260217000000; old `kds_settings_key_key` dropped |
| 2  | Two tenants can each have a kds_images row with the same filename without conflict | VERIFIED | `kds_images_tenant_filename_unique UNIQUE(tenant_id, filename)` added; old `kds_images_filename_unique` dropped |
| 3  | Two tenants can each have a kds_menu_items row with the same square_variation_id without conflict | VERIFIED | `idx_kds_menu_items_tenant_variation_unique ON (tenant_id, square_variation_id) WHERE square_variation_id IS NOT NULL`; old `idx_kds_menu_items_square_variation_id_unique` dropped |
| 4  | Two tenants can each have a cogs_products row with the same square_item_id without conflict | VERIFIED | `cogs_products_tenant_square_item_id_unique UNIQUE(tenant_id, square_item_id)` in migration 20260217100000 |
| 5  | Two tenants can each have a cogs_products row with the same product_code without conflict | VERIFIED | `idx_cogs_products_tenant_product_code_unique ON (tenant_id, lower(product_code)) WHERE product_code IS NOT NULL` |
| 6  | Two tenants can each have a cogs_sellables row with the same square_variation_id without conflict | VERIFIED | `cogs_sellables_tenant_square_variation_id_unique UNIQUE(tenant_id, square_variation_id)` |
| 7  | Two tenants can each have a cogs_sellable_aliases row with the same square_variation_id without conflict | VERIFIED | `cogs_sellable_aliases_tenant_square_variation_id_unique UNIQUE(tenant_id, square_variation_id)` |
| 8  | Two tenants can each have a cogs_modifier_sets row with the same square_modifier_list_id without conflict | VERIFIED | `cogs_modifier_sets_tenant_square_modifier_list_id_unique UNIQUE(tenant_id, square_modifier_list_id)` |
| 9  | Two tenants can each have a cogs_modifier_options row with the same square_modifier_id without conflict | VERIFIED | `cogs_modifier_options_tenant_square_modifier_id_unique UNIQUE(tenant_id, square_modifier_id)` |
| 10 | Two tenants can each have an inventory_items row with the same square_item_id + pack_size combination without conflict | VERIFIED | `inventory_items_tenant_square_pack_unique ON (tenant_id, square_item_id, pack_size) WHERE square_item_id IS NOT NULL` in migration 20260217200000 |
| 11 | Two tenants can each have a suppliers row with the same name without conflict | VERIFIED | `suppliers_tenant_name_unique UNIQUE(tenant_id, name)`; old `suppliers_name_key` dropped |
| 12 | Two tenants can each have inventory_unit_types rows with the same symbol without conflict | VERIFIED | `inventory_unit_types_tenant_symbol_unique UNIQUE(tenant_id, symbol)`; old `inventory_unit_types_symbol_key` dropped. Note: the `name` column had no existing UNIQUE constraint to replace (DEC-85-03-01) — no cross-tenant conflict risk on name was present |
| 13 | Two tenants can each have a purchase_orders row with the same order_number without conflict | VERIFIED | `purchase_orders_tenant_order_number_unique UNIQUE(tenant_id, order_number)`; old `purchase_orders_order_number_key` dropped |
| 14 | KDS queries upsert with composite onConflict strings | VERIFIED | `queries.ts` lines 341/368/396: `'tenant_id,square_variation_id'`, `'tenant_id,filename'`, `'tenant_id,key'`; `kds_categories` `'slug'` unchanged |
| 15 | COGS sync route upserts with composite onConflict strings | VERIFIED | `sync-square/route.ts` lines 205/246: `'tenant_id,square_item_id'` and `'tenant_id,square_variation_id'`; tenant_id present in both payloads |
| 16 | seed-cogs-recipes script upserts modifier_sets and modifier_options with tenant_id in payload | VERIFIED | `DEFAULT_TENANT_ID` constant at line 34; `tenantId` default param on `seedModifierRecipes`; `tenant_id: tenantId` in both upsert objects |
| 17 | simulate-cogs-sales script upserts cogs_products and cogs_sellables with tenant_id in payload | VERIFIED | `DEFAULT_TENANT_ID` at line 59; `tenant_id: tenantId` in productRows and sellableRows |
| 18 | import-kds-menu-from-sheets script upserts kds_images and kds_settings with tenant_id in payload | VERIFIED | `DEFAULT_TENANT_ID` at line 38; `tenant_id: DEFAULT_TENANT_ID` returned by `transformImage()` (line 283) and `transformSetting()` (line 305) |

**Score:** 18/18 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260217000000_composite_kds_unique_constraints.sql` | KDS domain DDL migration | VERIFIED | EXISTS, 23 lines, BEGIN/COMMIT, drops old constraints, adds composite constraints. Contains `DROP CONSTRAINT kds_settings_key_key` |
| `supabase/migrations/20260217100000_composite_cogs_unique_constraints.sql` | COGS/Square domain DDL migration | VERIFIED | EXISTS, 34 lines, BEGIN/COMMIT, 6 operations (5 ALTER TABLE + 1 DROP/CREATE INDEX). Contains `DROP CONSTRAINT cogs_products_square_item_id_key` |
| `supabase/migrations/20260217200000_composite_operational_unique_constraints.sql` | Operational domain DDL migration | VERIFIED | EXISTS, 32 lines, BEGIN/COMMIT. Correctly omits inventory_unit_types name step (no constraint to replace). Contains `DROP INDEX inventory_items_square_pack_unique` |
| `src/lib/kds/queries.ts` | KDS upsert functions with composite onConflict strings | VERIFIED | EXISTS, composite strings at lines 341/368/396. Contains `onConflict: 'tenant_id,square_variation_id'` |
| `src/app/api/admin/cogs/catalog/sync-square/route.ts` | COGS sync upserts with composite onConflict strings | VERIFIED | EXISTS, composite strings at lines 205/246. Contains `onConflict: 'tenant_id,square_item_id'` |
| `scripts/seed-cogs-recipes.ts` | Modifier upserts with tenant_id payload + composite onConflict | VERIFIED | EXISTS, DEFAULT_TENANT_ID constant, tenant_id in payloads, composite onConflict strings at lines 569/583 |
| `scripts/simulate-cogs-sales.ts` | COGS upserts with tenant_id payload + composite onConflict | VERIFIED | EXISTS, DEFAULT_TENANT_ID constant, tenant_id in productRows/sellableRows, composite onConflict at lines 427/454 |
| `scripts/import-kds-menu-from-sheets.js` | KDS image/setting upserts with tenant_id payload + composite onConflict | VERIFIED | EXISTS, DEFAULT_TENANT_ID at line 38, transformImage/transformSetting return tenant_id, composite onConflict at lines 487/511 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `20260217000000_composite_kds_unique_constraints.sql` | kds_settings, kds_images, kds_menu_items | ALTER TABLE DROP/ADD CONSTRAINT + DROP/CREATE INDEX | WIRED | All three tables modified; composite constraint names confirmed in migration body |
| `20260217100000_composite_cogs_unique_constraints.sql` | cogs_products, cogs_sellables, cogs_sellable_aliases, cogs_modifier_sets, cogs_modifier_options | ALTER TABLE DROP/ADD CONSTRAINT + DROP/CREATE INDEX | WIRED | 5 ALTER TABLE operations + 1 expression index replacement |
| `20260217200000_composite_operational_unique_constraints.sql` | inventory_items, suppliers, inventory_unit_types, purchase_orders | DROP INDEX / ALTER TABLE DROP/ADD CONSTRAINT | WIRED | 4 operational tables updated; name-only deviation correctly documented |
| `src/lib/kds/queries.ts` | kds_menu_items, kds_images, kds_settings | Supabase .upsert() with onConflict composite strings | WIRED | Lines 341/368/396 have `onConflict: 'tenant_id,…'`; kds_categories `'slug'` correctly unchanged |
| `src/app/api/admin/cogs/catalog/sync-square/route.ts` | cogs_products, cogs_sellables | Supabase .upsert() with onConflict composite strings | WIRED | Lines 205/246; tenant_id in both row payloads |
| `scripts/seed-cogs-recipes.ts` | cogs_modifier_sets, cogs_modifier_options | .upsert() with tenant_id payload + composite onConflict | WIRED | Lines 566/579 include `tenant_id: tenantId`; onConflict updated at 569/583 |
| `scripts/simulate-cogs-sales.ts` | cogs_products, cogs_sellables | .upsert() with tenant_id payload + composite onConflict | WIRED | Lines 418/443 include `tenant_id: tenantId`; onConflict updated at 427/454 |
| `scripts/import-kds-menu-from-sheets.js` | kds_images, kds_settings | transformImage/transformSetting return tenant_id; composite onConflict | WIRED | Lines 283/305 return `tenant_id: DEFAULT_TENANT_ID`; onConflict at 487/511 |

---

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| Replace single-column UNIQUE constraints with composite (tenant_id, field) across 12 tables + cogs_sellable_aliases | SATISFIED | 13 tables covered: kds_settings, kds_images, kds_menu_items, cogs_products (×2), cogs_sellables, cogs_sellable_aliases, cogs_modifier_sets, cogs_modifier_options, inventory_items, suppliers, inventory_unit_types (symbol only — name had no prior UNIQUE constraint), purchase_orders |
| Update all ON CONFLICT upsert clauses in app code and scripts | SATISFIED | 5 files updated; zero stale single-column onConflict strings remain in src/ or scripts/ |
| TypeScript build passes | SATISFIED | `npx tsc --noEmit` produces zero errors in src/ and scripts/; errors in `__tests__/` are pre-existing test infrastructure issues unrelated to this phase |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None | — | — | — |

No stub patterns, TODO comments, empty implementations, or placeholder content found in any artifact.

---

### Notable Deviation (Not a Gap)

**Plan 85-03: inventory_unit_types name constraint**

The plan truth said "same name or symbol without conflict." During execution, `inventory_unit_types_name_key` was found to not exist in the database — the original CREATE TABLE defined `name text not null` without UNIQUE. The migration was correctly trimmed to only replace the `symbol` constraint (which did exist). Decision documented as DEC-85-03-01.

Impact on goal: None. Since the `name` column was never globally unique, there was no cross-tenant conflict risk to begin with. The outcome (no constraint violations on name across tenants) was already true.

---

### Human Verification Required

One item requires database-side confirmation that cannot be verified from the filesystem:

**1. Live constraint state in Supabase**

**Test:** Connect to dev Supabase (`ofppjltowsdvojixeflr`) and run:
```sql
SELECT constraint_name, table_name
FROM information_schema.table_constraints
WHERE constraint_name IN (
  'kds_settings_tenant_key_unique',
  'kds_images_tenant_filename_unique',
  'cogs_products_tenant_square_item_id_unique',
  'cogs_sellables_tenant_square_variation_id_unique',
  'cogs_sellable_aliases_tenant_square_variation_id_unique',
  'cogs_modifier_sets_tenant_square_modifier_list_id_unique',
  'cogs_modifier_options_tenant_square_modifier_id_unique',
  'suppliers_tenant_name_unique',
  'inventory_unit_types_tenant_symbol_unique',
  'purchase_orders_tenant_order_number_unique'
);

SELECT indexname FROM pg_indexes
WHERE indexname IN (
  'idx_kds_menu_items_tenant_variation_unique',
  'idx_cogs_products_tenant_product_code_unique',
  'inventory_items_tenant_square_pack_unique'
);
```
**Expected:** 10 rows from first query; 3 rows from second query.
**Why human:** Cannot query live Supabase from this environment — migration was applied by the executor per 85-01 SUMMARY (applied without errors including pre-existing 85-02/03 files applied incidentally). Migration files exist and are correct; live state is the only remaining verification.

---

## Summary

All four plans delivered their artifacts in full. The three migration files exist, are substantively correct, and are wrapped in BEGIN/COMMIT transactions. All five application files have composite onConflict strings that match the new DB constraints. All three scripts include tenant_id in their upsert payloads via the DEFAULT_TENANT_ID constant pattern. No stale single-column onConflict strings remain anywhere in src/ or scripts/.

The only deviation from plan truths was the inventory_unit_types name constraint — which correctly was not added because it never existed. TypeScript build passes with zero errors in production code.

Phase 85 GAP-2 remediation is structurally complete.

---

_Verified: 2026-02-17T04:01:54Z_
_Verifier: assistant (gsd-verifier)_
