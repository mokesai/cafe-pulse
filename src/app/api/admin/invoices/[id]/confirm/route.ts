import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { formatApiError, unexpectedError } from '@/lib/api/errors'

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const { id } = await context.params

    console.log('✅ Confirming invoice import:', id)

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Get the invoice and its items
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        *,
        total_fees,
        fee_cogs_distributed,
        supplier_fees,
        invoice_items!inner(
          id,
          item_description,
          quantity,
          unit_price,
          total_price,
          matched_item_id,
          match_method
        ),
        suppliers(name)
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (invoiceError) {
      return formatApiError('fetch invoice for confirmation', invoiceError)
    }

    // Fetch linked purchase orders
    const { data: linkedOrders } = await supabase
      .from('order_invoice_matches')
      .select('purchase_order_id')
      .eq('invoice_id', id)

    type InvoiceItemRow = {
      id: string
      item_description: string
      quantity: number
      unit_price: number
      total_price: number
      matched_item_id: string | null
      match_method: string | null
    }

    const invoiceItems = (invoice.invoice_items || []) as InvoiceItemRow[]

    const matchedItems = invoiceItems.filter(item =>
      item.matched_item_id && item.match_method !== 'skipped'
    )

    // Update inventory stock levels for matched items (invoice is source of truth)
    console.log(`📦 Updating stock levels for ${matchedItems.length} matched items from invoice`)

    for (const invoiceItem of matchedItems) {
      if (!invoiceItem.matched_item_id) continue

      // Fetch pack metadata for the matched item
      const { data: invRow, error: invErr } = await supabase
        .from('inventory_items')
        .select('id, pack_size, square_item_id, unit_cost')
        .eq('id', invoiceItem.matched_item_id)
        .single()

      if (invErr || !invRow) {
        console.error('Failed to load inventory item for invoice update', invoiceItem.matched_item_id, invErr)
        continue
      }

      const packSize = Number(invRow.pack_size) || 1

      // Prefer base (pack_size=1) with same Square ID
      let targetInventoryId = invRow.id
      let baseCurrentUnitCost: number | null = null
      if (invRow.square_item_id) {
        const { data: baseItem } = await supabase
          .from('inventory_items')
          .select('id, unit_cost')
          .eq('square_item_id', invRow.square_item_id)
          .or('pack_size.eq.1,pack_size.is.null')
          .is('deleted_at', null)
          .maybeSingle()
        if (baseItem?.id) {
          targetInventoryId = baseItem.id
          baseCurrentUnitCost = Number(baseItem.unit_cost ?? 0)
        }
      }

      const invoiceQty = Number(invoiceItem.quantity)
      // If the matched item is a pack variant (pack_size > 1) and we're applying stock to the base item,
      // treat the invoice quantity as number of packs and expand to units.
      const quantityChange = (packSize > 1 && targetInventoryId !== invRow.id)
        ? invoiceQty * packSize
        : invoiceQty

      console.log('[Invoice confirm] stock update', {
        invoice_id: invoice.id,
        invoice_item_id: invoiceItem.id,
        matched_item_id: invoiceItem.matched_item_id,
        target_inventory_id: targetInventoryId,
        pack_size: packSize,
        invoice_qty: invoiceQty,
        applied_qty: quantityChange,
        square_id: invRow.square_item_id
      })

      const { error: stockError } = await supabase
        .rpc('update_inventory_stock', {
          item_id: targetInventoryId,
          quantity_change: quantityChange,
          operation_type: 'restock',
          notes: `Invoice ${invoice.invoice_number} - ${invoice.suppliers?.name || 'Unknown Supplier'}`
        })

      if (stockError) {
        console.error('Failed to update stock for item:', targetInventoryId, stockError)
      } else {
        console.log(`✅ Updated stock for item ${targetInventoryId}: +${quantityChange}`)
      }

      // Optional cost refresh & history: normalize to unit cost when pack_size > 1
      const currentUnitCost = Number(invRow.unit_cost) || 0
      const inferredPack = packSize > 1
      // Choose the best interpretation of invoice price (could be per-pack or per-unit).
      const rawPrice = Number(invoiceItem.unit_price)
      const candidatePerUnit = rawPrice
      const candidateFromPack = inferredPack ? rawPrice / packSize : rawPrice

      let effectiveUnitCost: number

      if (inferredPack && targetInventoryId !== invRow.id) {
        // Pack item matched, updating base (single-unit): force raw invoice price as per-unit.
        effectiveUnitCost = candidatePerUnit
      } else if (inferredPack) {
        // Staying on the pack item: choose the interpretation closest to current unit cost
        const diffRaw = Math.abs(candidatePerUnit - currentUnitCost)
        const diffPack = Math.abs(candidateFromPack - currentUnitCost)
        effectiveUnitCost = diffRaw <= diffPack ? candidatePerUnit : candidateFromPack
      } else {
        effectiveUnitCost = candidatePerUnit
      }

      effectiveUnitCost = Number(effectiveUnitCost.toFixed(2))
      // For base updates from pack items, always update; otherwise compare to current.
      const previousCost = inferredPack && targetInventoryId !== invRow.id
        ? (baseCurrentUnitCost ?? currentUnitCost)
        : currentUnitCost
      const unitCostChanged = inferredPack && targetInventoryId !== invRow.id
        ? true
        : (Number.isFinite(effectiveUnitCost) && Math.abs(effectiveUnitCost - previousCost) > 0.0001)

      if (unitCostChanged) {
        console.log('[Invoice confirm] cost update decision', {
          target_inventory_id: targetInventoryId,
          matched_item_id: invRow.id,
          pack_size: packSize,
          inferredPack,
          rawPrice,
          candidatePerUnit,
          candidateFromPack,
          chosen_unit_cost: effectiveUnitCost,
          current_unit_cost: currentUnitCost
        })
        // Update inventory item cost on the target (base) item
        const { error: costError } = await supabase
          .from('inventory_items')
          .update({ unit_cost: effectiveUnitCost, updated_at: new Date().toISOString() })
          .eq('id', targetInventoryId)

        if (costError) {
          console.error('Failed to update unit cost from invoice:', costError)
        } else {
          await supabase
            .from('inventory_item_cost_history')
            .insert({
              inventory_item_id: targetInventoryId,
              previous_unit_cost: previousCost,
              new_unit_cost: effectiveUnitCost,
              pack_size: inferredPack ? packSize : 1,
              source: 'invoice_confirm',
              source_ref: invoice.id,
              notes: `Invoice ${invoice.invoice_number} (${invoice.suppliers?.name || 'Unknown Supplier'})`,
              changed_by: null
            })
          console.log(`✅ Updated unit cost for item ${targetInventoryId}: ${currentUnitCost} -> ${effectiveUnitCost}`)
        }
      }
    }

    // ── Distribute supplier fees proportionally across matched items ──────────
    // Fees (delivery, shipping, processing, etc.) are COGS overhead.
    // We spread them across matched line items proportionally by line-item value,
    // recording each allocation as an 'invoice_fee' entry in inventory_item_cost_history.
    // This keeps fee overhead visible in the cost history time-series.
    const totalFees = Number(invoice.total_fees ?? 0)
    const feeAlreadyDistributed = Boolean(invoice.fee_cogs_distributed)

    if (totalFees > 0 && !feeAlreadyDistributed && matchedItems.length > 0) {
      console.log(`💰 Distributing supplier fees ($${totalFees}) across ${matchedItems.length} matched items`)

      // Compute the total value of matched line items for proportional weighting
      const totalMatchedValue = matchedItems.reduce(
        (sum, item) => sum + Number(item.total_price ?? 0),
        0
      )

      if (totalMatchedValue > 0) {
        const feeHistoryRows: Array<{
          tenant_id: string
          inventory_item_id: string
          previous_unit_cost: number
          new_unit_cost: number
          pack_size: number
          source: string
          source_ref: string
          notes: string
          changed_by: null
          fee_amount: number
        }> = []

        for (const invoiceItem of matchedItems) {
          if (!invoiceItem.matched_item_id) continue

          // What fraction of total line-item value does this item represent?
          const itemValue = Number(invoiceItem.total_price ?? 0)
          const feeShare = (itemValue / totalMatchedValue) * totalFees
          const roundedFeeShare = Math.round(feeShare * 10000) / 10000 // 4 decimal places

          if (roundedFeeShare <= 0) continue

          // Fetch current unit_cost for this item (resolve to base item if pack variant)
          const { data: invRow } = await supabase
            .from('inventory_items')
            .select('id, unit_cost, pack_size, square_item_id')
            .eq('id', invoiceItem.matched_item_id)
            .single()

          if (!invRow) continue

          let targetId = invRow.id
          if (invRow.square_item_id) {
            const { data: baseItem } = await supabase
              .from('inventory_items')
              .select('id, unit_cost')
              .eq('square_item_id', invRow.square_item_id)
              .or('pack_size.eq.1,pack_size.is.null')
              .is('deleted_at', null)
              .maybeSingle()
            if (baseItem?.id) targetId = baseItem.id
          }

          const { data: targetRow } = await supabase
            .from('inventory_items')
            .select('unit_cost')
            .eq('id', targetId)
            .single()

          const currentCost = Number(targetRow?.unit_cost ?? 0)
          const invoiceQty = Number(invoiceItem.quantity ?? 1)
          // Fee overhead per unit = allocated fee share / invoice quantity
          const feePerUnit = invoiceQty > 0
            ? Math.round((roundedFeeShare / invoiceQty) * 10000) / 10000
            : 0

          if (feePerUnit <= 0) continue

          // new_unit_cost = current cost + fee-per-unit overhead
          // This represents the fully-loaded cost including proportional fees
          const newCost = Math.round((currentCost + feePerUnit) * 10000) / 10000

          feeHistoryRows.push({
            tenant_id: tenantId,
            inventory_item_id: targetId,
            previous_unit_cost: currentCost,
            new_unit_cost: newCost,
            pack_size: 1,
            source: 'invoice_fee',
            source_ref: invoice.id,
            notes: `Fee allocation from Invoice ${invoice.invoice_number} (${invoice.suppliers?.name || 'Unknown Supplier'}): $${roundedFeeShare.toFixed(4)} of $${totalFees.toFixed(2)} total fees`,
            changed_by: null,
            fee_amount: roundedFeeShare,
          })
        }

        if (feeHistoryRows.length > 0) {
          const { error: feeInsertError } = await supabase
            .from('inventory_item_cost_history')
            .insert(feeHistoryRows)

          if (feeInsertError) {
            console.error('Failed to insert fee cost history rows:', feeInsertError)
          } else {
            console.log(`✅ Recorded ${feeHistoryRows.length} fee allocation entries in cost history`)
          }
        }
      }
    }

    if (linkedOrders && linkedOrders.length > 0) {
      for (const link of linkedOrders) {
        if (!link.purchase_order_id) continue
        const nowIso = new Date().toISOString()
        const { error: poError } = await supabase
          .from('purchase_orders')
          .update({
            status: 'confirmed',
            confirmed_at: nowIso,
            received_at: nowIso,
            notes: `Confirmed via invoice ${invoice.invoice_number}`
          })
          .eq('id', link.purchase_order_id)
          .in('status', ['sent', 'approved', 'received', 'confirmed'])

        if (poError) {
          console.error(`Failed to update purchase order ${link.purchase_order_id}:`, poError)
        } else {
          console.log('✅ Marked purchase order as confirmed:', link.purchase_order_id)
        }
      }
    }

    // Update invoice status to confirmed (also mark fees as distributed if applicable)
    const { error: confirmError } = await supabase
      .from('invoices')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(totalFees > 0 && !feeAlreadyDistributed && { fee_cogs_distributed: true }),
      })
      .eq('id', id)

    if (confirmError) {
      return formatApiError('confirm invoice', confirmError)
    }

    console.log('✅ Invoice import confirmed successfully')

    // Generate summary stats
    const totalItems = invoice.invoice_items.length
    const matchedCount = matchedItems.length
    const skippedCount = invoiceItems.filter(item => item.match_method === 'skipped').length
    const createdCount = invoiceItems.filter(item => item.match_method === 'manual_create').length

    return NextResponse.json({
      success: true,
      data: {
        message: 'Invoice import confirmed successfully',
        summary: {
          total_items: totalItems,
          matched_items: matchedCount,
          created_items: createdCount,
          skipped_items: skippedCount,
          inventory_updated: true,
          purchase_order_updated: linkedOrders && linkedOrders.length > 0,
          fees_distributed: totalFees > 0,
          total_fees: totalFees,
        }
      }
    })

  } catch (error) {
    return unexpectedError('confirm invoice', error)
  }
}
