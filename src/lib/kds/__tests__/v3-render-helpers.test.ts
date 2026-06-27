/**
 * MOK-158 / KDS v3 phase 6 — pure render helper unit tests.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T5)
 *
 * Pure-function tests for the override resolution, price text, canonical
 * variation set, and price range helpers consumed by the renderer (T6-T9)
 * and the render-fetch helper (T4).
 */
import { describe, expect, it } from 'vitest'

import {
  resolveDisplayForItem,
  resolveDisplayForVariation,
  derivePriceText,
  derivePriceRangeForGroup,
  deriveCanonicalVariationSet,
  formatPriceCents,
  featuredBulletColorClass,
  type DisplayOverride,
  type ResolvedVariationLike,
} from '../v3-render-helpers'

function override(partial: Partial<DisplayOverride> = {}): DisplayOverride {
  return {
    target_kind: 'item',
    target_id: 'item-1',
    alt_display_name: null,
    alt_image_aesthetic_image_id: null,
    hidden_from_kds: false,
    ...partial,
  }
}

// Post-resolution variation shape — matches what the renderer hands the
// price / canonical-set helpers (display_name + price_cents). The
// resolveDisplayForVariation tests below construct their input directly
// with a `name` field since that's the pre-resolution shape.
function variation(display_name: string, price_cents: number | null): ResolvedVariationLike & {
  id: string
} {
  return { id: `var-${display_name}`, display_name, price_cents }
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveDisplayForItem
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveDisplayForItem', () => {
  const item = { id: 'item-1', name: 'Latte' }

  it('no override → Square name, no image, not hidden', () => {
    expect(resolveDisplayForItem(item, null)).toEqual({
      display_name: 'Latte',
      alt_image_id: null,
      hidden: false,
    })
  })

  it('alt_display_name only → override wins', () => {
    expect(resolveDisplayForItem(item, override({ alt_display_name: 'Café Latte' }))).toEqual({
      display_name: 'Café Latte',
      alt_image_id: null,
      hidden: false,
    })
  })

  it('alt_image_aesthetic_image_id only → image attached, name unchanged', () => {
    expect(
      resolveDisplayForItem(item, override({ alt_image_aesthetic_image_id: 'img-42' })),
    ).toEqual({
      display_name: 'Latte',
      alt_image_id: 'img-42',
      hidden: false,
    })
  })

  it('hidden_from_kds=true → hidden flag set, other defaults', () => {
    expect(resolveDisplayForItem(item, override({ hidden_from_kds: true }))).toEqual({
      display_name: 'Latte',
      alt_image_id: null,
      hidden: true,
    })
  })

  it('all three override fields set → all applied', () => {
    expect(
      resolveDisplayForItem(
        item,
        override({
          alt_display_name: 'Café Latte',
          alt_image_aesthetic_image_id: 'img-42',
          hidden_from_kds: true,
        }),
      ),
    ).toEqual({
      display_name: 'Café Latte',
      alt_image_id: 'img-42',
      hidden: true,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// resolveDisplayForVariation
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveDisplayForVariation', () => {
  const variation0 = { id: 'var-1', name: 'Tall', price_cents: 495 }

  it('no override → Square variation name', () => {
    expect(resolveDisplayForVariation(variation0, null)).toEqual({
      display_name: 'Tall',
      alt_image_id: null,
      hidden: false,
    })
  })

  it('alt_display_name → override wins (variation-level name, not item-level)', () => {
    // Item-level alt_display_name does NOT propagate to variations. Variations
    // only get their own override applied — phase 5's precedence rule.
    expect(
      resolveDisplayForVariation(
        variation0,
        override({ target_kind: 'variation', target_id: 'var-1', alt_display_name: 'Small' }),
      ),
    ).toEqual({
      display_name: 'Small',
      alt_image_id: null,
      hidden: false,
    })
  })

  it('hidden_from_kds on variation → variation hidden but parent item unaffected', () => {
    expect(
      resolveDisplayForVariation(
        variation0,
        override({ target_kind: 'variation', target_id: 'var-1', hidden_from_kds: true }),
      ).hidden,
    ).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// derivePriceText
// ─────────────────────────────────────────────────────────────────────────────

describe('derivePriceText', () => {
  it('mode=none → null', () => {
    expect(derivePriceText('none', [variation('Tall', 495)])).toBeNull()
  })

  it('no variations with prices → null', () => {
    expect(derivePriceText('lowest', [])).toBeNull()
    expect(derivePriceText('lowest', [variation('Each', null)])).toBeNull()
  })

  it('single variation, all modes → single $X.XX form (no "from" / no range)', () => {
    const v = [variation('Each', 425)]
    expect(derivePriceText('lowest', v)).toBe('$4.25')
    expect(derivePriceText('range', v)).toBe('$4.25')
    expect(derivePriceText('base', v)).toBe('$4.25')
  })

  it('lowest with multi-price variations → "from $X.XX" of min', () => {
    const v = [variation('Tall', 495), variation('Grande', 555), variation('Venti', 615)]
    expect(derivePriceText('lowest', v)).toBe('from $4.95')
  })

  it('range with multi-price variations → "$min – $max"', () => {
    const v = [variation('Tall', 495), variation('Grande', 555), variation('Venti', 615)]
    expect(derivePriceText('range', v)).toBe('$4.95 – $6.15')
  })

  it('base picks the first variation by array order', () => {
    const v = [variation('Tall', 495), variation('Grande', 555), variation('Venti', 615)]
    expect(derivePriceText('base', v)).toBe('$4.95')
  })

  it('all-same-price collapses lowest/range to single form', () => {
    const v = [variation('Blueberry', 425), variation('Banana Walnut', 425)]
    expect(derivePriceText('lowest', v)).toBe('$4.25')
    expect(derivePriceText('range', v)).toBe('$4.25')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// derivePriceRangeForGroup
// ─────────────────────────────────────────────────────────────────────────────

describe('derivePriceRangeForGroup', () => {
  it('empty items → null', () => {
    expect(derivePriceRangeForGroup([])).toBeNull()
  })

  it('all items same price → single $X.XX', () => {
    expect(
      derivePriceRangeForGroup([
        { variations: [variation('Each', 595)] },
        { variations: [variation('Each', 595)] },
      ]),
    ).toBe('$5.95')
  })

  it('multi-price items → "$min – $max"', () => {
    expect(
      derivePriceRangeForGroup([
        { variations: [variation('Each', 595)] },
        { variations: [variation('Each', 795)] },
      ]),
    ).toBe('$5.95 – $7.95')
  })

  it('mixes uniform with sized items → range spans everything', () => {
    expect(
      derivePriceRangeForGroup([
        { variations: [variation('Each', 595)] },
        {
          variations: [variation('Tall', 495), variation('Grande', 555), variation('Venti', 615)],
        },
      ]),
    ).toBe('$4.95 – $6.15')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// deriveCanonicalVariationSet
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveCanonicalVariationSet', () => {
  it('empty → empty', () => {
    expect(deriveCanonicalVariationSet([])).toEqual([])
  })

  it('uniform Tall/Grande/Venti across all items → that set in first-seen order', () => {
    const items = [
      { variations: [variation('Tall', 495), variation('Grande', 555), variation('Venti', 615)] },
      { variations: [variation('Tall', 525), variation('Grande', 585), variation('Venti', 645)] },
    ]
    expect(deriveCanonicalVariationSet(items)).toEqual(['Tall', 'Grande', 'Venti'])
  })

  it('one item missing a size → union; most-common first', () => {
    const items = [
      { variations: [variation('Tall', 495), variation('Grande', 555), variation('Venti', 615)] },
      { variations: [variation('Tall', 525), variation('Grande', 585)] },
    ]
    // Tall + Grande appear in both (count=2); Venti only in one (count=1).
    // Frequency desc, tie-break by first-seen order.
    expect(deriveCanonicalVariationSet(items)).toEqual(['Tall', 'Grande', 'Venti'])
  })

  it('non-overlapping variations → union by first-seen', () => {
    const items = [
      { variations: [variation('Single', 350), variation('Double', 450)] },
      { variations: [variation('Tall', 495), variation('Grande', 555)] },
    ]
    expect(deriveCanonicalVariationSet(items)).toEqual(['Single', 'Double', 'Tall', 'Grande'])
  })

  it('flavor-list shape — different variation names per item all count=1', () => {
    const items = [
      {
        variations: [
          variation('Blueberry', 425),
          variation('Banana Walnut', 425),
          variation('Lemon Poppyseed', 425),
        ],
      },
    ]
    expect(deriveCanonicalVariationSet(items)).toEqual([
      'Blueberry',
      'Banana Walnut',
      'Lemon Poppyseed',
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatPriceCents
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// featuredBulletColorClass (phase 6 addendum)
// ─────────────────────────────────────────────────────────────────────────────

describe('featuredBulletColorClass', () => {
  it('returns a non-empty Tailwind text-color class for index 0', () => {
    expect(featuredBulletColorClass(0)).toMatch(/^text-[a-z]+-\d+$/)
  })

  it('cycles through 6 distinct colors before repeating', () => {
    const colors = [0, 1, 2, 3, 4, 5].map((i) => featuredBulletColorClass(i))
    expect(new Set(colors).size).toBe(6)
    // 7th wraps to first.
    expect(featuredBulletColorClass(6)).toBe(colors[0])
    expect(featuredBulletColorClass(7)).toBe(colors[1])
  })

  it('handles negative indices safely (wraps modulo)', () => {
    expect(featuredBulletColorClass(-1)).toBe(featuredBulletColorClass(5))
    expect(featuredBulletColorClass(-6)).toBe(featuredBulletColorClass(0))
  })
})

describe('formatPriceCents', () => {
  it('zero → $0.00', () => {
    expect(formatPriceCents(0)).toBe('$0.00')
  })

  it('cents-only price → $0.0X', () => {
    expect(formatPriceCents(5)).toBe('$0.05')
    expect(formatPriceCents(50)).toBe('$0.50')
  })

  it('dollars-only (round) → $X.00', () => {
    expect(formatPriceCents(500)).toBe('$5.00')
    expect(formatPriceCents(1000)).toBe('$10.00')
  })

  it('typical menu price → $X.XX', () => {
    expect(formatPriceCents(425)).toBe('$4.25')
    expect(formatPriceCents(595)).toBe('$5.95')
    expect(formatPriceCents(805)).toBe('$8.05')
  })

  it('large price preserves all digits', () => {
    expect(formatPriceCents(12345)).toBe('$123.45')
  })
})
