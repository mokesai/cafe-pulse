import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

function getResend() { return new Resend(process.env.RESEND_API_KEY) }

interface OrderItemRow {
  id: string
  item_name: string
  quantity: number
  unit_price: number
  total_price: number
  variations?: Record<string, string>
  modifiers?: Record<string, string>
}

interface OrderRow {
  id: string
  order_number?: string | null
  status: string
  payment_status: string
  created_at: string
  customer_email: string | null
  subtotal?: number | null
  tax_amount?: number | null
  total_amount: number
  special_instructions?: string | null
  order_items?: OrderItemRow[]
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    // Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Fetch order details and ensure user can only access their own orders
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single<OrderRow>()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (!order.customer_email) {
      return NextResponse.json(
        { error: 'No email address associated with this order' }, 
        { status: 400 }
      )
    }

    // Validate Resend API key
    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured')
      return NextResponse.json(
        { error: 'Email service not configured' }, 
        { status: 500 }
      )
    }

    // Generate receipt content
    const receiptContent = generateReceiptEmailContent(order)
    
    // Send email using Resend (same setup as order confirmations)
    // For development, send to your verified email address
    const recipientEmail = process.env.NODE_ENV === 'production' 
      ? order.customer_email 
      : 'jerry@jmcpastrycoffee.com' // Your verified Resend email
    
    const { data, error: resendError } = await getResend().emails.send({
      from: 'Little Cafe <orders@jmcpastrycoffee.com>', // Same as existing email service
      to: [recipientEmail],
      subject: `Receipt for Order #${order.order_number || order.id.slice(-8)} - Little Cafe${
        process.env.NODE_ENV !== 'production' ? ` (originally for ${order.customer_email})` : ''
      }`,
      html: receiptContent,
    })

    if (resendError) {
      console.error('Resend error details:', JSON.stringify(resendError, null, 2))
      return NextResponse.json(
        { error: 'Failed to send email receipt', details: resendError }, 
        { status: 500 }
      )
    }

    
    return NextResponse.json({ 
      message: 'Receipt email sent successfully',
      email: order.customer_email,
      emailId: data?.id
    })
    
  } catch (error) {
    console.error('Error sending receipt email:', error)
    return NextResponse.json(
      { error: 'Failed to send receipt email' }, 
      { status: 500 }
    )
  }
}

function generateReceiptEmailContent(order: OrderRow): string {
  const formatPrice = (price: number) => (price / 100).toFixed(2)
  const taxAmount = order.tax_amount ?? 0
  const subtotalValue = order.subtotal ?? (order.total_amount - taxAmount)
  
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt - Order #${order.order_number || order.id.slice(-8)}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; border-bottom: 2px solid #f59e0b; padding-bottom: 20px; margin-bottom: 20px; }
    .logo { color: #f59e0b; font-size: 24px; font-weight: bold; margin-bottom: 10px; }
    .order-info { background: #f9fafb; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .items { margin-bottom: 20px; }
    .item { border-bottom: 1px solid #e5e7eb; padding: 10px 0; }
    .item:last-child { border-bottom: none; }
    .item-name { font-weight: bold; }
    .item-details { color: #6b7280; font-size: 14px; margin-left: 20px; }
    .totals { border-top: 2px solid #e5e7eb; padding-top: 15px; }
    .total-line { display: flex; justify-content: space-between; margin: 5px 0; }
    .final-total { font-weight: bold; font-size: 18px; border-top: 1px solid #d1d5db; padding-top: 10px; margin-top: 10px; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">LITTLE CAFE</div>
    <p>Kaiser Permanente Medical Complex<br>
    10400 E Alameda Ave, Denver, CO<br>
    Phone: (303) 555-0123</p>
  </div>

  <div class="order-info">
    <h2>Order Receipt</h2>
    <p><strong>Order #:</strong> ${order.order_number || order.id.slice(-8)}</p>
    <p><strong>Date:</strong> ${formatDate(order.created_at)}</p>
    <p><strong>Status:</strong> ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</p>
    <p><strong>Payment Status:</strong> ${order.payment_status.charAt(0).toUpperCase() + order.payment_status.slice(1)}</p>
  </div>

  <div class="items">
    <h3>Order Items:</h3>
    ${order.order_items?.map((item) => `
      <div class="item">
        <div class="item-name">${item.quantity}x ${item.item_name} - $${formatPrice(item.total_price)}</div>
        <div style="display: flex; justify-content: space-between; color: #6b7280; font-size: 14px;">
          <span>$${formatPrice(item.unit_price)} each</span>
        </div>
        ${item.variations && Object.keys(item.variations).length > 0 ? 
          Object.entries(item.variations).map(([key, value]) => 
            `<div class="item-details">• ${key}: ${value}</div>`
          ).join('') : ''
        }
        ${item.modifiers && Object.keys(item.modifiers).length > 0 ? 
          Object.entries(item.modifiers).map(([key, value]) => 
            `<div class="item-details">+ ${key}: ${value}</div>`
          ).join('') : ''
        }
      </div>
    `).join('')}
  </div>

  <div class="totals">
    <div class="total-line">
      <span>Subtotal:</span>
      <span>$${formatPrice(subtotalValue)}</span>
    </div>
    ${taxAmount > 0 ? `
      <div class="total-line">
        <span>Tax:</span>
        <span>$${formatPrice(taxAmount)}</span>
      </div>
    ` : ''}
    <div class="total-line final-total">
      <span>TOTAL:</span>
      <span>$${formatPrice(order.total_amount)}</span>
    </div>
  </div>

  ${order.special_instructions ? `
    <div style="margin-top: 20px; padding: 15px; background: #f0f9ff; border-radius: 8px;">
      <h4>Special Instructions:</h4>
      <p>${order.special_instructions}</p>
    </div>
  ` : ''}

  <div class="footer">
    <p>Thank you for your order!</p>
    <p>Visit us again soon!</p>
    <p><strong>Hours:</strong> Monday - Friday, 8:00 AM - 6:00 PM</p>
    <p>This is an automated receipt. Please keep this for your records.</p>
  </div>
</body>
</html>
  `
}
