import { ExceptionQueuePageClient } from '@/components/admin/invoice-exceptions/ExceptionQueuePageClient'

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

      <ExceptionQueuePageClient />
    </div>
  )
}
