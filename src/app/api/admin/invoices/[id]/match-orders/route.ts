import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { findOrderMatches } from '@/lib/matching/item-matcher'

interface RouteContext {
  params: Promise<{ id: string }>
}

type SupplierEmbed = { id: string; name: string } | Array<{ id: string; name: string }> | null
type InventoryItemEmbed = { id: string; item_name: string } | Array<{ id: string; item_name: string }> | null

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await context.params
    const { id } = resolvedParams
    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    console.log('🔍 Starting order matching for invoice:', id)

    // Get invoice details
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_date,
        total_amount,
        supplier_id,
        suppliers (
          id,
          name
        ),
        invoice_items (
          id,
          item_description,
          quantity,
          unit_price,
          total_price
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      )
    }

    // Check for existing linked purchase order
    const { data: existingMatches, error: existingError } = await supabase
      .from('order_invoice_matches')
      .select(`
        id,
        purchase_order_id,
        match_confidence,
        match_method,
        status,
        quantity_variance,
        amount_variance,
        variance_notes,
        created_at,
        purchase_orders (
          id,
          order_number,
          supplier_id,
          order_date,
          expected_delivery_date,
          status,
          total_amount,
          suppliers (
            id,
            name
          ),
          purchase_order_items (
            id,
            inventory_item_id,
            quantity_ordered,
            unit_cost,
            total_cost,
            inventory_items (
              id,
              item_name
            )
          )
        )
      `)
      .eq('invoice_id', id)
      .order('created_at', { ascending: false })

    if (existingError) {
      console.error('Failed to fetch existing order matches:', existingError)
    }

    const existingMatchRecord = existingMatches && existingMatches.length > 0 ? existingMatches[0] : null
    const linkedOrderId = existingMatchRecord?.purchase_order_id || null

    // Get candidate purchase orders (sent/confirmed status, same supplier, recent)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: purchaseOrders, error: ordersError } = await supabase
      .from('purchase_orders')
      .select(`
        id,
        order_number,
        supplier_id,
        order_date,
        expected_delivery_date,
        status,
        total_amount,
        suppliers (
          id,
          name
        ),
        purchase_order_items (
          id,
          inventory_item_id,
          quantity_ordered,
          unit_cost,
          total_cost,
          inventory_items (
            id,
            item_name
          )
        )
      `)
      .eq('supplier_id', invoice.supplier_id)
      .eq('tenant_id', tenantId)
      .in('status', ['sent', 'confirmed'])
      .gte('order_date', thirtyDaysAgo.toISOString())
      .order('order_date', { ascending: false })

    if (ordersError) {
      console.error('Error fetching purchase orders:', ordersError)
      return NextResponse.json(
        { error: 'Failed to fetch purchase orders' },
        { status: 500 }
      )
    }

    // Transform purchase orders for matching
    const formattedOrders = (purchaseOrders || []).map(mapPurchaseOrder)

    console.log(`📦 Found ${formattedOrders.length} candidate purchase orders`)

    // Transform invoice items for matching
    const invoiceItems = (invoice.invoice_items || []).map(item => ({
      id: item.id,
      item_description: item.item_description,
      quantity: item.quantity,
      unit_price: item.unit_price
    }))

    type SupplierInfo = { name?: string } | null
    const supplierName = (invoice.suppliers as SupplierInfo)?.name || ''

    // Find order matches
    const orderMatches = await findOrderMatches(
      supplierName,
      invoice.invoice_date,
      invoice.total_amount,
      invoiceItems,
      formattedOrders
    )

    let linkedMatch = null

    if (linkedOrderId) {
      // Remove the linked order from suggestions if present
      const linkedIndex = orderMatches.findIndex(match => match.purchase_order_id === linkedOrderId)
      if (linkedIndex >= 0) {
        linkedMatch = orderMatches[linkedIndex]
        orderMatches.splice(linkedIndex, 1)
      } else {
        const embeddedPurchaseOrder = extractEmbeddedPurchaseOrder(existingMatchRecord?.purchase_orders)
        let linkedPurchaseOrder: PurchaseOrderRow | null = embeddedPurchaseOrder

        if (!linkedPurchaseOrder) {
          const { data: purchaseOrder, error: linkedOrderError } = await supabase
            .from('purchase_orders')
            .select(`
              id,
              order_number,
              supplier_id,
              order_date,
              expected_delivery_date,
              status,
              total_amount,
              suppliers (
                id,
                name
              ),
              purchase_order_items (
                id,
                inventory_item_id,
                quantity_ordered,
                unit_cost,
                total_cost,
                inventory_items (
                  id,
                  item_name
                )
              )
            `)
            .eq('id', linkedOrderId)
            .maybeSingle()

          if (linkedOrderError) {
            console.error('Failed to fetch linked purchase order:', linkedOrderError)
          } else if (purchaseOrder) {
            linkedPurchaseOrder = purchaseOrder as unknown as PurchaseOrderRow
          }
        }

        if (linkedPurchaseOrder) {
          const formattedOrder = mapPurchaseOrder(linkedPurchaseOrder)
          linkedMatch = {
            purchase_order_id: formattedOrder.id,
            purchase_order: formattedOrder,
            confidence: existingMatchRecord?.match_confidence || 0.9,
            match_reasons: existingMatchRecord?.variance_notes
              ? [existingMatchRecord.variance_notes]
              : ['Previously linked to this purchase order'],
            quantity_variance: existingMatchRecord?.quantity_variance ?? 0,
            amount_variance:
              existingMatchRecord?.amount_variance ??
              Math.abs(invoice.total_amount - formattedOrder.total_amount),
            matched_items: formattedOrder.items.length,
            total_items: formattedOrder.items.length
          }
        }
      }
    }

    // Auto-create high confidence matches
    const autoMatches = []
    if (!linkedMatch) {
      for (const match of orderMatches) {
        if (match.confidence >= 0.7) {
          const { data: existingMatch } = await supabase
            .from('order_invoice_matches')
            .select('id')
            .eq('invoice_id', id)
            .eq('purchase_order_id', match.purchase_order_id)
            .single()

          if (!existingMatch) {
            const { data: newMatch, error: matchError } = await supabase
              .from('order_invoice_matches')
              .insert({
                invoice_id: id,
                purchase_order_id: match.purchase_order_id,
                match_confidence: match.confidence,
                match_method: 'auto',
                status: 'pending',
                quantity_variance: match.quantity_variance,
                amount_variance: match.amount_variance,
                variance_notes: `Auto-matched: ${match.match_reasons.join(', ')}`
              })
              .select()
              .single()

            if (matchError) {
              console.error('Failed to create auto-match:', matchError)
            } else {
              autoMatches.push(newMatch)
              linkedMatch = match
              console.log(`✅ Auto-matched order: ${match.purchase_order.order_number}`)
              break
            }
          }
        }
      }
    }

    // Calculate matching statistics
    const statistics = {
      total_candidates: formattedOrders.length,
      matches_found: orderMatches.length,
      high_confidence_matches: orderMatches.filter(m => m.confidence >= 0.7).length,
      auto_matches_created: autoMatches.length,
      best_match_confidence: linkedMatch?.confidence ?? (orderMatches.length > 0 ? orderMatches[0].confidence : 0)
    }

    console.log('✅ Order matching completed:', statistics)

    return NextResponse.json({
      success: true,
      data: {
        invoice_id: id,
        invoice_date: invoice.invoice_date,
        invoice_total: invoice.total_amount,
        supplier_name: supplierName,
        linked_match: linkedMatch,
        order_matches: orderMatches,
        auto_matches: autoMatches,
        statistics
      },
      message: 'Order matching completed successfully'
    })

  } catch (error) {
    console.error('Failed to match orders:', error)
    return NextResponse.json(
      { 
        error: 'Failed to match orders', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

type PurchaseOrderRow = {
  id: string
  order_number: string
  supplier_id: string
  order_date: string
  expected_delivery_date: string | null
  status: string
  total_amount: number
  suppliers: SupplierEmbed
  purchase_order_items: Array<{
    id: string
    inventory_item_id: string | null
    quantity_ordered: number
    unit_cost: number
    total_cost: number | null
    inventory_items: InventoryItemEmbed
  }>
}

function mapPurchaseOrder(order: PurchaseOrderRow) {
  const supplier = Array.isArray(order.suppliers) ? order.suppliers[0] : order.suppliers

  return {
    id: order.id,
    order_number: order.order_number,
    supplier_id: order.supplier_id,
    supplier_name: supplier?.name || '',
    order_date: order.order_date,
    expected_delivery_date: order.expected_delivery_date ?? undefined,
    status: order.status,
    total_amount: order.total_amount,
    items: (order.purchase_order_items || []).map((item) => {
      const inventoryItemId = item.inventory_item_id ?? ''
      const totalCost = item.total_cost ?? item.unit_cost * item.quantity_ordered
      const inventoryItem = Array.isArray(item.inventory_items) ? item.inventory_items[0] : item.inventory_items

      return {
        id: item.id,
        inventory_item_id: inventoryItemId,
        item_name: inventoryItem?.item_name || 'Unknown Item',
        quantity_ordered: item.quantity_ordered,
        unit_cost: item.unit_cost,
        total_cost: totalCost
      }
    })
  }
}

function extractEmbeddedPurchaseOrder(embedded: unknown): PurchaseOrderRow | null {
  if (!embedded) return null
  if (Array.isArray(embedded)) {
    return (embedded[0] as PurchaseOrderRow) || null
  }
  return embedded as PurchaseOrderRow
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    // Verify admin authentication
    const authResult = await requireAdminAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const resolvedParams = await context.params
    const { id } = resolvedParams
    const supabase = createServiceClient()

    // Get existing order matches for the invoice
    const { data: matches, error } = await supabase
      .from('order_invoice_matches')
      .select(`
        id,
        match_confidence,
        match_method,
        status,
        quantity_variance,
        amount_variance,
        variance_notes,
        created_at,
        purchase_orders (
          id,
          order_number,
          order_date,
          total_amount,
          status,
          suppliers (name)
        )
      `)
      .eq('invoice_id', id)
      .order('match_confidence', { ascending: false })

    if (error) {
      console.error('Error fetching order matches:', error)
      return NextResponse.json(
        { error: 'Failed to fetch order matches' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        invoice_id: id,
        order_matches: matches || []
      }
    })

  } catch (error) {
    console.error('Failed to get order matches:', error)
    return NextResponse.json(
      { 
        error: 'Failed to get order matches', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
