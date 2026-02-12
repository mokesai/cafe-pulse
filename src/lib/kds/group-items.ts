/**
 * KDS Item Grouping Utility
 * Groups menu items by size variations (Tall, Grande, Venti) for columnar display
 */

import type { KDSMenuItem } from './types'

/**
 * Size order for consistent column display
 */
const SIZE_ORDER = ['Tall', 'Grande', 'Venti'] as const
export type SizeKey = (typeof SIZE_ORDER)[number]

/**
 * Price info for a single size
 */
export interface SizePrice {
  price: string
  priceCents: number
}

/**
 * Grouped menu item with prices per size
 */
export interface GroupedMenuItem {
  baseName: string // "Caffè Americano" (without size suffix)
  squareItemId: string
  sizes: Partial<Record<SizeKey, SizePrice>>
  sortOrder: number
  displayName?: string
}

/**
 * Single menu item (no size variations)
 */
export interface SingleMenuItem {
  id: string
  name: string
  displayName?: string
  price: string
  priceCents: number
  sortOrder: number
}

/**
 * Union type for processed items
 */
export type ProcessedItem =
  | { type: 'grouped'; item: GroupedMenuItem }
  | { type: 'single'; item: SingleMenuItem }

/**
 * Extract base name from item name (remove size suffix like "(Tall)")
 */
function extractBaseName(name: string, variationName?: string): string {
  // If we have a variation name, try to remove it from the full name
  if (variationName) {
    // Remove patterns like "(Tall)", "(Grande)", "(Venti)", "(Regular)"
    const suffixPattern = new RegExp(`\\s*\\(${variationName}\\)\\s*$`, 'i')
    return name.replace(suffixPattern, '').trim()
  }

  // Fallback: try common size patterns
  return name
    .replace(/\s*\((Tall|Grande|Venti|Regular)\)\s*$/i, '')
    .trim()
}

/**
 * Check if a variation name is a standard size
 */
function isStandardSize(variationName?: string): variationName is SizeKey {
  if (!variationName) return false
  return SIZE_ORDER.includes(variationName as SizeKey)
}

/**
 * Group items by squareItemId for size-based display
 * Items with the same squareItemId are size variations of the same product
 */
export function groupItemsBySizes(items: KDSMenuItem[]): ProcessedItem[] {
  // Group items by squareItemId
  const groupedByItemId = new Map<string, KDSMenuItem[]>()
  const singleItems: KDSMenuItem[] = []

  for (const item of items) {
    // Items without squareItemId cannot be grouped
    if (!item.squareItemId) {
      singleItems.push(item)
      continue
    }

    // Items without a standard size variation are singles
    if (!isStandardSize(item.variationName)) {
      singleItems.push(item)
      continue
    }

    const existing = groupedByItemId.get(item.squareItemId)
    if (existing) {
      existing.push(item)
    } else {
      groupedByItemId.set(item.squareItemId, [item])
    }
  }

  const result: ProcessedItem[] = []

  // Process grouped items (including single-size items with standard sizes)
  for (const [squareItemId, groupItems] of groupedByItemId) {
    // Build sizes object (even for single items - they'll display in columnar format)
    const sizes: Partial<Record<SizeKey, SizePrice>> = {}
    let minSortOrder = Infinity
    let baseName = ''
    let displayName: string | undefined

    for (const item of groupItems) {
      const size = item.variationName as SizeKey
      sizes[size] = {
        price: item.displayPrice || `$${(item.priceCents / 100).toFixed(2)}`,
        priceCents: item.priceCents,
      }

      // Use the minimum sort order for the group
      if (item.sortOrder < minSortOrder) {
        minSortOrder = item.sortOrder
      }

      // Extract base name from first item
      if (!baseName) {
        baseName = extractBaseName(item.name, item.variationName)
        // Check for display name override
        if (item.displayName) {
          displayName = extractBaseName(item.displayName, item.variationName)
        }
      }
    }

    result.push({
      type: 'grouped',
      item: {
        baseName,
        squareItemId,
        sizes,
        sortOrder: minSortOrder === Infinity ? 0 : minSortOrder,
        displayName,
      },
    })
  }

  // Add single items
  for (const item of singleItems) {
    result.push({
      type: 'single',
      item: {
        id: item.id,
        name: item.name,
        displayName: item.displayName,
        price: item.displayPrice || `$${(item.priceCents / 100).toFixed(2)}`,
        priceCents: item.priceCents,
        sortOrder: item.sortOrder,
      },
    })
  }

  // Sort by sortOrder
  result.sort((a, b) => {
    const aOrder = a.type === 'grouped' ? a.item.sortOrder : a.item.sortOrder
    const bOrder = b.type === 'grouped' ? b.item.sortOrder : b.item.sortOrder
    return aOrder - bOrder
  })

  return result
}

/**
 * Check if a category should use sized column display.
 * Returns true if majority of items have standard sizes (Tall/Grande/Venti)
 * and at least one product has multiple sizes.
 */
export function hasSizedItems(items: KDSMenuItem[]): boolean {
  if (items.length === 0) return false

  // Count items with standard sizes vs non-standard
  let standardSizeCount = 0
  const sizeCounts = new Map<string, number>()

  for (const item of items) {
    if (isStandardSize(item.variationName)) {
      standardSizeCount++
      if (item.squareItemId) {
        sizeCounts.set(item.squareItemId, (sizeCounts.get(item.squareItemId) || 0) + 1)
      }
    }
  }

  // Use size columns if at least 50% of items have standard sizes
  // AND at least one product has multiple sizes
  const hasEnoughStandardSizes = standardSizeCount >= items.length * 0.5

  if (!hasEnoughStandardSizes) return false

  // Check if any product has multiple sizes
  for (const count of sizeCounts.values()) {
    if (count > 1) return true
  }

  return false
}

/**
 * Get the standard size columns in order
 */
export function getSizeColumns(): readonly SizeKey[] {
  return SIZE_ORDER
}
