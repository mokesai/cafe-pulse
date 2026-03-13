import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import type { PostgrestError } from '@supabase/supabase-js'

const RECEIPT_BUCKET = 'purchase-order-receipts'

type ReceiptRow = {
  id: string
  purchase_order_id: string
  purchase_order_item_id: string
  quantity_received: number
  weight?: number | null
  weight_unit?: string | null
  notes?: string | null
  photo_path?: string | null
  photo_url?: string | null
  received_by?: string | null
  received_at: string
  created_at: string
  purchase_order_items?: {
    id: string
    inventory_item_id: string
    quantity_ordered: number
    quantity_received: number
    inventory_items?: {
      item_name: string
      unit_type?: string | null
    } | null
  } | null
  received_by_profile?: {
    full_name?: string | null
    email?: string | null
  } | null
}

type ReceiptInput = {
  purchase_order_item_id?: string
  quantity?: number
  notes?: string
  weight?: number
  weight_unit?: string
  fileKey?: string
}

interface PurchaseOrderItemRow {
  id: string
  inventory_item_id: string
  is_excluded?: boolean | null
  exclusion_reason?: string | null
  pack_size?: number | null
  ordered_pack_qty?: number | null
  inventory_items?: {
    square_item_id?: string | null
    pack_size?: number | null
  } | null
}

function sanitizeFileName(name: string) {
  return name.replace(/[^\w.\-]/g, '_')
}

