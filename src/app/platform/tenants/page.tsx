import { requirePlatformAdmin } from '@/lib/platform/auth'
import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import Badge from '@/components/ui/Badge'
import type { Tenant, TenantStatus } from '@/lib/tenant/types'

function getStatusBadgeVariant(status: TenantStatus): 'default' | 'secondary' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'trial':
      return 'default' // blue
    case 'active':
      return 'success' // green
    case 'paused':
      return 'warning' // yellow
    case 'suspended':
      return 'danger' // red
    case 'deleted':
      return 'secondary' // gray
    default:
      return 'default'
  }
}

export default async function TenantsListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string }>
}) {
  // Verify platform admin authentication
  await requirePlatformAdmin()

  // Use service client to bypass RLS and see all tenants
  const supabase = createServiceClient()

  // Await searchParams
  const params = await searchParams

  // Build query with filters
  let query = supabase
    .from('tenants')
    .select('id, slug, name, status, created_at, trial_expires_at')
    .is('deleted_at', null)

  // Search filter
  if (params.q) {
    query = query.or(`slug.ilike.%${params.q}%,name.ilike.%${params.q}%`)
  }

  // Sort
  const sortField = params.sort === 'status' ? 'status' : 'created_at'
  query = query.order(sortField, { ascending: false })
  
  const { data: tenants, error } = await query
  
  if (error) {
    console.error('Error fetching tenants:', error)
  }
  
  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">All Tenants</h1>
          <p className="text-gray-600 mt-2">
            {tenants?.length ?? 0} tenant{tenants?.length !== 1 ? 's' : ''} found
          </p>
        </div>
        <Link
          href="/platform/tenants/new"
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          Onboard New Tenant
        </Link>
      </div>
      
      {/* Search and Sort */}
      <div className="mb-6 bg-white p-4 rounded-lg shadow">
        <form className="flex gap-4">
          <div className="flex-1">
            <input
              type="text"
              name="q"
              placeholder="Search by name or slug..."
              defaultValue={params.q}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="w-48">
            <select
              name="sort"
              defaultValue={params.sort ?? 'created_at'}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="created_at">Created Date</option>
              <option value="status">Status</option>
            </select>
          </div>
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Search
          </button>
        </form>
      </div>
      
      {/* Tenant Table */}
      {tenants && tenants.length > 0 ? (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Trial Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <Link
                      href={`/platform/tenants/${tenant.id}`}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      {tenant.slug}
                    </Link>
                  </TableCell>
                  <TableCell className="font-semibold">{tenant.name}</TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(tenant.status)} size="sm">
                      {tenant.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(tenant.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {tenant.status === 'trial' && tenant.trial_expires_at
                      ? new Date(tenant.trial_expires_at).toLocaleDateString()
                      : 'N/A'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/platform/tenants/${tenant.id}`}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-600">
            {params.q
              ? `No tenants found matching "${params.q}"`
              : 'No tenants found'}
          </p>
        </div>
      )}
    </div>
  )
}
