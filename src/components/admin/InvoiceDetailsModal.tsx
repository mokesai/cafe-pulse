'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { 
  X, 
  FileText, 
  Calendar, 
  DollarSign, 
  Package, 
  Building, 
  Clock, 
  CheckCircle,
  AlertCircle,
  Download,
  Eye,
  Activity,
  Info
} from 'lucide-react'
import { Invoice } from '@/types/invoice'
import { InvoiceException } from '@/types/invoice-exceptions'
import { PipelineProgressBar } from './invoices/PipelineProgressBar'
import { PipelineRunningPanel } from './invoices/PipelineRunningPanel'
import { PipelineErrorPanel } from './invoices/PipelineErrorPanel'
import { InvoiceExceptionsPanel } from './invoices/InvoiceExceptionsPanel'
import { AutoConfirmedPanel } from './invoices/AutoConfirmedPanel'

// Pipeline stages that indicate active/in-progress processing
const IN_PROGRESS_PIPELINE_STAGES = new Set([
  'extracting',
  'resolving_supplier',
  'matching_po',
  'matching_items',
  'confirming',
])

interface InvoiceItem {
  id: string
  item_description: string
  supplier_item_code?: string
  quantity: number
  unit_price: number
  total_price: number
  package_size?: string
  unit_type?: string
  matched_item_id?: string
  match_confidence?: number
  match_method?: string
  inventory_items?: {
    id: string
    item_name: string
    current_stock: number
    unit_cost: number
  }
}

interface DetailedInvoice extends Omit<Invoice, 'invoice_items'> {
  invoice_items: InvoiceItem[]
  open_exceptions?: InvoiceException[]
}

interface InvoiceDetailsModalProps {
  invoice: Invoice
  isOpen: boolean
  onClose: () => void
}

