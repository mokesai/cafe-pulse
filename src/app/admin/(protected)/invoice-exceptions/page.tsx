import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const ExceptionQueueTable = dynamic(
  () => import('@/components/admin/invoice-exceptions/ExceptionQueueTable').then(mod => mod.ExceptionQueueTable),
  { loading: () => <div className="animate-pulse space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-200 rounded-lg" />)}</div>, ssr: false }
)

export const metadata = {
  title: 'Invoice Exceptions',
}

export default function AdminInvoiceExceptionsPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Invoice Exceptions</h1>
        <p className="text-sm text-gray-500 mt-1">Review and resolve exceptions from the invoice pipeline.</p>
      </div>

      <Suspense fallback={<div className="animate-pulse h-16 bg-gray-200 rounded-lg" />}>
        <ExceptionQueueTable />
      </Suspense>
    </div>
  )
}
