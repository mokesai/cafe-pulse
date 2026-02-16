import { requirePlatformAdmin } from '@/lib/platform/auth';
import { createServiceClient } from '@/lib/supabase/server';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import type { Tenant } from '@/lib/tenant/types';
import { notFound } from 'next/navigation';
import { StatusManager } from './StatusManager';

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  await requirePlatformAdmin();

  const { tenantId } = await params;
  const supabase = createServiceClient();

  // Fetch tenant
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single();

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
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h2 className="text-lg font-semibold mb-4">Square Configuration</h2>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-gray-500">Environment</dt>
            <dd className="font-medium capitalize">{tenant.square_environment || 'Not configured'}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Merchant ID</dt>
            <dd className="font-mono text-sm">{tenant.square_merchant_id || 'N/A'}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Location ID</dt>
            <dd className="font-mono text-sm">{tenant.square_location_id || 'N/A'}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Token Expires</dt>
            <dd>
              {tenant.square_token_expires_at
                ? new Date(tenant.square_token_expires_at).toLocaleDateString()
                : 'N/A'}
            </dd>
          </div>
        </dl>
      </div>

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
