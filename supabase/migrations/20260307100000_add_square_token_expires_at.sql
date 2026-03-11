-- Add missing square_token_expires_at column to tenants table.
-- Referenced by store_square_credentials_internal RPC but never created.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS square_token_expires_at timestamptz;
