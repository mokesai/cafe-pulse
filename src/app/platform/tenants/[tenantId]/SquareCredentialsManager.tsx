'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { connectSquareCredentials } from '../actions'

interface SquareCredentialsManagerProps {
  tenantId: string
  squareEnvironment: string
  currentApplicationId: string | null
  currentLocationId: string | null
  currentMerchantId: string | null
}

export function SquareCredentialsManager({
  tenantId,
  squareEnvironment,
  currentApplicationId,
  currentLocationId,
  currentMerchantId,
}: SquareCredentialsManagerProps) {
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const isSandbox = squareEnvironment === 'sandbox'
  const isConfigured = !!currentApplicationId && !!currentLocationId
  const envLabel = isSandbox ? 'Sandbox' : 'Production'

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setStatus('saving')
    setError(null)
    const formData = new FormData(e.currentTarget)
    const result = await connectSquareCredentials(tenantId, formData)
    if (result.success) {
      setStatus('saved')
      setEditing(false)
    } else {
      setStatus('error')
      setError(result.errors?._form?.[0] ?? 'Failed to save credentials')
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Square Configuration</h2>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${isSandbox ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
            {envLabel}
          </span>
        </div>
        {!editing && (
          <Button variant="outline" size="sm" onClick={() => { setEditing(true); setStatus('idle') }}>
            {isConfigured ? 'Edit Credentials' : 'Connect Square'}
          </Button>
        )}
      </div>

      {status === 'saved' && (
        <div className="flex items-center gap-2 text-green-700 mb-4 text-sm bg-green-50 rounded-md p-3">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{envLabel} credentials saved successfully</span>
        </div>
      )}

      {!editing ? (
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-gray-500">Application ID</dt>
            <dd className="font-mono text-sm">{currentApplicationId || <span className="text-gray-400">Not configured</span>}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Location ID</dt>
            <dd className="font-mono text-sm">{currentLocationId || <span className="text-gray-400">Not configured</span>}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Merchant ID</dt>
            <dd className="font-mono text-sm">{currentMerchantId || <span className="text-gray-400">N/A</span>}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Access Token</dt>
            <dd className="text-sm">{isConfigured ? <span className="text-green-600">Stored in Vault</span> : <span className="text-gray-400">Not configured</span>}</dd>
          </div>
        </dl>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-sm text-gray-600 mb-3">
            Enter {envLabel.toLowerCase()} credentials from your{' '}
            <a
              href={isSandbox ? 'https://developer.squareup.com/apps' : 'https://developer.squareup.com/apps'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              Square Developer Dashboard
            </a>
            {isSandbox && ' (Sandbox tab)'}.
          </p>
          <div>
            <label htmlFor="application_id" className="block text-sm font-medium text-gray-700 mb-1">
              {envLabel} Application ID
            </label>
            <Input
              id="application_id"
              name="application_id"
              placeholder={isSandbox ? 'sandbox-sq0idb-...' : 'sq0idb-...'}
              defaultValue={currentApplicationId || ''}
              required
            />
          </div>
          <div>
            <label htmlFor="access_token" className="block text-sm font-medium text-gray-700 mb-1">
              {envLabel} Access Token
            </label>
            <Input
              id="access_token"
              name="access_token"
              placeholder="EAAAl..."
              required
            />
            <p className="text-xs text-gray-500 mt-1">Token is stored encrypted in Vault. Previous token will be overwritten.</p>
          </div>
          <div>
            <label htmlFor="location_id" className="block text-sm font-medium text-gray-700 mb-1">
              {envLabel} Location ID
            </label>
            <Input
              id="location_id"
              name="location_id"
              placeholder="L..."
              defaultValue={currentLocationId || ''}
              required
            />
          </div>
          {status === 'error' && error && (
            <p className="text-red-600 text-sm">{error}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" isLoading={status === 'saving'} size="sm">
              Save {envLabel} Credentials
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(false); setStatus('idle') }}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
