-- A3 / MOK-171: store package_cost as the canonical pack/case price so an operator-entered
-- package cost does not drift when unit_cost is rounded to 4dp.
--
-- Today only unit_cost (numeric(12,4)) is persisted; the pack cost is re-derived in the UI as
-- unit_cost * pack_size. A non-divisible entry like $10.00 for a pack of 3 becomes unit_cost
-- 3.3333, and re-deriving the pack cost gives 9.9999 — silently changing what the operator typed.
--
-- Fix: add package_cost. For pack rows it is the authoritative pack price; unit_cost is the
-- derived per-unit value used by stock/COGS math. The two are kept consistent by the inventory
-- API (whichever the caller supplies, the other is derived). Backfill keeps existing rows
-- consistent with their current unit_cost.

BEGIN;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS package_cost numeric(12,4);

COMMENT ON COLUMN public.inventory_items.package_cost IS
  'MOK-171: canonical pack/case price as entered by the operator. unit_cost is the derived per-unit value (round(package_cost / pack_size, 4)). Kept consistent with unit_cost by the inventory API.';

-- Backfill: existing rows carry only unit_cost; derive package_cost from it so the column is
-- populated and consistent (package_cost = unit_cost * pack_size, to 4dp).
UPDATE public.inventory_items
   SET package_cost = round(coalesce(unit_cost, 0) * coalesce(pack_size, 1), 4)
 WHERE package_cost IS NULL;

COMMIT;
