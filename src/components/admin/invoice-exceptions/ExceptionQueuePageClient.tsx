'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const ExceptionQueueTable = dynamic(
  () => import('@/components/admin/invoice-exceptions/ExceptionQueueTable').then(mod => mod.ExceptionQueueTable),
  {
    loading: () => (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 bg-gray-200 rounded-lg" />
        ))}
      </div>
    ),
    ssr: false,
  }
)

export function ExceptionQueuePageClient() {
  return (
    <Suspense fallback={<div className="animate-pulse h-16 bg-gray-200 rounded-lg" />}>
      <ExceptionQueueTable />
    </Suspense>
  )
}
