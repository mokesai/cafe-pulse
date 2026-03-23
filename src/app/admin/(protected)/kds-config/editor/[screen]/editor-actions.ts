'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import type { KDSLayout } from '@/lib/kds/layout-types'

export type EditorActionResult =
  | { success: true; layoutId: string; updatedAt: string }
  | { success: false; error: string }

/**
 * Save draft — writes layout with is_draft = true
 * Checks updated_at for optimistic concurrency (warns but doesn't block)
 */
export async function saveDraft(
  tenantId: string,
  screen: 'drinks' | 'food',
  layout: KDSLayout,
  currentUpdatedAt: string | null
): Promise<EditorActionResult> {
  try {
    const supabase = createServiceClient()

    // Optimistic concurrency check
    if (currentUpdatedAt) {
      const { data: existing } = await supabase
        .from('tenant_kds_layouts')
        .select('updated_at')
        .eq('tenant_id', tenantId)
        .eq('screen', screen)
        .eq('is_draft', true)
        .maybeSingle()

      if (existing && existing.updated_at !== currentUpdatedAt) {
        return { success: false, error: 'CONCURRENT_EDIT' }
      }
    }

    const { data, error } = await supabase
      .from('tenant_kds_layouts')
      .upsert(
        { tenant_id: tenantId, screen, layout, is_draft: true },
        { onConflict: 'tenant_id,screen,is_draft' }
      )
      .select('id, updated_at')
      .single()

    if (error) throw new Error(error.message)

    revalidatePath(`/admin/kds-config/editor/${screen}`)
    return { success: true, layoutId: data.id, updatedAt: data.updated_at }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Save failed' }
  }
}

/**
 * Publish — copies draft to published (is_draft = false)
 * Live KDS screens update on next refresh
 */
export async function publishLayout(
  tenantId: string,
  screen: 'drinks' | 'food',
  layout: KDSLayout
): Promise<EditorActionResult> {
  try {
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('tenant_kds_layouts')
      .upsert(
        { tenant_id: tenantId, screen, layout, is_draft: false },
        { onConflict: 'tenant_id,screen,is_draft' }
      )
      .select('id, updated_at')
      .single()

    if (error) throw new Error(error.message)

    revalidatePath(`/admin/(kds)/kds/${screen}`)
    revalidatePath(`/kds/${screen}`)
    revalidatePath(`/admin/kds-config/editor/${screen}`)
    return { success: true, layoutId: data.id, updatedAt: data.updated_at }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Publish failed' }
  }
}

/**
 * Reset to default — deletes both draft and published layouts
 * KDS reverts to default KDSDrinksMagazine / KDSFoodMagazine
 */
export async function resetToDefault(
  tenantId: string,
  screen: 'drinks' | 'food'
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createServiceClient()

    const { error } = await supabase
      .from('tenant_kds_layouts')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('screen', screen)

    if (error) throw new Error(error.message)

    revalidatePath(`/admin/(kds)/kds/${screen}`)
    revalidatePath(`/kds/${screen}`)
    revalidatePath(`/admin/kds-config/editor/${screen}`)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Reset failed' }
  }
}
