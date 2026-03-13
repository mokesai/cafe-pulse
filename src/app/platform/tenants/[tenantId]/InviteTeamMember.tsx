'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { inviteTeamMember } from '../actions';
import type { PlatformAdminRole } from '@/lib/platform/auth';

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'staff', label: 'Staff' },
];

export function InviteTeamMember({
  tenantId,
  callerRole,
}: {
  tenantId: string;
  callerRole: PlatformAdminRole;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('admin');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  // tenant_admin can only invite admin and staff, super_admin can invite any role
  const allowedRoles = callerRole === 'super_admin'
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((r) => r.value !== 'owner');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setMessage('');

    const result = await inviteTeamMember(tenantId, email, role);

    if (result.success) {
      setStatus('sent');
      setMessage(result.message || 'Invite sent successfully');
      setEmail('');
    } else {
      setStatus('error');
      setMessage(result.error || 'Failed to send invite');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="flex-1">
        <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700 mb-1">
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setStatus('idle'); }}
          placeholder="team@example.com"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
        />
      </div>
      <div>
        <label htmlFor="invite-role" className="block text-sm font-medium text-gray-700 mb-1">
          Role
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
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
  );
}
