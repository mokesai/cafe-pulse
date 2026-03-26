'use client'

import dynamic from 'next/dynamic'

const ExceptionDetailView = dynamic(
  () => import('@/components/admin/invoice-exceptions/ExceptionDetailView').then(mod => mod.ExceptionDetailView),
  {
    loading: () => (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="h-40 bg-gray-200 rounded" />
      </div>
    ),
    ssr: false,
  }
)

interface Props {
  exceptionId: string
}

export function ExceptionDetailPageClient({ exceptionId }: Props) {
  return <ExceptionDetailView exceptionId={exceptionId} />
}