async function enrichReceipts(receipts: ReceiptRow[]) {
  if (receipts.length === 0) return receipts

  const supabase = createServiceClient()

  const receivedByIds = Array.from(
    new Set(
      receipts
        .map(receipt => receipt.received_by)
        .filter((value): value is string => Boolean(value))
    )
  )

  let profilesMap: Record<string, { full_name?: string | null; email?: string | null }> = {}
  if (receivedByIds.length > 0) {
    const serviceSupabase = createServiceClient()
    const { data: profiles } = await serviceSupabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', receivedByIds)

    profilesMap = (profiles || []).reduce((acc, profile) => {
      acc[profile.id] = {
        full_name: profile.full_name,
        email: profile.email
      }
      return acc
    }, {} as Record<string, { full_name?: string | null; email?: string | null }>)
  }

  const itemIds = Array.from(
    new Set(
      receipts.map(receipt => receipt.purchase_order_item_id)
    )
  )

  let itemsMap: Record<string, ReceiptRow['purchase_order_items']> = {}
  if (itemIds.length > 0) {
    const { data: items } = await supabase
      .from('purchase_order_items')
      .select(`
        id,
        inventory_item_id,
        quantity_ordered,
        quantity_received,
        inventory_items!purchase_order_items_inventory_item_id_fkey (
          item_name,
          unit_type
        )
      `)
      .in('id', itemIds)

    type RawPurchaseOrderItemRow = {
      id: string
      inventory_item_id: string
      quantity_ordered: number
      quantity_received: number
      inventory_items?: Array<{
        item_name?: string | null
        unit_type?: string | null
      }> | null
    }

    const rawItems = (items || []) as RawPurchaseOrderItemRow[]
    itemsMap = rawItems.reduce((acc, item) => {
      const linkedInventory = item.inventory_items?.[0]
      acc[item.id] = {
        id: item.id,
        inventory_item_id: item.inventory_item_id,
        quantity_ordered: item.quantity_ordered,
        quantity_received: item.quantity_received,
        inventory_items: linkedInventory
          ? {
              item_name: linkedInventory.item_name ?? 'Item',
              unit_type: linkedInventory.unit_type ?? null
            }
          : null
      }
      return acc
    }, {} as Record<string, ReceiptRow['purchase_order_items']>)
  }

  return receipts.map(receipt => ({
    ...receipt,
    received_by_profile: receipt.received_by ? profilesMap[receipt.received_by] || null : null,
    purchase_order_items: itemsMap[receipt.purchase_order_item_id] || null
  }))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const resolved = await params
    const { orderId } = resolved

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Verify purchase order belongs to this tenant before fetching receipts
    const { data: po, error: poCheckError } = await supabase
      .from('purchase_orders')
      .select('id')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (poCheckError || !po) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    const { data, error } = await supabase
      .from('purchase_order_receipts')
      .select('*')
      .eq('purchase_order_id', orderId)
      .order('received_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch purchase order receipts:', error)
      return NextResponse.json(
        { error: 'Failed to fetch receipts', details: error.message },
        { status: 500 }
      )
    }

    const enriched = await enrichReceipts((data || []) as ReceiptRow[])

    return NextResponse.json({
      success: true,
      receipts: enriched
    })
  } catch (error) {
    console.error('Error fetching purchase order receipts:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch purchase order receipts',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }
    const admin = authResult

    const resolved = await params
    const { orderId } = resolved

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const contentType = request.headers.get('content-type') || ''
    let itemInputs: ReceiptInput[] = []
    const fileMap = new Map<string, File>()

    if (contentType.includes('application/json')) {
      const body = await request.json()
      if (Array.isArray(body?.items)) {
        itemInputs = body.items
      } else if (body?.purchase_order_item_id) {
        itemInputs = [body]
      }
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const payloadRaw = formData.get('payload')
      if (typeof payloadRaw === 'string') {
        try {
          const parsed = JSON.parse(payloadRaw)
          if (Array.isArray(parsed?.items)) {
            itemInputs = parsed.items
          } else if (parsed?.purchase_order_item_id) {
            itemInputs = [parsed]
          }
        } catch (error) {
          console.error('Failed to parse receipt payload JSON:', error)
          return NextResponse.json(
            { error: 'Invalid payload format' },
            { status: 400 }
          )
        }
      } else {
        const purchaseOrderItemId = formData.get('purchase_order_item_id')
        const quantity = formData.get('quantity')
        if (typeof purchaseOrderItemId === 'string' && typeof quantity === 'string') {
          itemInputs = [{
            purchase_order_item_id: purchaseOrderItemId,
            quantity: Number(quantity),
            notes: typeof formData.get('notes') === 'string' ? formData.get('notes') as string : undefined,
            weight: typeof formData.get('weight') === 'string' && formData.get('weight') !== '' ? Number(formData.get('weight')) : undefined,
            weight_unit: typeof formData.get('weight_unit') === 'string' ? formData.get('weight_unit') as string : undefined
          }]
        }
      }

      formData.forEach((value, key) => {
        if (value instanceof File) {
          fileMap.set(key, value)
        }
      })

      if (itemInputs.length === 1 && fileMap.size === 0) {
        const directFile = formData.get('file')
        if (directFile instanceof File) {
          fileMap.set('file', directFile)
        }
      }
    } else {
      return NextResponse.json(
        { error: 'Unsupported content type' },
        { status: 415 }
      )
    }

    if (itemInputs.length === 0) {
      return NextResponse.json(
        { error: 'At least one receipt item is required' },
        { status: 400 }
      )
    }

    if (itemInputs.length > 1) {
      return NextResponse.json(
        { error: 'Submit one receipt item per request' },
        { status: 400 }
      )
    }

    const item = itemInputs[0]
    const purchaseOrderItemId = item.purchase_order_item_id?.trim()
    if (!purchaseOrderItemId) {
      return NextResponse.json(
        { error: 'purchase_order_item_id is required' },
        { status: 400 }
      )
    }

    const quantity = Number(item.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json(
        { error: 'Quantity must be a positive number' },
        { status: 400 }
      )
    }
    if (!Number.isInteger(quantity)) {
      return NextResponse.json(
        { error: 'Quantity must be a whole number' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Verify purchase order belongs to this tenant
    const { data: po, error: poCheckError } = await supabase
      .from('purchase_orders')
      .select('id')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (poCheckError || !po) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    // Block receipts for excluded/out-of-stock items
    const { data: poItemData, error: poItemError } = await supabase
      .from('purchase_order_items')
      .select(`
        id,
        inventory_item_id,
        is_excluded,
        exclusion_reason,
        pack_size,
        ordered_pack_qty,
        inventory_items!purchase_order_items_inventory_item_id_fkey (
          square_item_id,
          pack_size
        )
      `)
      .eq('id', purchaseOrderItemId)
      .single()

    const poItem = poItemData as PurchaseOrderItemRow | null

    if (poItemError) {
      console.error('Failed to fetch purchase order item before receipt:', poItemError)
      return NextResponse.json(
        { error: 'Unable to validate purchase order item', details: poItemError.message },
        { status: 500 }
      )
    }

    if (!poItem) {
      return NextResponse.json(
        { error: 'Purchase order item not found' },
        { status: 404 }
      )
    }

    if (poItem?.is_excluded) {
      return NextResponse.json(
        { error: 'Item is marked out-of-stock/excluded and cannot be received', details: poItem.exclusion_reason || undefined },
        { status: 400 }
      )
    }

    const notes = item.notes?.trim() || null
    const weightValue = item.weight !== undefined && item.weight !== null ? Number(item.weight) : null
    const weight = weightValue !== null && Number.isFinite(weightValue) ? weightValue : null
    const weightUnit = item.weight_unit?.trim() || null

    let uploadedPhotoPath: string | null = null
    let uploadedPhotoUrl: string | null = null

    let uploadFile: File | undefined
    if (item.fileKey && fileMap.has(item.fileKey)) {
      uploadFile = fileMap.get(item.fileKey)
    } else if (fileMap.has('file')) {
      uploadFile = fileMap.get('file')
    }

    if (uploadFile && uploadFile.size > 0) {
      const supabase = createServiceClient()
      const sanitized = sanitizeFileName(uploadFile.name)
      const storagePath = `${orderId}/${purchaseOrderItemId}/${Date.now()}_${sanitized}`
      const arrayBuffer = await uploadFile.arrayBuffer()
      const fileBuffer = new Uint8Array(arrayBuffer)

      const { error: uploadError } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: uploadFile.type || 'application/octet-stream',
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        console.error('Failed to upload receipt photo:', uploadError)
        return NextResponse.json(
          { error: 'Failed to upload receipt photo', details: uploadError.message },
          { status: 500 }
        )
      }

      const { data: urlData } = supabase.storage
        .from(RECEIPT_BUCKET)
        .getPublicUrl(storagePath)

      uploadedPhotoPath = storagePath
      uploadedPhotoUrl = urlData?.publicUrl || null
    }

    const serviceSupabase = createServiceClient()
    // Determine target inventory item (prefer base single-unit with same Square ID)
    let targetInventoryId = poItem.inventory_item_id
    const squareId = poItem.inventory_items?.square_item_id || null
    if (squareId) {
      const { data: baseItem } = await serviceSupabase
        .from('inventory_items')
        .select('id')
        .eq('square_item_id', squareId)
        .eq('pack_size', 1)
        .is('deleted_at', null)
        .maybeSingle()
      if (baseItem?.id) {
        targetInventoryId = baseItem.id
      }
    }

    // Use entered quantity as units (PO line is stored in units already); informational only
    const packSize = poItem.pack_size ?? poItem.inventory_items?.pack_size ?? 1
    const unitQuantity = quantity

    console.log('[PO receipt] info only (no stock change)', {
      po_item_id: purchaseOrderItemId,
      pack_size: packSize,
      ordered_pack_qty: poItem.ordered_pack_qty,
      input_qty: quantity,
      unit_qty: unitQuantity,
      from_item_id: poItem.inventory_item_id,
      target_item_id: targetInventoryId,
      square_id: squareId
    })

    // Log receipt record only (no stock mutation here)
    const { data, error } = await serviceSupabase.rpc('log_purchase_order_receipt', {
      p_purchase_order_id: orderId,
      p_purchase_order_item_id: purchaseOrderItemId,
      p_quantity: unitQuantity,
      p_received_by: admin.userId,
      p_notes: notes,
      p_weight: weight,
      p_weight_unit: weightUnit,
      p_photo_path: uploadedPhotoPath,
      p_photo_url: uploadedPhotoUrl
    })

    if (error) {
      console.error('Failed to log purchase order receipt:', error)

      if (uploadedPhotoPath) {
        const supabase = createServiceClient()
        await supabase.storage.from(RECEIPT_BUCKET).remove([uploadedPhotoPath])
      }

      const details = (error as PostgrestError | null)?.message || 'Failed to create receipt'
      return NextResponse.json(
        { error: 'Failed to log receipt', details },
        { status: 400 }
      )
    }

    const receiptId = data?.receipt?.id
    let enrichedReceipt: ReceiptRow | null = null

    if (receiptId) {
      const supabase = createServiceClient()
      const { data: receiptData, error: fetchError } = await supabase
        .from('purchase_order_receipts')
        .select('*')
        .eq('id', receiptId)
        .single()

      if (!fetchError && receiptData) {
        const enriched = await enrichReceipts([receiptData as ReceiptRow])
        enrichedReceipt = enriched[0] ?? null
      }
    }

    // No stock shifts here; inventory updates occur during invoice confirmation.

    return NextResponse.json({
      success: true,
      receipt: enrichedReceipt ?? data?.receipt ?? null,
      order_completed: Boolean(data?.order_completed)
    }, { status: 201 })
  } catch (error) {
    console.error('Error logging purchase order receipt:', error)
    return NextResponse.json(
      {
        error: 'Failed to log purchase order receipt',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
