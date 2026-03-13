BEGIN;

-- inventory_items: Replace single-column partial index with tenant-scoped composite partial index.
-- The old index was (square_item_id, pack_size) WHERE square_item_id IS NOT NULL.
-- The new index prepends tenant_id so each tenant can independently manage their inventory SKUs.
DROP INDEX IF EXISTS inventory_items_square_pack_unique;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_tenant_square_pack_unique
  ON public.inventory_items (tenant_id, square_item_id, pack_size)
  WHERE square_item_id IS NOT NULL;

-- suppliers: Replace global name uniqueness with per-tenant name uniqueness.
-- Two tenants can now each have a supplier named "Sysco" or "US Foods".
ALTER TABLE public.suppliers DROP CONSTRAINT suppliers_name_key;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_tenant_name_unique UNIQUE (tenant_id, name);

-- inventory_unit_types: name column has no existing single-column UNIQUE constraint
-- (the original CREATE TABLE defined `name text not null` without UNIQUE).
-- No drop needed; skip the tenant_name constraint (nothing to replace).
-- Note: research doc incorrectly listed inventory_unit_types_name_key as existing.

-- inventory_unit_types: Replace global symbol uniqueness with per-tenant symbol uniqueness.
ALTER TABLE public.inventory_unit_types DROP CONSTRAINT inventory_unit_types_symbol_key;
ALTER TABLE public.inventory_unit_types
  ADD CONSTRAINT inventory_unit_types_tenant_symbol_unique UNIQUE (tenant_id, symbol);

-- purchase_orders: Replace global order_number uniqueness with per-tenant order_number uniqueness.
-- Tenants use independent sequential order number series (e.g., both can have PO-0001).
ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_order_number_key;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_tenant_order_number_unique UNIQUE (tenant_id, order_number);

COMMIT;
