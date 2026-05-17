'use client'

/**
 * MOK-156 / KDS v3 phase 4 — aesthetic image library admin page.
 *
 * Plan: .planning/kds-v3/PHASE-4-PLAN.md (T6)
 *
 * Operator-facing surface for managing the tenant's aesthetic image library.
 * Two source modes — uploaded files and external HTTPS URLs — share a single
 * grid view. Per-card actions: inline rename, soft-delete, external-URL flag.
 *
 * Inlined HTML + Tailwind per the webpack-dev gotcha from phase 2 — no
 * @/components/ui barrel imports, no lucide-react.
 */
import { useCallback, useEffect, useState } from 'react'

interface ImageRow {
  id: string
  name: string
  source_kind: 'uploaded' | 'external'
  storage_path: string | null
  external_url: string | null
  alt_text: string | null
  mime_type: string | null
  width_px: number | null
  height_px: number | null
  bytes: number | null
  is_deleted: boolean
  thumbnail_url: string | null
  created_at: string
  updated_at: string
}

const NAME_MAX = 80
const ALT_TEXT_MAX = 200

export function AestheticImageLibrary() {
  const [images, setImages] = useState<ImageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showExternalForm, setShowExternalForm] = useState(false)

  const fetchImages = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/kds-v3/aesthetic-images')
      const body = await res.json()
      if (!res.ok || !body.success) {
        setError(body.error ?? `Failed to load (HTTP ${res.status})`)
        return
      }
      setImages(body.data as ImageRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load images')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchImages()
  }, [fetchImages])

  const handleUpload = async (file: File, name: string, altText: string | null) => {
    setError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('name', name)
    if (altText) form.append('alt_text', altText)
    try {
      const res = await fetch('/api/admin/kds-v3/aesthetic-images/upload', {
        method: 'POST',
        body: form,
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        setError(
          (body.validation_errors as string[] | undefined)?.join('; ') ??
            body.error ??
            `Upload failed (HTTP ${res.status})`,
        )
        return
      }
      setImages((prev) => [body.data as ImageRow, ...prev])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    }
  }

  const handleExternalAdd = async (name: string, url: string, altText: string | null) => {
    setError(null)
    try {
      const res = await fetch('/api/admin/kds-v3/aesthetic-images/external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, external_url: url, alt_text: altText }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        setError(
          (body.validation_errors as string[] | undefined)?.join('; ') ??
            body.error ??
            `Add failed (HTTP ${res.status})`,
        )
        return
      }
      setImages((prev) => [body.data as ImageRow, ...prev])
      setShowExternalForm(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed')
    }
  }

  const handleRename = async (id: string, name: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/kds-v3/aesthetic-images/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        setError(body.error ?? `Rename failed (HTTP ${res.status})`)
        return
      }
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, name } : img)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed')
    }
  }

  const handleAltTextUpdate = async (id: string, altText: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/kds-v3/aesthetic-images/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alt_text: altText || null }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        setError(body.error ?? `Update failed (HTTP ${res.status})`)
        return
      }
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, alt_text: altText || null } : img)),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this image? It will be hidden from the editor; uploaded files remain in storage and can be recovered manually.')) {
      return
    }
    setError(null)
    try {
      const res = await fetch(`/api/admin/kds-v3/aesthetic-images/${id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok || !body.success) {
        setError(body.error ?? `Delete failed (HTTP ${res.status})`)
        return
      }
      await fetchImages()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const live = images.filter((img) => !img.is_deleted)
  const deleted = images.filter((img) => img.is_deleted)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Aesthetic image library</h1>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Upload image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const fallbackName = file.name.replace(/\.[^.]+$/, '').slice(0, NAME_MAX)
                const name = prompt('Image name', fallbackName)?.trim()
                if (!name) {
                  e.target.value = ''
                  return
                }
                await handleUpload(file, name, null)
                e.target.value = ''
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => setShowExternalForm((v) => !v)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {showExternalForm ? 'Cancel external add' : 'Add external URL'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {showExternalForm && (
        <ExternalUrlForm
          onSubmit={handleExternalAdd}
          onCancel={() => setShowExternalForm(false)}
        />
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading library…</p>
      ) : live.length === 0 && deleted.length === 0 ? (
        <p className="text-sm text-gray-500">
          No images yet. Click <strong>Upload image</strong> to add one from disk, or{' '}
          <strong>Add external URL</strong> to hot-link an image from somewhere else.
        </p>
      ) : (
        <>
          <ImageGrid
            rows={live}
            onRename={handleRename}
            onAltTextUpdate={handleAltTextUpdate}
            onDelete={handleDelete}
          />
          {deleted.length > 0 && (
            <details className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-gray-600">
                Recently deleted ({deleted.length})
              </summary>
              <div className="mt-3">
                <ImageGrid
                  rows={deleted}
                  onRename={handleRename}
                  onAltTextUpdate={handleAltTextUpdate}
                  onDelete={handleDelete}
                  dimmed
                />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}

function ExternalUrlForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, url: string, altText: string | null) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [altText, setAltText] = useState('')

  return (
    <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={NAME_MAX}
          placeholder="Name (e.g. Seasonal banner)"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/image.png"
          className="rounded border border-gray-300 px-2 py-1 text-sm md:col-span-2"
        />
      </div>
      <input
        type="text"
        value={altText}
        onChange={(e) => setAltText(e.target.value)}
        maxLength={ALT_TEXT_MAX}
        placeholder="Alt text (optional)"
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSubmit(name.trim(), url.trim(), altText.trim() || null)}
          disabled={!name.trim() || !url.trim()}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function ImageGrid({
  rows,
  onRename,
  onAltTextUpdate,
  onDelete,
  dimmed = false,
}: {
  rows: ImageRow[]
  onRename: (id: string, name: string) => void
  onAltTextUpdate: (id: string, altText: string) => void
  onDelete: (id: string) => void
  dimmed?: boolean
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 ${dimmed ? 'opacity-60' : ''}`}
    >
      {rows.map((img) => (
        <ImageCard
          key={img.id}
          img={img}
          onRename={onRename}
          onAltTextUpdate={onAltTextUpdate}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}

function ImageCard({
  img,
  onRename,
  onAltTextUpdate,
  onDelete,
}: {
  img: ImageRow
  onRename: (id: string, name: string) => void
  onAltTextUpdate: (id: string, altText: string) => void
  onDelete: (id: string) => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(img.name)
  const [editingAlt, setEditingAlt] = useState(false)
  const [altDraft, setAltDraft] = useState(img.alt_text ?? '')

  useEffect(() => {
    setNameDraft(img.name)
  }, [img.name])
  useEffect(() => {
    setAltDraft(img.alt_text ?? '')
  }, [img.alt_text])

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
      <div className="relative aspect-video w-full bg-gray-100">
        {img.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img.thumbnail_url}
            alt={img.alt_text ?? img.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
            No thumbnail
          </div>
        )}
        <span className="absolute top-1 right-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-gray-600 shadow-sm">
          {img.source_kind}
        </span>
        {img.is_deleted && (
          <span className="absolute top-1 left-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
            deleted
          </span>
        )}
      </div>
      <div className="space-y-1 p-2 text-sm">
        {editingName ? (
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              setEditingName(false)
              const trimmed = nameDraft.trim()
              if (trimmed && trimmed !== img.name) onRename(img.id, trimmed)
              else setNameDraft(img.name)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setNameDraft(img.name)
                setEditingName(false)
              }
            }}
            autoFocus
            maxLength={NAME_MAX}
            className="w-full rounded border border-gray-300 px-1 py-0.5 text-sm font-medium"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="block w-full truncate text-left font-medium text-gray-800 hover:text-blue-700"
            title="Click to rename"
          >
            {img.name}
          </button>
        )}
        {editingAlt ? (
          <input
            type="text"
            value={altDraft}
            onChange={(e) => setAltDraft(e.target.value)}
            onBlur={() => {
              setEditingAlt(false)
              if ((img.alt_text ?? '') !== altDraft) onAltTextUpdate(img.id, altDraft)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setAltDraft(img.alt_text ?? '')
                setEditingAlt(false)
              }
            }}
            autoFocus
            maxLength={ALT_TEXT_MAX}
            placeholder="Alt text"
            className="w-full rounded border border-gray-300 px-1 py-0.5 text-xs text-gray-600"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingAlt(true)}
            className="block w-full truncate text-left text-xs text-gray-500 hover:text-blue-700"
            title="Click to edit alt text"
          >
            {img.alt_text ? img.alt_text : <span className="italic">(no alt text)</span>}
          </button>
        )}
        <div className="flex items-center justify-end">
          {!img.is_deleted && (
            <button
              type="button"
              onClick={() => onDelete(img.id)}
              className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
