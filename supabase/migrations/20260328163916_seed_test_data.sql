-- Seed test data for staging environment
-- Adds suppliers and inventory items to bigcafe tenant for testing

-- Get bigcafe tenant ID (this is static in our dev database)
DO $$
DECLARE
  v_bigcafe_id uuid := '4fa1cbbe-49ff-4cde-a686-8d34252945b4'::uuid;
  v_supplier_id uuid;
BEGIN
  -- Only seed if not already done (idempotent)
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE tenant_id = v_bigcafe_id) THEN
    
    -- Create suppliers
    INSERT INTO suppliers (id, tenant_id, name, email, phone, is_active, created_at, updated_at)
    VALUES
      (gen_random_uuid(), v_bigcafe_id, 'Bluepoint Bakery', 'contact@bluepointbakery.com', '555-0001', true, now(), now()),
      (gen_random_uuid(), v_bigcafe_id, 'Walmart Business', 'orders@walmart.com', '555-0002', true, now(), now()),
      (gen_random_uuid(), v_bigcafe_id, 'Sam''s Club', 'business@samsclub.com', '555-0003', true, now(), now()),
      (gen_random_uuid(), v_bigcafe_id, 'Odeko', 'sales@odeko.com', '555-0004', true, now(), now()),
      (gen_random_uuid(), v_bigcafe_id, 'Outrageous Bakery', 'orders@outrageousbakery.com', '555-0005', true, now(), now()),
      (gen_random_uuid(), v_bigcafe_id, 'Lulala LLC', 'contact@lulala.com', '555-0006', true, now(), now()),
      (gen_random_uuid(), v_bigcafe_id, 'Gold Seal Distributors', 'sales@goldseal.com', '555-0007', true, now(), now());
    
    -- Get Bluepoint Bakery supplier ID for inventory
    SELECT id INTO v_supplier_id FROM suppliers 
    WHERE tenant_id = v_bigcafe_id AND name = 'Bluepoint Bakery' LIMIT 1;
    
    IF v_supplier_id IS NOT NULL THEN
      -- Create inventory items for Bluepoint Bakery
      INSERT INTO inventory_items (id, supplier_id, tenant_id, product_name, unit_cost, unit, sku, is_active, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Sourdough Bread', 12.50, 'loaf', 'BP-SOURDOUGH', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Croissants', 18.00, 'dozen', 'BP-CROISSANT-DZ', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Bagels', 15.00, 'dozen', 'BP-BAGEL-DZ', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Danish Pastries', 16.00, 'dozen', 'BP-DANISH-DZ', true, now(), now()),
        (gen_random_uuid(), v_supplier_id, v_bigcafe_id, 'Baguettes', 8.50, 'loaf', 'BP-BAGUETTE', true, now(), now());
    END IF;

    RAISE NOTICE 'Seeded test data for bigcafe tenant';
  END IF;
END $$;
