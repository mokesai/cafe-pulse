-- Seed inventory items for all test suppliers in bigcafe
-- This enables proper item matching during invoice pipeline testing
-- square_item_id is NOT NULL on the live DB (nullable constraint added by MOK-63 which runs after this)
-- We use a synthetic unique value: 'SEED-<supplier-prefix>-<item>' 

DO $$
DECLARE
  v_bigcafe_id uuid := '4fa1cbbe-49ff-4cde-a686-8d34252945b4'::uuid;
  v_supplier_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inventory_items WHERE tenant_id = v_bigcafe_id) THEN

    -- Bluepoint Bakery
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Bluepoint Bakery' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, item_name, unit_cost, unit_type, square_item_id, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Sourdough Bread',    12.50, 'each',   'SEED-BP-SOURDOUGH',   now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Croissants',         18.00, 'each',   'SEED-BP-CROISSANT',   now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Bagels',             15.00, 'each',   'SEED-BP-BAGEL',       now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Danish Pastries',    16.00, 'each',   'SEED-BP-DANISH',      now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Baguettes',           8.50, 'each',   'SEED-BP-BAGUETTE',    now(), now());
    END IF;

    -- Gold Seal Distributors
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Gold Seal Distributors' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, item_name, unit_cost, unit_type, square_item_id, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Whole Milk',  3.50, 'gallon', 'SEED-GS-MILK',    now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Butter',      4.25, 'lb',     'SEED-GS-BUTTER',  now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Eggs',        2.99, 'each',   'SEED-GS-EGGS',    now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Sugar',       1.50, 'lb',     'SEED-GS-SUGAR',   now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Flour',       0.75, 'lb',     'SEED-GS-FLOUR',   now(), now());
    END IF;

    -- Walmart Business
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Walmart Business' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, item_name, unit_cost, unit_type, square_item_id, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Coffee Beans Dark Roast', 8.99, 'lb',   'SEED-WM-COFFEE',  now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Paper Cups 12oz',         0.08, 'each', 'SEED-WM-CUPS',    now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Napkins',                 0.02, 'each', 'SEED-WM-NAPKINS', now(), now());
    END IF;

    -- Sam's Club
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Sam''s Club' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, item_name, unit_cost, unit_type, square_item_id, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Bulk Coffee Beans', 7.50, 'lb', 'SEED-SC-COFFEE', now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Bulk Sugar',        0.60, 'lb', 'SEED-SC-SUGAR',  now(), now());
    END IF;

    RAISE NOTICE 'Seeded inventory items for all suppliers in bigcafe tenant';
  ELSE
    RAISE NOTICE 'Inventory items already seeded — skipping';
  END IF;
END $$;
