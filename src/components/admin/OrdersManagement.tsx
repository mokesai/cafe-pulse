'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  Search,
  Download,
  Eye,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { Button } from '@/components/ui'
import { toast } from 'react-hot-toast'
import { OrderDetailsModal } from './OrderDetailsModal'

interface OrderItemSummary {
  item_name?: string
  quantity?: number
}

interface Order {
  id: string
  created_at: string
  status: string
  total_amount: number
  customer_email: string
  payment_status: string
  order_items: OrderItemSummary[]
  profiles?: {
    full_name: string
    email: string
  }
}

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-yellow-100 text-yellow-800', // Same as pending
  preparing: 'bg-blue-100 text-blue-800',
  ready: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800'
}

const statusIcons = {
  pending: Clock,
  confirmed: Clock, // Same as pending
  preparing: AlertTriangle,
  ready: CheckCircle,
  completed: CheckCircle,
  cancelled: XCircle
}

export function OrdersManagement() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  // Helper function to format price from cents to dollars
  const formatPrice = (cents: number) => {
    return (cents / 100).toFixed(2)
  }
  // Set default date range: yesterday to today
  const getDefaultDates = () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    
    return {
      startDate: yesterday.toISOString().split('T')[0], // Format: YYYY-MM-DD
      endDate: today.toISOString().split('T')[0]
    }
  }

  const [filters, setFilters] = useState({
    status: 'all',
    ...getDefaultDates(),
    search: ''
  })
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false
  })
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        limit: pagination.limit.toString(),
        offset: pagination.offset.toString(),
      })

      if (filters.status !== 'all') params.append('status', filters.status)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)

      const response = await fetch(`/api/admin/orders?${params}`)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Orders API error:', response.status, errorText)
        throw new Error(`Failed to fetch orders: ${response.status}`)
      }

      const data = await response.json()
      console.log('Orders fetched:', data.orders?.length || 0, 'total:', data.pagination?.total || 0)
      setOrders(data.orders)
      setPagination(prev => ({
        ...prev,
        total: data.pagination.total,
        hasMore: data.pagination.hasMore
      }))
    } catch (error) {
      console.error('Error fetching orders:', error)
      toast.error('Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [filters, pagination.limit, pagination.offset])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      setUpdating(orderId)
      
      const response = await fetch('/api/admin/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, status: newStatus })
      })

      if (!response.ok) {
        throw new Error('Failed to update order')
      }

      const data = await response.json()
      
      // Update local orders state
      setOrders(prev => prev.map(order => 
        order.id === orderId ? data.order : order
      ))
      
      toast.success(`Order ${newStatus} successfully`)
    } catch (error) {
      console.error('Error updating order:', error)
      toast.error('Failed to update order')
    } finally {
      setUpdating(null)
    }
  }

  const filteredOrders = orders.filter(order => {
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      return (
        order.id.toLowerCase().includes(searchLower) ||
        order.customer_email.toLowerCase().includes(searchLower) ||
        order.profiles?.full_name?.toLowerCase().includes(searchLower)
      )
    }
    return true
  })

  const getStatusButton = (order: Order) => {
    const currentStatus = order.status
    let nextStatus = ''
    let buttonText = ''
    let buttonColor = ''

    switch (currentStatus) {
      case 'pending':
      case 'confirmed': // Treat confirmed same as pending
        nextStatus = 'preparing'
        buttonText = 'Start Preparing'
        buttonColor = 'bg-blue-600 hover:bg-blue-700'
        break
      case 'preparing':
        nextStatus = 'ready'
        buttonText = 'Mark Ready'
        buttonColor = 'bg-green-600 hover:bg-green-700'
        break
      case 'ready':
        nextStatus = 'completed'
        buttonText = 'Complete Order'
        buttonColor = 'bg-gray-600 hover:bg-gray-700'
        break
      default:
        return null
    }

    return (
      <Button
        size="sm"
        onClick={() => updateOrderStatus(order.id, nextStatus)}
        disabled={updating === order.id}
        className={`${buttonColor} text-white text-xs px-2 py-1`}
      >
        {updating === order.id ? 'Updating...' : buttonText}
      </Button>
    )
  }

  const handlePreviousPage = () => {
    if (pagination.offset > 0) {
      setPagination(prev => ({
        ...prev,
        offset: Math.max(0, prev.offset - prev.limit)
      }))
    }
  }

  const handleNextPage = () => {
    if (pagination.hasMore) {
      setPagination(prev => ({
        ...prev,
        offset: prev.offset + prev.limit
      }))
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="all">All Orders</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="preparing">Preparing</option>
              <option value="ready">Ready</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Order ID, email, name..."
                value={filters.search}
                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                className="w-full pl-10 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
          
          {/* Quick Filter Actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => setFilters(prev => ({ ...prev, ...getDefaultDates() }))}
              className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm hover:bg-amber-200 transition-colors"
            >
              Recent (Yesterday - Today)
            </button>
            <button
              onClick={() => setFilters(prev => ({ ...prev, startDate: '', endDate: '' }))}
              className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm hover:bg-gray-200 transition-colors"
            >
              All Orders
            </button>
            <button
              onClick={() => {
                const today = new Date().toISOString().split('T')[0]
                setFilters(prev => ({ ...prev, startDate: today, endDate: today }))
              }}
              className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm hover:bg-blue-200 transition-colors"
            >
              Today Only
            </button>
            <button
              onClick={() => setFilters(prev => ({ ...prev, status: 'pending' }))}
              className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm hover:bg-yellow-200 transition-colors"
            >
              Pending Orders
            </button>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Orders ({pagination.total})
              </h3>
              {(filters.startDate || filters.endDate) && (
                <p className="text-sm text-gray-600 mt-1">
                  {filters.startDate && filters.endDate 
                    ? `Showing orders from ${new Date(filters.startDate).toLocaleDateString()} to ${new Date(filters.endDate).toLocaleDateString()}`
                    : filters.startDate 
                    ? `Showing orders from ${new Date(filters.startDate).toLocaleDateString()} onwards`
                    : `Showing orders up to ${new Date(filters.endDate).toLocaleDateString()}`
                  }
                </p>
              )}
            </div>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto"></div>
            <p className="mt-2 text-gray-500">Loading orders...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No orders found</h3>
            <p className="text-gray-500 mb-4">
              {filters.startDate || filters.endDate 
                ? "No orders match your date filter. Try expanding the date range."
                : filters.status !== 'all'
                ? `No orders with status "${filters.status}". Try selecting "All Orders".`
                : filters.search
                ? "No orders match your search terms. Try different keywords."
                : "No orders have been placed yet."
              }
            </p>
            {(filters.status !== 'all' || filters.search) && (
              <button
                onClick={() => setFilters({ status: 'all', ...getDefaultDates(), search: '' })}
                className="text-amber-600 hover:text-amber-700 font-medium text-sm"
              >
                Reset filters
              </button>
            )}
            {(filters.startDate !== getDefaultDates().startDate || filters.endDate !== getDefaultDates().endDate) && (
              <button
                onClick={() => setFilters(prev => ({ ...prev, ...getDefaultDates() }))}
                className="text-amber-600 hover:text-amber-700 font-medium text-sm ml-2"
              >
                Reset to default dates
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Order
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Items
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredOrders.map((order) => {
                  const StatusIcon = statusIcons[order.status as keyof typeof statusIcons] || Clock
                  return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            #{order.id.slice(-8)}
                          </p>
                          <p className="text-xs text-gray-500">
                            {order.payment_status}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {order.profiles?.full_name || 'Guest'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {order.customer_email}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-900">
                          {order.order_items?.length || 0} items
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm font-medium text-gray-900">
                          ${formatPrice(order.total_amount || 0)}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          statusColors[order.status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800'
                        }`}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {order.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(order.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedOrder(order)
                            setShowOrderModal(true)
                          }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {getStatusButton(order)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.total > pagination.limit && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing {pagination.offset + 1} to {Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total} orders
            </div>
            <div className="flex space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousPage}
                disabled={pagination.offset === 0}
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={!pagination.hasMore}
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      <OrderDetailsModal
        order={selectedOrder}
        isOpen={showOrderModal}
        onClose={() => {
          setShowOrderModal(false)
          setSelectedOrder(null)
        }}
      />
    </div>
  )
}

