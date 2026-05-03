'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Modal } from '@/components/ui'
import { isPurchaseOrderOverdue } from '@/lib/purchase-orders/is-overdue'
import { 
  ClipboardList,
  Plus,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  DollarSign,
  Package,
  Eye,
  Edit,
  Send,
  Download,
  Mail,
  Copy,
  RefreshCcw,
  MoreVertical
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import PurchaseOrderModal from './PurchaseOrderModal'
import PurchaseOrderViewModal from './PurchaseOrderViewModal'
import { buildPurchaseOrderTemplateContext, renderTemplate } from '@/lib/purchase-orders/templates'
import type { SupplierEmailTemplate } from '@/lib/purchase-orders/templates'

const ActionMenuButton = ({
  label,
  icon,
  colorClass = 'text-gray-700',
  disabled,
  onClick
}: {
  label: string
  icon: React.ReactNode
  colorClass?: string
  disabled?: boolean
  onClick: () => void
}) => (
  <button
    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${colorClass} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    onClick={onClick}
    disabled={disabled}
  >
    {icon}
    <span className="truncate">{label}</span>
  </button>
)

interface PurchaseOrderItem {
  id: string
  purchase_order_id: string
  inventory_item_id: string
  inventory_item_name: string
  quantity_ordered: number
  quantity_received: number
  unit_cost: number
  total_cost: number
  unit_type?: string
  is_excluded?: boolean
  exclusion_reason?: string | null
  ordered_pack_qty?: number | null
  pack_size?: number | null
}

type PurchaseOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'received'
  | 'cancelled'
  | 'confirmed'

interface PurchaseOrder {
  id: string
  supplier_id: string
  supplier_name: string
  supplier_contact?: string
  supplier_email?: string
  supplier_phone?: string
  order_number: string
  status: PurchaseOrderStatus
  order_date: string
  expected_delivery_date?: string
  actual_delivery_date?: string
  sent_at?: string
  sent_via?: string
  sent_notes?: string
  sent_by?: string
  sent_by_profile?: {
    full_name?: string | null
    email?: string | null
  } | null
  total_amount: number
  notes?: string
  created_at: string
  updated_at: string
  items?: PurchaseOrderItem[]
  status_history?: {
    previous_status: string | null
    new_status: string
    changed_by?: string | null
    changed_at: string
    note?: string | null
  }[]
  pack_size?: number | null
}

interface PurchaseOrdersManagementProps {
  showCreateButton?: boolean
}

const STATUS_CONFIG: Record<string, { color: string; label: string; icon: LucideIcon }> = {
  draft: { color: 'bg-gray-100 text-gray-800', label: 'Draft', icon: FileText },
  pending_approval: { color: 'bg-amber-100 text-amber-800', label: 'Pending Approval', icon: Clock },
  approved: { color: 'bg-blue-100 text-blue-800', label: 'Approved', icon: CheckCircle },
  sent: { color: 'bg-indigo-100 text-indigo-800', label: 'Sent to Supplier', icon: Send },
  received: { color: 'bg-green-100 text-green-800', label: 'Received', icon: Package },
  confirmed: { color: 'bg-emerald-100 text-emerald-800', label: 'Confirmed', icon: CheckCircle },
  cancelled: { color: 'bg-red-100 text-red-800', label: 'Cancelled', icon: XCircle }
}

const getStatusConfig = (status: PurchaseOrderStatus) => {
  return STATUS_CONFIG[status] || STATUS_CONFIG.draft
}

const PurchaseOrdersManagement = ({ 
  showCreateButton = true 
}: PurchaseOrdersManagementProps) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'this_week' | 'this_month' | 'overdue'>('all')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [viewModalOpen, setViewModalOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [sendForm, setSendForm] = useState({
    method: 'email',
    notes: '',
    sent_at: new Date().toISOString().slice(0, 16)
  })
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailForm, setEmailForm] = useState({
    to: '',
    cc: '',
    subject: '',
    message: '',
    markAsSent: true,
    excludedItemIds: [] as string[]
  })
  const [emailSending, setEmailSending] = useState(false)
  const [emailTemplateLoading, setEmailTemplateLoading] = useState(false)
  const [emailTemplatePreview, setEmailTemplatePreview] = useState('')
  const [markingReceiptOrderId, setMarkingReceiptOrderId] = useState<string | null>(null)
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false)
  
  const queryClient = useQueryClient()

  // Fetch purchase orders
  const { 
    data: ordersData, 
    isLoading, 
    error 
  } = useQuery({
    queryKey: ['admin-purchase-orders', statusFilter, dateFilter],
    queryFn: async () => {
      const url = '/api/admin/purchase-orders?'
      const params = new URLSearchParams()
      
      if (statusFilter !== 'all') params.append('status', statusFilter)
      if (dateFilter !== 'all') params.append('dateFilter', dateFilter)
      
      const response = await fetch(url + params.toString())
      if (!response.ok) {
        throw new Error('Failed to fetch purchase orders')
      }
      return response.json()
    }
  })

  const orders: PurchaseOrder[] = ordersData?.orders || []

  // Filter orders based on search
  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         order.supplier_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         order.notes?.toLowerCase().includes(searchQuery.toLowerCase())
    
    return matchesSearch
  })

  // Update order status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, body }: { orderId: string; body: Record<string, unknown> }) => {
      const response = await fetch(`/api/admin/purchase-orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to update purchase order')
      }

      return response.json()
    }
  })

  const handleCreateOrder = () => {
    setSelectedOrder(null)
    setCreateModalOpen(true)
  }

  const handleViewOrder = (order: PurchaseOrder) => {
    setSelectedOrder(order)
    setViewModalOpen(true)
  }

  const handleEditOrder = (order: PurchaseOrder) => {
    setSelectedOrder(order)
    setEditModalOpen(true)
  }

  const handleDuplicateOrder = (order: PurchaseOrder) => {
    const duplicatedItems = (order.items || []).map(item => ({
      id: '',
      purchase_order_id: '',
      inventory_item_id: item.inventory_item_id,
      inventory_item_name: item.inventory_item_name,
      quantity_ordered: item.quantity_ordered,
      quantity_received: 0,
      unit_cost: item.unit_cost,
      total_cost: item.total_cost ?? (item.quantity_ordered || 0) * (item.unit_cost || 0),
      unit_type: item.unit_type,
      is_excluded: false,
      exclusion_reason: null
    }))

    const duplicatedOrder: PurchaseOrder = {
      ...order,
      id: '',
      status: 'draft',
      order_number: `PO-${Date.now().toString().slice(-6)}`,
      sent_at: undefined,
      sent_via: undefined,
      sent_notes: undefined,
      total_amount: duplicatedItems.reduce((sum, item) => sum + (item.total_cost || 0), 0),
      items: duplicatedItems
    }

    setSelectedOrder(duplicatedOrder)
    setCreateModalOpen(true)
    setEditModalOpen(false)
  }

  const resetEmailForm = () => {
    setEmailForm({
      to: '',
      cc: '',
      subject: '',
      message: '',
      markAsSent: true,
      excludedItemIds: []
    })
    setEmailTemplateLoading(false)
    setEmailTemplatePreview('')
  }

  const toggleExcludedItem = (itemId: string) => {
    setEmailForm(prev => {
      const exists = prev.excludedItemIds.includes(itemId)
      return {
        ...prev,
        excludedItemIds: exists
          ? prev.excludedItemIds.filter(id => id !== itemId)
          : [...prev.excludedItemIds, itemId]
      }
    })
  }

  const buildEmailTemplateDefaults = (
    order: PurchaseOrder,
    template?: SupplierEmailTemplate | null
  ) => {
    const preExcluded = order.items?.filter((i) => i.is_excluded)?.map((i) => i.id) || []
    const base = {
      to: order.supplier_email || '',
      cc: '',
      subject: `Purchase Order ${order.order_number}`,
      message: '',
      markAsSent: true,
      excludedItemIds: preExcluded
    }

    const context = buildPurchaseOrderTemplateContext({
      order_number: order.order_number,
      order_date: order.order_date,
      expected_delivery_date: order.expected_delivery_date,
      total_amount: order.total_amount,
      supplier: {
        name: order.supplier_name,
        contact_person: order.supplier_contact,
        payment_terms: undefined
      }
    })

    if (!template) {
      setEmailTemplatePreview(buildDefaultTemplatePreview(order))
      return base
    }

    const templatedSubject = renderTemplate(template.subject_template, context).trim()
    const templatedBody = renderTemplate(template.body_template, context).trim()
    setEmailTemplatePreview(templatedBody || buildDefaultTemplatePreview(order))

    return {
      ...base,
      subject: templatedSubject || base.subject,
      message: ''
    }
  }

  const fetchSupplierEmailTemplate = async (supplierId: string) => {
    const response = await fetch(`/api/admin/suppliers/${supplierId}/email-templates`)
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error || 'Failed to load supplier template')
    }
    const result = await response.json()
    return result.template as SupplierEmailTemplate | null
  }

  const handleEmailSupplier = async (order: PurchaseOrder) => {
    if (!order.supplier_email) {
      toast.error('Supplier email is missing. Update the supplier record before emailing.')
      return
    }

    setSelectedOrder(order)
    setEmailTemplateLoading(Boolean(order.supplier_id))
    setEmailForm(buildEmailTemplateDefaults(order))
    setEmailModalOpen(true)

    if (!order.supplier_id) {
      setEmailTemplateLoading(false)
      return
    }

    try {
      const template = await fetchSupplierEmailTemplate(order.supplier_id)
      if (template) {
        setEmailForm(buildEmailTemplateDefaults(order, template))
      } else {
        setEmailTemplatePreview(buildDefaultTemplatePreview(order))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load supplier template'
      toast.error(message)
    } finally {
      setEmailTemplateLoading(false)
    }
  }

  const buildDefaultTemplatePreview = (order: PurchaseOrder) => {
    const greeting = order.supplier_contact || order.supplier_name
    const formatDateOnly = (value?: string | null) => {
      if (!value) return null
      const trimmed = value.trim()
      const date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
        ? new Date(`${trimmed}T00:00:00`)
        : new Date(trimmed)
      if (Number.isNaN(date.getTime())) return null
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }
    const expectedDate = order.expected_delivery_date
      ? (formatDateOnly(order.expected_delivery_date) || 'Not specified')
      : 'Not specified'

    return [
      `Hello ${greeting},`,
      '',
      `Please find attached purchase order ${order.order_number}.`,
      `Expected delivery: ${expectedDate}`,
      '',
      'Thank you,',
      'Little Cafe Purchasing'
    ].join('\n')
  }

  const handleEmailSubmit = async () => {
    if (!selectedOrder) return

    if (!emailForm.to.trim()) {
      toast.error('Please provide at least one recipient email.')
      return
    }

    if (emailTemplateLoading) {
      toast.error('Please wait for the supplier template to finish loading.')
      return
    }

    const totalItems = selectedOrder.items?.length || 0
    const excludedCount = emailForm.excludedItemIds.length
    if (totalItems > 0 && excludedCount >= totalItems) {
      toast.error('At least one item must be included when sending the purchase order.')
      return
    }

    try {
      setEmailSending(true)

      const response = await fetch(`/api/admin/purchase-orders/${selectedOrder.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailForm.to,
          cc: emailForm.cc || undefined,
          subject: emailForm.subject,
          message: emailForm.message,
          markAsSent: emailForm.markAsSent,
          excluded_item_ids: emailForm.excludedItemIds
        })
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to email purchase order')
      }

      toast.success('Purchase order emailed to supplier')
      setEmailModalOpen(false)
      setSelectedOrder(null)
      resetEmailForm()
      queryClient.invalidateQueries({ queryKey: ['admin-purchase-orders'] })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to email purchase order'
      toast.error(message)
    } finally {
      setEmailSending(false)
    }
  }

  const handleStatusChange = async (
    order: PurchaseOrder,
    nextStatus: PurchaseOrderStatus,
    successMessage: string,
    extraBody: Record<string, unknown> = {}
  ) => {
    try {
      await updateStatusMutation.mutateAsync({
        orderId: order.id,
        body: {
          status: nextStatus,
          ...extraBody
        }
      })

      toast.success(successMessage)
      queryClient.invalidateQueries({ queryKey: ['admin-purchase-orders'] })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update purchase order'
      toast.error(message)
    }
  }

  const getOutstandingItems = (order: PurchaseOrder) => {
    const outstanding = order.items?.map(item => {
      const remaining = (item.quantity_ordered || 0) - (item.quantity_received || 0)
      return {
        id: item.id,
        inventory_item_name: item.inventory_item_name,
        remaining
      }
    }).filter(item => (item?.remaining ?? 0) > 0)

    return outstanding || []
  }

  const handleMarkReceived = async (order: PurchaseOrder) => {
    const outstanding = getOutstandingItems(order)
    if (outstanding.length === 0) {
      toast.success('Purchase order already fully received')
      return
    }

    try {
      setMarkingReceiptOrderId(order.id)

      for (const item of outstanding) {
        const response = await fetch(`/api/admin/purchase-orders/${order.id}/receipts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purchase_order_item_id: item.id,
            quantity: item.remaining,
            notes: `Auto receipt logged from Mark Received action for ${order.order_number}`
          })
        })

        const result = await response.json()
        if (!response.ok) {
          throw new Error(result?.error || 'Failed to log receipt')
        }
      }

      toast.success('Purchase order marked as received')
      queryClient.invalidateQueries({ queryKey: ['admin-purchase-orders'] })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to mark purchase order as received'
      toast.error(message)
    } finally {
      setMarkingReceiptOrderId(null)
    }
  }

  const handleSendSubmit = async () => {
    if (!selectedOrder) return

    const sentAtIso = sendForm.sent_at
      ? new Date(sendForm.sent_at).toISOString()
      : new Date().toISOString()

    await handleStatusChange(
      selectedOrder,
      'sent',
      'Purchase order marked as sent to supplier',
      {
        sent_at: sentAtIso,
        sent_via: sendForm.method,
        sent_notes: sendForm.notes || null
      }
    )

    setSendModalOpen(false)
    setSelectedOrder(null)
  }

  const handleDownloadPdf = async (order: PurchaseOrder) => {
    try {
      const response = await fetch(`/api/admin/purchase-orders/${order.id}/pdf`)
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || 'Failed to generate purchase order PDF')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `PO-${order.order_number}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast.success('Purchase order PDF downloaded')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download purchase order PDF'
      toast.error(message)
    }
  }

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '—'
    const localDate = dateString.includes('T')
      ? new Date(dateString)
      : new Date(`${dateString}T00:00:00`)
    return localDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  const isOverdue = (order: PurchaseOrder) => isPurchaseOrderOverdue(order)

  if (isLoading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading purchase orders...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="text-center text-red-600">
          <ClipboardList className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium mb-2">Failed to Load Purchase Orders</h3>
          <p className="text-red-500">{(error as Error).message}</p>
        </div>
      </div>
    )
  }

  const statusCounts: Record<string, number> = {
    draft: 0,
    pending_approval: 0,
    approved: 0,
    sent: 0,
    received: 0,
    confirmed: 0,
    cancelled: 0,
    all: orders.length,
    overdue: 0
  }

  orders.forEach(order => {
    if (statusCounts[order.status] !== undefined) {
      statusCounts[order.status] += 1
    }
  })

  statusCounts.overdue = orders.filter(o => isOverdue(o)).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Purchase Orders</h2>
          <p className="text-gray-600 mt-1">Track purchase orders and deliveries from suppliers</p>
        </div>
        {showCreateButton && (
          <Button 
            onClick={handleCreateOrder}
            className="bg-primary-600 hover:bg-primary-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Order
          </Button>
        )}
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="md:hidden"
            onClick={() => setFiltersOpen(prev => !prev)}
          >
            <Filter className="w-4 h-4 mr-1" />
            Filters
          </Button>
        </div>

        <div className={`${filtersOpen ? 'mt-4 block' : 'mt-4 hidden'} md:block`}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 flex-1">
              {/* Status Filter */}
              <div className="flex items-center gap-2 flex-wrap pb-2 sm:pb-0">
                {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1 text-sm rounded-full font-medium transition-colors whitespace-nowrap flex items-center gap-1 ${
                      statusFilter === status
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <config.icon className="w-3 h-3" />
                    {config.label} ({statusCounts[status] ?? 0})
                  </button>
                ))}
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1 text-sm rounded-full font-medium transition-colors whitespace-nowrap ${
                    statusFilter === 'all'
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  All ({statusCounts.all})
                </button>
              </div>

              {/* Date Filter */}
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="all">All Time</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="overdue">Overdue</option>
              </select>

              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery('')
                  setStatusFilter('all')
                  setDateFilter('all')
                }}
                className="flex items-center gap-2 text-sm"
              >
                <RefreshCcw className="w-4 h-4" />
                Reset
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Purchase Orders List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {filteredOrders.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardList className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchQuery || statusFilter !== 'all' || dateFilter !== 'all'
                ? 'No purchase orders found' 
                : 'No purchase orders yet'
              }
            </h3>
            <p className="text-gray-600 mb-4">
              {searchQuery || statusFilter !== 'all' || dateFilter !== 'all'
                ? 'Try adjusting your search or filters'
                : 'Create your first purchase order to get started'
              }
            </p>
            {showCreateButton && !searchQuery && statusFilter === 'all' && dateFilter === 'all' && (
              <Button 
                onClick={handleCreateOrder}
                className="bg-primary-600 hover:bg-primary-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create First Order
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Order Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Dates
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredOrders.map((order) => {
                  const statusConfig = getStatusConfig(order.status)
                  const StatusIcon = statusConfig.icon
                  const overdue = isOverdue(order)
                  const outstandingItems = getOutstandingItems(order)
                  const totalOrdered = order.items?.reduce((sum, item) => sum + (item.quantity_ordered || 0), 0) || 0
                  const totalReceived = order.items?.reduce((sum, item) => sum + (item.quantity_received || 0), 0) || 0
                  const excludedCount = order.items?.filter((item) => item.is_excluded).length || 0
                  
                  return (
                    <tr key={order.id} className={`hover:bg-gray-50 ${overdue ? 'bg-red-50' : ''}`}>
                      <td className="px-6 py-4 align-top whitespace-normal break-words">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            #{order.order_number}
                          </div>
                          <div className="text-sm text-gray-500">
                            Created {formatDate(order.created_at)}
                          </div>
                          {overdue && (
                            <div className="text-xs text-red-600 font-medium">
                              OVERDUE
                            </div>
                          )}
                          {excludedCount > 0 && (
                            <div className="mt-1 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                              {excludedCount} item{excludedCount === 1 ? '' : 's'} excluded
                            </div>
                          )}
                        </div>
                      </td>
                      
                      <td className="px-6 py-4 align-top whitespace-normal break-words">
                        <div className="text-sm text-gray-900">{order.supplier_name}</div>
                        {totalOrdered > 0 && totalReceived > 0 && totalReceived < totalOrdered && (
                          <div className="text-xs text-indigo-600 mt-1">
                            Partially received ({totalReceived}/{totalOrdered})
                          </div>
                        )}
                  </td>
                      
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusConfig.color}`}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {statusConfig.label}
                        </span>
                      </td>
                      
                      <td className="px-6 py-4 whitespace-normal text-sm text-gray-500">
                        <div>Ordered: {formatDate(order.order_date)}</div>
                        {order.expected_delivery_date && (
                          <div>Expected: {formatDate(order.expected_delivery_date)}</div>
                        )}
                        {order.sent_at && (
                          <div className="text-indigo-600">Sent: {formatDate(order.sent_at)}</div>
                        )}
                        {order.actual_delivery_date && (
                          <div className="text-green-600">
                            Delivered: {formatDate(order.actual_delivery_date)}
                          </div>
                        )}
                      </td>
                      
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {formatCurrency(order.total_amount)}
                      </td>
                      
                      <td className="px-6 py-4 whitespace-normal text-sm font-medium">
                        <div className="relative inline-flex">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setOpenActionMenuId(prev => prev === order.id ? null : order.id)}
                            className="text-gray-700"
                            aria-haspopup="menu"
                            aria-expanded={openActionMenuId === order.id}
                            aria-label={`Actions for purchase order ${order.order_number}`}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                          {openActionMenuId === order.id && (
                            <div className="absolute right-0 top-full mt-2 w-56 rounded-md border border-gray-200 bg-white shadow-lg z-20">
                              <div className="py-1">
                                <ActionMenuButton label="View" icon={<Eye className="w-4 h-4" />} onClick={() => { setOpenActionMenuId(null); handleViewOrder(order) }} />
                                {(['draft', 'pending_approval', 'approved', 'sent', 'received'] as PurchaseOrderStatus[]).includes(order.status) && (
                                  <ActionMenuButton label="Edit" icon={<Edit className="w-4 h-4" />} onClick={() => { setOpenActionMenuId(null); handleEditOrder(order) }} />
                                )}
                                {(['approved', 'confirmed', 'sent', 'received'] as PurchaseOrderStatus[]).includes(order.status) && (
                                  <ActionMenuButton label="PDF" icon={<Download className="w-4 h-4" />} onClick={() => { setOpenActionMenuId(null); void handleDownloadPdf(order) }} />
                                )}
                                {(['approved', 'sent'] as PurchaseOrderStatus[]).includes(order.status) && (
                                  <ActionMenuButton
                                    label="Email"
                                    icon={<Mail className="w-4 h-4" />}
                                    disabled={emailSending && selectedOrder?.id === order.id}
                                    onClick={() => { setOpenActionMenuId(null); void handleEmailSupplier(order) }}
                                  />
                                )}
                                <ActionMenuButton label="Duplicate" icon={<Copy className="w-4 h-4" />} onClick={() => { setOpenActionMenuId(null); handleDuplicateOrder(order) }} />
                                {order.status === 'draft' && (
                                  <ActionMenuButton
                                    label="Submit for Approval"
                                    icon={<Clock className="w-4 h-4" />}
                                    colorClass="text-amber-600"
                                    onClick={() => { setOpenActionMenuId(null); void handleStatusChange(order, 'pending_approval', 'Purchase order submitted for approval') }}
                                  />
                                )}
                                {order.status === 'pending_approval' && (
                                  <ActionMenuButton
                                    label="Approve"
                                    icon={<CheckCircle className="w-4 h-4" />}
                                    colorClass="text-blue-600"
                                    onClick={() => { setOpenActionMenuId(null); void handleStatusChange(order, 'approved', 'Purchase order approved') }}
                                  />
                                )}
                                {order.status === 'approved' && (
                                  <ActionMenuButton
                                    label="Mark Sent"
                                    icon={<Send className="w-4 h-4" />}
                                    colorClass="text-indigo-600"
                                    onClick={() => {
                                      setOpenActionMenuId(null)
                                      setSelectedOrder(order)
                                      setSendForm({
                                        method: order.sent_via || 'email',
                                        notes: order.sent_notes || '',
                                        sent_at: (order.sent_at ? new Date(order.sent_at).toISOString() : new Date().toISOString()).slice(0, 16)
                                      })
                                      setSendModalOpen(true)
                                    }}
                                  />
                                )}
                                {(order.status === 'sent' || order.status === 'approved') && (
                                  <ActionMenuButton
                                    label={markingReceiptOrderId === order.id ? 'Receiving...' : 'Mark Received'}
                                    icon={<CheckCircle className="w-4 h-4" />}
                                    colorClass="text-green-600"
                                    disabled={
                                      updateStatusMutation.isPending ||
                                      markingReceiptOrderId === order.id ||
                                      outstandingItems.length === 0
                                    }
                                    onClick={() => { setOpenActionMenuId(null); void handleMarkReceived(order) }}
                                  />
                                )}
                                {(order.status !== 'cancelled' && order.status !== 'received' && order.status !== 'confirmed') && (
                                  <ActionMenuButton
                                    label="Cancel"
                                    icon={<XCircle className="w-4 h-4" />}
                                    colorClass="text-red-600"
                                    onClick={() => { setOpenActionMenuId(null); void handleStatusChange(order, 'cancelled', 'Purchase order cancelled') }}
                                  />
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">Total Orders</p>
              <p className="text-2xl font-bold text-gray-900">{orders.length}</p>
            </div>
            <ClipboardList className="w-8 h-8 text-primary-600" />
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">Pending Orders</p>
              <p className="text-2xl font-bold text-yellow-600">
                {orders.filter(o => ['pending_approval', 'approved', 'sent', 'confirmed'].includes(o.status)).length}
              </p>
            </div>
            <Clock className="w-8 h-8 text-yellow-600" />
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">Overdue Orders</p>
              <p className="text-2xl font-bold text-red-600">
                {orders.filter(o => isOverdue(o)).length}
              </p>
            </div>
            <XCircle className="w-8 h-8 text-red-600" />
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600">Total Value</p>
              <p className="text-2xl font-bold text-green-600">
                {formatCurrency(orders.reduce((sum, order) => sum + order.total_amount, 0))}
              </p>
            </div>
            <DollarSign className="w-8 h-8 text-green-600" />
          </div>
        </div>
      </div>

      <Modal
        isOpen={sendModalOpen}
        onClose={() => {
          setSendModalOpen(false)
          setSelectedOrder(null)
          setSendForm({ method: 'email', notes: '', sent_at: new Date().toISOString().slice(0, 16) })
        }}
        title="Mark Purchase Order as Sent"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Log when and how this purchase order was issued to the supplier. This will place the order in the <strong>Sent</strong> state.
          </p>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Sent Via</label>
            <select
              value={sendForm.method}
              onChange={(e) => setSendForm(prev => ({ ...prev, method: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="portal">Supplier Portal</option>
              <option value="in_person">In Person</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Sent At</label>
            <input
              type="datetime-local"
              value={sendForm.sent_at}
              onChange={(e) => setSendForm(prev => ({ ...prev, sent_at: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea
              rows={3}
              value={sendForm.notes}
              onChange={(e) => setSendForm(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="e.g., Emailed PO PDF to supplier contact"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setSendModalOpen(false)
                setSelectedOrder(null)
                setSendForm({ method: 'email', notes: '', sent_at: new Date().toISOString().slice(0, 16) })
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendSubmit}
              disabled={updateStatusMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Mark as Sent
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={emailModalOpen}
        onClose={() => {
          setEmailModalOpen(false)
          setSelectedOrder(null)
          resetEmailForm()
        }}
        title="Email Purchase Order to Supplier"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Send the supplier a PDF copy of this purchase order. You can add optional notes that will appear in the email body.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">To *</label>
              <input
                type="text"
                value={emailForm.to}
                onChange={(e) => setEmailForm(prev => ({ ...prev, to: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="supplier@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">CC</label>
              <input
                type="text"
                value={emailForm.cc}
                onChange={(e) => setEmailForm(prev => ({ ...prev, cc: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="ops-team@example.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Subject</label>
            <input
              type="text"
              value={emailForm.subject}
              onChange={(e) => setEmailForm(prev => ({ ...prev, subject: e.target.value }))}
              disabled={emailTemplateLoading}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-70"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium text-gray-700">Template Preview</label>
            <div className="mt-1 rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-wrap">
              {emailTemplatePreview || 'Default greeting will be used.'}
            </div>
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium text-gray-700">Message (optional)</label>
            <textarea
              rows={6}
              value={emailForm.message}
              onChange={(e) => setEmailForm(prev => ({ ...prev, message: e.target.value }))}
              disabled={emailTemplateLoading}
              className="mt-1 block w-full max-w-full min-w-0 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-70 resize-y"
              placeholder="Include any special instructions or delivery notes for the supplier..."
            />
            {emailTemplateLoading && (
              <p className="mt-1 text-xs text-gray-500">Loading supplier template…</p>
            )}
          </div>
          {selectedOrder?.items?.length ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-800">Items to include</p>
                <p className="text-xs text-gray-500">Uncheck to exclude out-of-stock items from this send</p>
              </div>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {selectedOrder.items.map((item) => (
                  <label key={item.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-white px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">
                        {item.inventory_item_name}
                        {item.is_excluded && (
                          <span className="ml-2 inline-flex items-center rounded bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                            Excluded
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">
                        Qty: {item.quantity_ordered} {item.unit_type || ''} • ${typeof item.unit_cost === 'number' ? item.unit_cost.toFixed(2) : '0.00'} ea
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={!emailForm.excludedItemIds.includes(item.id)}
                      onChange={() => toggleExcludedItem(item.id)}
                      className="h-4 w-4 text-primary-600 border-gray-300 rounded"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <label className="inline-flex items-center space-x-2">
            <input
              type="checkbox"
              checked={emailForm.markAsSent}
              onChange={(e) => setEmailForm(prev => ({ ...prev, markAsSent: e.target.checked }))}
              className="h-4 w-4 text-primary-600 border-gray-300 rounded"
            />
            <span className="text-sm text-gray-700">
              Automatically record this purchase order as sent after emailing
            </span>
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setEmailModalOpen(false)
                setSelectedOrder(null)
                resetEmailForm()
              }}
              disabled={emailSending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => { void handleEmailSubmit() }}
              className="bg-indigo-600 hover:bg-indigo-700"
              disabled={emailSending || emailTemplateLoading}
            >
              {emailSending ? 'Sending…' : (emailTemplateLoading ? 'Loading template…' : 'Send Email')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modals */}
      <PurchaseOrderModal
        order={selectedOrder}
        isOpen={createModalOpen || editModalOpen}
        onClose={() => {
          setCreateModalOpen(false)
          setEditModalOpen(false)
          setSelectedOrder(null)
        }}
      />

      <PurchaseOrderViewModal
        order={selectedOrder}
        isOpen={viewModalOpen}
        onClose={() => {
          setViewModalOpen(false)
          setSelectedOrder(null)
        }}
      />
    </div>
  )
}

export default PurchaseOrdersManagement
