/**
 * MOK-159 / KDS v3 phase 6.5 — publish + discard-draft helpers.
 *
 * Plan: .planning/kds-v3/PHASE-6.5-PLAN.md (T2)
 *
 * Thin wrappers around the two PL/pgSQL functions that do the
 * transactional snapshot work. Server-side only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PublishDiff {
  added: number
  changed: number
  removed: number
}

export interface PublishResult {
  published_at: string
  diff: PublishDiff
}

export interface DiscardResult {
  reverted_to_published_at: string
}

/**
 * Snapshot the current draft of a screen into the published tables. The
 * underlying PL/pgSQL function does the work inside a single DB
 * transaction. Returns a diff summary the route surfaces to the operator
 * in the publish-confirm dialog.
 *
 * Throws if the screen doesn't exist for the tenant.
 */
export async function publishKdsScreen(
  supabase: SupabaseClient,
  tenantId: string,
  screenId: string,
): Promise<PublishResult> {
  const { data, error } = await supabase.rpc('publish_kds_screen', {
    p_tenant_id: tenantId,
    p_screen_id: screenId,
  })
  if (error) {
    // P0002 → screen not found for tenant.
    const code = (error as { code?: string }).code
    if (code === 'P0002') {
      const e = new Error('KDS_SCREEN_NOT_FOUND') as Error & { code: string; status: number }
      e.code = 'KDS_SCREEN_NOT_FOUND'
      e.status = 404
      throw e
    }
    throw new Error(`publish_kds_screen failed: ${error.message}`)
  }
  return data as PublishResult
}

/**
 * Replace a screen's draft state from the most recently published snapshot
 * (the inverse of publish). Useful when an operator wants to abandon an
 * in-progress iteration.
 *
 * Throws KDS_NO_PUBLISHED_VERSION if the screen has never been published.
 */
export async function discardKdsScreenDraft(
  supabase: SupabaseClient,
  tenantId: string,
  screenId: string,
): Promise<DiscardResult> {
  const { data, error } = await supabase.rpc('discard_kds_screen_draft', {
    p_tenant_id: tenantId,
    p_screen_id: screenId,
  })
  if (error) {
    const code = (error as { code?: string }).code
    if (code === 'P0002') {
      const e = new Error('KDS_SCREEN_NOT_FOUND') as Error & { code: string; status: number }
      e.code = 'KDS_SCREEN_NOT_FOUND'
      e.status = 404
      throw e
    }
    if (code === '22023' || error.message.includes('KDS_NO_PUBLISHED_VERSION')) {
      const e = new Error('KDS_NO_PUBLISHED_VERSION') as Error & { code: string; status: number }
      e.code = 'KDS_NO_PUBLISHED_VERSION'
      e.status = 422
      throw e
    }
    throw new Error(`discard_kds_screen_draft failed: ${error.message}`)
  }
  return data as DiscardResult
}
