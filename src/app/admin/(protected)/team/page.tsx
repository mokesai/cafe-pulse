import { requireAdmin } from '@/lib/admin/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { TeamMemberList } from './TeamMemberList'
import { InviteForm } from './InviteForm'

export default async function TeamPage() {
  const { user, membership, tenantId } = await requireAdmin()

  const supabase = createServiceClient()

  // Fetch team members and pending invites in parallel
  const [{ data: memberships }, { data: pendingInvites }] = await Promise.all([
    supabase
      .from('tenant_memberships')
      .select('id, user_id, role, created_at')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('role', ['owner', 'admin', 'staff'])
      .order('created_at', { ascending: true }),
    supabase
      .from('tenant_pending_invites')
      .select('id, invited_email, role, invited_at')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('invited_at', { ascending: true }),
  ])

  // Resolve emails from auth.users
  let memberDetails: { id: string; email: string; role: string; created_at: string; isCurrentUser: boolean }[] = []
  if (memberships && memberships.length > 0) {
    const { data: usersData } = await supabase.auth.admin.listUsers()
    const usersMap = new Map(
      usersData?.users?.map(u => [u.id, u.email || 'Unknown']) || []
    )
    memberDetails = memberships.map(m => ({
      id: m.id,
      email: usersMap.get(m.user_id) || 'Unknown',
      role: m.role,
      created_at: m.created_at,
      isCurrentUser: m.user_id === user.id,
    }))
  }

  const callerRole = membership.role as 'owner' | 'admin' | 'staff'
  const canInvite = callerRole === 'owner' || callerRole === 'admin'

  return (
    <div className="max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
      </div>

      {/* Team Member List */}
      <TeamMemberList
        members={memberDetails}
        pendingInvites={pendingInvites || []}
        callerRole={callerRole}
      />

      {/* Invite Form */}
      {canInvite && (
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <h2 className="text-lg font-semibold mb-4">Invite Team Member</h2>
          <InviteForm callerRole={callerRole} />
        </div>
      )}
    </div>
  )
}
