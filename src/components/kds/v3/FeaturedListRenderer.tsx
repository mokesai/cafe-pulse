/**
 * KDS v3 phase 6 addendum — `featured_list` layout renderer.
 *
 * Plan: PHASE-6-PLAN.md addendum (featured layouts + box chrome)
 *
 * Attention-grabbing layout for a single highlighted box. Renders:
 *   - Title line (group name or header_override)
 *   - Subtitle line (optional, from subtitle_override) — secondary text
 *     color from the theme
 *   - Bulleted item rows, each colored via featuredBulletColorClass(idx)
 *     so adjacent rows are visually distinct
 *
 * Bullets are always shown for items, regardless of whether the source is
 * a single ITEM-with-N-variations (e.g. Muffins) or N-items-with-1-variation
 * each (e.g. Energy Drinks). For multi-variation items the variation names
 * are joined with " • " as a sub-line — matches `flavor_list`'s shape.
 *
 * price_display_mode is honored (lowest / range / base / none) — operator's
 * choice. Default `lowest` collapses to a single $X.XX when all variations
 * share a price.
 */
import { derivePriceText, featuredBulletColorClass } from '@/lib/kds/v3-render-helpers'
import type { ResolvedGroup, SlotFormatting } from '@/lib/kds/v3-render'
import {
  DENSITY_TO_ROW_PADDING,
  TITLE_SIZE_CLASS,
  BODY_SIZE_FOR_TITLE,
  TITLE_ALIGN_CLASS,
} from './style-mappings'

export interface FeaturedListRendererProps {
  group: ResolvedGroup
  formatting: SlotFormatting
}

export function FeaturedListRenderer({ group, formatting }: FeaturedListRendererProps) {
  const headerText = formatting.header_override ?? group.name
  const titleClass = `${TITLE_SIZE_CLASS[formatting.title_size]} ${TITLE_ALIGN_CLASS[formatting.title_align]}`
  const bodyClass = BODY_SIZE_FOR_TITLE[formatting.title_size]
  const rowPadding = DENSITY_TO_ROW_PADDING[formatting.density]

  // Spacing: the subtitle belongs visually to the items it introduces, not
  // to the title above. A larger gap above the subtitle separates it from
  // the title; a small gap below keeps it tight to the bulleted list. When
  // no subtitle is present, the list gets a medium gap directly from the
  // title.
  const hasSubtitle = Boolean(formatting.subtitle_override)
  const listTopMargin = hasSubtitle ? 'mt-0.5' : 'mt-3'

  return (
    <div className="flex h-full w-full flex-col px-4 py-3 text-[color:var(--kds-text)]">
      <h2 className={`font-bold ${titleClass}`}>{headerText}</h2>
      {hasSubtitle && (
        // Rendered as a "feature title" — a section heading that
        // introduces the items below. Bold + uppercase + slight letter-
        // spacing distinguishes it from a subtitle-style flourish (italic
        // muted) while still being clearly secondary to the main title.
        <p
          className={`mt-4 font-bold uppercase tracking-wide text-[color:var(--kds-text)] ${TITLE_ALIGN_CLASS[formatting.title_align]}`}
        >
          {formatting.subtitle_override}
        </p>
      )}
      <ul className={`flex-1 ${listTopMargin} ${bodyClass}`}>
        {group.items.map((item, idx) => {
          const colorClass = featuredBulletColorClass(idx)
          const flavors = item.variations.map((v) => v.display_name).join(' • ')
          const showFlavors = item.variations.length > 1
          const price = derivePriceText(formatting.price_display_mode, item.variations)
          return (
            <li
              key={item.id}
              className={`flex items-baseline gap-3 ${rowPadding} ${colorClass}`}
            >
              <span aria-hidden="true">•</span>
              <span className="flex-1">
                <span className="font-semibold">{item.display_name}</span>
                {showFlavors && (
                  <span className="ml-2 text-[color:var(--kds-text-secondary)]">{flavors}</span>
                )}
              </span>
              {price && <span className="font-semibold">{price}</span>}
            </li>
          )
        })}
        {group.items.length === 0 && (
          <li className="text-[color:var(--kds-text-muted)] italic">(no items)</li>
        )}
      </ul>
    </div>
  )
}
