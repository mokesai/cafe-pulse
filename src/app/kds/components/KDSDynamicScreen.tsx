/**
 * KDSDynamicScreen v2 — MOK-37
 *
 * Renders a KDS screen from v2 layout JSON using nested flexbox.
 * Falls back to KDSDrinksMagazine / KDSFoodMagazine when no custom layout exists.
 *
 * Render hierarchy:
 *   Screen (flex row)
 *     Column (flex col, width%)
 *       Row (flex row if divided, else block, height%)
 *         Division (flex item, width%) — only when row.divisions present
 *           Content (category section or image)
 *         OR
 *         Content (directly in row when not divided)
 */

import React from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getCategoriesWithItems, getImages, getSettings } from '@/lib/kds/queries'
import type { KDSSettingsMap } from '@/lib/kds/types'
import type { KDSLayout, KDSCellContent, KDSColumn, KDSRow, KDSLayoutFooter } from '@/lib/kds/layout-types'
import type { KDSScreen, KDSScreenData, KDSCategoryWithItems } from '@/lib/kds/types'
import { KDSDrinksMagazine } from './index'
import { KDSFoodMagazine } from './index'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HeaderImages {
  left?: string
  right?: string
  subtitleLogo?: string
  subtitleIcon?: string
  leftTitleIcon?: string
  rightTitleIcon?: string
}

interface KDSDynamicScreenProps {
  screen: KDSScreen
  draft?: boolean
  autoRefresh?: boolean
  tenantIdOverride?: string  // For device display route (bypasses admin auth context)
  fallbackProps?: {
    headerImages?: HeaderImages
    sectionBadge?: string
    defaultSubtitle?: string
    mostPopularImage?: string
    photoStripImages?: string[]
    lotusImage?: string
    foodImage?: string
    pastriesImage?: string
  }
}

// ---------------------------------------------------------------------------
// Footer renderer
// ---------------------------------------------------------------------------

