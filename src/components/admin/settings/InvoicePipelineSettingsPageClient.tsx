'use client'

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

export function InvoicePipelineSettingsPageClient() {
  return <InvoicePipelineSettings />
}
