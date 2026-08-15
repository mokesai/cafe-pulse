# Theoretical / Recipe-Based COGS — Completeness Assessment

**Date:** 2026-06-28
**Context:** Surfaced while reviewing the COGS Reporting page subtitle ("Phase 1: periodic COGS. Phase 2: product/sellable mapping + base recipes."). Operator goal not believed to work in production: *a sold prepared item (e.g. a Venti Frappuccino) ⇒ AI estimates its recipe ⇒ deduct milk/syrup/drizzle from inventory + compute theoretical COGS.*

**Verdict: ~60% complete.** The hard parts (data model, AI estimation, theoretical computation) are built and work as a **reporting tool**; the feature is **not operational** because the last-mile wiring (sale→ingredient depletion, operator UI, production estimation) is missing.

> Note: these "Phases" are the original COGS-reporting feature's Dec-2025 build stages, **unrelated** to the COGS Reliability & Visibility project's Clusters A/B/C.

## Built & working

| Capability | Status | Where |
|---|---|---|
| Data model (10+ COGS tables + AI tables) | ✅ Working | `*_create_cogs_reporting_phase1/2/3.sql`, `*_create_ai_cogs_tables.sql` |
| AI recipe estimation (OpenRouter/gpt-4o, per-ingredient confidence, pending → approve/reject) | ✅ Working | `src/lib/cogs/ai-recipe-service.ts`, `recipe-lookup.ts`; `POST /api/admin/cogs/recipes/generate`, `/[id]/approve`, `/[id]/reject`; `ai_recipe_estimates` |
| Theoretical COGS computation (recipes × sales, effective-dated recipes, sellable overrides, modifiers, unit conversion, waste, variance, coverage %) | ✅ Working | `/api/admin/cogs/report?include_theoretical=1` |
| Square sellable mapping (ITEM/VARIATION → cogs_products/cogs_sellables, aliases) | ✅ Working | `POST /api/admin/cogs/catalog/sync-square` |
| Manual recipe entry + report preview UI | ✅ Working | `COGSManagement.tsx` (Periods/Catalog/Recipes/Modifiers tabs) |

## Gaps (why it's not operational)

1. **Sale → ingredient depletion — MISSING (critical).** `sales-sync.ts` marks prepared/recipe items `impact='manual'` (`mapImpactType`) and never deducts recipe ingredients; only 1:1 prepackaged items decrement (`applyAutoDecrements`). Inventory goes stale for recipe-based items; theoretical COGS never reflects in real stock. → **MOK-179 (D1)**, needs a design brainstorm.
2. **No operator UI** to generate/approve AI recipes — routes + AI service exist, but nothing in `COGSManagement` triggers them; products missing recipes aren't surfaced. → **MOK-180 (D2)**.
3. **No production estimation workflow** — only dev/sim scripts (`estimate-sim-recipes.ts`, `simulate-cogs-sales.ts`, `seed-cogs-recipes.ts`). → **MOK-181 (D3)**.

## Tracking

Linear project **[Theoretical COGS → Production](https://linear.app/mokesai/project/theoretical-cogs-production-7b6d9e0fe4eb)** (MOK-179, MOK-180, MOK-181). Separate from COGS Reliability & Visibility (ships first). D1's depletion design gets a dedicated brainstorm before implementation.
