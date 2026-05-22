-- KDS Pi Deployment phase 5 — v3 schema integration on kds_devices
--
-- Spec: https://linear.app/mokesai/issue/MOK-161
-- Plan: .planning/kds-v3-pi/PHASE-5-PLAN.md (T1)
--
-- Add screen_1_id + screen_2_id UUID columns referencing kds_screens(id)
-- with ON DELETE SET NULL. The Pi-side config routes build v3 URLs
-- (/kds/v3/<deviceId>/<screen_uuid>) from these.
--
-- Legacy `screen_1` / `screen_2` text columns are intentionally left
-- alone — they stay in the response shape through one release for Pi-side
-- script compatibility; drop in a follow-up post-Phase-7.
--
-- No automatic backfill: operator reassigns screens via the Phase 6 device
-- manager. Existing rows get NULL UUID values until the operator picks.
--
-- Rollback: see .planning/kds-v3-pi/PHASE-5-ROLLBACK.sql.

BEGIN;

ALTER TABLE public.kds_devices
  ADD COLUMN IF NOT EXISTS screen_1_id uuid,
  ADD COLUMN IF NOT EXISTS screen_2_id uuid;

-- FK to kds_screens. ON DELETE SET NULL so removing a v3 screen doesn't
-- cascade-delete the device record — operator sees the "Unassigned" state
-- in the Phase 6 device manager and reassigns.
ALTER TABLE public.kds_devices
  DROP CONSTRAINT IF EXISTS kds_devices_screen_1_id_fkey;
ALTER TABLE public.kds_devices
  ADD CONSTRAINT kds_devices_screen_1_id_fkey
    FOREIGN KEY (screen_1_id) REFERENCES public.kds_screens(id) ON DELETE SET NULL;

ALTER TABLE public.kds_devices
  DROP CONSTRAINT IF EXISTS kds_devices_screen_2_id_fkey;
ALTER TABLE public.kds_devices
  ADD CONSTRAINT kds_devices_screen_2_id_fkey
    FOREIGN KEY (screen_2_id) REFERENCES public.kds_screens(id) ON DELETE SET NULL;

COMMIT;
