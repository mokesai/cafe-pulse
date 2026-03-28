-- Seed inventory items for all test suppliers in bigcafe
-- This enables proper item matching during invoice pipeline testing

DO $$
DECLARE
  v_bigcafe_id uuid := '4fa1cbbe-49ff-4cde-a686-8d34252945b4'::uuid;
  v_supplier_id uuid;
BEGIN
  -- Only seed if not already done
  IF NOT EXISTS (SELECT 1 FROM inventory_items WHERE supplier_id IN (SELECT id FROM suppliers WHERE tenant_id = v_bigcafe_id)) THEN
    
    -- Bluepoint Bakery inventory
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Bluepoint Bakery' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, product_name, unit_cost, unit, sku, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Sourdough Bread', 12.50, 'loaf', 'BP-SOURDOUGH', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Croissants', 18.00, 'dozen', 'BP-CROISSANT-DZ', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Bagels', 15.00, 'dozen', 'BP-BAGEL-DZ', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Danish Pastries', 16.00, 'dozen', 'BP-DANISH-DZ', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Baguettes', 8.50, 'loaf', 'BP-BAGUETTE', true, now(), now());
    END IF;

    -- Gold Seal Distributors inventory (common items)
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Gold Seal Distributors' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, product_name, unit_cost, unit, sku, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Whole Milk', 3.50, 'gallon', 'GS-MILK-GAL', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Butter', 4.25, 'lb', 'GS-BUTTER-LB', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Eggs', 2.99, 'dozen', 'GS-EGGS-DZ', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Sugar', 1.50, 'lb', 'GS-SUGAR-LB', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Flour', 0.75, 'lb', 'GS-FLOUR-LB', true, now(), now());
    END IF;

    -- Walmart Business inventory
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Walmart Business' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, product_name, unit_cost, unit, sku, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Coffee Beans - Dark Roast', 8.99, 'lb', 'WM-COFFEE-DARK', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Paper Cups - 12oz', 0.08, 'cup', 'WM-CUPS-12OZ', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Napkins', 0.02, 'napkin', 'WM-NAPKINS', true, now(), now());
    END IF;

    -- Sam's Club inventory
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Sam''s Club' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, product_name, unit_cost, unit, sku, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Bulk Coffee Beans', 7.50, 'lb', 'SC-COFFEE-BULK', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Bulk Sugar', 0.60, 'lb', 'SC-SUGAR-BULK', true, now(), now());
    END IF;

    RAISE NOTICE 'Seeded inventory items for all suppliers in bigcafe tenant';
  END IF;
END $$;