export function InvoiceDetailsModal({ invoice, isOpen, onClose }: InvoiceDetailsModalProps) {
  const [detailedInvoice, setDetailedInvoice] = useState<DetailedInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const router = useRouter()

  const loadInvoiceDetails = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const response = await fetch(`/api/admin/invoices/${invoice.id}`)
      const result = await response.json()
      
      if (result.success) {
        setDetailedInvoice(result.data)
      } else {
        console.error('Failed to load invoice details:', result.error)
      }
    } catch (error) {
      console.error('Error loading invoice details:', error)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [invoice.id])

  // Auto-poll every 5s while pipeline is in-progress
  useEffect(() => {
    if (!isOpen || !detailedInvoice) return

    const stage = detailedInvoice.pipeline_stage
    const isInProgress = stage ? IN_PROGRESS_PIPELINE_STAGES.has(stage) : false

    if (isInProgress) {
      pollIntervalRef.current = setInterval(() => {
        void loadInvoiceDetails(true)
      }, 5_000)
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [isOpen, detailedInvoice?.pipeline_stage, loadInvoiceDetails])

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadInvoiceDetails(true)
    setRefreshing(false)
  }, [loadInvoiceDetails])

  useEffect(() => {
    if (isOpen && invoice.id) {
      void loadInvoiceDetails()
    }
  }, [isOpen, invoice.id, loadInvoiceDetails])

  const handleDownload = async () => {
    if (!invoice?.id) return
    try {
      setDownloading(true)
      setDownloadError(null)
      const response = await fetch(`/api/admin/invoices/${invoice.id}/file`)
      const result = await response.json()
      if (!response.ok || !result?.url) {
        throw new Error(result?.error || 'Unable to fetch download URL')
      }
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      console.error('Failed to download invoice file:', error)
      setDownloadError(error instanceof Error ? error.message : 'Failed to download file')
    } finally {
      setDownloading(false)
    }
  }

  if (!isOpen) return null

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'uploaded':
        return <FileText className="w-5 h-5 text-blue-500" />
      case 'parsing':
        return <Clock className="w-5 h-5 text-yellow-500 animate-spin" />
      case 'parsed':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'reviewing':
        return <Eye className="w-5 h-5 text-orange-500" />
      case 'matched':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'confirmed':
        return <CheckCircle className="w-5 h-5 text-green-600" />
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      default:
        return <FileText className="w-5 h-5 text-gray-500" />
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'uploaded': return 'Uploaded'
      case 'parsing': return 'Parsing...'
      case 'parsed': return 'Parsed'
      case 'reviewing': return 'Under Review'
      case 'matched': return 'Matched'
      case 'confirmed': return 'Confirmed'
      case 'error': return 'Error'
      default: return status
    }
  }

  const getMatchStatusBadge = (item: InvoiceItem) => {
    if (!item.matched_item_id) {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">Unmatched</span>
    }
    
    if (item.match_method === 'skipped') {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Skipped</span>
    }
    
    if (item.match_method === 'manual_create') {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Created</span>
    }

    const confidence = item.match_confidence || 0
    if (confidence >= 0.8) {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">High Match</span>
    } else if (confidence >= 0.6) {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Medium Match</span>
    } else {
      return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">Low Match</span>
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-5 border w-11/12 max-w-6xl shadow-lg rounded-md bg-white">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center">
              {getStatusIcon(invoice.status)}
              <span className="ml-3">Invoice Details</span>
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {invoice.invoice_number} • {invoice.suppliers?.name || 'Unknown Supplier'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Clock className="w-8 h-8 animate-spin text-indigo-600" />
            <span className="ml-3 text-lg">Loading invoice details...</span>
          </div>
        ) : detailedInvoice ? (
          <div className="space-y-6">
            {/* Pipeline Progress Indicator — shown whenever pipeline data is present */}
            {detailedInvoice.pipeline_stage !== undefined && (
              <div className="space-y-3">
                <PipelineProgressBar
                  pipelineStage={detailedInvoice.pipeline_stage}
                  status={detailedInvoice.status}
                  pipelineStartedAt={detailedInvoice.pipeline_started_at}
                  pipelineCompletedAt={detailedInvoice.pipeline_completed_at}
                  pipelineError={detailedInvoice.pipeline_error}
                />

                {/* Contextual panel based on current pipeline state */}
                {(() => {
                  const stage = detailedInvoice.pipeline_stage
                  const status = detailedInvoice.status

                  // Error state
                  if (stage === 'failed' || status === 'error') {
                    return (
                      <PipelineErrorPanel
                        invoiceId={detailedInvoice.id}
                        pipelineError={detailedInvoice.pipeline_error}
                        pipelineStage={stage}
                        onRetrySuccess={() => void loadInvoiceDetails(true)}
                        onViewExceptions={() => {
                          onClose()
                          router.push(`/admin/invoice-exceptions?invoice_id=${detailedInvoice.id}`)
                        }}
                      />
                    )
                  }

                  // In-progress state
                  if (stage && IN_PROGRESS_PIPELINE_STAGES.has(stage)) {
                    return (
                      <PipelineRunningPanel
                        pipelineStage={stage}
                        onRefresh={() => void handleManualRefresh()}
                        refreshing={refreshing}
                      />
                    )
                  }

                  // Pending exceptions state
                  if (status === 'pending_exceptions' && (detailedInvoice.open_exceptions?.length ?? 0) > 0) {
                    return (
                      <InvoiceExceptionsPanel
                        invoiceId={detailedInvoice.id}
                        exceptions={detailedInvoice.open_exceptions!}
                        openCount={detailedInvoice.open_exception_count ?? detailedInvoice.open_exceptions!.length}
                      />
                    )
                  }

                  // Confirmed / auto-confirmed state
                  if (stage === 'completed' || status === 'confirmed') {
                    return (
                      <AutoConfirmedPanel
                        pipelineCompletedAt={detailedInvoice.pipeline_completed_at}
                      />
                    )
                  }

                  return null
                })()}
              </div>
            )}

            {/* Invoice Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center">
                  <Calendar className="w-5 h-5 text-gray-400" />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-500">Invoice Date</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {new Date(detailedInvoice.invoice_date).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center">
                  <DollarSign className="w-5 h-5 text-gray-400" />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-500">Total Amount</p>
                    <p className="text-lg font-semibold text-gray-900">
                      ${detailedInvoice.total_amount.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center">
                  <Package className="w-5 h-5 text-gray-400" />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-500">Line Items</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {detailedInvoice.invoice_items?.length || 0}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center">
                  <div className="w-5 h-5 flex items-center justify-center">
                    {getStatusIcon(detailedInvoice.status)}
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-500">Status</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {getStatusText(detailedInvoice.status)}
                    </p>
                    {detailedInvoice.pipeline_stage && (
                      <p className="text-xs text-gray-400 mt-0.5 capitalize">
                        Stage: {detailedInvoice.pipeline_stage.replace(/_/g, ' ')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Supplier Information */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Building className="w-5 h-5 mr-2" />
                Supplier Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-500">Supplier Name</p>
                  <p className="text-base text-gray-900">{detailedInvoice.suppliers?.name || 'Not specified'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">File Type</p>
                  <p className="text-base text-gray-900">{detailedInvoice.file_type || 'Unknown'}</p>
                </div>
              </div>
              {detailedInvoice.parsing_confidence && (
                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-500">AI Parsing Confidence</p>
                  <p className="text-base text-gray-900">{Math.round(detailedInvoice.parsing_confidence * 100)}%</p>
                </div>
              )}
            </div>

            {/* Text Extraction Insights */}
            {detailedInvoice.text_analysis && (
              <div className="bg-white border border-indigo-100 rounded-lg p-6">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-medium text-gray-900 flex items-center">
                    <Activity className="w-5 h-5 mr-2 text-indigo-500" />
                    Text Extraction Insights
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {detailedInvoice.text_analysis.needs_ocr && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                        Needs OCR Review
                      </span>
                    )}
                    {detailedInvoice.text_analysis.needs_manual_review && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">
                        Manual Review Required
                      </span>
                    )}
                    {detailedInvoice.text_analysis.validation_confidence !== undefined && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800">
                        Confidence {Math.round(detailedInvoice.text_analysis.validation_confidence * 100)}%
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Extraction Method</p>
                    <p className="text-base text-gray-900">
                      {detailedInvoice.text_analysis.extraction_method
                        ? detailedInvoice.text_analysis.extraction_method.replace(/-/g, ' ')
                        : 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Text Length</p>
                    <p className="text-base text-gray-900">
                      {detailedInvoice.text_analysis.text_length?.toLocaleString() || 'N/A'} chars
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Line Items Detected</p>
                    <p className="text-base text-gray-900">
                      {detailedInvoice.text_analysis.line_item_candidates ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Pages Processed</p>
                    <p className="text-base text-gray-900">
                      {detailedInvoice.text_analysis.page_count ?? '—'}
                    </p>
                  </div>
                </div>

                {(detailedInvoice.text_analysis.warnings?.length || 0) > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-red-700 flex items-center">
                      <AlertCircle className="w-4 h-4 mr-2" />
                      Warnings
                    </p>
                    <ul className="mt-2 text-sm text-red-700 space-y-1 list-disc pl-5">
                      {detailedInvoice.text_analysis.warnings!.map((warning, index) => (
                        <li key={`warning-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(detailedInvoice.text_analysis.indicators?.length || 0) > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-600 flex items-center">
                      <Info className="w-4 h-4 mr-2" />
                      Detected Signals
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {detailedInvoice.text_analysis.indicators!.map((indicator, index) => (
                        <span
                          key={`indicator-${index}`}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700"
                        >
                          {indicator}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Line Items — skeleton when pipeline is still extracting/matching */}
            {detailedInvoice.pipeline_stage && IN_PROGRESS_PIPELINE_STAGES.has(detailedInvoice.pipeline_stage) &&
              (detailedInvoice.invoice_items?.length ?? 0) === 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-6" aria-label="Loading line items…">
                <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                  <Package className="w-5 h-5 mr-2" />
                  Line Items
                </h3>
                <div className="space-y-3 animate-pulse">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-10 bg-gray-200 rounded" />
                  ))}
                </div>
              </div>
            )}

            {/* Line Items */}
            {detailedInvoice.invoice_items && detailedInvoice.invoice_items.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                  <Package className="w-5 h-5 mr-2" />
                  Line Items ({detailedInvoice.invoice_items.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Description
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Quantity
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Unit Price
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Total
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Match Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {detailedInvoice.invoice_items.map((item) => (
                        <tr key={item.id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {item.item_description}
                              </div>
                              {item.supplier_item_code && (
                                <div className="text-sm text-gray-500">
                                  Code: {item.supplier_item_code}
                                </div>
                              )}
                              {item.package_size && (
                                <div className="text-sm text-gray-500">
                                  Package: {item.package_size}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.quantity} {item.unit_type || 'each'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ${item.unit_price.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            ${item.total_price.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="space-y-1">
                              {getMatchStatusBadge(item)}
                              {item.inventory_items && (
                                <div className="text-xs text-gray-500">
                                  → {item.inventory_items.item_name}
                                </div>
                              )}
                              {item.match_confidence && (
                                <div className="text-xs text-gray-500">
                                  {Math.round(item.match_confidence * 100)}% confidence
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Actions */}
            {downloadError && (
              <p className="text-sm text-red-600 mb-2">{downloadError}</p>
            )}

            <div className="flex justify-end space-x-3">
              {detailedInvoice.file_url && (
                <button
                  onClick={() => { void handleDownload() }}
                  disabled={downloading}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-60"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {downloading ? 'Preparing...' : 'Download File'}
                </button>
              )}
              <button
                onClick={onClose}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-20">
            <AlertCircle className="mx-auto h-12 w-12 text-red-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">Failed to load invoice details</h3>
            <p className="mt-1 text-sm text-gray-500">Please try again later.</p>
          </div>
        )}
      </div>
    </div>
  )
}
