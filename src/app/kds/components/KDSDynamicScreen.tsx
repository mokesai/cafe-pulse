/**
 * KDSDynamicScreen — MOK-14
 *
 * Renders a KDS screen from a stored layout JSON.
 * Falls back to KDSDrinksMagazine / KDSFoodMagazine when no custom layout exists.
 *
 * Render logic:
 *   1. Query tenant_kds_layouts for current tenant + screen (is_draft = false)
 *   2. If layout found → render sections/overlays from JSON using CSS Grid
 *   3. If no layout → render existing default component (zero impact on existing tenants)
 */

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getCategoriesWithItems, getImages, getSettings } from '@/lib/kds/queries'
import type { KDSLayout, KDSLayoutSection } from '@/lib/kds/layout-types'
import type { KDSScreen } from '@/lib/kds/types'
import { KDSDrinksMagazine } from './index'
import { KDSFoodMagazine } from './index'
import type { KDSScreenData } from '@/lib/kds/types'

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
  /** If true, reads is_draft = true layout (for preview page) */
  draft?: boolean
  /** Auto-refresh interval ms (default: from DB settings or 300000) */
  autoRefresh?: boolean
  /** Pass-through props for default KDSDrinksMagazine/KDSFoodMagazine fallback */
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
// Section renderer
// ---------------------------------------------------------------------------

async function renderSection(
  section: KDSLayoutSection,
  tenantId: string,
  screen: KDSScreen
) {
  if (section.type === 'image') {
    const fit = section.fit ?? 'cover'
    return (
      <div
        key={section.id}
        style={{
          gridColumn: `${section.position.col + 1} / span ${section.span.cols}`,
          gridRow: `${section.position.row + 1} / span ${section.span.rows}`,
          overflow: 'hidden',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={section.image_url}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: fit }}
        />
      </div>
    )
  }

  // Category section
  const allCategories = await getCategoriesWithItems(tenantId, screen)
  const cat = allCategories.find(c => c.slug === section.category_slug)

  if (!cat) {
    return (
      <div
        key={section.id}
        style={{
          gridColumn: `${section.position.col + 1} / span ${section.span.cols}`,
          gridRow: `${section.position.row + 1} / span ${section.span.rows}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255,0,0,0.1)',
          color: '#f87171',
          fontSize: '0.875rem',
          padding: '1rem',
        }}
      >
        ⚠ Category not found: {section.category_slug}
      </div>
    )
  }

  return (
    <div
      key={section.id}
      style={{
        gridColumn: `${section.position.col + 1} / span ${section.span.cols}`,
        gridRow: `${section.position.row + 1} / span ${section.span.rows}`,
        overflow: 'hidden',
      }}
    >
      {/* Simplified category display — editor phase will expand this */}
      <div style={{ padding: '1rem', height: '100%' }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          {cat.name}
        </h3>
        {cat.items.filter(i => i.isVisible).map(item => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0', fontSize: '0.875rem' }}>
            <span>{item.displayName || item.name}</span>
            <span>{item.displayPrice}</span>
          </div>
        ))}
      </div>
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

  // 1. Try to load custom layout
  const { data: layoutRow } = await supabase
    .from('tenant_kds_layouts')
    .select('layout, updated_at')
    .eq('tenant_id', tenantId)
    .eq('screen', screen)
    .eq('is_draft', draft)
    .maybeSingle()

  // 2. No custom layout → fall back to default components (zero change for existing tenants)
  if (!layoutRow) {
    const [categoriesWithItems, images, settings] = await Promise.all([
      getCategoriesWithItems(tenantId, screen),
      getImages(tenantId, screen),
      getSettings(tenantId),
    ])

    const screenData: KDSScreenData = {
      categories: categoriesWithItems,
      images,
      settings,
    }

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

  // 3. Render from layout JSON
  const layout = layoutRow.layout as KDSLayout
  const { grid, sections = [], overlays = [], header, footer } = layout

  const renderedSections = await Promise.all(
    sections.map(s => renderSection(s, tenantId, screen))
  )

  return (
    <div
      className={`kds-dynamic-screen theme-${layout.theme ?? 'warm'}`}
      style={{
        width: '1920px',
        height: '1080px',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--kds-bg, #1a1a1a)',
      }}
    >
      {/* Header */}
      {header?.visible !== false && (
        <div className="kds-dynamic-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
          {/* Header content provided by theme CSS */}
        </div>
      )}

      {/* Main grid */}
      <div
        className="kds-dynamic-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${grid.columns}, 1fr)`,
          gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        {renderedSections}
      </div>

      {/* Overlays — free-positioned on top */}
      {overlays.map(overlay => (
        <div
          key={overlay.id}
          style={{
            position: 'absolute',
            left: overlay.position.x,
            top: overlay.position.y,
            width: overlay.size.width,
            height: overlay.size.height,
            zIndex: 20,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={overlay.image_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
      ))}

      {/* Footer */}
      {footer?.visible && (
        <div className="kds-dynamic-footer" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 }}>
          {/* Footer content provided by theme */}
        </div>
      )}
    </div>
  )
}
