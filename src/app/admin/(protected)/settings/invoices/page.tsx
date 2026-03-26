import dynamic from 'next/dynamic'

const InvoicePipelineSettings = dynamic(
  () => import('@/components/admin/settings/InvoicePipelineSettings'),
  {
    loading: () => (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-6" />
        <div className="space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4" />
          <div className="h-10 bg-gray-200 rounded w-full max-w-md" />
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-10 bg-gray-200 rounded" />
            <div className="h-10 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    ),
    ssr: false,
  }
)

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

      <InvoicePipelineSettings />
    </div>
  )
}
