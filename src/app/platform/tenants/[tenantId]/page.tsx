import { requirePlatformAdmin } from '@/lib/platform/auth';
import { createServiceClient } from '@/lib/supabase/server';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { notFound } from 'next/navigation';
import { StatusManager } from './StatusManager';
import { ResendInviteButton } from './ResendInviteButton';
import { SquareCredentialsManager } from './SquareCredentialsManager';
import { InviteTeamMember } from './InviteTeamMember';

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { admin } = await requirePlatformAdmin();

  const { tenantId } = await params;
  const supabase = createServiceClient();

  // Fetch tenant, memberships, and pending invites in parallel
  const [{ data: tenant, error }, { data: memberships }, { data: pendingInvites }] = await Promise.all([
    supabase.from('tenants').select('*').eq('id', tenantId).single(),
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
  ]);

  // Resolve user emails for memberships
  let memberDetails: { id: string; email: string; role: string; created_at: string }[] = [];
  if (memberships && memberships.length > 0) {
    const { data: usersData } = await supabase.auth.admin.listUsers();
    const usersMap = new Map(
      usersData?.users?.map(u => [u.id, u.email || 'Unknown']) || []
    );
    memberDetails = memberships.map(m => ({
      id: m.id,
      email: usersMap.get(m.user_id) || 'Unknown',
      role: m.role,
      created_at: m.created_at,
    }));
  }

  if (error || !tenant) {
    notFound();
  }

  return (
    <div className="max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{tenant.name}</h1>
        <div className="space-x-2">
          <Link href={`/platform/tenants/${tenant.id}/edit`}>
            <Button>Edit Tenant</Button>
          </Link>
          <Link href="/platform/tenants">
            <Button variant="outline">Back to List</Button>
          </Link>
        </div>
      </div>

      {/* Status and Basic Info */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h2 className="text-lg font-semibold mb-4">Basic Information</h2>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-gray-500">Slug</dt>
            <dd className="font-medium">{tenant.slug}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Status</dt>
            <dd>
              <Badge variant={getStatusVariant(tenant.status)}>
                {tenant.status}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Active</dt>
            <dd>{tenant.is_active ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Created</dt>
            <dd>{new Date(tenant.created_at).toLocaleDateString()}</dd>
          </div>
          {tenant.status === 'trial' && tenant.trial_expires_at && (
            <div>
              <dt className="text-sm text-gray-500">Trial Expires</dt>
              <dd>{new Date(tenant.trial_expires_at).toLocaleDateString()}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Square Configuration */}
      <SquareCredentialsManager
        tenantId={tenant.id}
        squareEnvironment={process.env.SQUARE_ENVIRONMENT || 'sandbox'}
        currentApplicationId={tenant.square_application_id}
        currentLocationId={tenant.square_location_id}
        currentMerchantId={tenant.square_merchant_id}
      />

      {/* Branding */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h2 className="text-lg font-semibold mb-4">Branding</h2>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-gray-500">Logo URL</dt>
            <dd className="text-sm break-all">{tenant.logo_url || 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Primary Color</dt>
            <dd className="flex items-center gap-2">
              {tenant.primary_color && (
                <div
                  className="w-6 h-6 rounded border"
                  style={{ backgroundColor: tenant.primary_color }}
                />
              )}
              <span>{tenant.primary_color || 'Not set'}</span>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Secondary Color</dt>
            <dd className="flex items-center gap-2">
              {tenant.secondary_color && (
                <div
                  className="w-6 h-6 rounded border"
                  style={{ backgroundColor: tenant.secondary_color }}
                />
              )}
              <span>{tenant.secondary_color || 'Not set'}</span>
            </dd>
          </div>
        </dl>
      </div>

      {/* Team Members */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h2 className="text-lg font-semibold mb-4">Team Members</h2>

        {memberDetails.length > 0 ? (
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-gray-500 font-medium">Email</th>
                <th className="text-left py-2 text-gray-500 font-medium">Role</th>
                <th className="text-left py-2 text-gray-500 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {memberDetails.map((member) => (
                <tr key={member.id} className="border-b border-gray-100">
                  <td className="py-2">{member.email}</td>
                  <td className="py-2">
                    <Badge size="xs" variant={getRoleVariant(member.role)}>
                      {member.role}
                    </Badge>
                  </td>
                  <td className="py-2 text-gray-500">
                    {new Date(member.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500 mb-6">No team members yet.</p>
        )}

        {/* Pending Invites */}
        {pendingInvites && pendingInvites.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Pending Invites</h3>
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-sm">{invite.invited_email}</span>
                  <Badge size="xs" variant="warning">{invite.role}</Badge>
                  <span className="text-xs text-gray-400">
                    invited {new Date(invite.invited_at).toLocaleDateString()}
                  </span>
                </div>
                <ResendInviteButton tenantId={tenant.id} inviteId={invite.id} />
              </div>
            ))}
          </div>
        )}

        {/* Invite Form */}
        <div className="pt-4 border-t border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Invite Team Member</h3>
          <InviteTeamMember tenantId={tenant.id} callerRole={admin.role} />
        </div>
      </div>

      {/* Lifecycle Management */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Lifecycle Management</h2>
        <StatusManager
          tenantId={tenant.id}
          currentStatus={tenant.status}
          isDeleted={!!tenant.deleted_at}
        />
      </div>
    </div>
  );
}

function getRoleVariant(role: string): 'default' | 'success' | 'warning' | 'danger' | 'secondary' | 'info' {
  const variants: Record<string, 'default' | 'success' | 'info' | 'secondary'> = {
    owner: 'success',
    admin: 'info',
    staff: 'secondary',
  };
  return variants[role] || 'default';
}

function getStatusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' | 'secondary' {
  const variants: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'secondary'> = {
    trial: 'default',
    active: 'success',
    paused: 'warning',
    suspended: 'danger',
    deleted: 'secondary',
  };
  return variants[status] || 'default';
}
