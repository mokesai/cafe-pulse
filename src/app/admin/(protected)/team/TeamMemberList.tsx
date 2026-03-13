'use client'

import { useState } from 'react'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { changeTeamMemberRole, removeTeamMember } from './actions'

type Member = {
  id: string
  email: string
  role: string
  created_at: string
  isCurrentUser: boolean
}

type PendingInvite = {
  id: string
  invited_email: string
  role: string
  invited_at: string
}

function getRoleVariant(role: string): 'success' | 'info' | 'secondary' | 'default' {
  const variants: Record<string, 'success' | 'info' | 'secondary'> = {
    owner: 'success',
    admin: 'info',
    staff: 'secondary',
  }
  return variants[role] || 'default'
}

export function TeamMemberList({
  members,
  pendingInvites,
  callerRole,
}: {
  members: Member[]
  pendingInvites: PendingInvite[]
  callerRole: 'owner' | 'admin' | 'staff'
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; message: string; type: 'success' | 'error' } | null>(null)

  const isOwner = callerRole === 'owner'

  const handleRoleChange = async (membershipId: string, newRole: string) => {
    setActionLoading(membershipId)
    setFeedback(null)
    const result = await changeTeamMemberRole(membershipId, newRole)
    setActionLoading(null)
    if (result.success) {
      setFeedback({ id: membershipId, message: result.message || 'Updated', type: 'success' })
    } else {
      setFeedback({ id: membershipId, message: result.error || 'Failed', type: 'error' })
    }
  }

  const handleRemove = async (membershipId: string, email: string) => {
    if (!confirm(`Remove ${email} from the team?`)) return
    setActionLoading(membershipId)
    setFeedback(null)
    const result = await removeTeamMember(membershipId)
    setActionLoading(null)
    if (result.success) {
      setFeedback({ id: membershipId, message: result.message || 'Removed', type: 'success' })
    } else {
      setFeedback({ id: membershipId, message: result.error || 'Failed', type: 'error' })
    }
  }

  return (
    <>
      {/* Active Members */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Email</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Role</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Joined</th>
              {isOwner && (
                <th className="text-right py-3 px-4 text-gray-500 font-medium">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className="border-t border-gray-100">
                <td className="py-3 px-4">
                  {member.email}
                  {member.isCurrentUser && (
                    <span className="ml-2 text-xs text-gray-400">(you)</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <Badge size="xs" variant={getRoleVariant(member.role)}>
                    {member.role}
                  </Badge>
                </td>
                <td className="py-3 px-4 text-gray-500">
                  {new Date(member.created_at).toLocaleDateString()}
                </td>
                {isOwner && (
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Role change dropdown */}
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        disabled={actionLoading === member.id}
                        className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="staff">Staff</option>
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRemove(member.id, member.email)}
                        disabled={actionLoading === member.id}
                        isLoading={actionLoading === member.id}
                      >
                        Remove
                      </Button>
                    </div>
                    {feedback?.id === member.id && (
                      <p className={`text-xs mt-1 ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                        {feedback.message}
                      </p>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={isOwner ? 4 : 3} className="py-8 text-center text-gray-500">
                  No team members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mt-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">Pending Invites</h2>
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-sm">{invite.invited_email}</span>
                  <Badge size="xs" variant="warning">{invite.role}</Badge>
                </div>
                <span className="text-xs text-gray-400">
                  invited {new Date(invite.invited_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
