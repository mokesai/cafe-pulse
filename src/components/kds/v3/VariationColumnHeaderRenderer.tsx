/**
 * MOK-158 / KDS v3 phase 6 — `variation_column_header` layout renderer.
 *
 * Plan: .planning/kds-v3/PHASE-6-PLAN.md (T7)
 *
 * For groups where items share size variations (e.g. Hot Drinks at
 * Tall / Grande / Venti). Header row shows the canonical variation set on
 * the right; each item row shows the item name on the left + per-column
 * prices to its right.
 *
 * Uses a single unified CSS Grid for the column-header row + every item
 * row so column tracks are shared and never drift between rows. (The
 * previous flex-based implementation had a separate grid per row, which
 * let the header row and price rows take different widths — the operator
 * surfaced this in UI/UX testing.)
 *
 * Emphasizes a "recommended size" column (case-insensitive match against
 * `grande` / `medium` / `m`) with the theme accent color + bold weight.
 * Operator-configurable emphasis is deferred to phase 6.5+.
 *
 * price_display_mode is NOT consulted — column pricing is the layout's
 * inherent pricing mode. The editor disables the price-display dropdown
 * when this layout is selected.
 */
import { Fragment } from 'react'
import {
  deriveCanonicalVariationSet,
  formatPriceCents,
} from '@/lib/kds/v3-render-helpers'
import type { ResolvedGroup, SlotFormatting } from '@/lib/kds/v3-render'
import {
  DENSITY_TO_ROW_PADDING,
  TITLE_SIZE_CLASS,
  BODY_SIZE_FOR_TITLE,
  TITLE_ALIGN_CLASS,
} from './style-mappings'

const EMPHASIZED_VARIATION_PATTERN = /^(grande|medium|m)$/i

export interface VariationColumnHeaderRendererProps {
  group: ResolvedGroup
  formatting: SlotFormatting
}

export function VariationColumnHeaderRenderer({
  group,
  formatting,
}: VariationColumnHeaderRendererProps) {
  const headerText = formatting.header_override ?? group.name
  const titleClass = `${TITLE_SIZE_CLASS[formatting.title_size]} ${TITLE_ALIGN_CLASS[formatting.title_align]}`
  const bodyClass = BODY_SIZE_FOR_TITLE[formatting.title_size]
  const rowPadding = DENSITY_TO_ROW_PADDING[formatting.density]

  const canonical = deriveCanonicalVariationSet(group.items)
  // Phase 6.5 (MOK-159): operator-pickable emphasis overrides the regex.
  //   - explicit_none = true → no emphasis at all
  //   - name set → emphasize matching column (case-insensitive)
  //   - name null + not explicit_none → "Auto" → regex heuristic (phase 6)
  const emphasizedIdx = formatting.emphasized_variation_explicit_none
    ? -1
    : formatting.emphasized_variation_name != null
      ? canonical.findIndex(
          (name) =>
            name.toLowerCase() === formatting.emphasized_variation_name!.toLowerCase(),
        )
      : canonical.findIndex((name) => EMPHASIZED_VARIATION_PATTERN.test(name))
  // Operator can suppress prices entirely by picking price_display_mode='none'
  // — the column headers (sizes available) still render, but the per-item
  // price cells go blank. Useful for "we offer these sizes" without
  // committing to prices on this particular screen.
  const showPrices = formatting.price_display_mode !== 'none'

  // Map item → variation_name → price_cents, indexed by item position so
  // each item row can look up its prices in O(1) inside the grid.
  const priceByItem = group.items.map((item) => {
    const byName = new Map<string, number>()
    for (const v of item.variations) {
      if (typeof v.price_cents === 'number') byName.set(v.display_name, v.price_cents)
    }
    return byName
  })

  // Single CSS Grid track set shared by the column header row + every item
  // row. First column = item name (fills remaining horizontal space);
  // remaining columns = price columns sized to the wider of header label
  // vs widest price in that column. Bottom-most clamp 4rem keeps narrow
  // columns from collapsing.
  const gridTemplateColumns =
    canonical.length > 0
      ? `minmax(0, 1fr) repeat(${canonical.length}, minmax(4rem, max-content))`
      : 'minmax(0, 1fr)'

  return (
    <div className="flex h-full w-full flex-col px-4 py-3 text-[color:var(--kds-text)]">
      <h2 className={`font-bold ${titleClass} mb-2`}>{headerText}</h2>
      <div
        className={`grid items-baseline gap-x-4 ${bodyClass}`}
        style={{ gridTemplateColumns }}
      >
        {/* Column header row */}
        {canonical.length > 0 && (
          <>
            <div aria-hidden="true" /> {/* spacer above the item-name column */}
            {canonical.map((name, idx) => {
              const emphasized = emphasizedIdx === idx
              return (
                <span
                  key={`hdr-${name}`}
                  className={`${rowPadding} text-center font-bold ${
                    emphasized
                      ? 'text-[color:var(--kds-accent)]'
                      : 'text-[color:var(--kds-text-secondary)]'
                  }`}
                >
                  {name}
                </span>
              )
            })}
          </>
        )}

        {/* Item rows */}
        {group.items.map((item, itemIdx) => (
          <Fragment key={item.id}>
            <span className={`${rowPadding} truncate`}>{item.display_name}</span>
            {canonical.map((name, colIdx) => {
              const cents = priceByItem[itemIdx].get(name)
              const emphasized = emphasizedIdx === colIdx
              return (
                <span
                  key={`${item.id}-${name}`}
                  className={`${rowPadding} text-center ${
                    emphasized
                      ? 'font-bold text-[color:var(--kds-accent)]'
                      : 'font-medium text-[color:var(--kds-price)]'
                  }`}
                >
                  {showPrices && typeof cents === 'number' ? formatPriceCents(cents) : ''}
                </span>
              )
            })}
          </Fragment>
        ))}

        {group.items.length === 0 && (
          <span
            className="text-[color:var(--kds-text-muted)] italic"
            style={{ gridColumn: '1 / -1' }}
          >
            (no items)
          </span>
        )}
      </div>
    </div>
  )
}
