'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import type { InitialScreen } from '@/components/admin/kds-v3/ScreenForm'

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
}

export default function EditScreenPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [initial, setInitial] = useState<InitialScreen | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/admin/kds-v3/screens/${id}`)
        const body = await res.json()
        if (cancelled) return
        if (!res.ok || !body.success) {
          setError(body.error ?? `Failed to load (HTTP ${res.status})`)
          return
        }
        setInitial({
          id: body.data.id,
          name: body.data.name,
          grid_rows: body.data.grid_rows,
          grid_cols: body.data.grid_cols,
          theme: body.data.theme,
          boxes: (body.data.boxes ?? []).map((b: ApiBox) => ({
            position: b.position,
            row_start: b.row_start,
            col_start: b.col_start,
            row_span: b.row_span,
            col_span: b.col_span,
            box_type: b.box_type,
            header_override: b.header_override ?? null,
          })),
        })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

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
    return <div className="max-w-5xl mx-auto px-4 py-6 text-sm text-gray-500">Loading editor…</div>
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <ScreenForm initialScreen={initial} />
    </div>
  )
}
