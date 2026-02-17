import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { SiteSettings, SiteSettingsPayload, SiteStatus } from '@/types/settings'
import { DEFAULT_SITE_STATUS, mapSiteSettingsToStatus } from './siteSettings.shared'

export { DEFAULT_SITE_STATUS } from './siteSettings.shared'

async function invalidateEdgeCache(tenantId: string) {
  try {
    const edgeModule = await import('./siteSettings.edge')
    edgeModule.invalidateSiteStatusCache(tenantId)
  } catch (error) {
    console.warn('Unable to invalidate edge site status cache', error)
  }
}

export async function getSiteSettings(tenantId: string): Promise<SiteSettings | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('site_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch site settings:', error)
    return null
  }

  return (data as SiteSettings | null) ?? null
}

export async function getSiteStatus(tenantId: string): Promise<SiteStatus> {
  const record = await getSiteSettings(tenantId)
  return mapSiteSettingsToStatus(record || undefined)
}

function buildUpdatePayload(payload: SiteSettingsPayload, adminUserId?: string) {
  const updateData: Record<string, unknown> = {}

  if (payload.is_customer_app_live !== undefined) {
    updateData.is_customer_app_live = payload.is_customer_app_live
  }
  if (payload.maintenance_title !== undefined) {
    updateData.maintenance_title = payload.maintenance_title
  }
  if (payload.maintenance_message !== undefined) {
    updateData.maintenance_message = payload.maintenance_message
  }
  if (payload.maintenance_cta_label !== undefined) {
    updateData.maintenance_cta_label = payload.maintenance_cta_label
  }
  if (payload.maintenance_cta_href !== undefined) {
    updateData.maintenance_cta_href = payload.maintenance_cta_href
  }
  if (adminUserId) {
    updateData.updated_by = adminUserId
  }

  return updateData
}

export async function saveSiteSettings(tenantId: string, payload: SiteSettingsPayload, adminUserId?: string): Promise<SiteSettings> {
  const supabase = createServiceClient()
  const updateData = buildUpdatePayload(payload, adminUserId)

  if (Object.keys(updateData).length === 0) {
    const { data, error } = await supabase
      .from('site_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (error) {
      console.error('Failed to load existing site settings:', error)
      throw error
    }

    return data as SiteSettings
  }

  // Try updating the existing row first
  const { data: updated, error: updateError } = await supabase
    .from('site_settings')
    .update(updateData)
    .eq('tenant_id', tenantId)
    .select()
    .maybeSingle()

  if (updateError && updateError.code !== 'PGRST116') {
    console.error('Error updating site settings:', updateError)
    throw updateError
  }

  if (updated) {
    void invalidateEdgeCache(tenantId)
    return updated as SiteSettings
  }

  // If no row existed, insert a new one using defaults merged with payload
  const insertData = {
    tenant_id: tenantId,
    is_customer_app_live: payload.is_customer_app_live ?? DEFAULT_SITE_STATUS.isCustomerAppLive,
    maintenance_title: payload.maintenance_title ?? DEFAULT_SITE_STATUS.maintenanceTitle,
    maintenance_message: payload.maintenance_message ?? DEFAULT_SITE_STATUS.maintenanceMessage,
    maintenance_cta_label: payload.maintenance_cta_label ?? DEFAULT_SITE_STATUS.maintenanceCtaLabel,
    maintenance_cta_href: payload.maintenance_cta_href ?? DEFAULT_SITE_STATUS.maintenanceCtaHref,
    updated_by: adminUserId ?? null
  }

  const { data: inserted, error: insertError } = await supabase
    .from('site_settings')
    .insert(insertData)
    .select()
    .single()

  if (insertError) {
    console.error('Error inserting site settings:', insertError)
    throw insertError
  }

  void invalidateEdgeCache(tenantId)
  return inserted as SiteSettings
}

export async function getSiteStatusUsingServiceClient(tenantId: string): Promise<SiteStatus> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('site_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) {
    console.error('Service role failed to fetch site settings:', error)
    return DEFAULT_SITE_STATUS
  }

  return mapSiteSettingsToStatus(data as SiteSettings | null)
}
