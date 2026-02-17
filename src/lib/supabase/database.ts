import { createClient, createServiceClient } from './server'
import type { UserProfile } from '@/types/menu'

// Server-side database operations
export async function createUserProfile(userId: string, email: string, fullName?: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      email,
      full_name: fullName
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function getUserProfile(userId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  
  if (error) throw error
  return data
}

export async function updateUserProfile(userId: string, updates: Partial<UserProfile>) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('profiles')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function createOrder(orderData: {
  tenantId: string
  userId?: string
  squareOrderId?: string
  totalAmount: number
  taxAmount?: number
  customerEmail?: string
  customerPhone?: string
  specialInstructions?: string
  items: Array<{
    squareItemId: string
    itemName: string
    quantity: number
    unitPrice: number
    totalPrice: number
    variations?: Record<string, unknown>
    modifiers?: Record<string, unknown>
    specialInstructions?: string
  }>
}) {
  const supabase = createServiceClient() // Use service role for order creation
  const { tenantId } = orderData

  console.log('Creating order with data:', JSON.stringify(orderData, null, 2))

  // Create the order
  const orderInsertData = {
    tenant_id: tenantId,
    user_id: orderData.userId,
    square_order_id: orderData.squareOrderId,
    total_amount: orderData.totalAmount,
    tax_amount: orderData.taxAmount || 0,
    customer_email: orderData.customerEmail,
    customer_phone: orderData.customerPhone,
    special_instructions: orderData.specialInstructions
  }

  console.log('Inserting order with data:', orderInsertData)

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert(orderInsertData)
    .select()
    .single()

  if (orderError) {
    console.error('Order creation error:', orderError)
    throw orderError
  }

  console.log('Order created successfully:', order)

  // Create order items
  const itemsInsertData = orderData.items.map(item => ({
    tenant_id: tenantId,
    order_id: order.id,
    square_item_id: item.squareItemId,
    item_name: item.itemName,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total_price: item.totalPrice,
    variations: item.variations || {},
    modifiers: item.modifiers || {}
    // Note: special_instructions not included as it's not in the schema
  }))
  
  console.log('Inserting order items:', JSON.stringify(itemsInsertData, null, 2))
  
  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(itemsInsertData)
  
  if (itemsError) {
    console.error('Order items creation error:', itemsError)
    throw itemsError
  }
  
  console.log('Order items created successfully')
  
  return order
}

export async function getOrdersForUser(userId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (*)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data
}

export async function updateOrderStatus(orderId: string, status: string, paymentStatus?: string) {
  const supabase = await createClient()
  
  const updates: { status: string; payment_status?: string } = { status }
  if (paymentStatus) updates.payment_status = paymentStatus
  
  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', orderId)
    .select()
    .single()
  
  if (error) throw error
  return data
}
