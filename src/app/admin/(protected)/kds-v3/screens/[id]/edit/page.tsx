import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { ScreenForm, type InitialScreen } from '@/components/admin/kds-v3/ScreenForm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditScreenPage({ params }: Props) {
  const { id } = await params

  // Fetch via the same admin API the client uses — keeps auth + tenant
  // scoping consistent (cookies propagate).
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('host') ?? 'localhost:3000'
  const cookie = h.get('cookie') ?? ''
  const res = await fetch(`${proto}://${host}/api/admin/kds-v3/screens/${id}`, {
    headers: { cookie },
    cache: 'no-store',
  })

  if (res.status === 404) notFound()
  const body = await res.json()
  if (!res.ok || !body.success) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load screen: {body.error ?? `HTTP ${res.status}`}
        </div>
      </div>
    )
  }

  const initial: InitialScreen = {
    id: body.data.id,
    name: body.data.name,
    grid_rows: body.data.grid_rows,
    grid_cols: body.data.grid_cols,
    theme: body.data.theme,
    boxes: (body.data.boxes ?? []).map(
      (b: {
        position: number
        row_start: number
        col_start: number
        row_span: number
        col_span: number
        box_type: 'menu_group' | 'image_only'
        header_override?: string | null
      }) => ({
        position: b.position,
        row_start: b.row_start,
        col_start: b.col_start,
        row_span: b.row_span,
        col_span: b.col_span,
        box_type: b.box_type,
        header_override: b.header_override ?? null,
      }),
    ),
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <ScreenForm initialScreen={initial} />
    </div>
  )
}
