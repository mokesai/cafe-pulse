-- Drop all v1 tenant_kds_layouts rows
-- v2 schema (hierarchical column model) is not backward compatible with v1 CSS grid JSON
-- Safe to truncate — no production tenants using v1 yet

TRUNCATE TABLE tenant_kds_layouts;
