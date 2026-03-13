-- Migration: Fix site_settings PK from integer DEFAULT 1 to UUID
-- Resolves GAP-3: second tenant INSERT fails with PK collision (both tenants get id=1)
-- After this migration: each tenant gets a random UUID as PK; UNIQUE(tenant_id) enforces one row per tenant

BEGIN;

-- Step 1: Add a new UUID column that will become the primary key
ALTER TABLE public.site_settings
  ADD COLUMN id_new uuid DEFAULT gen_random_uuid() NOT NULL;

-- Step 2: Drop the existing PK constraint (no other table has an FK to site_settings.id)
ALTER TABLE public.site_settings
  DROP CONSTRAINT site_settings_pkey;

-- Step 3: Drop the old integer id column
ALTER TABLE public.site_settings
  DROP COLUMN id;

-- Step 4: Rename the new UUID column to id
ALTER TABLE public.site_settings
  RENAME COLUMN id_new TO id;

-- Step 5: Set the UUID column as the new primary key
ALTER TABLE public.site_settings
  ADD CONSTRAINT site_settings_pkey PRIMARY KEY (id);

-- Step 6: Add UNIQUE constraint on tenant_id (enforces one settings row per tenant)
ALTER TABLE public.site_settings
  ADD CONSTRAINT site_settings_tenant_id_unique UNIQUE (tenant_id);

COMMIT;
