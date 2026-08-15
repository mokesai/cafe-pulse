'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Button } from '@/components/ui'
import toast from 'react-hot-toast'
import { 
  Package, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  Search, 
  Filter,
  Plus,
  RefreshCw,
  CloudDownload,
  Building2,
  Link2,
  ClipboardList,
  Settings,
  MoreVertical,
  X
} from 'lucide-react'
import InventoryEditModal from './InventoryEditModal'
import InventoryCreateModal from './InventoryCreateModal'
import InventoryAdjustModal from './InventoryAdjustModal'
import RestockModal from './RestockModal'
import SuppliersManagement, { type Supplier } from './SuppliersManagement'
import PurchaseOrdersManagement from './PurchaseOrdersManagement'
import InventorySettings from './InventorySettings'

interface InventoryItem {
  id: string
  square_item_id: string
  item_name: string
  current_stock: number
  minimum_threshold: number
  reorder_point: number
  unit_cost: number
  unit_type: string
  pack_size?: number
  pack_price?: number
  is_packaged_variant?: boolean
  is_ingredient: boolean
  item_type?: 'ingredient' | 'prepackaged' | 'prepared' | 'supply'
  auto_decrement?: boolean
  supplier_id?: string
  supplier_name?: string
  location: string
  notes?: string
  package_label?: string | null
  last_restocked_at?: string
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

interface StockAlert {
  id: string
  inventory_item_id: string
  item_name: string
  alert_level: 'low' | 'critical' | 'out_of_stock'
  stock_level: number
  threshold_level: number
  is_acknowledged: boolean
  created_at: string
}

const InventoryManagement = () => {
  const [activeTab, setActiveTab] = useState('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [stockFilter, setStockFilter] = useState('all') // all, low, critical, out_of_stock
  const [supplierFilter, setSupplierFilter] = useState('all') // all, or supplier_id
  const [squareMatchFilter, setSquareMatchFilter] = useState('all') // all, matched, unmatched
  const [showArchived, setShowArchived] = useState(false)
  
  // Modal states
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [restockModalOpen, setRestockModalOpen] = useState(false)
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [openInventoryActionMenuId, setOpenInventoryActionMenuId] = useState<string | null>(null)
  
  const queryClient = useQueryClient()

  // Fetch inventory items
  const { 
    data: inventoryData, 
    isLoading: inventoryLoading
  } = useQuery({
    queryKey: ['admin-inventory', showArchived],
    queryFn: async () => {
      const response = await fetch(`/api/admin/inventory${showArchived ? '?includeArchived=1' : ''}`)
      if (!response.ok) {
        throw new Error('Failed to fetch inventory')
      }
      return response.json()
    }
  })

  // Fetch stock alerts
  const { 
    data: alertsData
  } = useQuery({
    queryKey: ['admin-stock-alerts'],
    queryFn: async () => {
      const response = await fetch('/api/admin/inventory/alerts')
      if (!response.ok) {
        throw new Error('Failed to fetch stock alerts')
      }
      return response.json()
    }
  })

  // Fetch suppliers for edit modal
  const { data: suppliersData } = useQuery({
    queryKey: ['admin-suppliers'],
    queryFn: async () => {
      const response = await fetch('/api/admin/suppliers')
      if (!response.ok) {
        return { suppliers: [] } // Return empty array if suppliers API doesn't exist yet
      }
      return response.json()
    }
  })

  // B3 (MOK-175): items whose supplier cost jumped recently → prompt a menu-price review.
  const { data: priceReviewData } = useQuery({
    queryKey: ['admin-price-review'],
    queryFn: async () => {
      const response = await fetch('/api/admin/inventory/price-review')
      if (!response.ok) return { items: [], count: 0 }
      return response.json()
    }
  })

  const inventoryItems: InventoryItem[] = inventoryData?.items || []
  const stockAlerts: StockAlert[] = alertsData?.alerts || []
  const suppliers: Supplier[] = suppliersData?.suppliers ?? []
  const priceReviewItems: Array<{ id: string; item_name: string; pct_change: number }> =
    priceReviewData?.items ?? []
  const priceReviewById = new Map<string, number>(priceReviewItems.map((p) => [p.id, p.pct_change]))

  // Sales sync status
  const { data: salesSyncStatus, isFetching: salesSyncFetching, error: salesSyncError } = useQuery({
    queryKey: ['admin-sales-sync-status'],
    queryFn: async () => {
      const response = await fetch('/api/admin/inventory/sales-sync/status')
      if (!response.ok) {
        throw new Error('Failed to fetch sales sync status')
      }
      return response.json()
    },
    refetchOnWindowFocus: false,
    retry: false
  })

  useEffect(() => {
    if (salesSyncError instanceof Error) {
      toast.error(salesSyncError.message || 'Unable to load sales sync status')
    }
  }, [salesSyncError])

  const salesSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/admin/inventory/sales-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData?.error || 'Failed to sync Square sales')
      }

