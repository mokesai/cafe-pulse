import { ExceptionDetailPageClient } from '@/components/admin/invoice-exceptions/ExceptionDetailPageClient'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AdminInvoiceExceptionDetailPage({ params }: Props) {
  const { id } = await params
  return <ExceptionDetailPageClient exceptionId={id} />
}
