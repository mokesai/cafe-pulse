-- KDS v3 phase 6.5 — publish + discard-draft PL/pgSQL functions
--
-- Spec: https://linear.app/mokesai/issue/MOK-159
-- Plan: .planning/kds-v3/PHASE-6.5-PLAN.md (T2)
--
-- Two transactional functions called by the publish + discard-draft routes:
--
--   - publish_kds_screen(tenant_id, screen_id) — snapshots the current
--     draft into the published tables atomically and returns a JSON diff
--     summary { added, changed, removed } for the confirm dialog.
--
--   - discard_kds_screen_draft(tenant_id, screen_id) — replaces the
--     draft state from the last published snapshot (the inverse of
--     publish). Returns the published_at timestamp the draft was
--     reverted to.
--
-- Both run inside the function's implicit transaction so a crash mid-
-- operation can't leave a half-published / half-discarded state.
--
-- SECURITY INVOKER (the default) — the route uses the service-role
-- client to call these, which bypasses RLS. Route-layer tenant ownership
-- check is the load-bearing authorization boundary.
--
-- Rollback: see .planning/kds-v3/PHASE-6.5-ROLLBACK.sql.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- publish_kds_screen — snapshot draft → published
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.publish_kds_screen(
  p_tenant_id uuid,
  p_screen_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_added   int := 0;
  v_removed int := 0;
  v_changed int := 0;
  v_old_boxes jsonb;
  v_new_boxes jsonb;
  v_published_at timestamptz;
BEGIN
  -- Defense in depth: the route validates this too, but ensure the function
  -- can't be tricked into publishing a screen the caller doesn't own.
  IF NOT EXISTS (
    SELECT 1 FROM public.kds_screens WHERE id = p_screen_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'KDS_SCREEN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Capture pre-publish box state for diff computation. Strip created_at /
  -- updated_at (those tick on every mutation; meaningful diffs are in the
  -- semantic columns).
  SELECT COALESCE(
    jsonb_object_agg(b.id, to_jsonb(b.*) - 'created_at' - 'updated_at'),
    '{}'::jsonb
  )
  INTO v_old_boxes
  FROM public.kds_published_grid_boxes b
  WHERE b.screen_id = p_screen_id AND b.tenant_id = p_tenant_id;

  -- Replace published screen + boxes from draft.
  -- screen_id FK cascade removes the old boxes when we delete the screen row.
  DELETE FROM public.kds_published_screens
    WHERE id = p_screen_id AND tenant_id = p_tenant_id;

  v_published_at := now();

  INSERT INTO public.kds_published_screens
    (id, tenant_id, name, grid_rows, grid_cols, theme, square_menu_id, created_at, updated_at, published_at)
  SELECT id, tenant_id, name, grid_rows, grid_cols, theme, square_menu_id, created_at, updated_at, v_published_at
  FROM public.kds_screens
  WHERE id = p_screen_id AND tenant_id = p_tenant_id;

  INSERT INTO public.kds_published_grid_boxes
  SELECT * FROM public.kds_grid_boxes
  WHERE screen_id = p_screen_id AND tenant_id = p_tenant_id;

  -- Capture post-publish state for the diff.
  SELECT COALESCE(
    jsonb_object_agg(b.id, to_jsonb(b.*) - 'created_at' - 'updated_at'),
    '{}'::jsonb
  )
  INTO v_new_boxes
  FROM public.kds_published_grid_boxes b
  WHERE b.screen_id = p_screen_id AND b.tenant_id = p_tenant_id;

  -- Diff: keys-in-new-only = added; keys-in-old-only = removed; keys in
  -- both whose payload differs = changed.
  SELECT count(*) INTO v_added
  FROM jsonb_object_keys(v_new_boxes) AS k(key)
  WHERE NOT (v_old_boxes ? k.key);

  SELECT count(*) INTO v_removed
  FROM jsonb_object_keys(v_old_boxes) AS k(key)
  WHERE NOT (v_new_boxes ? k.key);

  SELECT count(*) INTO v_changed
  FROM jsonb_object_keys(v_new_boxes) AS k(key)
  WHERE (v_old_boxes ? k.key)
    AND (v_old_boxes -> k.key) IS DISTINCT FROM (v_new_boxes -> k.key);

  RETURN jsonb_build_object(
    'published_at', v_published_at,
    'diff', jsonb_build_object(
      'added',   v_added,
      'removed', v_removed,
      'changed', v_changed
    )
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- discard_kds_screen_draft — replace draft from last published snapshot
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.discard_kds_screen_draft(
  p_tenant_id uuid,
  p_screen_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_published_at timestamptz;
BEGIN
  -- Verify both a draft AND a published version exist for the tenant +
  -- screen. If no published exists, there's nothing to revert to —
  -- surface as a structured error the route can map to 422.
  IF NOT EXISTS (
    SELECT 1 FROM public.kds_screens WHERE id = p_screen_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'KDS_SCREEN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT published_at INTO v_published_at
  FROM public.kds_published_screens
  WHERE id = p_screen_id AND tenant_id = p_tenant_id;

  IF v_published_at IS NULL THEN
    RAISE EXCEPTION 'KDS_NO_PUBLISHED_VERSION' USING ERRCODE = '22023';
  END IF;

  -- Replace draft boxes from published.
  DELETE FROM public.kds_grid_boxes
    WHERE screen_id = p_screen_id AND tenant_id = p_tenant_id;

  INSERT INTO public.kds_grid_boxes
  SELECT * FROM public.kds_published_grid_boxes
  WHERE screen_id = p_screen_id AND tenant_id = p_tenant_id;

  -- Restore draft screen metadata from published; reset draft_updated_at
  -- to the published_at so the "unpublished changes" badge returns to
  -- "up to date".
  UPDATE public.kds_screens d
  SET name              = p.name,
      grid_rows         = p.grid_rows,
      grid_cols         = p.grid_cols,
      theme             = p.theme,
      square_menu_id    = p.square_menu_id,
      updated_at        = now(),
      draft_updated_at  = v_published_at
  FROM public.kds_published_screens p
  WHERE d.id = p_screen_id
    AND d.tenant_id = p_tenant_id
    AND p.id = p_screen_id
    AND p.tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'reverted_to_published_at', v_published_at
  );
END;
$$;

COMMIT;
