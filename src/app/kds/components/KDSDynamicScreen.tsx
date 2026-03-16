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
  if (images.length === 0) return <div style={{ height: 80, flexShrink: 0 }} />

  return (
    <div style={{
      flexShrink: 0, height: 80, display: 'flex', alignItems: 'center',
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
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', ...style }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={content.image_url}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: content.image_fit ?? 'cover' }}
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
          color: '#f87171', fontSize: '0.75rem', padding: '0.5rem', ...style,
        }}>
          ⚠ {content.category_slug}
        </div>
      )
    }

    const visibleItems = cat.items.filter(i => i.isVisible)

    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', padding: '0.75rem', ...style }}
        className={`kds-dynamic-category kds-display-${content.display_type ?? 'price-grid'}`}>
        <div className="kds-dynamic-category-title"
          style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--kds-text, #fff)' }}>
          {cat.name}
        </div>
        <div className="kds-dynamic-items">
          {visibleItems.map(item => (
            <div key={item.id}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0', fontSize: '0.8rem', color: 'var(--kds-text-secondary, rgba(255,255,255,0.85))' }}>
              <span>{item.displayName || item.name}</span>
              {content.display_type !== 'simple-list' && (
                <span style={{ marginLeft: '1rem', whiteSpace: 'nowrap' }}>{item.displayPrice}</span>
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
    return (
      <div key={row.id} style={{ ...rowStyle, display: 'flex', flexDirection: 'row' }}>
        <div style={{ flex: `0 0 ${left.width}%`, overflow: 'hidden', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
          {renderContent(left.content, categories)}
        </div>
        <div style={{ flex: `0 0 ${right.width}%`, overflow: 'hidden' }}>
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
}: KDSDynamicScreenProps) {
  const tenantId = await getCurrentTenantId()
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
      {/* Header */}
      {header?.visible !== false && (
        <div className="kds-dynamic-header" style={{
          flexShrink: 0, display: 'flex', alignItems: 'center',
          padding: '0.75rem 1.5rem', gap: '1rem',
          background: 'var(--kds-header-bg, rgba(0,0,0,0.3))',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          minHeight: 80,
        }}>
          {/* Logo */}
          {header?.logo_url && (header?.logo_position === 'left' || !header?.logo_position) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={header.logo_url} alt="Logo" style={{ height: 48, objectFit: 'contain', flexShrink: 0 }} />
          )}
          {/* Title + subtitle */}
          <div style={{ flex: 1 }}>
            {header?.title && (
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--kds-text, #fff)', lineHeight: 1.2 }}>
                {header.title}
              </div>
            )}
            {header?.subtitle && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                {header?.subtitle_icon_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={header.subtitle_icon_url} alt="" style={{ height: 20, objectFit: 'contain' }} />
                )}
                <span style={{ fontSize: '1rem', color: 'var(--kds-text-secondary, rgba(255,255,255,0.8))' }}>
                  {header.subtitle}
                </span>
              </div>
            )}
          </div>
          {/* Center logo */}
          {header?.logo_url && header?.logo_position === 'center' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={header.logo_url} alt="Logo" style={{ height: 48, objectFit: 'contain', position: 'absolute', left: '50%', transform: 'translateX(-50%)' }} />
          )}
          {/* Right side: location + hours */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            {header?.show_location && settings?.header_location && (
              <div style={{ fontSize: '0.8rem', color: 'var(--kds-text-secondary, rgba(255,255,255,0.7))' }}>
                {settings.header_location as string}
              </div>
            )}
            {header?.show_hours && settings?.header_hours && (
              <div style={{ fontSize: '0.8rem', color: 'var(--kds-text-secondary, rgba(255,255,255,0.7))' }}>
                {settings.header_hours as string}
              </div>
            )}
          </div>
          {/* Right logo */}
          {header?.logo_url && header?.logo_position === 'right' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={header.logo_url} alt="Logo" style={{ height: 48, objectFit: 'contain', flexShrink: 0 }} />
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
