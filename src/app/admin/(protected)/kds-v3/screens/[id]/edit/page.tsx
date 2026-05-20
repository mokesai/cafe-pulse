'use client'

/**
 * KDS v3 phase 6 — edit-screen page.
 *
 * Tabbed shell: Edit | Preview. Both tabs share the page heading + back
 * link so toggling never causes a page transition. Save in Edit stays put
 * (doesn't navigate to the screens list anymore); the operator iterates
 * Edit → Save → Preview → Edit → Preview indefinitely until satisfied,
 * then manually clicks "← Back to screens".
 *
 * Data flow:
 *   - Edit tab data: GET /api/admin/kds-v3/screens/[id] (existing route)
 *     fetched once on mount.
 *   - Preview tab data: GET /api/admin/kds-v3/screens/[id]/render (new in
 *     phase 6) — returns the resolveScreenForRender shape. Fetched lazily
 *     on first switch to the Preview tab + on Save success + on manual
 *     ⟳ Refresh inside the canvas.
 *
 * Save behavior:
 *   - On successful save: refresh the editable form data (so any
 *     server-side normalization round-trips) + invalidate the preview
 *     resolved state so it re-fetches on next view.
 */
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import type { InitialScreen } from '@/components/admin/kds-v3/ScreenForm'
import { KDSv3PreviewCanvas } from '@/components/kds/v3/KDSv3PreviewCanvas'
import { PublishStatusBadge } from '@/components/admin/kds-v3/PublishStatusBadge'
import type { ResolvedScreen } from '@/lib/kds/v3-render'
import '@/app/kds/kds-themes.css'

const ScreenForm = dynamic(
  () => import('@/components/admin/kds-v3/ScreenForm').then((mod) => mod.ScreenForm),
  {
    loading: () => <div className="text-sm text-gray-500">Loading editor…</div>,
    ssr: false,
  },
)

interface ApiBox {
  position: number
  row_start: number
  col_start: number
  row_span: number
  col_span: number
  box_type: 'menu_group' | 'image_only'
  header_override?: string | null
  square_menu_group_id?: string | null
  aesthetic_image_id?: string | null
  division?: 'none' | 'horizontal' | 'vertical'
  box_type_b?: 'menu_group' | 'image_only' | null
  header_override_b?: string | null
  square_menu_group_id_b?: string | null
  aesthetic_image_id_b?: string | null
  layout_mode?:
    | 'simple_list'
    | 'variation_column_header'
    | 'flavor_list'
    | 'compact_list'
    | 'featured_list'
  price_display_mode?: 'none' | 'lowest' | 'range' | 'base'
  density?: 'compact' | 'normal' | 'loose'
  title_size?: 'small' | 'medium' | 'large'
  title_align?: 'left' | 'center' | 'right'
  layout_mode_b?:
    | 'simple_list'
    | 'variation_column_header'
    | 'flavor_list'
    | 'compact_list'
    | 'featured_list'
    | null
  price_display_mode_b?: 'none' | 'lowest' | 'range' | 'base' | null
  density_b?: 'compact' | 'normal' | 'loose' | null
  title_size_b?: 'small' | 'medium' | 'large' | null
  title_align_b?: 'left' | 'center' | 'right' | null
  // Phase 6 addendum — featured_list subtitle + per-box chrome.
  subtitle_override?: string | null
  subtitle_override_b?: string | null
  box_border?: 'none' | 'thin' | 'thick'
  box_radius?: 'none' | 'sm' | 'lg'
  box_background?: 'none' | 'white' | 'accent' | 'warm' | 'cool'
  // Phase 6.5 (MOK-159) — variation emphasis.
  emphasized_variation_name?: string | null
  emphasized_variation_explicit_none?: boolean
  emphasized_variation_name_b?: string | null
  emphasized_variation_explicit_none_b?: boolean
}

type Tab = 'edit' | 'preview'