function DynamicFooter({ footer, settings: _settings }: { footer: KDSLayoutFooter; settings: Partial<KDSSettingsMap> }) {
  const images = footer.images ?? []
  if (images.length === 0) return <div style={{ height: 120, flexShrink: 0 }} />

  return (
    <div style={{
      flexShrink: 0, height: 120, display: 'flex', alignItems: 'center',
      overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.1)',
      background: 'var(--kds-footer-bg, rgba(0,0,0,0.3))',
    }}>
      {images.map((url, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={url} alt="" style={{ height: '100%', objectFit: 'cover', flex: `0 0 ${100 / images.length}%` }} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cell content renderer
// ---------------------------------------------------------------------------

// Icons that are PNGs (not SVGs)
const PNG_ICONS = new Set(['heart', 'bolt'])

function iconPath(icon: string): string {
  return `/images/kds/icons/${icon}.${PNG_ICONS.has(icon) ? 'png' : 'svg'}`
}

function CategoryTitle({ cat }: { cat: KDSCategoryWithItems }) {
  return (
    <div className="kds-dynamic-category-title"
      style={{
        fontSize: '1.75rem', fontWeight: 700, marginBottom: '10px',
        color: cat.color || 'var(--kds-text, #fff)',
        display: 'flex', alignItems: 'center', gap: '8px',
      }}>
      {cat.icon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconPath(cat.icon)}
          alt=""
          style={{ height: '1.2em', width: '1.2em', objectFit: 'contain' }}
        />
      )}
      {cat.name}
    </div>
  )
}

function renderContent(
  content: KDSCellContent,
  categories: KDSCategoryWithItems[],
  style?: React.CSSProperties
): React.ReactNode {
  if (content.type === 'empty') {
    return <div style={{ width: '100%', height: '100%', ...style }} />
  }

  if (content.type === 'image' && content.image_url) {
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 8, ...style }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={content.image_url}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: content.image_fit ?? 'cover', borderRadius: 8 }}
        />
      </div>
    )
  }

  if (content.type === 'category' && content.category_slug) {
    const cat = categories.find(c => c.slug === content.category_slug)
    if (!cat) {
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(255,0,0,0.1)',
          color: '#f87171', fontSize: '1.25rem', padding: '16px', ...style,
        }}>
          ⚠ {content.category_slug}
        </div>
      )
    }

    const displayType = content.display_type ?? cat.displayType ?? 'price-grid'
    const visibleItems = cat.items.filter(i => i.isVisible)
    const sizeLabels = cat.sizeLabels ?? ['Tall', 'Grande', 'Venti']

    // For featured: deduplicate by base name, show name only
    // For price-grid: group by base name, show size headers + price columns
    // For simple-list: show name + single price per row

    // Grid styles for price-based displays
    // price-grid: name fills remaining space, prices right-aligned at cell edge (consistent across categories)
    // price-grid-compact: name column sizes to longest content, prices hug the names (less whitespace)
    const isCompact = displayType === 'price-grid-compact'
    const priceGridCols = isCompact
      ? `minmax(0, max-content) ${sizeLabels.map(() => 'minmax(55px, 70px)').join(' ')}`
      : `1fr ${sizeLabels.map(() => '70px').join(' ')}`
    const gridStyle: React.CSSProperties = {
      display: 'grid',
      gridTemplateColumns: priceGridCols,
      gap: '0 6px',
      fontSize: '1.25rem',
      color: 'var(--kds-text-secondary, rgba(255,255,255,0.85))',
    }

    if (displayType === 'price-grid' || displayType === 'price-grid-compact') {
      // Group items by base name, ordered by first appearance
      const grouped = new Map<string, { name: string; prices: Map<string, string> }>()
      for (const item of visibleItems) {
        const baseName = item.name
        const variation = item.variationName?.toLowerCase() ?? ''
        if (!grouped.has(baseName)) {
          grouped.set(baseName, { name: baseName, prices: new Map() })
        }
        grouped.get(baseName)!.prices.set(variation, item.displayPrice)
      }

      return (
        <div style={{ width: '100%', height: '100%', overflow: 'hidden', padding: '16px 20px', ...style }}
          className="kds-dynamic-category kds-display-price-grid">
          <CategoryTitle cat={cat} />
          <div className="kds-dynamic-items" style={gridStyle}>
            {/* Size headers row */}
            {cat.showSizeHeader !== false && (<>
              <span />
              {sizeLabels.map(label => (
                <span key={label} style={{
                  textAlign: 'right', fontSize: '0.85rem', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: 'var(--kds-text-muted, rgba(255,255,255,0.5))',
                  paddingBottom: 4,
                }}>{label}</span>
              ))}
            </>)}
            {/* Item rows */}
            {Array.from(grouped.values()).map(({ name, prices }) => (
              <React.Fragment key={name}>
                <span style={{ padding: '3px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                {sizeLabels.map(label => {
                  const price = prices.get(label.toLowerCase())
                  return (
                    <span key={label} style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '3px 0' }}>
                      {price ?? '—'}
                    </span>
                  )
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )
    }

    if (displayType === 'flavor-options') {
      // Group items by sub_group slug (parentItem), then by base name within each group
      // Look up the sub_group slug in categories to get the display name for the heading
      const subGroups = new Map<string, { displayName: string; color?: string; items: Map<string, { name: string; prices: Map<string, string> }> }>()
      for (const item of visibleItems) {
        const groupSlug = item.parentItem || ''
        const baseName = item.name
        const variation = item.variationName?.toLowerCase() ?? ''
        if (!subGroups.has(groupSlug)) {
          const subCat = categories.find(c => c.slug === groupSlug)
          subGroups.set(groupSlug, { displayName: subCat?.name || groupSlug, color: subCat?.color, items: new Map() })
        }
        const group = subGroups.get(groupSlug)!
        if (!group.items.has(baseName)) {
          group.items.set(baseName, { name: baseName, prices: new Map() })
        }
        group.items.get(baseName)!.prices.set(variation, item.displayPrice)
      }

      return (
        <div style={{ width: '100%', height: '100%', overflow: 'hidden', padding: '16px 20px', ...style }}
          className="kds-dynamic-category kds-display-flavor-options">
          <CategoryTitle cat={cat} />
          <div className="kds-dynamic-items" style={gridStyle}>
            {/* Size headers row */}
            {cat.showSizeHeader !== false && (<>
              <span />
              {sizeLabels.map(label => (
                <span key={label} style={{
                  textAlign: 'right', fontSize: '0.85rem', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: 'var(--kds-text-muted, rgba(255,255,255,0.5))',
                  paddingBottom: 4,
                }}>{label}</span>
              ))}
            </>)}
            {/* Sub-group sections */}
            {Array.from(subGroups.entries()).map(([groupSlug, { displayName, color: subColor, items }]) => (
              <React.Fragment key={groupSlug || '_ungrouped'}>
                {groupSlug && (<>
                  <span style={{
                    gridColumn: `1 / -1`,
                    fontSize: '1.25rem', fontWeight: 600, fontStyle: 'italic',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    padding: '10px 0 4px',
                    color: subColor || 'var(--kds-text-muted, rgba(255,255,255,0.5))',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                  }}>
                    {displayName}
                  </span>
                </>)}
                {Array.from(items.values()).map(({ name, prices }) => (
                  <React.Fragment key={name}>
                    <span style={{ padding: '3px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                    {sizeLabels.map(label => {
                      const price = prices.get(label.toLowerCase())
                      return (
                        <span key={label} style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '3px 0' }}>
                          {price ?? '—'}
                        </span>
                      )
                    })}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      )
    }

    if (displayType === 'single-price') {
      // Group items by base name, collect variation names as flavors
      const grouped = new Map<string, { name: string; price: string; flavors: string[] }>()
      for (const item of visibleItems) {
        const baseName = item.name
        const variation = item.variationName ?? ''
        if (!grouped.has(baseName)) {
          grouped.set(baseName, { name: baseName, price: item.displayPrice ?? '', flavors: [] })
        }
        // Add variation as flavor if it's not a generic name
        const skipVariation = !variation || variation.toLowerCase() === 'regular' || variation.toLowerCase() === baseName.toLowerCase()
        if (!skipVariation) {
          grouped.get(baseName)!.flavors.push(variation)
        }
      }

      return (
        <div style={{ width: '100%', height: '100%', overflow: 'hidden', padding: '16px 20px', ...style }}
          className="kds-dynamic-category kds-display-single-price">
          <CategoryTitle cat={cat} />
          {cat.headerText && (
            <div style={{
              fontSize: '1.1rem', fontWeight: 600, marginBottom: '6px',
              color: 'var(--kds-text-secondary, rgba(255,255,255,0.85))',
            }}>
              {cat.headerText}
            </div>
          )}
          <div className="kds-dynamic-items" style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, max-content) minmax(55px, 70px)',
            gap: '0 6px',
            fontSize: '1.25rem',
            color: 'var(--kds-text-secondary, rgba(255,255,255,0.85))',
          }}>
            {Array.from(grouped.values()).map(({ name, price, flavors }) => (
              <React.Fragment key={name}>
                <span style={{ fontWeight: 700, padding: '4px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '4px 0 0' }}>{price}</span>
                {flavors.length > 0 && (
                  <span style={{
                    gridColumn: '1 / -1',
                    fontSize: '1rem', fontStyle: 'italic', paddingLeft: '8px', paddingBottom: '4px',
                    color: 'var(--kds-text-muted, rgba(255,255,255,0.5))',
                  }}>
                    {flavors.join(' · ')}
                  </span>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )
    }

    const displayItems = displayType === 'featured'
      ? visibleItems.filter((item, idx, arr) => arr.findIndex(i => i.name === item.name) === idx)
      : visibleItems

    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', padding: '16px 20px', ...style }}
        className={`kds-dynamic-category kds-display-${displayType}`}>
        <CategoryTitle cat={cat} />
        {cat.headerText && (
          <div style={{
            fontSize: '1.1rem', fontWeight: 600, marginBottom: '6px',
            color: 'var(--kds-text-secondary, rgba(255,255,255,0.85))',
          }}>
            {cat.headerText}
          </div>
        )}
        <div className="kds-dynamic-items">
          {displayItems.map(item => (
            <div key={item.id}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '1.25rem', color: 'var(--kds-text-secondary, rgba(255,255,255,0.85))' }}>
              <span>{displayType === 'featured' ? item.name : (item.displayName || item.name)}</span>
              {displayType !== 'simple-list' && displayType !== 'featured' && (
                <span style={{ marginLeft: '16px', whiteSpace: 'nowrap' }}>{item.displayPrice}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return <div style={{ width: '100%', height: '100%', ...style }} />
}

// ---------------------------------------------------------------------------
// Row renderer
// ---------------------------------------------------------------------------

function renderRow(row: KDSRow, categories: KDSCategoryWithItems[], rowIndex: number): React.ReactNode {
  const rowStyle: React.CSSProperties = {
    flex: `0 0 ${row.height}%`,
    overflow: 'hidden',
    position: 'relative',
    borderBottom: rowIndex > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
  }

  if (row.divisions) {
    const [left, right] = row.divisions
    const gap = row.gap ?? 0
    return (
      <div key={row.id} style={{ ...rowStyle, display: 'flex', flexDirection: 'row', gap: gap > 0 ? `${gap}px` : undefined }}>
        <div style={{ flex: `0 0 ${gap > 0 ? `calc(${left.width}% - ${gap / 2}px)` : `${left.width}%`}`, overflow: 'hidden', borderRight: gap > 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
          {renderContent(left.content, categories)}
        </div>
        <div style={{ flex: `0 0 ${gap > 0 ? `calc(${right.width}% - ${gap / 2}px)` : `${right.width}%`}`, overflow: 'hidden' }}>
          {renderContent(right.content, categories)}
        </div>
      </div>
    )
  }

  return (
    <div key={row.id} style={rowStyle}>
      {renderContent(row.content ?? { type: 'empty' }, categories)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Column renderer
// ---------------------------------------------------------------------------

function renderColumn(col: KDSColumn, categories: KDSCategoryWithItems[], colIndex: number): React.ReactNode {
  return (
    <div key={col.id} style={{
      flex: `0 0 ${col.width}%`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      height: '100%',
      borderRight: colIndex > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
    }}>
      {col.rows.map((row, i) => renderRow(row, categories, i))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default async function KDSDynamicScreen({
  screen,
  draft = false,
  autoRefresh = true,
  fallbackProps = {},
  tenantIdOverride,
}: KDSDynamicScreenProps) {
  const tenantId = tenantIdOverride ?? await getCurrentTenantId()
  const supabase = createServiceClient()

  // Try to load custom v2 layout
  const { data: layoutRow } = await supabase
    .from('tenant_kds_layouts')
    .select('layout, updated_at')
    .eq('tenant_id', tenantId)
    .eq('screen', screen)
    .eq('is_draft', draft)
    .maybeSingle()

  // No custom layout — fall back to default hardcoded components
  if (!layoutRow) {
    const [categoriesWithItems, images, settings] = await Promise.all([
      getCategoriesWithItems(tenantId, screen),
      getImages(tenantId, screen),
      getSettings(tenantId),
    ])
    const screenData: KDSScreenData = { categories: categoriesWithItems, images, settings }

    if (screen === 'drinks') {
      return (
        <KDSDrinksMagazine
          data={screenData}
          autoRefresh={autoRefresh}
          headerImages={fallbackProps.headerImages}
          sectionBadge={fallbackProps.sectionBadge}
          defaultSubtitle={fallbackProps.defaultSubtitle}
          mostPopularImage={fallbackProps.mostPopularImage}
          photoStripImages={fallbackProps.photoStripImages}
        />
      )
    }
    return (
      <KDSFoodMagazine
        data={screenData}
        autoRefresh={autoRefresh}
        headerImages={fallbackProps.headerImages}
        lotusImage={fallbackProps.lotusImage}
        foodImage={fallbackProps.foodImage}
        pastriesImage={fallbackProps.pastriesImage}
      />
    )
  }

  // Render from v2 layout JSON
  const layout = layoutRow.layout as KDSLayout

  // Guard: if somehow v1 JSON slipped through, fall back
  if (!layout.version || layout.version < 2 || !('columns' in layout)) {
    const [categoriesWithItems, images, settings] = await Promise.all([
      getCategoriesWithItems(tenantId, screen),
      getImages(tenantId, screen),
      getSettings(tenantId),
    ])
    const screenData: KDSScreenData = { categories: categoriesWithItems, images, settings }
    if (screen === 'drinks') return <KDSDrinksMagazine data={screenData} autoRefresh={autoRefresh} />
    return <KDSFoodMagazine data={screenData} autoRefresh={autoRefresh} />
  }

  const { columns = [], overlays = [], header, footer } = layout

  // Load categories + settings for content and header/footer rendering
  const categories = await getCategoriesWithItems(tenantId, screen)
  const settings = await getSettings(tenantId)

  return (
    <div
      className={`kds-dynamic-screen theme-${layout.theme ?? 'warm'}`}
      style={{
        width: '1920px',
        height: '1080px',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--kds-bg, #1a1a1a)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Dynamic Google Fonts for header */}
      {(header?.title_font || header?.subtitle_font) && (
        <link
          rel="stylesheet"
          href={`https://fonts.googleapis.com/css2?${[header?.title_font, header?.subtitle_font].filter(Boolean).map(f => `family=${encodeURIComponent(f!)}:wght@400;700`).join('&')}&display=swap`}
        />
      )}

      {/* Header */}
      {header?.visible !== false && (
        <div className="kds-dynamic-header" style={{
          flexShrink: 0, display: 'flex', alignItems: 'center',
          padding: '12px 32px', gap: '24px',
          background: 'var(--kds-header-bg, rgba(0,0,0,0.3))',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          minHeight: 100, position: 'relative',
        }}>
          {/* Logo — left */}
          {header?.logo_url && (header?.logo_position === 'left' || !header?.logo_position) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={header.logo_url} alt="Logo" style={{ height: 72, objectFit: 'contain', flexShrink: 0 }} />
          )}
          {/* Title + subtitle — centered */}
          <div style={{ flex: 1, textAlign: 'center' }}>
            {header?.title && (
              <div style={{
                fontSize: `${header?.title_font_size ?? 2.5}rem`,
                fontFamily: header?.title_font ? `'${header.title_font}', sans-serif` : undefined,
                fontWeight: 700, color: 'var(--kds-text, #fff)', lineHeight: 1.2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
              }}>
                {header?.title_icon_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={header.title_icon_url} alt="" style={{ height: '1.2em', objectFit: 'contain' }} />
                )}
                {header.title}
              </div>
            )}
            {header?.subtitle && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '4px' }}>
                {header?.subtitle_icon_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={header.subtitle_icon_url} alt="" style={{ height: 28, objectFit: 'contain' }} />
                )}
                <span style={{
                  fontSize: `${header?.subtitle_font_size ?? 1.5}rem`,
                  fontFamily: header?.subtitle_font ? `'${header.subtitle_font}', sans-serif` : undefined,
                  color: 'var(--kds-text-secondary, rgba(255,255,255,0.8))',
                }}>
                  {header.subtitle}
                </span>
              </div>
            )}
          </div>
          {/* Center logo */}
          {header?.logo_url && header?.logo_position === 'center' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={header.logo_url} alt="Logo" style={{ height: 72, objectFit: 'contain', position: 'absolute', left: '50%', transform: 'translateX(-50%)' }} />
          )}
          {/* Right side: location + hours */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            {header?.show_location && settings?.header_location && (
              <div style={{ fontSize: '1.1rem', color: 'var(--kds-text-secondary, rgba(255,255,255,0.7))' }}>
                {settings.header_location as string}
              </div>
            )}
            {header?.show_hours && settings?.header_hours && (
              <div style={{ fontSize: '1.1rem', color: 'var(--kds-text-secondary, rgba(255,255,255,0.7))' }}>
                {settings.header_hours as string}
              </div>
            )}
          </div>
          {/* Right logo */}
          {header?.logo_url && header?.logo_position === 'right' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={header.logo_url} alt="Logo" style={{ height: 72, objectFit: 'contain', flexShrink: 0 }} />
          )}
        </div>
      )}

      {/* Column layout */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: 0 }}>
        {columns.map((col, i) => renderColumn(col, categories, i))}
      </div>

      {/* Footer */}
      {footer?.visible && footer?.type !== 'none' && (
        <DynamicFooter footer={footer} settings={settings} />
      )}

      {/* Overlays — free-positioned on top */}
      {overlays.map(overlay => (
        <div key={overlay.id} style={{
          position: 'absolute',
          left: overlay.position.x,
          top: overlay.position.y,
          width: overlay.size.width,
          height: overlay.size.height,
          zIndex: 20,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={overlay.image_url} alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      ))}
    </div>
  )
}
