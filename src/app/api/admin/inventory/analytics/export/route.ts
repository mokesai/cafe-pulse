import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createCurrentTenantClient } from '@/lib/supabase/server'

type InventoryExportRecord = {
  item_name: string
  current_stock: number
  minimum_threshold: number
  reorder_point: number
  unit_cost: number
  unit_type: string
  location: string | null
  supplier_name: string | null
  notes: string | null
}

type MovementExportRecord = {
  created_at: string
  movement_type: string
  quantity_change: number
  reference_type: string | null
  notes: string | null
  inventory_items: Array<{
    item_name: string
    unit_type: string
  }> | null
}

type PurchaseOrderExportRecord = {
  order_number: string
  status: string
  order_date: string
  expected_delivery_date: string | null
  actual_delivery_date: string | null
  total_amount: number
  suppliers: Array<{
    name: string
  }> | null
}

type SupplierExportRecord = {
  name: string
  contact_person: string | null
  email: string | null
  phone: string | null
  is_active: boolean
  created_at: string
}

export async function GET(request: NextRequest) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') || '30d'

    // Calculate date ranges
    const now = new Date()
    let startDate: Date
    
    switch (range) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      default: // 30d
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    const supabase = await createCurrentTenantClient()

    console.log('Exporting inventory analytics for range:', range)

    // Fetch all relevant data for export
    const [inventoryResult, movementsResult, ordersResult, suppliersResult] = await Promise.all([
      supabase
        .from('inventory_items')
        .select('item_name, current_stock, minimum_threshold, reorder_point, unit_cost, unit_type, location, supplier_name, notes'),
      
      supabase
        .from('stock_movements')
        .select(`
          created_at,
          movement_type,
          quantity_change,
          reference_type,
          notes,
          inventory_items!inner (item_name, unit_type)
        `)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false }),
      
      supabase
        .from('purchase_orders')
        .select(`
          order_number,
          status,
          order_date,
          expected_delivery_date,
          actual_delivery_date,
          total_amount,
          suppliers!inner (name)
        `)
        .gte('created_at', startDate.toISOString())
        .order('order_date', { ascending: false }),
      
      supabase
        .from('suppliers')
        .select('name, contact_person, email, phone, is_active, created_at')
        .order('name')
    ])

    // Build CSV content
    const csvSections = []

    // Inventory Overview Section
    csvSections.push('INVENTORY OVERVIEW')
    csvSections.push('Item Name,Current Stock,Unit Type,Unit Cost,Value,Status,Min Threshold,Reorder Point,Location,Supplier,Notes')
    
    const inventoryData = (inventoryResult.data ?? []) as InventoryExportRecord[]
    if (inventoryData.length > 0) {
      inventoryData.forEach(item => {
        const value = item.current_stock * item.unit_cost
        const status = item.current_stock === 0 ? 'Out of Stock' :
                     item.current_stock <= item.minimum_threshold ? 'Critical' :
                     item.current_stock <= item.reorder_point ? 'Low Stock' : 'Good'
        
        csvSections.push([
          `"${item.item_name}"`,
          item.current_stock,
          `"${item.unit_type}"`,
          item.unit_cost.toFixed(2),
          value.toFixed(2),
          `"${status}"`,
          item.minimum_threshold,
          item.reorder_point,
          `"${item.location || ''}"`,
          `"${item.supplier_name || ''}"`,
          `"${item.notes || ''}"`
        ].join(','))
      })
    }

    csvSections.push('')
    csvSections.push('')

    // Stock Movements Section
    csvSections.push('STOCK MOVEMENTS')
    csvSections.push('Date,Time,Item Name,Movement Type,Quantity,Unit Type,Reference Type,Notes')
    
    const movementData = (movementsResult.data ?? []) as MovementExportRecord[]
    if (movementData.length > 0) {
      movementData.forEach(movement => {
        const date = new Date(movement.created_at)
        const movementItem = movement.inventory_items?.[0]
        csvSections.push([
          date.toLocaleDateString(),
          date.toLocaleTimeString(),
          `"${movementItem?.item_name || 'Unknown'}"`,
          movement.movement_type.toUpperCase(),
          movement.quantity_change,
          `"${movementItem?.unit_type || 'each'}"`,
          `"${movement.reference_type || ''}"`,
          `"${movement.notes || ''}"`
        ].join(','))
      })
    }

    csvSections.push('')
    csvSections.push('')

    // Purchase Orders Section
    csvSections.push('PURCHASE ORDERS')
    csvSections.push('Order Number,Supplier,Status,Order Date,Expected Delivery,Actual Delivery,Total Amount,Delivery Performance')
    
    const purchaseOrderData = (ordersResult.data ?? []) as PurchaseOrderExportRecord[]
    if (purchaseOrderData.length > 0) {
      purchaseOrderData.forEach(order => {
        const orderDate = new Date(order.order_date)
        const expectedDate = order.expected_delivery_date ? new Date(order.expected_delivery_date) : null
        const actualDate = order.actual_delivery_date ? new Date(order.actual_delivery_date) : null
        
        let deliveryPerformance = 'N/A'
        if (actualDate && expectedDate) {
          deliveryPerformance = actualDate <= expectedDate ? 'On Time' : 'Late'
        } else if (expectedDate && order.status !== 'received' && order.status !== 'cancelled') {
          deliveryPerformance = expectedDate < now ? 'Overdue' : 'Pending'
        }
        
        const supplierName = order.suppliers?.[0]?.name
        csvSections.push([
          `"${order.order_number}"`,
          `"${supplierName || 'Unknown Supplier'}"`,
          order.status.toUpperCase(),
          orderDate.toLocaleDateString(),
          expectedDate ? expectedDate.toLocaleDateString() : '',
          actualDate ? actualDate.toLocaleDateString() : '',
          order.total_amount.toFixed(2),
          `"${deliveryPerformance}"`
        ].join(','))
      })
    }

    csvSections.push('')
    csvSections.push('')

    // Suppliers Section
    csvSections.push('SUPPLIERS')
    csvSections.push('Name,Contact Person,Email,Phone,Status,Added Date')
    
    const supplierData = (suppliersResult.data ?? []) as SupplierExportRecord[]
    if (supplierData.length > 0) {
      supplierData.forEach(supplier => {
        const addedDate = new Date(supplier.created_at)
        csvSections.push([
          `"${supplier.name}"`,
          `"${supplier.contact_person || ''}"`,
          `"${supplier.email || ''}"`,
          `"${supplier.phone || ''}"`,
          supplier.is_active ? 'Active' : 'Inactive',
          addedDate.toLocaleDateString()
        ].join(','))
      })
    }

    csvSections.push('')
    csvSections.push('')

    // Summary Statistics
    const totalItems = inventoryResult.data?.length || 0
    const totalValue = inventoryResult.data?.reduce((sum, item) => sum + (item.current_stock * item.unit_cost), 0) || 0
    const lowStockItems = inventoryResult.data?.filter(item => 
      item.current_stock <= item.reorder_point && item.current_stock > item.minimum_threshold
    ).length || 0
    const criticalStockItems = inventoryResult.data?.filter(item => 
      item.current_stock <= item.minimum_threshold && item.current_stock > 0
    ).length || 0
    const outOfStockItems = inventoryResult.data?.filter(item => item.current_stock === 0).length || 0
    
    const totalOrders = ordersResult.data?.length || 0
    const totalOrderValue = ordersResult.data?.reduce((sum, order) => sum + order.total_amount, 0) || 0
    const totalSuppliers = suppliersResult.data?.length || 0
    const activeSuppliers = suppliersResult.data?.filter(s => s.is_active).length || 0

    csvSections.push('SUMMARY STATISTICS')
    csvSections.push('Metric,Value')
    csvSections.push(`Total Inventory Items,${totalItems}`)
    csvSections.push(`Total Inventory Value,$${totalValue.toFixed(2)}`)
    csvSections.push(`Low Stock Items,${lowStockItems}`)
    csvSections.push(`Critical Stock Items,${criticalStockItems}`)
    csvSections.push(`Out of Stock Items,${outOfStockItems}`)
    csvSections.push(`Total Purchase Orders,${totalOrders}`)
    csvSections.push(`Total Order Value,$${totalOrderValue.toFixed(2)}`)
    csvSections.push(`Total Suppliers,${totalSuppliers}`)
    csvSections.push(`Active Suppliers,${activeSuppliers}`)
    csvSections.push('')
    csvSections.push(`Report Generated,${new Date().toLocaleString()}`)
    csvSections.push(`Date Range,${range}`)

    // Join all sections
    const csvContent = csvSections.join('\n')

    console.log('✅ Successfully generated analytics export')

    // Return as downloadable CSV
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="inventory-analytics-${range}-${new Date().toISOString().split('T')[0]}.csv"`
      }
    })

  } catch (error) {
    console.error('Failed to export inventory analytics:', error)
    return NextResponse.json(
      { 
        error: 'Failed to export inventory analytics', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