function mapInitialFromApi(data: {
  id: string
  name: string
  grid_rows: number
  grid_cols: number
  theme: InitialScreen['theme']
  boxes?: ApiBox[]
}): InitialScreen {
  return {
    id: data.id,
    name: data.name,
    grid_rows: data.grid_rows,
    grid_cols: data.grid_cols,
    theme: data.theme,
    boxes: (data.boxes ?? []).map((b) => ({
      position: b.position,
      row_start: b.row_start,
      col_start: b.col_start,
      row_span: b.row_span,
      col_span: b.col_span,
      box_type: b.box_type,
      header_override: b.header_override ?? null,
      square_menu_group_id: b.square_menu_group_id ?? null,
      aesthetic_image_id: b.aesthetic_image_id ?? null,
      division: b.division ?? 'none',
      box_type_b: b.box_type_b ?? null,
      header_override_b: b.header_override_b ?? null,
      square_menu_group_id_b: b.square_menu_group_id_b ?? null,
      aesthetic_image_id_b: b.aesthetic_image_id_b ?? null,
      layout_mode: b.layout_mode ?? 'simple_list',
      price_display_mode: b.price_display_mode ?? 'lowest',
      density: b.density ?? 'normal',
      title_size: b.title_size ?? 'medium',
      title_align: b.title_align ?? 'left',
      layout_mode_b: b.layout_mode_b ?? null,
      price_display_mode_b: b.price_display_mode_b ?? null,
      density_b: b.density_b ?? null,
      title_size_b: b.title_size_b ?? null,
      title_align_b: b.title_align_b ?? null,
      // Phase 6 addendum
      subtitle_override: b.subtitle_override ?? null,
      subtitle_override_b: b.subtitle_override_b ?? null,
      box_border: b.box_border ?? 'none',
      box_radius: b.box_radius ?? 'none',
      box_background: b.box_background ?? 'none',
      // Phase 6.5 (MOK-159)
      emphasized_variation_name: b.emphasized_variation_name ?? null,
      emphasized_variation_explicit_none: b.emphasized_variation_explicit_none ?? false,
      emphasized_variation_name_b: b.emphasized_variation_name_b ?? null,
      emphasized_variation_explicit_none_b: b.emphasized_variation_explicit_none_b ?? false,
    })),
  }
}

interface PublishStatus {
  unpublished: boolean
  published_at: string | null
}

