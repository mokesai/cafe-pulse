/**
 * KDS Layout JSON Schema v2 — Hierarchical Column Model
 *
 * Structure: columns → rows → (optional) 2 horizontal divisions
 * Rendering: nested flexbox (column row flex → column → row → division)
 *
 * Replaces v1 CSS Grid schema. No backward compatibility — v1 rows truncated via migration.
 */

import type { KDSDisplayType, KDSTheme } from './types'

// ---------------------------------------------------------------------------
// Cell content (lives in a row or division)
// ---------------------------------------------------------------------------

export type KDSCellContentType = 'category' | 'image' | 'empty'

export interface KDSCellContent {
  type: KDSCellContentType
  // category
  category_slug?: string
  display_type?: KDSDisplayType
  // image
  image_url?: string
  image_fit?: 'cover' | 'contain' | 'fill'
}

// ---------------------------------------------------------------------------
// Division — horizontal split within a row (exactly 2 per split row)
// ---------------------------------------------------------------------------

export interface KDSDivision {
  id: string
  width: number   // percentage of row width; two divisions sum to 100
  content: KDSCellContent
}

// ---------------------------------------------------------------------------
// Row — vertical slice within a column
// ---------------------------------------------------------------------------

export interface KDSRow {
  id: string
  height: number              // percentage of column height; rows in column sum to 100
  content?: KDSCellContent   // present when NOT split
  divisions?: [KDSDivision, KDSDivision]  // present when split (exactly 2)
  gap?: number               // pixel gap between divisions (default: 0)
}

// ---------------------------------------------------------------------------
// Column — horizontal section of the screen
// ---------------------------------------------------------------------------

export interface KDSColumn {
  id: string
  width: number   // percentage of screen width; columns sum to 100
  rows: KDSRow[]
}

// ---------------------------------------------------------------------------
// Overlays — free-positioned images on top of column layout (unchanged from v1)
// ---------------------------------------------------------------------------

export interface KDSLayoutOverlay {
  id: string
  type: 'image'
  image_url: string
  position: { x: string; y: string }   // e.g. "85%", "5%"
  size: { width: string; height: string }
}

// ---------------------------------------------------------------------------
// Header / Footer (unchanged from v1)
// ---------------------------------------------------------------------------

export interface KDSLayoutHeader {
  visible: boolean
  title?: string                    // e.g. "Little Cafe"
  subtitle?: string                 // e.g. "Freshly Brewed, Just for You"
  title_font?: string               // Google Fonts family name (e.g. "Playfair Display")
  subtitle_font?: string            // Google Fonts family name
  title_font_size?: number          // rem units (default: 2.5)
  subtitle_font_size?: number       // rem units (default: 1.5)
  title_icon_url?: string           // image URL for icon left of title
  logo_url?: string                 // image URL for logo
  logo_position?: 'left' | 'center' | 'right'
  subtitle_icon_url?: string        // small icon next to subtitle
  show_location?: boolean           // show location from kds_settings
  show_hours?: boolean              // show hours from kds_settings
}

export interface KDSLayoutFooter {
  visible: boolean
  type?: 'image-rotator' | 'static-image' | 'none'
  images?: string[]                 // image URLs for rotator or static display
  rotation_interval?: number        // seconds (default: from kds_settings)
}

// ---------------------------------------------------------------------------
// Root Layout v2
// ---------------------------------------------------------------------------

export interface KDSLayout {
  version: 2
  theme?: KDSTheme
  columns: KDSColumn[]
  overlays?: KDSLayoutOverlay[]
  header?: KDSLayoutHeader
  footer?: KDSLayoutFooter
}

// ---------------------------------------------------------------------------
// Default layout — 3 equal columns, 1 empty row each
// ---------------------------------------------------------------------------

export function createDefaultLayout(): KDSLayout {
  return {
    version: 2,
    columns: [
      { id: 'col-1', width: 33.33, rows: [{ id: 'r1-1', height: 100, content: { type: 'empty' } }] },
      { id: 'col-2', width: 33.33, rows: [{ id: 'r2-1', height: 100, content: { type: 'empty' } }] },
      { id: 'col-3', width: 33.34, rows: [{ id: 'r3-1', height: 100, content: { type: 'empty' } }] },
    ],
    overlays: [],
    header: { visible: true, logo_position: 'left', show_location: true, show_hours: true },
    footer: { visible: true, type: 'image-rotator', images: [], rotation_interval: 6 },
  }
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

export const LAYOUT_CONSTRAINTS = {
  MAX_COLUMNS: 6,
  MIN_COLUMN_WIDTH: 15,
  MAX_ROWS_PER_COLUMN: 6,
  MIN_ROW_HEIGHT: 10,
  MIN_DIVISION_WIDTH: 20,
} as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a stable unique ID for new elements */
export function layoutId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Redistribute percentages equally when adding an item
 * e.g. [40, 30, 30] + 1 → [25, 25, 25, 25]
 */
export function redistributeEqual(count: number): number[] {
  const base = Math.floor(100 / count)
  const remainder = 100 - base * count
  return Array.from({ length: count }, (_, i) => base + (i === count - 1 ? remainder : 0))
}

/**
 * Redistribute proportionally when removing an item
 * e.g. [40, 30, 30] remove index 0 → [50, 50] (30/60 * 100, 30/60 * 100)
 */
export function redistributeProportional(values: number[], removeIndex: number): number[] {
  const remaining = values.filter((_, i) => i !== removeIndex)
  const total = remaining.reduce((s, v) => s + v, 0)
  if (total === 0) return remaining.map(() => 100 / remaining.length)
  const scaled = remaining.map(v => (v / total) * 100)
  // Fix rounding so sum is exactly 100
  const roundedSum = scaled.slice(0, -1).reduce((s, v) => s + Math.round(v), 0)
  return [...scaled.slice(0, -1).map(v => Math.round(v)), 100 - roundedSum]
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
