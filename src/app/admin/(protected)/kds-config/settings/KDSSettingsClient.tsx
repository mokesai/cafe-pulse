'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Settings, Shield, RefreshCw, Monitor, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { saveKDSSettings, saveConfigAccessRoles } from './settings-actions'
import type { KDSTheme } from '@/lib/kds/types'

interface KDSSettingsClientProps {
  tenantId: string
  initialSettings: {
    theme: KDSTheme
    drinks_tagline: string
    food_tagline: string
    drinks_subtitle: string
    food_subtitle: string
    cafe_name: string
    header_hours: string
    header_location: string
    refresh_interval: number
    image_rotation_interval: number
  }
  configAccessRoles: string[]
}

const ALL_ROLES = ['owner', 'admin', 'staff'] as const

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-700">
      <Icon className="w-4 h-4 text-blue-400" />
      <h2 className="text-sm font-semibold text-white">{title}</h2>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">{label}</label>
      {children}
    </div>
  )
}

const inputClass = "w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
const selectClass = "w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"

export default function KDSSettingsClient({
  tenantId,
  initialSettings,
  configAccessRoles: initialRoles,
}: KDSSettingsClientProps) {
  const [settings, setSettings] = useState(initialSettings)
  const [accessRoles, setAccessRoles] = useState<string[]>(initialRoles)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function set(key: string, value: string | number) {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  function toggleRole(role: string) {
    if (role === 'owner') return // owner always included
    setAccessRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    )
  }

  function handleSave() {
    startTransition(async () => {
      setMessage(null)
      const [settingsResult, rolesResult] = await Promise.all([
        saveKDSSettings(tenantId, settings as Record<string, string | number | boolean>),
        saveConfigAccessRoles(tenantId, accessRoles),
      ])

      if (settingsResult.success && rolesResult.success) {
        setMessage({ type: 'success', text: 'Settings saved.' })
      } else {
        setMessage({ type: 'error', text: settingsResult.error ?? rolesResult.error ?? 'Save failed' })
      }
    })
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/kds-config" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to KDS Configuration
        </Link>
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-gray-400" />
          <h1 className="text-xl font-bold text-white">KDS Settings</h1>
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg mb-5 text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'}`}>
          {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        {/* Access Permissions */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <SectionHeader icon={Shield} title="Access Permissions" />
          <p className="text-xs text-gray-400 mb-4">Choose which roles can access KDS configuration. Owner always has access.</p>
          <div className="space-y-2">
            {ALL_ROLES.map(role => (
              <label key={role} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={accessRoles.includes(role)}
                  onChange={() => toggleRole(role)}
                  disabled={role === 'owner'}
                  className="w-4 h-4 accent-blue-500 disabled:opacity-50"
                />
                <span className="text-sm text-white capitalize">{role}</span>
                {role === 'owner' && <span className="text-xs text-gray-500">(always)</span>}
              </label>
            ))}
          </div>
        </div>

        {/* Theme */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <SectionHeader icon={Monitor} title="Theme" />
          <Field label="Display theme">
            <select value={settings.theme} onChange={e => set('theme', e.target.value)} className={selectClass}>
              <option value="warm">Warm</option>
              <option value="dark">Dark</option>
              <option value="wps">WPS (Starbucks)</option>
            </select>
          </Field>
        </div>

        {/* Display Settings */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <SectionHeader icon={Monitor} title="Display Settings" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Café name">
              <input type="text" value={settings.cafe_name} onChange={e => set('cafe_name', e.target.value)} className={inputClass} placeholder="The Little Café" />
            </Field>
            <Field label="Hours">
              <input type="text" value={settings.header_hours} onChange={e => set('header_hours', e.target.value)} className={inputClass} placeholder="8AM-6PM Mon-Fri" />
            </Field>
            <Field label="Location">
              <input type="text" value={settings.header_location} onChange={e => set('header_location', e.target.value)} className={inputClass} placeholder="Kaiser Permanente · Denver" />
            </Field>
            <Field label="Drinks tagline">
              <input type="text" value={settings.drinks_tagline} onChange={e => set('drinks_tagline', e.target.value)} className={inputClass} placeholder="Freshly Brewed Every Day" />
            </Field>
            <Field label="Food tagline">
              <input type="text" value={settings.food_tagline} onChange={e => set('food_tagline', e.target.value)} className={inputClass} placeholder="Baked Fresh Daily" />
            </Field>
            <Field label="Drinks subtitle">
              <input type="text" value={settings.drinks_subtitle} onChange={e => set('drinks_subtitle', e.target.value)} className={inputClass} placeholder="Freshly Brewed, Just for You" />
            </Field>
            <Field label="Food subtitle">
              <input type="text" value={settings.food_subtitle} onChange={e => set('food_subtitle', e.target.value)} className={inputClass} />
            </Field>
          </div>
        </div>

        {/* Refresh Settings */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <SectionHeader icon={RefreshCw} title="Refresh Settings" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Screen refresh interval (ms)">
              <input
                type="number" min={30000} step={10000}
                value={settings.refresh_interval}
                onChange={e => set('refresh_interval', parseInt(e.target.value) || 300000)}
                className={inputClass}
              />
              <p className="text-xs text-gray-500 mt-1">{Math.round(settings.refresh_interval / 1000)}s — how often live screens reload</p>
            </Field>
            <Field label="Image rotation interval (ms)">
              <input
                type="number" min={1000} step={1000}
                value={settings.image_rotation_interval}
                onChange={e => set('image_rotation_interval', parseInt(e.target.value) || 6000)}
                className={inputClass}
              />
              <p className="text-xs text-gray-500 mt-1">{Math.round(settings.image_rotation_interval / 1000)}s — footer image cycle speed</p>
            </Field>
          </div>
        </div>

        {/* Save */}
        <button onClick={handleSave} disabled={isPending}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          Save Settings
        </button>
      </div>
    </div>
  )
}