export default function EditScreenPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [initial, setInitial] = useState<InitialScreen | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('edit')
  const [resolved, setResolved] = useState<ResolvedScreen | null>(null)
  const [resolvedError, setResolvedError] = useState<string | null>(null)
  const [resolvedLoading, setResolvedLoading] = useState(false)
  const [formKey, setFormKey] = useState(0)
  // MOK-159 — publish status surfaced from GET /screens/[id]; ticks on save,
  // publish, and discard so the badge + buttons reflect current state.
  const [publishStatus, setPublishStatus] = useState<PublishStatus>({
    unpublished: false,
    published_at: null,
  })
  const [publishing, setPublishing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  // Initial fetch: editable screen data.
  const loadInitial = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/admin/kds-v3/screens/${id}`)
      const body = await res.json()
      if (!res.ok || !body.success) {
        setError(body.error ?? `Failed to load (HTTP ${res.status})`)
        return
      }
      setInitial(mapInitialFromApi(body.data))
      setPublishStatus({
        unpublished: Boolean(body.data.unpublished),
        published_at: body.data.published_at ?? null,
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [id])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  // Preview fetch: resolved-for-render shape. Lazy — only on first switch
  // to the Preview tab, on Save success, or on manual Refresh.
  const loadResolved = useCallback(async () => {
    if (!id) return
    setResolvedLoading(true)
    setResolvedError(null)
    try {
      const res = await fetch(`/api/admin/kds-v3/screens/${id}/render`)
      const body = await res.json()
      if (!res.ok || !body.success) {
        setResolvedError(body.error ?? `Failed to load preview (HTTP ${res.status})`)
        setResolved(null)
        return
      }
      setResolved(body.data as ResolvedScreen)
    } catch (e) {
      setResolvedError(e instanceof Error ? e.message : 'Failed to load preview')
    } finally {
      setResolvedLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (tab === 'preview' && !resolved && !resolvedLoading && !resolvedError) {
      void loadResolved()
    }
  }, [tab, resolved, resolvedLoading, resolvedError, loadResolved])

  const onSaved = useCallback(() => {
    // Refresh the editable form data so server-side normalization round-trips
    // (positions, defaults, etc.) are visible without a page transition. The
    // remount-by-key approach reinitializes the form's internal state from the
    // freshly-fetched data without disturbing the tab state.
    setFormKey((k) => k + 1)
    void loadInitial()
    // Invalidate the preview so the next switch to the Preview tab re-fetches.
    setResolved(null)
  }, [loadInitial])

  const onPublish = useCallback(async () => {
    if (!id) return
    if (!confirm('Publish your draft to the Pi displays? Visible on Pi within ~30s.')) return
    setPublishing(true)
    setPublishError(null)
    try {
      const res = await fetch(`/api/admin/kds-v3/screens/${id}/publish`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok || !body.success) {
        setPublishError(body.error ?? `Publish failed (HTTP ${res.status})`)
        return
      }
      // Refresh status (badge → "Up to date") + invalidate preview cache.
      await loadInitial()
      setResolved(null)
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }, [id, loadInitial])

  const onDiscardDraft = useCallback(async () => {
    if (!id) return
    if (
      !confirm(
        'Discard your unpublished changes? The draft will revert to the last-published version.',
      )
    )
      return
    setDiscarding(true)
    setPublishError(null)
    try {
      const res = await fetch(`/api/admin/kds-v3/screens/${id}/discard-draft`, {
        method: 'POST',
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        setPublishError(body.error ?? `Discard failed (HTTP ${res.status})`)
        return
      }
      // Reload form data from the (now-reverted) draft.
      setFormKey((k) => k + 1)
      await loadInitial()
      setResolved(null)
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Discard failed')
    } finally {
      setDiscarding(false)
    }
  }, [id, loadInitial])

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load screen: {error}
        </div>
      </div>
    )
  }

  if (!initial) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 text-sm text-gray-500">Loading editor…</div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div>
        <Link
          href="/admin/kds-v3/screens"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to screens
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">
              Edit screen: {initial.name}
            </h1>
            <PublishStatusBadge
              unpublished={publishStatus.unpublished}
              publishedAt={publishStatus.published_at}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onDiscardDraft}
              disabled={
                !publishStatus.unpublished ||
                publishStatus.published_at == null ||
                publishing ||
                discarding
              }
              title={
                publishStatus.published_at == null
                  ? 'Nothing published yet — no version to revert to'
                  : !publishStatus.unpublished
                    ? 'No unpublished changes to discard'
                    : 'Discard draft → revert to last-published version'
              }
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {discarding ? 'Discarding…' : 'Discard draft'}
            </button>
            <button
              type="button"
              onClick={onPublish}
              disabled={!publishStatus.unpublished || publishing || discarding}
              title={
                !publishStatus.unpublished
                  ? 'No unpublished changes'
                  : 'Publish draft → live on Pi displays within ~30s'
              }
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
            <div
              role="tablist"
              aria-label="Edit / Preview"
              className="inline-flex overflow-hidden rounded-md border border-gray-300"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'edit'}
                onClick={() => setTab('edit')}
                className={`px-3 py-1.5 text-sm ${
                  tab === 'edit'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Edit
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'preview'}
                onClick={() => setTab('preview')}
                className={`px-3 py-1.5 text-sm ${
                  tab === 'preview'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Preview
              </button>
            </div>
          </div>
        </div>
        {publishError && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {publishError}
          </div>
        )}
      </div>

      {tab === 'edit' ? (
        <ScreenForm
          key={formKey}
          initialScreen={initial}
          hideHeader
          onSaved={onSaved}
        />
      ) : resolvedLoading ? (
        <div className="text-sm text-gray-500">Loading preview…</div>
      ) : resolvedError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {resolvedError}
        </div>
      ) : resolved ? (
        <KDSv3PreviewCanvas resolved={resolved} onRefresh={loadResolved} />
      ) : (
        <div className="text-sm text-gray-500">Switching to preview…</div>
      )}
    </div>
  )
}
