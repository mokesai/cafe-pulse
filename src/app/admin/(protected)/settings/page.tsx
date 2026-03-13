import SiteAvailabilitySettings from '@/components/admin/SiteAvailabilitySettings'
import KDSThemeSelector from '@/components/admin/KDSThemeSelector'
import { getSiteSettings, getSiteStatusUsingServiceClient } from '@/lib/services/siteSettings'
import { getSettings as getKDSSettings } from '@/lib/kds/queries'
import type { KDSTheme } from '@/lib/kds/types'
import { getCurrentTenantId } from '@/lib/tenant/context'

export default async function AdminSettingsPage() {
  const tenantId = await getCurrentTenantId()

  const [initialStatus, initialSettings, kdsSettings] = await Promise.all([
    getSiteStatusUsingServiceClient(tenantId),
    getSiteSettings(tenantId),
    getKDSSettings(tenantId)
  ])

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-2">
          Configure system settings, integrations, and admin preferences.
        </p>
      </div>

      <SiteAvailabilitySettings initialStatus={initialStatus} initialSettings={initialSettings} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Settings */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            System Configuration
          </h3>
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-2">Cafe Information</h4>
              <div className="text-sm text-gray-600 space-y-1">
                <p><strong>Name:</strong> Little Cafe</p>
                <p><strong>Location:</strong> Kaiser Permanente, 10400 E Alameda Ave, Denver, CO</p>
                <p><strong>Hours:</strong> 8AM-6PM, Monday-Friday</p>
              </div>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-2">Tax Configuration</h4>
              <p className="text-sm text-gray-600">Tax rates are managed through Square</p>
            </div>
          </div>
        </div>

        {/* Integration Settings */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
            </svg>
            Integrations
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
              <div>
                <h4 className="font-medium text-green-900">Square</h4>
                <p className="text-sm text-green-700">Payment processing and catalog</p>
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                <span className="text-sm text-green-600">Connected</span>
              </div>
            </div>
            
            <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
              <div>
                <h4 className="font-medium text-green-900">Supabase</h4>
                <p className="text-sm text-green-700">Database and authentication</p>
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                <span className="text-sm text-green-600">Connected</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
              <div>
                <h4 className="font-medium text-green-900">Resend</h4>
                <p className="text-sm text-green-700">Email notifications</p>
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                <span className="text-sm text-green-600">Connected</span>
              </div>
            </div>
          </div>
        </div>

        {/* Admin Users */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
            </svg>
            Admin Users
          </h3>
          <div className="space-y-3">
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="font-medium text-gray-900">jerry.mccommas@gmail.com</p>
              <p className="text-sm text-gray-600">Primary Administrator</p>
            </div>
          </div>
        </div>

        {/* Backup & Maintenance */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            System Maintenance
          </h3>
          <div className="space-y-3">
            <div className="p-3 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-1">Database Status</h4>
              <p className="text-sm text-blue-700">All systems operational</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-1">Last Updated</h4>
              <p className="text-sm text-blue-700">System last updated today</p>
            </div>
          </div>
        </div>
      </div>

      {/* KDS Display Settings */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          KDS Display
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Choose a theme for the Kitchen Display System screens. Changes apply to all KDS displays.
          You can also override the theme per-screen using the <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">?theme=</code> URL parameter.
        </p>
        <KDSThemeSelector initialTheme={(kdsSettings.theme as KDSTheme) ?? 'warm'} />
      </div>

      {/* Coming Soon */}
      <div className="mt-8 bg-gray-50 border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Additional Settings Coming Soon</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
          <ul className="space-y-2">
            <li>• Email template customization</li>
            <li>• Notification preferences</li>
            <li>• Business hours management</li>
          </ul>
          <ul className="space-y-2">
            <li>• User role management</li>
            <li>• API key management</li>
            <li>• Backup and restore tools</li>
            <li>• Security audit logs</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
