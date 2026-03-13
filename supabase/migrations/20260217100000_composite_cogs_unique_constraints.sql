BEGIN;

-- cogs_products: replace single-column square_item_id unique with composite (tenant_id, square_item_id)
ALTER TABLE public.cogs_products DROP CONSTRAINT cogs_products_square_item_id_key;
ALTER TABLE public.cogs_products
  ADD CONSTRAINT cogs_products_tenant_square_item_id_unique UNIQUE (tenant_id, square_item_id);

-- cogs_products: replace single-column product_code expression index with composite (tenant_id, lower(product_code))
DROP INDEX IF EXISTS idx_cogs_products_product_code_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cogs_products_tenant_product_code_unique
  ON public.cogs_products (tenant_id, lower(product_code))
  WHERE product_code IS NOT NULL;

-- cogs_sellables: replace single-column square_variation_id unique with composite (tenant_id, square_variation_id)
ALTER TABLE public.cogs_sellables DROP CONSTRAINT cogs_sellables_square_variation_id_key;
ALTER TABLE public.cogs_sellables
  ADD CONSTRAINT cogs_sellables_tenant_square_variation_id_unique UNIQUE (tenant_id, square_variation_id);

-- cogs_sellable_aliases: replace single-column square_variation_id unique with composite (tenant_id, square_variation_id)
ALTER TABLE public.cogs_sellable_aliases DROP CONSTRAINT cogs_sellable_aliases_square_variation_id_key;
ALTER TABLE public.cogs_sellable_aliases
  ADD CONSTRAINT cogs_sellable_aliases_tenant_square_variation_id_unique UNIQUE (tenant_id, square_variation_id);

-- cogs_modifier_sets: replace single-column square_modifier_list_id unique with composite (tenant_id, square_modifier_list_id)
ALTER TABLE public.cogs_modifier_sets DROP CONSTRAINT cogs_modifier_sets_square_modifier_list_id_key;
ALTER TABLE public.cogs_modifier_sets
  ADD CONSTRAINT cogs_modifier_sets_tenant_square_modifier_list_id_unique UNIQUE (tenant_id, square_modifier_list_id);

-- cogs_modifier_options: replace single-column square_modifier_id unique with composite (tenant_id, square_modifier_id)
ALTER TABLE public.cogs_modifier_options DROP CONSTRAINT cogs_modifier_options_square_modifier_id_key;
ALTER TABLE public.cogs_modifier_options
  ADD CONSTRAINT cogs_modifier_options_tenant_square_modifier_id_unique UNIQUE (tenant_id, square_modifier_id);

COMMIT;