      return response.json()
    },
    onSuccess: (data) => {
      const processed = data?.metrics?.ordersProcessed ?? 0
      toast.success(`Synced ${processed} Square order${processed === 1 ? '' : 's'}`)
      queryClient.invalidateQueries({ queryKey: ['admin-inventory'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stock-alerts'] })
      queryClient.invalidateQueries({ queryKey: ['admin-sales-sync-status'] })
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Sync failed')
    }
  })

  const formatRelativeTime = (iso?: string | null) => {
    if (!iso) return 'Never synced'
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return 'Unknown'

    const diffMs = Date.now() - date.getTime()
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diffMs < minute) return 'Just now'
    if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`
    if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`
    return date.toLocaleString()
  }

  const lastSyncTimestamp: string | null = salesSyncStatus?.lastRun?.finished_at
    || salesSyncStatus?.lastRun?.started_at
    || null
  const lastSyncLabel = formatRelativeTime(lastSyncTimestamp)
  const pendingManualQuantity = salesSyncStatus?.pendingManual?.totalQuantity
    ? Math.round(Number(salesSyncStatus.pendingManual.totalQuantity))
    : 0
  const syncStatusText = salesSyncFetching ? 'Checking status...' : lastSyncLabel

  // Modal handlers
  const handleEditItem = (item: InventoryItem) => {
    setSelectedItem(item)
    setEditModalOpen(true)
  }

  const handleRestockItem = (item: InventoryItem) => {
    if (item.is_packaged_variant) {
      toast.error('Pack variants have stock fixed at 0. Restock the base (single-unit) item instead.')
      return
    }
    setSelectedItem(item)
    setRestockModalOpen(true)
  }

  const handleAdjustItem = (item: InventoryItem) => {
    if (item.is_packaged_variant) {
      toast.error('Pack variants have stock fixed at 0. Adjust the base (single-unit) item instead.')
      return
    }
    setSelectedItem(item)
    setAdjustModalOpen(true)
  }

  const archiveItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const response = await fetch(`/api/admin/inventory?id=${itemId}`, { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to archive item')
      }
      return result
    },
    onSuccess: () => {
      toast.success('Item archived')
      queryClient.invalidateQueries({ queryKey: ['admin-inventory'] })
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to archive item')
    }
  })

  const restoreItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const response = await fetch(`/api/admin/inventory/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: itemId })
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to restore item')
      }
      return result
    },
    onSuccess: () => {
      toast.success('Item restored')
      queryClient.invalidateQueries({ queryKey: ['admin-inventory'] })
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to restore item')
    }
  })

  const handleArchiveItem = (item: InventoryItem) => {
    if (!item.id) return
    const confirmArchive = window.confirm(`Archive ${item.item_name}? This hides it from inventory but keeps history.`)
    if (!confirmArchive) return
    archiveItemMutation.mutate(item.id)
  }

  const handleRestoreItem = (item: InventoryItem) => {
    if (!item.id) return
    restoreItemMutation.mutate(item.id)
  }

  const closeModals = () => {
    setCreateModalOpen(false)
    setEditModalOpen(false)
    setRestockModalOpen(false)
    setAdjustModalOpen(false)
    setSelectedItem(null)
  }

  const inventoryItemsWithPackFlags = (() => {
    const bySquareId = new Map<string, Array<{ id: string; pack_size: number }>>()
    for (const item of inventoryItems) {
      if (!item.square_item_id) continue
      const packSize = Number(item.pack_size) || 1
      const list = bySquareId.get(item.square_item_id) ?? []
      list.push({ id: item.id, pack_size: packSize })
      bySquareId.set(item.square_item_id, list)
    }

    const pairedSquareIds = new Set<string>()
    for (const [squareId, list] of bySquareId.entries()) {
      const hasBase = list.some(entry => entry.pack_size === 1)
      const hasPack = list.some(entry => entry.pack_size > 1)
      if (hasBase && hasPack) pairedSquareIds.add(squareId)
    }

    return inventoryItems.map(item => {
      const packSize = Number(item.pack_size) || 1
      const isPackagedVariant = Boolean(item.square_item_id && packSize > 1 && pairedSquareIds.has(item.square_item_id))
      return {
        ...item,
        is_packaged_variant: isPackagedVariant
      }
    })
  })()

  // Filter items based on search, stock level, and supplier
  const filteredItems = inventoryItemsWithPackFlags.filter(item => {
    const matchesSearch = item.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         item.location.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesStockFilter = (() => {
      switch (stockFilter) {
        case 'low':
          return item.current_stock <= item.reorder_point && item.current_stock > item.minimum_threshold
        case 'critical':
          return item.current_stock <= item.minimum_threshold && item.current_stock > 0
        case 'out_of_stock':
          return item.current_stock === 0
        default:
          return true
      }
    })()

    const matchesSupplierFilter = supplierFilter === 'all' || item.supplier_id === supplierFilter
    const matchesSquareFilter = (() => {
      switch (squareMatchFilter) {
        case 'matched':
          return Boolean(item.square_item_id)
        case 'unmatched':
          return !item.square_item_id
        default:
          return true
      }
    })()

    return matchesSearch && matchesStockFilter && matchesSupplierFilter && matchesSquareFilter
  })

  // Calculate summary statistics
  const totalItems = inventoryItemsWithPackFlags.length
  const lowStockItems = inventoryItemsWithPackFlags.filter(item => 
    item.current_stock <= item.reorder_point && item.current_stock > item.minimum_threshold
  ).length
  const criticalStockItems = inventoryItemsWithPackFlags.filter(item => 
    item.current_stock <= item.minimum_threshold && item.current_stock > 0
  ).length
  const outOfStockItems = inventoryItemsWithPackFlags.filter(item => item.current_stock === 0).length
  const totalValue = inventoryItemsWithPackFlags.reduce((sum, item) => sum + (item.current_stock * item.unit_cost), 0)

  const getStockStatus = (item: InventoryItem) => {
    if (item.current_stock === 0) return { status: 'out_of_stock', color: 'text-red-600 bg-red-50', label: 'Out of Stock' }
    if (item.current_stock <= item.minimum_threshold) return { status: 'critical', color: 'text-red-600 bg-red-50', label: 'Critical' }
    if (item.current_stock <= item.reorder_point) return { status: 'low', color: 'text-amber-600 bg-amber-50', label: 'Low Stock' }
    return { status: 'good', color: 'text-green-600 bg-green-50', label: 'Good Stock' }
  }

  if (inventoryLoading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading inventory data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Management</h1>
          <p className="text-gray-600 mt-1">Track stock levels, manage suppliers, and monitor inventory</p>
        </div>
        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
            <Button
              variant="outline"
              onClick={() => salesSyncMutation.mutate()}
              disabled={salesSyncMutation.isPending}
            >
              {salesSyncMutation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CloudDownload className="w-4 h-4 mr-2" />
              )}
              Sync Square Sales
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['admin-inventory'] })
                queryClient.invalidateQueries({ queryKey: ['admin-stock-alerts'] })
                queryClient.invalidateQueries({ queryKey: ['admin-sales-sync-status'] })
              }}
              disabled={inventoryLoading}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button
              className="bg-primary-600 hover:bg-primary-700"
              onClick={() => {
                setSelectedItem(null)
                setCreateModalOpen(true)
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
            {pendingManualQuantity > 0 && (
              <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                {pendingManualQuantity} manual adjustment{pendingManualQuantity === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 text-right">
            <p>Last sync: {syncStatusText}</p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-600">Total Items</p>
              <p className="text-lg font-bold text-gray-900">{totalItems}</p>
            </div>
            <Package className="w-6 h-6 text-blue-600 shrink-0" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-600">Low Stock</p>
              <p className="text-lg font-bold text-amber-600">{lowStockItems}</p>
            </div>
            <TrendingDown className="w-6 h-6 text-amber-600 shrink-0" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-600">Critical</p>
              <p className="text-lg font-bold text-red-600">{criticalStockItems}</p>
            </div>
            <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-600">Out of Stock</p>
              <p className="text-lg font-bold text-red-600">{outOfStockItems}</p>
            </div>
            <Package className="w-6 h-6 text-red-600 shrink-0" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-600">Total Value</p>
              <p className="text-lg font-bold text-green-600">${totalValue.toFixed(2)}</p>
            </div>
            <TrendingUp className="w-6 h-6 text-green-600 shrink-0" />
          </div>
        </div>

        {pendingManualQuantity > 0 && (
          <div className="bg-amber-50 p-5 rounded-lg shadow-sm border border-amber-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-amber-700">Manual Adjustments</p>
                <p className="text-lg font-bold text-amber-900">
                  {pendingManualQuantity}
                </p>
                <p className="text-[11px] text-amber-700 mt-1">Pending ingredient deductions</p>
              </div>
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex w-full h-12">
          <TabsTrigger value="overview" className="flex items-center gap-2 flex-1">
            <Package className="w-4 h-4" />
            Stock Overview
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="flex items-center gap-2 flex-1">
            <Building2 className="w-4 h-4" />
            Suppliers
          </TabsTrigger>
          <TabsTrigger value="orders" className="flex items-center gap-2 flex-1">
            <ClipboardList className="w-4 h-4" />
            Purchase Orders
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2 flex-1">
            <Settings className="w-4 h-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Filters */}
          <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex flex-col gap-4 lg:flex-row">
              {/* Search */}
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search inventory items..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600"
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Supplier Filter */}
              <div className="sm:w-56">
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <select
                    value={supplierFilter}
                    onChange={(e) => setSupplierFilter(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent appearance-none"
                  >
                    <option value="all">All Suppliers</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                  <Filter className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
                </div>
              </div>

              {/* Stock Level Filter */}
              <div className="sm:w-56">
                <div className="relative">
                  <Package className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <select
                    value={stockFilter}
                    onChange={(e) => setStockFilter(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent appearance-none"
                  >
                    <option value="all">All Items</option>
                    <option value="low">Low Stock</option>
                    <option value="critical">Critical Stock</option>
                    <option value="out_of_stock">Out of Stock</option>
                  </select>
                  <Filter className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
                </div>
              </div>

              {/* Square Match Filter */}
              <div className="sm:w-56">
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <select
                    value={squareMatchFilter}
                    onChange={(e) => setSquareMatchFilter(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent appearance-none"
                  >
                    <option value="all">All Square Links</option>
                    <option value="matched">Matched to Square</option>
                    <option value="unmatched">Not Matched</option>
                  </select>
                  <Filter className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Stock Alerts */}
          {stockAlerts.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="font-medium text-red-800">Stock Alerts</h4>
                  <p className="text-sm text-red-700 mt-1">
                    {stockAlerts.filter(alert => !alert.is_acknowledged).length} unacknowledged alerts
                  </p>
                  <div className="mt-2 space-y-1">
                    {stockAlerts.slice(0, 3).map(alert => (
                      <p key={alert.id} className="text-xs text-red-700">
                        • {alert.item_name}: {alert.stock_level} remaining (threshold: {alert.threshold_level})
                      </p>
                    ))}
                    {stockAlerts.length > 3 && (
                      <p className="text-xs text-red-700">+ {stockAlerts.length - 3} more alerts</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Price Review (MOK-175): items whose supplier cost jumped recently */}
          {priceReviewItems.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <TrendingUp className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="font-medium text-amber-800">Price review</h4>
                  <p className="text-sm text-amber-700 mt-1">
                    {priceReviewItems.length} item{priceReviewItems.length === 1 ? '' : 's'} had a supplier cost jump in the last 30 days — consider raising the menu price.
                  </p>
                  <div className="mt-2 space-y-1">
                    {priceReviewItems.slice(0, 3).map((p) => (
                      <p key={p.id} className="text-xs text-amber-700">
                        • {p.item_name}: cost up {p.pct_change}%
                      </p>
                    ))}
                    {priceReviewItems.length > 3 && (
                      <p className="text-xs text-amber-700">+ {priceReviewItems.length - 3} more</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Inventory Items Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-4 sm:p-5 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 text-base">Inventory Items</h3>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <p className="text-xs text-gray-600 mt-1 sm:text-sm">
                  {filteredItems.length} of {totalItems} items
                </p>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  Show archived items
                </label>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6">
                      Item
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6">
                      Current Stock
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6">
                      Unit Cost
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6">
                      Value
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6">
                      Supplier
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center sm:px-6">
                        <Package className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No inventory items found</h3>
                        <p className="text-gray-600 mb-4">
                          {searchQuery || stockFilter !== 'all' 
                            ? 'Try adjusting your search or filters' 
                            : 'Start by adding your first inventory item'
                          }
                        </p>
                        <Button className="bg-primary-600 hover:bg-primary-700">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Inventory Item
                        </Button>
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const isPackagedVariant = Boolean(item.is_packaged_variant)
                      const displayItem = isPackagedVariant ? { ...item, current_stock: 0 } : item
                      const stockStatus = getStockStatus(displayItem)
                      const itemValue = displayItem.current_stock * item.unit_cost
                      const itemType = item.item_type || (item.is_ingredient ? 'ingredient' : 'prepackaged')
                      const typeBadge = (() => {
                        switch (itemType) {
                          case 'ingredient':
                            return { label: 'Ingredient', className: 'bg-blue-100 text-blue-700' }
                          case 'prepared':
                            return { label: 'Prepared', className: 'bg-purple-100 text-purple-700' }
                          case 'supply':
                            return { label: 'Supply', className: 'bg-gray-100 text-gray-700' }
                          default:
                            return { label: 'Pre-packaged', className: 'bg-emerald-100 text-emerald-700' }
                        }
                      })()

                      return (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="px-4 py-4 align-top sm:px-6">
                            <div className="space-y-1">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                                <p className="text-sm font-medium text-gray-900">{item.item_name}</p>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${typeBadge.className}`}>
                                    {typeBadge.label}
                                  </span>
                                  {item.auto_decrement && (
                                    <span className="px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                                      Auto Sync
                                    </span>
                                  )}
                                  {item.package_label && (
                                    <span
                                      className="px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full"
                                      title="Package label — distinguishes packagings that share a Square item ID"
                                    >
                                      {item.package_label}
                                    </span>
                                  )}
                                  {priceReviewById.has(item.id) && (
                                    <span
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded-full"
                                      title={`Supplier cost up ${priceReviewById.get(item.id)}% in the last 30 days — review menu price`}
                                    >
                                      <TrendingUp className="w-3 h-3" />
                                      Review price +{priceReviewById.get(item.id)}%
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p className="text-xs text-gray-500">{item.location}</p>
                              <p className="text-xs text-gray-500">
                                Square ID: {item.square_item_id ? item.square_item_id : 'None linked'}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-900 sm:px-6 sm:whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {isPackagedVariant ? (
                                <span title="Pack variant stock is tracked on the base (single-unit) item.">
                                  0 {item.unit_type}
                                </span>
                              ) : (
                                `${item.current_stock} ${item.unit_type}`
                              )}
                            </div>
                            <div className="text-xs text-gray-500">
                              Min: {item.minimum_threshold} • Reorder: {item.reorder_point}
                            </div>
                          </td>
                          <td className="px-4 py-4 sm:px-6 sm:whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stockStatus.color}`}>
                              {stockStatus.label}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-900 sm:px-6 sm:whitespace-nowrap">
                            {(() => {
                              const packSize = item.pack_size || 1
                              const rawPackPrice = item.pack_price
                              let packPrice: number
                              if (packSize > 1) {
                                if (rawPackPrice !== undefined && rawPackPrice > 0) {
                                  packPrice = Number(rawPackPrice.toFixed(2))
                                } else if (item.unit_cost > 10) {
                                  // Heuristic: large unit_cost for a pack item likely represents the full pack price.
                                  packPrice = Number(item.unit_cost.toFixed(2))
                                } else {
                                  packPrice = Number((item.unit_cost * packSize).toFixed(2))
                                }
                              } else {
                                packPrice = item.unit_cost
                              }
                              const displayPrice = packSize > 1 ? packPrice : item.unit_cost
                              return `$${displayPrice.toFixed(2)}${packSize > 1 ? ' /pack' : ''}`
                            })()}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-900 sm:px-6 sm:whitespace-nowrap">
                            ${itemValue.toFixed(2)}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-500 sm:px-6 sm:whitespace-nowrap">
                            {item.supplier_name || 'No supplier'}
                          </td>
                          <td className="px-4 py-4 text-sm font-medium sm:px-6 sm:whitespace-nowrap">
                            <div className="relative inline-flex">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-gray-700"
                                onClick={() => setOpenInventoryActionMenuId(prev => prev === item.id ? null : item.id)}
                                aria-haspopup="menu"
                                aria-expanded={openInventoryActionMenuId === item.id}
                                aria-label={`Actions for ${item.item_name}`}
                              >
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                              {openInventoryActionMenuId === item.id && (
                                <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-md border border-gray-200 bg-white shadow-lg">
                                  <div className="py-1 text-left text-sm">
                                    <button
                                      className="w-full px-3 py-2 text-primary-600 hover:bg-gray-50 flex items-center gap-2"
                                      onClick={() => { setOpenInventoryActionMenuId(null); handleEditItem(item) }}
                                    >
                                      Edit Details
                                    </button>
                                    <button
                                      className={`w-full px-3 py-2 flex items-center gap-2 ${isPackagedVariant ? 'text-gray-400 cursor-not-allowed' : 'text-green-600 hover:bg-gray-50'}`}
                                      onClick={() => { setOpenInventoryActionMenuId(null); handleRestockItem(item) }}
                                      disabled={isPackagedVariant}
                                    >
                                      Restock
                                    </button>
                                    <button
                                      className={`w-full px-3 py-2 flex items-center gap-2 ${isPackagedVariant ? 'text-gray-400 cursor-not-allowed' : 'text-amber-600 hover:bg-gray-50'}`}
                                      onClick={() => { setOpenInventoryActionMenuId(null); handleAdjustItem(item) }}
                                      disabled={isPackagedVariant}
                                    >
                                      Adjust Stock
                                    </button>
                                    {item.deleted_at ? (
                                      <button
                                        className="w-full px-3 py-2 text-emerald-600 hover:bg-gray-50 flex items-center gap-2"
                                        onClick={() => { setOpenInventoryActionMenuId(null); handleRestoreItem(item) }}
                                        disabled={restoreItemMutation.isPending}
                                      >
                                        Restore
                                      </button>
                                    ) : (
                                      <button
                                        className="w-full px-3 py-2 text-red-600 hover:bg-gray-50 flex items-center gap-2"
                                        onClick={() => { setOpenInventoryActionMenuId(null); handleArchiveItem(item) }}
                                        disabled={archiveItemMutation.isPending}
                                      >
                                        Archive
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-6">
          <SuppliersManagement />
        </TabsContent>

        <TabsContent value="orders" className="space-y-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Purchase Orders</h3>
              <p className="text-sm text-gray-500">Log receipts or jump into the full workflow dashboard.</p>
            </div>
            <Link
              href="/admin/purchase-orders"
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50"
            >
              Open dashboard
            </Link>
          </div>
          <PurchaseOrdersManagement />
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <InventorySettings />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <InventoryCreateModal
        suppliers={suppliers}
        isOpen={createModalOpen}
        onClose={closeModals}
      />

      <InventoryEditModal
        item={selectedItem}
        suppliers={suppliers}
        isOpen={editModalOpen}
        onClose={closeModals}
      />

      <RestockModal
        item={selectedItem}
        isOpen={restockModalOpen}
        onClose={closeModals}
      />

      <InventoryAdjustModal
        item={selectedItem}
        isOpen={adjustModalOpen}
        onClose={closeModals}
      />
    </div>
  )
}

export default InventoryManagement
