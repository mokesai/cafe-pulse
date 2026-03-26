import { InvoicePipelineSettingsPageClient } from '@/components/admin/settings/InvoicePipelineSettingsPageClient'

export default function InvoicePipelineSettingsPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="mb-8">
        <nav className="text-sm text-gray-500 mb-2">
          <a href="/admin/settings" className="hover:text-gray-700 transition-colors">
            Settings
          </a>
          <span className="mx-2">›</span>
          <span className="text-gray-900 font-medium">Invoice Pipeline</span>
        </nav>
        <h1 className="text-3xl font-bold text-gray-900">Invoice Pipeline Settings</h1>
        <p className="text-gray-600 mt-2">
          Configure how the agentic invoice pipeline handles matching, thresholds, and exceptions.
        </p>
      </div>

      <InvoicePipelineSettingsPageClient />
    </div>
  )
}
