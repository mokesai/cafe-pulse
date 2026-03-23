'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Upload, ImageIcon, X, Loader2, RefreshCw } from 'lucide-react'

interface ImagePickerProps {
  tenantId: string
  value: string
  onChange: (url: string) => void
}

interface StorageFile {
  name: string
  url: string
}

export default function ImagePicker({ tenantId, value, onChange }: ImagePickerProps) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<StorageFile[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: listError } = await supabase.storage
        .from('kds-assets')
        .list(`${tenantId}/`, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })

      if (listError) throw listError

      const fileList: StorageFile[] = (data ?? [])
        .filter(f => f.name !== '.emptyFolderPlaceholder')
        .map(f => {
          const { data: { publicUrl } } = supabase.storage
            .from('kds-assets')
            .getPublicUrl(`${tenantId}/${f.name}`)
          return { name: f.name, url: publicUrl }
        })

      setFiles(fileList)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load images')
    } finally {
      setLoading(false)
    }
  }, [tenantId, supabase.storage])

  useEffect(() => {
    if (open) loadFiles()
  }, [open, loadFiles])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const MAX_SIZE = 5 * 1024 * 1024
    const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']

    if (file.size > MAX_SIZE) { setError('File exceeds 5MB limit'); return }
    if (!ALLOWED_TYPES.includes(file.type)) { setError('Unsupported file type (PNG, JPG, WebP, SVG only)'); return }

    setUploading(true)
    setError(null)
    try {
      const path = `${tenantId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`
      const { error: uploadError } = await supabase.storage
        .from('kds-assets')
        .upload(path, file)
      if (uploadError) throw uploadError
      await loadFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete(fileName: string) {
    try {
      await supabase.storage.from('kds-assets').remove([`${tenantId}/${fileName}`])
      setFiles(prev => prev.filter(f => f.name !== fileName))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div>
      {/* Current value display + open button */}
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="/images/kds/... or browse below"
          className="flex-1 bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={() => setOpen(v => !v)}
          className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded border border-gray-600 flex items-center gap-1"
          title="Browse images"
        >
          <ImageIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Preview */}
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="mt-1 h-12 w-full object-cover rounded border border-gray-600" onError={e => (e.currentTarget.style.display = 'none')} />
      )}

      {/* Picker panel */}
      {open && (
        <div className="mt-2 border border-gray-600 rounded-lg bg-gray-900 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 font-medium">KDS Assets</span>
            <div className="flex gap-2">
              <button onClick={loadFiles} title="Refresh" className="p-1 text-gray-400 hover:text-white">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Upload */}
          <div>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml" onChange={handleUpload} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-gray-600 rounded text-xs text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {uploading ? 'Uploading…' : 'Upload image (PNG, JPG, WebP, SVG — max 5MB)'}
            </button>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {/* File grid */}
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          ) : files.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-3">No images yet. Upload one above.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
              {files.map(file => (
                <div key={file.name} className="relative group cursor-pointer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={file.url}
                    alt={file.name}
                    onClick={() => { onChange(file.url); setOpen(false) }}
                    className={`w-full h-16 object-cover rounded border transition-colors ${value === file.url ? 'border-blue-500' : 'border-gray-600 hover:border-gray-400'}`}
                  />
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(file.name) }}
                    className="absolute top-0.5 right-0.5 p-0.5 bg-black/70 rounded opacity-0 group-hover:opacity-100 transition-opacity text-red-400"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                  <p className="text-xs text-gray-500 truncate mt-0.5 text-center">{file.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
