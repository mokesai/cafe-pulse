/**
 * KDS Layout JSON Schema (v1)
 * Used by tenant_kds_layouts table and KDSDynamicScreen renderer
 */

import type { KDSDisplayType, KDSTheme } from './types'

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export interface KDSLayoutGrid {
  columns: number  // 1–6
  rows: number     // 1–6
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export type KDSSectionType = 'category' | 'image'

export interface KDSSectionPosition {
  col: number  // 0-indexed
  row: number  // 0-indexed
}

export interface KDSSectionSpan {
  cols: number
  rows: number
}

export interface KDSCategorySection {
  id: string
  type: 'category'
  category_slug: string
  position: KDSSectionPosition
  span: KDSSectionSpan
  display_type?: KDSDisplayType
}

export interface KDSImageSection {
  id: string
  type: 'image'
  image_url: string
  position: KDSSectionPosition
  span: KDSSectionSpan
  fit?: 'cover' | 'contain' | 'fill'
}

export type KDSLayoutSection = KDSCategorySection | KDSImageSection

// ---------------------------------------------------------------------------
// Overlays (free-positioned on top of grid)
// ---------------------------------------------------------------------------

export interface KDSLayoutOverlay {
  id: string
  type: 'image'
  image_url: string
  position: { x: string; y: string }  // percentage strings e.g. "85%", "5%"
  size: { width: string; height: string }
}

// ---------------------------------------------------------------------------
// Header / Footer
// ---------------------------------------------------------------------------

export interface KDSLayoutHeader {
  visible: boolean
  show_logo?: boolean
  logo_position?: 'left' | 'center' | 'right'
}

export interface KDSLayoutFooter {
  visible: boolean
  type?: 'image-rotator' | 'text'
}

// ---------------------------------------------------------------------------
// Root Layout
// ---------------------------------------------------------------------------

export interface KDSLayout {
  version: 1
  theme?: KDSTheme
  grid: KDSLayoutGrid
  sections: KDSLayoutSection[]
  overlays?: KDSLayoutOverlay[]
  header?: KDSLayoutHeader
  footer?: KDSLayoutFooter
}

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

export interface TenantKDSLayout {
  id: string
  tenant_id: string
  screen: 'drinks' | 'food'
  layout: KDSLayout
  is_draft: boolean
  created_at: string
  updated_at: string
}
