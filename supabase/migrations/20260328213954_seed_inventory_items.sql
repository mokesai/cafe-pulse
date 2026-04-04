-- Seed inventory items for all test suppliers in bigcafe
-- This enables proper item matching during invoice pipeline testing
-- Columns: item_name, unit_cost, unit_type, tenant_id, supplier_id (square_item_id is nullable)

DO $$
DECLARE
  v_bigcafe_id uuid := '4fa1cbbe-49ff-4cde-a686-8d34252945b4'::uuid;
  v_supplier_id uuid;
BEGIN
  -- Only seed if not already done
  IF NOT EXISTS (SELECT 1 FROM inventory_items WHERE tenant_id = v_bigcafe_id) THEN

    -- Bluepoint Bakery inventory
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Bluepoint Bakery' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, item_name, unit_cost, unit_type, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Sourdough Bread', 12.50, 'each', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Croissants', 18.00, 'each', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Bagels', 15.00, 'each', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Danish Pastries', 16.00, 'each', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Baguettes', 8.50, 'each', true, now(), now());
    END IF;

    -- Gold Seal Distributors inventory
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Gold Seal Distributors' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, item_name, unit_cost, unit_type, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Whole Milk', 3.50, 'gallon', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Butter', 4.25, 'lb', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Eggs', 2.99, 'each', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Sugar', 1.50, 'lb', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Flour', 0.75, 'lb', true, now(), now());
    END IF;

    -- Walmart Business inventory
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Walmart Business' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, item_name, unit_cost, unit_type, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Coffee Beans Dark Roast', 8.99, 'lb', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Paper Cups 12oz', 0.08, 'each', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Napkins', 0.02, 'each', true, now(), now());
    END IF;

    -- Sam's Club inventory
    SELECT id INTO v_supplier_id FROM suppliers WHERE tenant_id = v_bigcafe_id AND name = 'Sam''s Club' LIMIT 1;
    IF v_supplier_id IS NOT NULL THEN
      INSERT INTO inventory_items (id, supplier_id, tenant_id, item_name, unit_cost, unit_type, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Bulk Coffee Beans', 7.50, 'lb', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Bulk Sugar', 0.60, 'lb', true, now(), now());
    END IF;

    RAISE NOTICE 'Seeded inventory items for all suppliers in bigcafe tenant';
  ELSE
    RAISE NOTICE 'Inventory items already seeded — skipping';
  END IF;
END $$;
