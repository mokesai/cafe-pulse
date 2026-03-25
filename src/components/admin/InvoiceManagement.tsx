'use client'

import { useState, useEffect, useCallback } from 'react'
import { Upload, FileText, Clock, CheckCircle, AlertCircle, Plus, Eye } from 'lucide-react'
import Link from 'next/link'
import { Invoice } from '@/types/invoice'
import { InvoiceReviewInterface } from './InvoiceReviewInterface'
import { InvoiceUploadModal } from './InvoiceUploadModal'
import { InvoiceDetailsModal } from './InvoiceDetailsModal'
import { PipelineStatusBadge } from './invoices/PipelineStatusBadge'

// Pipeline stages that indicate active/in-progress processing
const IN_PROGRESS_STAGES = new Set([
  'extracting',
  'resolving_supplier',
  'matching_po',
  'matching_items',
  'confirming',
])

interface Supplier {
  id: string
  name: string
  is_active: boolean
}

interface InvoicesListProps {
  invoices: Invoice[]
  loading: boolean
  parsing: string | null
  onReviewInvoice: (invoice: Invoice) => void
  onParseInvoice: (invoiceId: string) => void
  onViewDetails: (invoice: Invoice) => void
}

type TextQueue = 'all' | 'needs-ocr' | 'manual-review' | 'high-confidence' | 'ready-to-match'

