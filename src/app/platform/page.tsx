import { requirePlatformAdmin } from '@/lib/platform/auth'
import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function PlatformDashboardPage() {
  // Verify platform admin authentication
  await requirePlatformAdmin()
  
  // Use service client to bypass RLS and see all tenants
  const supabase = createServiceClient()
  
  // Query tenant statistics
  const { count: totalTenants } = await supabase
    .from('tenants')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
  
  const { count: trialTenants } = await supabase
    .from('tenants')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'trial')
    .is('deleted_at', null)
  
  const { count: activeTenants } = await supabase
    .from('tenants')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .is('deleted_at', null)
  
  const { count: pausedTenants } = await supabase
    .from('tenants')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'paused')
    .is('deleted_at', null)
  
  const { count: suspendedTenants } = await supabase
    .from('tenants')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'suspended')
    .is('deleted_at', null)
  
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Platform Admin Dashboard</h1>
        <p className="text-gray-600 mt-2">
          Manage all tenants and monitor platform health.
        </p>
      </div>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="text-sm font-medium text-gray-600 mb-1">Total Tenants</div>
          <div className="text-3xl font-bold text-gray-900">{totalTenants ?? 0}</div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="text-sm font-medium text-gray-600 mb-1">Active</div>
          <div className="text-3xl font-bold text-green-600">{activeTenants ?? 0}</div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="text-sm font-medium text-gray-600 mb-1">Trial</div>
          <div className="text-3xl font-bold text-blue-600">{trialTenants ?? 0}</div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="text-sm font-medium text-gray-600 mb-1">Paused</div>
          <div className="text-3xl font-bold text-yellow-600">{pausedTenants ?? 0}</div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="text-sm font-medium text-gray-600 mb-1">Suspended</div>
          <div className="text-3xl font-bold text-red-600">{suspendedTenants ?? 0}</div>
        </div>
      </div>
      
      {/* Quick Actions */}
      <div className="bg-white p-6 rounded-lg shadow mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Actions</h2>
        <div className="flex gap-4">
          <Link 
            href="/platform/tenants"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            View All Tenants
          </Link>
          <Link 
            href="/platform/tenants/new"
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            Onboard New Tenant
          </Link>
        </div>
      </div>
      
      {/* Recent Activity Placeholder */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Activity</h2>
        <p className="text-gray-600">Activity log coming in future plans.</p>
      </div>
    </div>
  )
}
