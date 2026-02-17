export interface SiteSettings {
  id: string
  tenant_id: string
  is_customer_app_live: boolean
  maintenance_title: string | null
  maintenance_message: string | null
  maintenance_cta_label: string | null
  maintenance_cta_href: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface SiteSettingsPayload {
  is_customer_app_live?: boolean
  maintenance_title?: string
  maintenance_message?: string
  maintenance_cta_label?: string
  maintenance_cta_href?: string
}

export interface SiteStatus {
  isCustomerAppLive: boolean
  maintenanceTitle: string
  maintenanceMessage: string
  maintenanceCtaLabel: string
  maintenanceCtaHref: string
}
