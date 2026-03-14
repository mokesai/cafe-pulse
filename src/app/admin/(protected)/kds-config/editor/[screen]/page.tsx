import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { getCategoriesWithItems } from '@/lib/kds/queries'
import KDSEditorClient from './KDSEditorClient'
import type { KDSLayout } from '@/lib/kds/layout-types'

export const dynamic = 'force-dynamic'

// Default layout when no custom layout exists
function defaultLayout(_screen: 'drinks' | 'food'): KDSLayout {
  return {
    version: 1,
    grid: { columns: 2, rows: 3 },
    sections: [],
    overlays: [],
    header: { visible: true },
    footer: { visible: true, type: 'image-rotator' },
  }
}

interface PageProps {
  params: Promise<{ screen: string }>
}

export default async function KDSEditorPage({ params }: PageProps) {
  const { screen: screenParam } = await params

  if (screenParam !== 'drinks' && screenParam !== 'food') {
    notFound()
  }
  const screen = screenParam as 'drinks' | 'food'

  const tenantId = await getCurrentTenantId()
  const supabase = createServiceClient()

  // Load draft layout (or published, or default)
  const { data: draftRow } = await supabase
    .from('tenant_kds_layouts')
    .select('id, layout, updated_at')
    .eq('tenant_id', tenantId)
    .eq('screen', screen)
    .eq('is_draft', true)
    .maybeSingle()

  const { data: publishedRow } = !draftRow
    ? await supabase
        .from('tenant_kds_layouts')
        .select('id, layout, updated_at')
        .eq('tenant_id', tenantId)
        .eq('screen', screen)
        .eq('is_draft', false)
        .maybeSingle()
    : { data: null }

  const initialLayout = (draftRow?.layout ?? publishedRow?.layout ?? defaultLayout(screen)) as KDSLayout
  const layoutId = draftRow?.id ?? publishedRow?.id ?? null
  const updatedAt = draftRow?.updated_at ?? publishedRow?.updated_at ?? null
  const hasDraft = !!draftRow

  // Load categories for the properties panel
  const categories = await getCategoriesWithItems(tenantId, screen)

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-400">Loading editor…</div>}>
      <KDSEditorClient
        tenantId={tenantId}
        screen={screen}
        initialLayout={initialLayout}
        layoutId={layoutId}
        updatedAt={updatedAt}
        hasDraft={hasDraft}
        categories={categories}
      />
    </Suspense>
  )
}
