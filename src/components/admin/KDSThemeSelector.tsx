'use client'

import { useState } from 'react'
import type { KDSTheme } from '@/lib/kds/types'
import { KDS_THEMES } from '@/lib/kds/types'

interface ThemeOption {
  id: KDSTheme
  name: string
  description: string
  colors: {
    bg: string
    header: string
    text: string
    accent: string
  }
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'warm',
    name: 'Warm',
    description: 'Cafe chalkboard aesthetic with wood texture',
    colors: {
      bg: '#8b6847',
      header: '#c4a87c',
      text: '#3d2b1f',
      accent: '#6b4423',
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Sleek dark display with gold accents',
    colors: {
      bg: '#121212',
      header: '#0a0a0a',
      text: '#ffffff',
      accent: '#c9a961',
    },
  },
  {
    id: 'wps',
    name: 'WPS',
    description: 'Clean Starbucks-inspired green on white',
    colors: {
      bg: '#F8F9FA',
      header: '#00704A',
      text: '#1E3932',
      accent: '#00704A',
    },
  },
]

interface KDSThemeSelectorProps {
  initialTheme?: KDSTheme
}

export default function KDSThemeSelector({ initialTheme = 'warm' }: KDSThemeSelectorProps) {
  const [activeTheme, setActiveTheme] = useState<KDSTheme>(
    KDS_THEMES.includes(initialTheme) ? initialTheme : 'warm'
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleThemeChange(theme: KDSTheme) {
    if (theme === activeTheme) return

    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/admin/kds/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update theme')
      }

      setActiveTheme(theme)
      setMessage({ type: 'success', text: 'Theme updated successfully' })
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update theme' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-4">
        {THEME_OPTIONS.map((option) => {
          const isActive = activeTheme === option.id
          return (
            <button
              key={option.id}
              onClick={() => handleThemeChange(option.id)}
              disabled={saving}
              className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                isActive
                  ? 'border-blue-500 ring-2 ring-blue-200'
                  : 'border-gray-200 hover:border-gray-300'
              } ${saving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
            >
              {/* Theme preview swatch */}
              <div className="rounded-md overflow-hidden mb-3 border border-gray-200">
                <div
                  className="h-6 flex items-center px-2"
                  style={{ backgroundColor: option.colors.header }}
                >
                  <span className="text-[8px] font-bold text-white truncate">
                    Little Cafe
                  </span>
                </div>
                <div
                  className="h-12 flex items-center justify-center"
                  style={{ backgroundColor: option.colors.bg }}
                >
                  <div className="flex gap-2">
                    <div
                      className="w-8 h-6 rounded-sm opacity-60"
                      style={{ backgroundColor: option.colors.accent }}
                    />
                    <div
                      className="w-8 h-6 rounded-sm opacity-40"
                      style={{ backgroundColor: option.colors.text }}
                    />
                  </div>
                </div>
                <div
                  className="h-3"
                  style={{ backgroundColor: option.colors.header }}
                />
              </div>

              <h4 className="font-semibold text-gray-900 text-sm">
                {option.name}
              </h4>
              <p className="text-xs text-gray-500 mt-0.5">
                {option.description}
              </p>

              {isActive && (
                <div className="absolute top-2 right-2">
                  <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {message && (
        <div className={`mt-3 text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {message.text}
        </div>
      )}
    </div>
  )
}
