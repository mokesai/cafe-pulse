-- Migration: Add tenant branding columns
-- Phase: 50, Plan 06 (gap closure - missing branding schema)
-- Description: Adds logo_url, primary_color, and secondary_color columns to the
-- tenants table. These fields were defined in Tenant type and used by
-- getTenantIdentity() in Phase 50-01 but never added to the database schema,
-- causing 500 errors site-wide.

-- =============================================================================
-- 1. Add branding columns to tenants table
-- =============================================================================
-- These columns enable per-tenant UI customization:
-- - logo_url: URL to tenant logo image (S3, CDN, or Supabase Storage)
-- - primary_color: Hex color for primary branding (buttons, headers)
-- - secondary_color: Hex color for secondary branding (accents, text)

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS primary_color text,
  ADD COLUMN IF NOT EXISTS secondary_color text;

-- =============================================================================
-- 2. Set default branding for default tenant (Little Cafe)
-- =============================================================================
-- Only updates if columns are null to avoid overwriting manual changes

UPDATE public.tenants
SET
  primary_color = '#f59e0b',  -- Amber 500 (Little Cafe brand)
  secondary_color = '#0f172a' -- Slate 900 (dark text)
WHERE id = '00000000-0000-0000-0000-000000000001'
  AND primary_color IS NULL; -- Only if not already set

-- Add helpful comments
COMMENT ON COLUMN public.tenants.logo_url IS
  'URL to tenant logo image for email templates, site header, and admin panel. Nullable until configured.';
COMMENT ON COLUMN public.tenants.primary_color IS
  'Primary brand color as hex code (e.g., #f59e0b). Used for buttons, headers, and email templates. Nullable with sensible defaults.';
COMMENT ON COLUMN public.tenants.secondary_color IS
  'Secondary brand color as hex code (e.g., #0f172a). Used for text, accents, and borders. Nullable with sensible defaults.';
