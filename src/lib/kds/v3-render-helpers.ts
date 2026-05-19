/**
 * MOK-158 / KDS v3 phase 6 — pure helpers consumed by the renderer.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T5)
 *
 * Functions in this module are pure — no I/O, no React, no Next.js. They
 * exist as a vitest-unit-testable layer separate from the render-fetch
 * helper (T4) and the per-layout components (T6-T9).
 *
 * Override precedence rule (frozen in phase 5, consumed here): variation
 * override > item override > Square default. Item-level overrides do NOT
 * propagate to variations — a variation keeps its Square name unless it
 * has its own override. The override lookup is by `target_id` against
 * a pre-built Map (built once by T4 from the kds_display_overrides query)
 * so resolution is O(1) per item/variation.
 */

export type LayoutMode =
  | 'simple_list'
  | 'variation_column_header'
  | 'flavor_list'
  | 'compact_list'
  | 'featured_list'

export type PriceDisplayMode = 'none' | 'lowest' | 'range' | 'base'

export interface DisplayOverride {
  target_kind: 'item' | 'variation'
  target_id: string
  alt_display_name: string | null
  alt_image_aesthetic_image_id: string | null
  hidden_from_kds: boolean
}

export interface ItemForResolution {
  id: string
  name: string
}

export interface VariationForResolution {
  id: string
  name: string
  price_cents: number | null
}

/**
 * Post-resolution variation shape consumed by the price / canonical-set
 * helpers below. Distinct from `VariationForResolution` (which is the
 * Square-name input to `resolveDisplayForVariation`) — by the time these
 * helpers run, override resolution has already produced `display_name`.
 *
 * The renderer hands `ResolvedVariation` (from v3-render.ts) directly to
 * these helpers; this structural type makes that contract explicit.
 */
export interface ResolvedVariationLike {
  display_name: string
  price_cents: number | null
}

export interface ResolvedItemDisplay {
  display_name: string
  alt_image_id: string | null
  hidden: boolean
}

export interface ResolvedVariationDisplay {
  display_name: string
  alt_image_id: string | null
  hidden: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Override resolution
// ─────────────────────────────────────────────────────────────────────────────

export function resolveDisplayForItem(
  item: ItemForResolution,
  override: DisplayOverride | null,
): ResolvedItemDisplay {
  return {
    display_name: override?.alt_display_name ?? item.name,
    alt_image_id: override?.alt_image_aesthetic_image_id ?? null,
    hidden: override?.hidden_from_kds ?? false,
  }
}

export function resolveDisplayForVariation(
  variation: VariationForResolution,
  override: DisplayOverride | null,
): ResolvedVariationDisplay {
  return {
    display_name: override?.alt_display_name ?? variation.name,
    alt_image_id: override?.alt_image_aesthetic_image_id ?? null,
    hidden: override?.hidden_from_kds ?? false,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Price formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a price in cents as a USD string. Single source of truth for the
 * renderer's currency rendering — no Intl.NumberFormat per call site.
 */
export function formatPriceCents(cents: number): string {
  const dollars = Math.floor(cents / 100)
  const remainder = Math.abs(cents % 100)
  return `$${dollars}.${remainder.toString().padStart(2, '0')}`
}

/**
 * Pick the price text for an item under a given price_display_mode. Returns
 * null when:
 *   - mode is 'none'
 *   - the item has no variations with a price
 *
 * `lowest` / `range` collapse to a single-price form when all variations
 * share the same price — avoids rendering "from $5.95" or "$5.95 – $5.95"
 * which would be misleading.
 */
export function derivePriceText(
  mode: PriceDisplayMode,
  variations: ResolvedVariationLike[],
): string | null {
  if (mode === 'none') return null
  const prices = variations
    .map((v) => v.price_cents)
    .filter((p): p is number => typeof p === 'number')
  if (prices.length === 0) return null

  const min = Math.min(...prices)
  const max = Math.max(...prices)

  switch (mode) {
    case 'lowest':
      return min === max ? formatPriceCents(min) : `from ${formatPriceCents(min)}`
    case 'range':
      return min === max
        ? formatPriceCents(min)
        : `${formatPriceCents(min)} – ${formatPriceCents(max)}`
    case 'base':
      // The first variation by array order is "base" — operator controls
      // the ordering in Square. Falls back to min if the first has no price.
      return formatPriceCents(variations[0].price_cents ?? min)
  }
}

/**
 * Compact_list header text — the group-level price range, e.g. for the
 * Energy Drinks header: "$5.95 – $7.95" or just "$5.95" when uniform.
 * Returns null when no items have priced variations (renderer omits the
 * trailing price block).
 */
export function derivePriceRangeForGroup(
  items: Array<{ variations: ResolvedVariationLike[] }>,
): string | null {
  const prices = items
    .flatMap((it) => it.variations.map((v) => v.price_cents))
    .filter((p): p is number => typeof p === 'number')
  if (prices.length === 0) return null
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return min === max ? formatPriceCents(min) : `${formatPriceCents(min)} – ${formatPriceCents(max)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical variation set (for variation_column_header layout)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the canonical set of variation names across a group's items for
 * the variation_column_header layout. Union of names sorted by frequency
 * (descending — most common first). Items missing a variation name get
 * a blank cell in the column row; this is the contract the renderer
 * relies on.
 *
 * If `items` is empty or no items have variations, returns an empty array
 * and the renderer falls back to a name-only display.
 *
 * Tie-break on frequency: first-seen order (stable sort behavior).
 *
 * Operator-defined canonical set is deferred to phase 6.5 per MOK-158.
 */
// ─────────────────────────────────────────────────────────────────────────────
// Featured-list bullet color cycling (phase 6 addendum)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixed 6-color bright palette for `featured_list` bullets. Cycles per
 * item index so adjacent bullets are always distinguishable. Returns a
 * Tailwind class name applied to BOTH the bullet glyph and the item text
 * (consistent row tinting).
 *
 * Operator-customizable palettes are explicitly out of scope for phase 6 —
 * defer to phase 6.5+.
 */
const FEATURED_BULLET_PALETTE = [
  'text-blue-500',
  'text-emerald-500',
  'text-rose-500',
  'text-pink-500',
  'text-amber-500',
  'text-purple-500',
] as const

export function featuredBulletColorClass(index: number): string {
  const i = ((index % FEATURED_BULLET_PALETTE.length) + FEATURED_BULLET_PALETTE.length) %
    FEATURED_BULLET_PALETTE.length
  return FEATURED_BULLET_PALETTE[i]
}

export function deriveCanonicalVariationSet(
  items: Array<{ variations: ResolvedVariationLike[] }>,
): string[] {
  const counts = new Map<string, { count: number; firstSeen: number }>()
  let seenIdx = 0
  for (const item of items) {
    for (const v of item.variations) {
      const existing = counts.get(v.display_name)
      if (existing) {
        existing.count++
      } else {
        counts.set(v.display_name, { count: 1, firstSeen: seenIdx++ })
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => {
      // Frequency desc; on tie, first-seen ascending (stable order).
      if (b[1].count !== a[1].count) return b[1].count - a[1].count
      return a[1].firstSeen - b[1].firstSeen
    })
    .map(([name]) => name)
}
