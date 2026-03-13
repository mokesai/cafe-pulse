'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import { inviteAppTeamMember } from './actions'

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'staff', label: 'Staff' },
]

export function InviteForm({ callerRole }: { callerRole: 'owner' | 'admin' }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('staff')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  // admin can only invite staff
  const allowedRoles = callerRole === 'owner'
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter(r => r.value === 'staff')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    setMessage('')

    const result = await inviteAppTeamMember(email, role)

    if (result.success) {
      setStatus('sent')
      setMessage(result.message || 'Invite sent')
      setEmail('')
    } else {
      setStatus('error')
      setMessage(result.error || 'Failed to send invite')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="flex-1">
        <label htmlFor="team-invite-email" className="block text-sm font-medium text-gray-700 mb-1">
          Email
        </label>
        <input
          id="team-invite-email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setStatus('idle') }}
          placeholder="team@example.com"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>
      <div>
        <label htmlFor="team-invite-role" className="block text-sm font-medium text-gray-700 mb-1">
          Role
        </label>
        <select
          id="team-invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          {allowedRoles.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      <Button
        type="submit"
        size="sm"
        isLoading={status === 'sending'}
        disabled={status === 'sending' || !email}
      >
        Invite
      </Button>
      {message && (
        <span className={`text-sm ${status === 'sent' ? 'text-green-600' : 'text-red-600'}`}>
          {message}
        </span>
      )}
    </form>
  )
}
