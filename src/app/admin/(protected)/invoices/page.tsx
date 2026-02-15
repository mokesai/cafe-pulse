'use client'

import dynamic from 'next/dynamic'

const InvoiceManagement = dynamic(
  () => import('@/components/admin/InvoiceManagement').then(mod => mod.InvoiceManagement),
  {
    loading: () => <div>Loading invoices...</div>,
    ssr: false
  }
)

export default function AdminInvoicesPage() {
  return (
    <div>
      <InvoiceManagement />
    </div>
  )
}