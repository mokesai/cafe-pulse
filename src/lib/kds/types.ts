/**
 * Kitchen Display System (KDS) Types
 * Type definitions for menu display on TV screens
 */

// Screen identifier for the two TV displays
export type KDSScreen = 'drinks' | 'food'

// Available themes
export type KDSTheme = 'warm' | 'dark' | 'wps'
export const KDS_THEMES: KDSTheme[] = ['warm', 'dark', 'wps']

// Display type for categories and items
export type KDSDisplayType = 'featured' | 'price-grid' | 'simple-list' | 'single-price' | 'flavor-options'

// Bullet color for featured and flavor items
export type KDSBulletColor = 'green' | 'yellow' | 'orange' | 'brown' | 'pink' | 'blue' | 'red' | 'teal'

// Position of category quadrant on screen (legacy, now optional)
export type KDSPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

// Available category icons
export type KDSCategoryIcon =
  | 'coffee'
  | 'frappuccino'
  | 'tea'
  | 'iced-drink'
  | 'croissant'
  | 'cookie'
  | 'danish'
  | 'ice-cream'
  | 'chocolate'
  | 'customize'
  | 'lotus'
  | 'sandwich'
  | 'breakfast'

/**
 * Display category (one quadrant on a screen)
 */
export interface KDSCategory {
  id: string
  name: string           // "Hot Drinks"
  slug: string           // "hot-drinks"
  screen: KDSScreen
  position?: KDSPosition // now optional, use sortOrder for ordering
  sortOrder: number
  color?: string         // optional accent color
  icon?: KDSCategoryIcon // icon name for category header
  displayType?: KDSDisplayType // display style for this category
  showSizeHeader?: boolean     // whether to show size column headers
  headerText?: string          // custom header text for single-price categories
  sizeLabels?: string[]        // custom size labels (e.g., ["Tall", "Grande", "Venti"])
  createdAt: string
  updatedAt: string
}

/**
 * Database row format for kds_categories
 */
export interface KDSCategoryRow {
  id: string
  name: string
  slug: string
  screen: string
  position: string | null
  sort_order: number
  color: string | null
  icon: string | null
  display_type: string | null
  show_size_header: boolean | null
  header_text: string | null
  size_labels: string | null
  created_at: string
  updated_at: string
}

/**
 * Menu item displayed on KDS screen
 */
export interface KDSMenuItem {
  id: string
  squareItemId?: string
  squareVariationId?: string
  name: string           // "Caramel Macchiato"
  displayName?: string   // optional shorter name
  variationName?: string // size variation (Tall, Grande, Venti, Regular)
  priceCents: number     // 595 = $5.95
  displayPrice?: string  // "$5.95" formatted
  categoryId: string
  sortOrder: number
  isVisible: boolean
  displayType?: KDSDisplayType // override display type for this item
  featured?: boolean           // appears in featured section
  bulletColor?: KDSBulletColor // bullet color for featured/flavor items
  parentItem?: string          // parent item name for flavor grouping
  createdAt: string
  updatedAt: string
}

/**
 * Database row format for kds_menu_items
 */
export interface KDSMenuItemRow {
  id: string
  square_item_id: string | null
  square_variation_id: string | null
  name: string
  display_name: string | null
  variation_name: string | null
  price_cents: number
  display_price: string | null
  category_id: string | null
  sort_order: number
  is_visible: boolean
  display_type: string | null
  featured: boolean | null
  bullet_color: string | null
  parent_item: string | null
  created_at: string
  updated_at: string
}

/**
 * KDS setting key-value pair
 */
export interface KDSSetting {
  id: string
  key: string
  value: string | number | boolean | object
  updatedAt: string
}

/**
 * Database row format for kds_settings
 */
export interface KDSSettingRow {
  id: string
  key: string
  value: unknown  // JSONB
  updated_at: string
}

/**
 * Known setting keys with their value types
 */
export interface KDSSettingsMap {
  image_rotation_interval: number  // milliseconds
  refresh_interval: number         // milliseconds
  drinks_tagline: string
  food_tagline: string
  drinks_subtitle: string          // subtitle under logo for drinks screen
  food_subtitle: string            // subtitle under logo for food screen
  header_hours: string
  header_location: string
  cafe_name: string                // "Little Café"
  theme: KDSTheme                   // theme selection
  food_header: string              // banner header text for food screen
  drinks_show_starbucks_logo: boolean // show Starbucks logo in drinks subtitle
  config_access_roles: string      // JSON array e.g. '["owner","admin"]'
}

/**
 * Footer image for rotating display
 */
export interface KDSImage {
  id: string
  screen: KDSScreen
  filename: string       // "espresso-pour.jpg"
  altText?: string
  sortOrder: number
  isActive: boolean
  createdAt: string
}

/**
 * Database row format for kds_images
 */
export interface KDSImageRow {
  id: string
  screen: string
  filename: string
  alt_text: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

/**
 * Category with its menu items (for display)
 */
export interface KDSCategoryWithItems extends KDSCategory {
  items: KDSMenuItem[]
}

/**
 * Complete screen data for rendering
 */
export interface KDSScreenData {
  screen: KDSScreen
  categories: KDSCategoryWithItems[]
  images: KDSImage[]
  tagline: string
  settings: Partial<KDSSettingsMap>
}

/**
 * Header configuration for display
 */
export interface KDSHeaderConfig {
  logoUrl?: string
  cafeName: string
  location: string
  hours: string
}

/**
 * Import data format (from Google Sheets CSV)
 */
export interface KDSImportItem {
  square_item_id?: string
  square_variation_id?: string
  name: string
  display_name?: string
  price: number | string    // can be "5.95" or 595
  display_price?: string
  category: string          // category slug
  sort_order?: number | string
  is_visible?: boolean | string
  display_type?: KDSDisplayType
  featured?: boolean | string
  bullet_color?: KDSBulletColor
  parent_item?: string
}

export interface KDSImportCategory {
  slug: string
  name: string
  screen: KDSScreen
  position?: KDSPosition   // now optional
  sort_order?: number
  color?: string
  icon?: string            // icon name
  display_type?: KDSDisplayType
  show_size_header?: boolean
  header_text?: string
  size_labels?: string     // pipe-separated (e.g., "Tall|Grande|Venti")
}

export interface KDSImportImage {
  screen: KDSScreen
  filename: string
  alt_text?: string
  sort_order?: number
  is_active?: boolean
}

// Utility type for mapping database rows to domain types
export type MapRowToType<T> = (row: unknown) => T
