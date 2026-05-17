'use client'

/**
 * MOK-157 / KDS v3 phase 5 — display overrides admin page.
 *
 * Plan: .planning/kds-v3/PHASE-5-PLAN.md (T4)
 *
 * Layout: a menu-group selector at top; below, a nested table of items in
 * the selected group with each item's variations indented. Each row has
 * three inline controls (alt name input, alt image dropdown, hidden
 * checkbox). Changes trigger a debounced PUT (~500 ms) to the appropriate
 * route. PUT-with-all-defaults auto-deletes the row server-side.
 *
 * Inlined plain-HTML + Tailwind per the webpack-dev gotcha — no
 * @/components/ui barrel imports, no lucide-react.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface MenuGroup {
  id: string
  name: string
  is_deleted: boolean
  parent_menu_name: string | null
}

interface AestheticImage {
  id: string
  name: string
  source_kind: 'uploaded' | 'external'
  is_deleted: boolean
}

interface OverrideRow {
  id: string
  target_kind: 'item' | 'variation'
  target_id: string
  alt_display_name: string | null
  alt_image_aesthetic_image_id: string | null
  hidden_from_kds: boolean
}

interface VariationRow {
  id: string
  name: string | null
  price_cents: number | null
  ordinal: number
  is_deleted: boolean
}

interface ItemRow {
  id: string
  name: string | null
  is_deleted: boolean
  ordinal: number
  variations: VariationRow[]
}

interface OverrideState {
  alt_display_name: string
  alt_image_aesthetic_image_id: string | null
  hidden_from_kds: boolean
}

function defaultOverrideState(o: OverrideRow | undefined): OverrideState {
  return {
    alt_display_name: o?.alt_display_name ?? '',
    alt_image_aesthetic_image_id: o?.alt_image_aesthetic_image_id ?? null,
    hidden_from_kds: o?.hidden_from_kds ?? false,
  }
}

const DEBOUNCE_MS = 500

export function DisplayOverridesPage() {
  const [groups, setGroups] = useState<MenuGroup[]>([])
  const [images, setImages] = useState<AestheticImage[]>([])
  const [overrides, setOverrides] = useState<Map<string, OverrideRow>>(new Map())
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ─── Initial fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [gRes, iRes, oRes] = await Promise.all([
          fetch('/api/admin/kds-v3/menu-groups'),
          fetch('/api/admin/kds-v3/aesthetic-images'),
          fetch('/api/admin/kds-v3/display-overrides'),
        ])
        const [gBody, iBody, oBody] = await Promise.all([gRes.json(), iRes.json(), oRes.json()])
        if (cancelled) return
        if (gBody.success) setGroups(gBody.data as MenuGroup[])
        if (iBody.success) setImages(iBody.data as AestheticImage[])
        if (oBody.success) {
          const map = new Map<string, OverrideRow>()
          for (const o of oBody.data as OverrideRow[]) {
            map.set(overrideKey(o.target_kind, o.target_id), o)
          }
          setOverrides(map)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ─── Fetch items+variations when a group is selected ────────────────────
  useEffect(() => {
    if (!selectedGroupId) {
      setItems([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/kds-v3/menu-groups/${selectedGroupId}/items`,
        )
        const body = await res.json()
        if (cancelled) return
        if (!body.success) {
          setError(body.error ?? `Failed to load items (HTTP ${res.status})`)
          return
        }
        setItems((body.data.items ?? []) as ItemRow[])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load items')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedGroupId])

  // ─── Debounced PUT for a single row ─────────────────────────────────────
  const pendingByKey = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const sendUpdate = useCallback(
    (kind: 'item' | 'variation', id: string, state: OverrideState) => {
      const key = overrideKey(kind, id)
      const existing = pendingByKey.current.get(key)
      if (existing) clearTimeout(existing)
      const handle = setTimeout(async () => {
        pendingByKey.current.delete(key)
        try {
          const path =
            kind === 'item'
              ? `/api/admin/kds-v3/display-overrides/items/${id}`
              : `/api/admin/kds-v3/display-overrides/variations/${id}`
          const res = await fetch(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              alt_display_name: state.alt_display_name.trim() || null,
              alt_image_aesthetic_image_id: state.alt_image_aesthetic_image_id,
              hidden_from_kds: state.hidden_from_kds,
            }),
          })
          const body = await res.json()
          if (!res.ok || !body.success) {
            setError(
              (body.validation_errors as string[] | undefined)?.join('; ') ??
                body.error ??
                `Save failed (HTTP ${res.status})`,
            )
            return
          }
          setError(null)
          setOverrides((prev) => {
            const next = new Map(prev)
            if (body.deleted) {
              next.delete(key)
            } else if (body.data) {
              next.set(key, body.data as OverrideRow)
            }
            return next
          })
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Save failed')
        }
      }, DEBOUNCE_MS)
      pendingByKey.current.set(key, handle)
    },
    [],
  )

  // Cleanup pending timers on unmount.
  useEffect(() => {
    const map = pendingByKey.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  const liveImages = useMemo(() => images.filter((i) => !i.is_deleted), [images])
  const groupsLive = useMemo(() => groups.filter((g) => !g.is_deleted), [groups])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Display overrides</h1>
        <p className="mt-1 text-sm text-gray-500">
          Override how individual Square items and variations show on KDS. Square stays the source
          of truth; overrides are escape hatches. Toggling everything off auto-deletes the row.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Menu group</label>
            <select
              value={selectedGroupId ?? ''}
              onChange={(e) => setSelectedGroupId(e.target.value || null)}
              className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
            >
              <option value="">— select a menu group —</option>
              {groupsLive.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.parent_menu_name ? `${g.parent_menu_name} › ` : ''}
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {selectedGroupId && items.length === 0 ? (
            <p className="text-sm text-gray-500">No items in this menu group yet.</p>
          ) : null}

          {items.length > 0 && (
            <div className="space-y-1">
              <div className="grid grid-cols-12 items-center gap-2 border-b border-gray-200 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <div className="col-span-4">Item / variation</div>
                <div className="col-span-3">Alt display name</div>
                <div className="col-span-3">Alt image</div>
                <div className="col-span-2">Hidden</div>
              </div>
              {items.map((item) => (
                <div key={item.id} className="space-y-0">
                  <OverrideRowControl
                    indent={false}
                    label={item.name ?? '(no name)'}
                    isDeleted={item.is_deleted}
                    targetKind="item"
                    targetId={item.id}
                    initialOverride={overrides.get(overrideKey('item', item.id))}
                    images={liveImages}
                    onChange={sendUpdate}
                  />
                  {item.variations.map((v) => (
                    <OverrideRowControl
                      key={v.id}
                      indent
                      label={v.name ?? '(unnamed variation)'}
                      isDeleted={v.is_deleted}
                      targetKind="variation"
                      targetId={v.id}
                      initialOverride={overrides.get(overrideKey('variation', v.id))}
                      images={liveImages}
                      onChange={sendUpdate}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function overrideKey(kind: 'item' | 'variation', id: string): string {
  return `${kind}:${id}`
}

function OverrideRowControl({
  indent,
  label,
  isDeleted,
  targetKind,
  targetId,
  initialOverride,
  images,
  onChange,
}: {
  indent: boolean
  label: string
  isDeleted: boolean
  targetKind: 'item' | 'variation'
  targetId: string
  initialOverride: OverrideRow | undefined
  images: AestheticImage[]
  onChange: (kind: 'item' | 'variation', id: string, state: OverrideState) => void
}) {
  const [state, setState] = useState<OverrideState>(defaultOverrideState(initialOverride))

  // Re-sync if the parent's override map updates (e.g. after a save).
  useEffect(() => {
    setState(defaultOverrideState(initialOverride))
  }, [initialOverride])

  const apply = (next: OverrideState) => {
    setState(next)
    onChange(targetKind, targetId, next)
  }

  return (
    <div
      className={`grid grid-cols-12 items-center gap-2 border-b border-gray-100 py-1.5 text-sm ${
        isDeleted ? 'opacity-60' : ''
      }`}
    >
      <div
        className={`col-span-4 truncate ${
          indent ? 'pl-6 text-xs text-gray-600' : 'font-medium text-gray-800'
        }`}
        title={label}
      >
        {indent ? '↳ ' : ''}
        {isDeleted ? '⚠ ' : ''}
        {label}
      </div>
      <div className="col-span-3">
        <input
          type="text"
          maxLength={120}
          value={state.alt_display_name}
          onChange={(e) => apply({ ...state, alt_display_name: e.target.value })}
          placeholder="(use Square name)"
          className="w-full rounded border border-gray-300 px-1.5 py-0.5 text-xs"
        />
      </div>
      <div className="col-span-3">
        <select
          value={state.alt_image_aesthetic_image_id ?? ''}
          onChange={(e) =>
            apply({
              ...state,
              alt_image_aesthetic_image_id: e.target.value === '' ? null : e.target.value,
            })
          }
          className="w-full rounded border border-gray-300 px-1.5 py-0.5 text-xs"
        >
          <option value="">— no override —</option>
          {images.map((img) => (
            <option key={img.id} value={img.id}>
              {img.name} · {img.source_kind}
            </option>
          ))}
        </select>
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={state.hidden_from_kds}
          onChange={(e) => apply({ ...state, hidden_from_kds: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300"
        />
        <span className="text-xs text-gray-500">hide</span>
      </div>
    </div>
  )
}