function InvoicesList({ invoices, loading, parsing, onReviewInvoice, onParseInvoice, onViewDetails }: InvoicesListProps) {
  const renderTextAnalysisIndicators = (analysis?: Invoice['text_analysis']) => {
    if (!analysis) return null

    const badges: Array<{ label: string; className: string }> = []
    const confidence = typeof analysis.validation_confidence === 'number'
      ? Math.round(analysis.validation_confidence * 100)
      : null

    if (analysis.needs_ocr) {
      badges.push({ label: 'Needs OCR', className: 'bg-red-100 text-red-800' })
    } else if (analysis.extraction_method) {
      const label = analysis.extraction_method === 'tesseract-ocr'
        ? 'OCR text'
        : analysis.extraction_method.replace(/-/g, ' ')
      badges.push({ label, className: 'bg-gray-100 text-gray-700' })
    }

    if (analysis.needs_manual_review) {
      badges.push({ label: 'Manual review required', className: 'bg-orange-100 text-orange-800' })
    } else if (confidence !== null) {
      badges.push({ label: `Text confidence ${confidence}%`, className: confidence >= 70 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-800' })
    }

    if (analysis.line_item_candidates) {
      badges.push({ label: `${analysis.line_item_candidates} line items detected`, className: 'bg-blue-100 text-blue-800' })
    }

    if (badges.length === 0) return null

    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {badges.map((badge, index) => (
          <span
            key={`${badge.label}-${index}`}
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
        ))}
      </div>
    )
  }
  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    )
  }

  if (invoices.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="mx-auto h-12 w-12 text-gray-400" />
        <h3 className="mt-2 text-sm font-medium text-gray-900">No invoices</h3>
        <p className="mt-1 text-sm text-gray-500">
          Get started by uploading your first invoice.
        </p>
      </div>
    )
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'uploaded':
        return <Upload className="w-4 h-4 text-blue-500" />
      case 'parsing':
        return <Clock className="w-4 h-4 text-yellow-500" />
      case 'parsed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'reviewing':
        return <Clock className="w-4 h-4 text-orange-500" />
      case 'matched':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'confirmed':
        return <CheckCircle className="w-4 h-4 text-green-600" />
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />
      default:
        return <FileText className="w-4 h-4 text-gray-500" />
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'uploaded':
        return 'Uploaded'
      case 'parsing':
        return 'Parsing...'
      case 'parsed':
        return 'Parsed'
      case 'reviewing':
        return 'Under Review'
      case 'matched':
        return 'Matched'
      case 'confirmed':
        return 'Confirmed'
      case 'error':
        return 'Error'
      default:
        return status
    }
  }

  const handleReparse = (invoiceId: string) => {
    const confirmed = window.confirm('Re-running parsing will overwrite the current extraction result. Continue?')
    if (!confirmed) return
    onParseInvoice(invoiceId)
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <ul className="divide-y divide-gray-200">
        {invoices.map((invoice) => {
          const isPipelineInProgress = invoice.pipeline_stage
            ? IN_PROGRESS_STAGES.has(invoice.pipeline_stage)
            : false
          const hasPipelineStatus = !!(invoice.pipeline_stage || invoice.status === 'pipeline_running' || invoice.status === 'pending_exceptions' || invoice.status === 'confirmed' || invoice.status === 'error' || invoice.status === 'duplicate')

          return (
            <li
              key={invoice.id}
              className={`px-6 py-4 hover:bg-gray-50 ${isPipelineInProgress ? 'animate-pulse-subtle' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    {getStatusIcon(invoice.status)}
                  </div>
                  <div className="ml-4">
                    <div className="flex items-center flex-wrap gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {invoice.invoice_number}
                      </p>
                      {/* Pipeline status badge — shown when pipeline data available */}
                      {hasPipelineStatus ? (
                        <PipelineStatusBadge
                          pipelineStage={invoice.pipeline_stage}
                          status={invoice.status}
                          openExceptionCount={invoice.open_exception_count}
                        />
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          {getStatusText(invoice.status)}
                        </span>
                      )}
                      {/* Exceptions column — amber link badge when there are open exceptions */}
                      {(invoice.open_exception_count ?? 0) > 0 && (
                        <Link
                          href={`/admin/invoice-exceptions?invoice_id=${invoice.id}`}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                          title="View exceptions for this invoice"
                        >
                          {invoice.open_exception_count} open
                        </Link>
                      )}
                    </div>
                    <div className="flex items-center mt-1 text-sm text-gray-500">
                      <span>{invoice.suppliers?.name || 'Unknown Supplier'}</span>
                      <span className="mx-1">•</span>
                      <span>{new Date(invoice.invoice_date).toLocaleDateString()}</span>
                      <span className="mx-1">•</span>
                      <span>
                        {invoice.total_amount > 0
                          ? `$${invoice.total_amount.toFixed(2)}`
                          : 'Pending'
                        }
                      </span>
                    </div>
                    {renderTextAnalysisIndicators(invoice.text_analysis)}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {invoice.parsing_confidence && (
                    <div className="text-sm text-gray-500">
                      {Math.round(invoice.parsing_confidence * 100)}% confidence
                    </div>
                  )}
                  {['uploaded', 'error'].includes(invoice.status) && (
                    <button
                      onClick={() => onParseInvoice(invoice.id)}
                      disabled={parsing === invoice.id}
                      className={`text-sm disabled:opacity-50 ${
                        invoice.status === 'error'
                          ? 'text-orange-600 hover:text-orange-900'
                          : 'text-green-600 hover:text-green-900'
                      }`}
                    >
                      {parsing === invoice.id
                        ? 'Parsing...'
                        : invoice.status === 'error'
                          ? 'Retry Parse'
                          : 'Parse with AI'
                      }
                    </button>
                  )}
                  {!['uploaded', 'error', 'parsing'].includes(invoice.status) && (
                    <button
                      onClick={() => handleReparse(invoice.id)}
                      disabled={parsing === invoice.id}
                      className="text-sm text-green-600 hover:text-green-900 disabled:opacity-50"
                    >
                      {parsing === invoice.id ? 'Parsing...' : 'Re-parse with AI'}
                    </button>
                  )}
                  {['parsed', 'reviewing', 'matched'].includes(invoice.status) && (
                    <button
                      onClick={() => onReviewInvoice(invoice)}
                      className="text-sm text-blue-600 hover:text-blue-900"
                    >
                      <Eye className="w-4 h-4 inline mr-1" />
                      Review Matches
                    </button>
                  )}
                  <button
                    onClick={() => onViewDetails(invoice)}
                    className="text-sm text-indigo-600 hover:text-indigo-900"
                  >
                    View Details
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function InvoiceManagement() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [parsing, setParsing] = useState<string | null>(null) // Invoice ID being parsed
  const [testingAI, setTestingAI] = useState(false)
  const [testingMatching, setTestingMatching] = useState(false)
  const [reviewingInvoice, setReviewingInvoice] = useState<Invoice | null>(null)
  const [detailsInvoice, setDetailsInvoice] = useState<Invoice | null>(null)
  const [activeFilter, setActiveFilter] = useState<TextQueue>('all')
  const [textQueueCounts, setTextQueueCounts] = useState<Record<TextQueue, number>>({
    'all': 0,
    'needs-ocr': 0,
    'manual-review': 0,
    'high-confidence': 0,
    'ready-to-match': 0
  })
  const [invoiceStats, setInvoiceStats] = useState({
    total: 0,
    pending_review: 0,
    confirmed: 0,
    errors: 0
  })

  const FILTERS: Array<{
    id: TextQueue
    label: string
    description: string
  }> = [
    {
      id: 'all',
      label: 'All invoices',
      description: 'Full list'
    },
    {
      id: 'needs-ocr',
      label: 'Needs OCR',
      description: 'Flagged for OCR fallback'
    },
    {
      id: 'manual-review',
      label: 'Manual review',
      description: 'Text quality issues'
    },
    {
      id: 'high-confidence',
      label: 'High confidence',
      description: 'Confidence ≥ 75%'
    },
    {
      id: 'ready-to-match',
      label: 'Ready to match',
      description: 'Parsed & stable text'
    }
  ]

  const fetchInvoices = useCallback(async (queue?: TextQueue) => {
    const targetQueue = queue ?? activeFilter
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('text_queue', targetQueue)
      const response = await fetch(`/api/admin/invoices?${params.toString()}`)
      const result = await response.json()
      
      if (result.success) {
        setInvoices(result.data)
        if (result.text_queue_counts) {
          setTextQueueCounts(result.text_queue_counts)
        }
        if (result.stats) {
          setInvoiceStats(result.stats)
        }
      } else {
        console.error('Failed to fetch invoices:', result.error)
      }
    } catch (error) {
      console.error('Error fetching invoices:', error)
    } finally {
      setLoading(false)
    }
  }, [activeFilter])

  useEffect(() => {
    fetchSuppliers()
  }, [])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  // Auto-refresh every 10s while any invoice is in an active pipeline stage.
  // Stops automatically when all rows reach a terminal state.
  useEffect(() => {
    const hasInProgress = invoices.some(
      (inv) => inv.pipeline_stage && IN_PROGRESS_STAGES.has(inv.pipeline_stage)
    )
    if (!hasInProgress) return

    const interval = setInterval(() => {
      void fetchInvoices()
    }, 10_000)

    return () => clearInterval(interval)
  }, [invoices, fetchInvoices])

  const fetchSuppliers = async () => {
    try {
      const response = await fetch('/api/admin/suppliers')
      const result = await response.json()
      
      if (result.success) {
        setSuppliers(result.suppliers || [])
      } else {
        console.error('Failed to fetch suppliers:', result.error)
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error)
    }
  }

  const parseInvoice = async (invoiceId: string) => {
    try {
      setParsing(invoiceId)
      console.log('🤖 Starting AI parsing for invoice:', invoiceId)
      
      const response = await fetch(`/api/admin/invoices/${invoiceId}/parse`, {
        method: 'POST'
      })
      
      const result = await response.json()
      
      if (result.success) {
        console.log('✅ Invoice parsed successfully:', result.parsing_stats)
        // Refresh the invoices list to show updated status
        await fetchInvoices()
        
        // Show success message (you could use a toast library here)
        alert(`Invoice parsed successfully! Extracted ${result.parsing_stats?.line_items_extracted || 0} line items with ${Math.round((result.parsing_stats?.confidence || 0) * 100)}% confidence.`)
      } else {
        console.error('Parsing failed:', result.error)
        alert(`Parsing failed: ${result.error}`)
        await fetchInvoices() // Refresh to show error status
      }
    } catch (error) {
      console.error('Error parsing invoice:', error)
      alert('Failed to parse invoice. Please try again.')
    } finally {
      setParsing(null)
    }
  }

  const testAIService = async () => {
    try {
      setTestingAI(true)
      console.log('🧪 Testing AI service...')
      
      const response = await fetch('/api/admin/invoices/test-ai', {
        method: 'POST'
      })
      
      const result = await response.json()
      
      if (result.success) {
        alert('✅ AI Service Test Passed!\n\n' + JSON.stringify(result.results, null, 2))
      } else {
        alert('❌ AI Service Test Failed!\n\n' + JSON.stringify(result.results, null, 2))
      }
    } catch (error) {
      console.error('Error testing AI service:', error)
      alert('Failed to test AI service')
    } finally {
      setTestingAI(false)
    }
  }

  const testMatchingEngine = async () => {
    try {
      setTestingMatching(true)
      console.log('🧪 Testing matching engine...')
      
      const response = await fetch('/api/admin/invoices/test-matching', {
        method: 'POST'
      })
      
      const result = await response.json()
      
      if (result.success) {
        alert('✅ Matching Engine Test Passed!\n\n' + JSON.stringify(result.results, null, 2))
      } else {
        alert('❌ Matching Engine Test Failed!\n\n' + JSON.stringify(result.results, null, 2))
      }
    } catch (error) {
      console.error('Error testing matching engine:', error)
      alert('Failed to test matching engine')
    } finally {
      setTestingMatching(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoice Import</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload and process supplier invoices with AI-powered parsing and order matching.
          </p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={testAIService}
            disabled={testingAI}
            className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {testingAI ? (
              <Clock className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <AlertCircle className="w-4 h-4 mr-2" />
            )}
            Test AI
          </button>
          <button
            onClick={testMatchingEngine}
            disabled={testingMatching}
            className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {testingMatching ? (
              <Clock className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2" />
            )}
            Test Matching
          </button>
          <button
            onClick={() => setShowUploadModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <Plus className="w-4 h-4 mr-2" />
            Upload Invoice
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <FileText className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Total Invoices
                  </dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {invoiceStats.total}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Clock className="h-6 w-6 text-yellow-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Pending Review
                  </dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {invoiceStats.pending_review}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CheckCircle className="h-6 w-6 text-green-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Confirmed
                  </dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {invoiceStats.confirmed}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <AlertCircle className="h-6 w-6 text-red-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Errors
                  </dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {invoiceStats.errors}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">Focus queues</p>
          <span className="text-xs text-gray-500">Tap a queue to slice invoices by text quality</span>
        </div>
        <div className="flex flex-wrap gap-3">
          {FILTERS.map((filter) => {
            const isActive = activeFilter === filter.id
            const count = textQueueCounts[filter.id] ?? 0
            return (
              <button
                key={filter.id}
                onClick={() => setActiveFilter(filter.id)}
                className={`flex flex-col items-start rounded-lg border px-4 py-3 text-left transition ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-semibold ${isActive ? 'text-indigo-700' : 'text-gray-800'}`}>
                    {filter.label}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    isActive ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {count}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{filter.description}</p>
              </button>
            )
          })}
        </div>
        {!loading && invoices.length === 0 && (
          <p className="mt-3 text-sm text-gray-500">
            {(textQueueCounts[activeFilter] ?? 0) > 0
              ? 'No invoices currently match this queue on this page. Adjust filters or pagination.'
              : 'No invoices have hit this queue yet.'}
          </p>
        )}
      </div>

      {/* Invoices List */}
      <InvoicesList 
        invoices={invoices} 
        loading={loading} 
        parsing={parsing}
        onReviewInvoice={setReviewingInvoice}
        onParseInvoice={parseInvoice}
        onViewDetails={setDetailsInvoice}
      />

      {/* Upload Modal */}
      <InvoiceUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadComplete={() => void fetchInvoices()}
        suppliers={suppliers}
      />

      {/* Review Interface */}
      {reviewingInvoice && (
        <InvoiceReviewInterface
          invoice={reviewingInvoice}
          onClose={() => setReviewingInvoice(null)}
          onConfirm={() => {
            setReviewingInvoice(null)
    fetchInvoices() // Refresh the list
          }}
        />
      )}

      {/* Details Modal */}
      {detailsInvoice && (
        <InvoiceDetailsModal
          invoice={detailsInvoice}
          isOpen={!!detailsInvoice}
          onClose={() => setDetailsInvoice(null)}
        />
      )}
    </div>
  )
}

