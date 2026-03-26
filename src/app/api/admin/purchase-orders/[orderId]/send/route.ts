import { Buffer } from 'node:buffer'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { requireAdminAuth, isAdminAuthSuccess } from '@/lib/admin/middleware'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/tenant/context'
import { fetchPurchaseOrderForIssuance } from '@/lib/purchase-orders/load'
import { generatePurchaseOrderPdf } from '@/lib/purchase-orders/pdf'
import { fetchSupplierTemplate, buildPurchaseOrderTemplateContext, renderTemplate } from '@/lib/purchase-orders/templates'
import { canonicalStatus, canTransition, insertStatusHistory } from '../../status-utils'

function getResend() { return new Resend(process.env.RESEND_API_KEY) }

type SendRequestBody = {
  to?: string | string[]
  cc?: string | string[]
  subject?: string
  message?: string
  markAsSent?: boolean
  excluded_item_ids?: string[]
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: 'Email service is not configured. Set RESEND_API_KEY to enable supplier emails.' },
        { status: 503 }
      )
    }

    const authResult = await requireAdminAuth(request)
    if (!isAdminAuthSuccess(authResult)) {
      return authResult
    }

    const admin = authResult
    const resolvedParams = await params
    const { orderId } = resolvedParams

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    const body: SendRequestBody = await request.json().catch(() => ({}))

    const supabase = createServiceClient()
    const tenantId = await getCurrentTenantId()

    // Verify purchase order belongs to this tenant before proceeding
    const { data: poCheck, error: poCheckError } = await supabase
      .from('purchase_orders')
      .select('id')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (poCheckError || !poCheck) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    const { order, error } = await fetchPurchaseOrderForIssuance(supabase, orderId)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to load purchase order', details: error.message },
        { status: 500 }
      )
    }

    if (!order) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    const status = canonicalStatus(order.status) || order.status
    if (!['approved', 'confirmed', 'sent', 'received'].includes(status)) {
      return NextResponse.json(
        { error: 'Purchase order must be approved before emailing the supplier' },
        { status: 400 }
      )
    }

    const recipients = normaliseAddresses(body.to) || (order.supplier.email ? [order.supplier.email] : [])
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: 'Supplier email address is required to send the purchase order' },
        { status: 400 }
      )
    }

    const cc = normaliseAddresses(body.cc)
  const excludedItemIds = Array.isArray(body.excluded_item_ids)
    ? body.excluded_item_ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  // Persist exclusions before sending (so they apply to future phases as well)
  if (excludedItemIds.length > 0) {
    const { error: exclusionError } = await supabase
      .from('purchase_order_items')
      .update({
        is_excluded: true,
        exclusion_reason: body.message || 'Marked out-of-stock during send',
        exclusion_phase: 'pre_send',
        excluded_at: new Date().toISOString(),
        excluded_by: admin.userId
      })
      .in('id', excludedItemIds)

    if (exclusionError) {
      console.error('Failed to persist excluded items:', exclusionError)
      return NextResponse.json(
        { error: 'Failed to save excluded items', details: exclusionError.message },
        { status: 500 }
      )
    }
  }

  // Clear previous exclusions if user re-included items
  const clearQuery = supabase
    .from('purchase_order_items')
    .update({
      is_excluded: false,
      exclusion_reason: null,
      exclusion_phase: null,
      excluded_at: null,
      excluded_by: null
    })
    .eq('purchase_order_id', orderId)
    .eq('is_excluded', true)

  if (excludedItemIds.length > 0) {
    clearQuery.not('id', 'in', `(${excludedItemIds.map(id => `'${id}'`).join(',')})`)
  }

  const { error: clearError } = await clearQuery
  if (clearError) {
    console.warn('Failed to clear previous exclusions:', clearError)
  }

  const filteredItems = (order.items || []).filter(item => !excludedItemIds.includes(item.id))

    if (filteredItems.length === 0) {
      return NextResponse.json(
        { error: 'Cannot send purchase order with zero items after exclusions' },
        { status: 400 }
      )
    }

    const filteredOrder = {
      ...order,
      items: filteredItems,
      total_amount: filteredItems.reduce((sum, item) => {
        const lineTotal = typeof item.total_cost === 'number'
          ? item.total_cost
          : (item.quantity_ordered || 0) * (item.unit_cost || 0)
        return sum + lineTotal
      }, 0)
    }

    // Update order total to reflect exclusions
    const { error: totalUpdateError } = await supabase
      .from('purchase_orders')
      .update({ total_amount: filteredOrder.total_amount })
      .eq('id', order.id)
      .eq('tenant_id', tenantId)
    if (totalUpdateError) {
      console.warn('Failed to update purchase order total after exclusions:', totalUpdateError)
    }

    const templateContext = buildPurchaseOrderTemplateContext(filteredOrder)
    const supplierTemplate = await fetchSupplierTemplate(supabase, order.supplier?.id)
    const templateSubject = supplierTemplate
      ? renderTemplate(supplierTemplate.subject_template, templateContext).trim()
      : ''
    const templateBody = supplierTemplate
      ? renderTemplate(supplierTemplate.body_template, templateContext).trim()
      : ''

    const subject = body.subject?.trim() || templateSubject || `Purchase Order ${order.order_number}`
    const noteMessage = body.message?.trim() || ''

    const pdfBytes = await generatePurchaseOrderPdf(filteredOrder)
    const attachmentFileName = `PO-${order.order_number || order.id}.pdf`

    const emailResponse = await getResend().emails.send({
      from: process.env.RESEND_PURCHASING_FROM || 'Little Cafe Purchasing <orders@jmcpastrycoffee.com>',
      to: recipients,
      cc: cc.length > 0 ? cc : undefined,
      subject,
      html: buildEmailHtml(filteredOrder, noteMessage, templateBody),
      attachments: [
        {
          filename: attachmentFileName,
          content: Buffer.from(pdfBytes).toString('base64')
        }
      ]
    })

    if (emailResponse.error) {
      console.error('Failed to send purchase order email:', emailResponse.error)
      return NextResponse.json(
        { error: 'Failed to send email', details: emailResponse.error.message },
        { status: 502 }
      )
    }

    let statusChanged = false
    if (body.markAsSent !== false) {
      const targetStatus = 'sent'
      const currentStatus = canonicalStatus(order.status) || order.status

      if (currentStatus !== targetStatus) {
        if (!canTransition(currentStatus, targetStatus)) {
          return NextResponse.json(
            { error: `Cannot transition purchase order from ${currentStatus} to ${targetStatus}` },
            { status: 400 }
          )
        }
        statusChanged = true
      }

      const { error: updateError } = await supabase
        .from('purchase_orders')
        .update({
          status: statusChanged ? targetStatus : currentStatus,
          sent_at: new Date().toISOString(),
          sent_via: 'email',
          sent_notes: noteMessage || 'Sent to supplier via email',
          sent_by: admin.userId
        })
        .eq('id', order.id)
        .eq('tenant_id', tenantId)

      if (updateError) {
        console.error('Failed to update purchase order after email:', updateError)
        return NextResponse.json(
          { error: 'Email sent, but failed to record send status', details: updateError.message },
          { status: 500 }
        )
      }

      if (statusChanged) {
        await insertStatusHistory(
          supabase,
          order.id,
          currentStatus,
          targetStatus,
          admin.userId,
          `Automatically marked as sent after emailing supplier (Resend id: ${emailResponse.data?.id || 'n/a'}, to: ${recipients.join(',')}${cc.length ? `, cc: ${cc.join(',')}` : ''})`
        )
      } else {
        await insertStatusHistory(
          supabase,
          order.id,
          currentStatus,
          currentStatus,
          admin.userId,
          `Email sent via Resend (id: ${emailResponse.data?.id || 'n/a'}, to: ${recipients.join(',')}${cc.length ? `, cc: ${cc.join(',')}` : ''})`
        )
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Purchase order emailed to supplier',
      emailId: emailResponse.data?.id,
      recipients,
      cc,
      statusChanged
    })
  } catch (error) {
    console.error('Failed to send purchase order email:', error)
    return NextResponse.json(
      {
        error: 'Failed to send purchase order email',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

function normaliseAddresses(addresses?: string | string[] | null): string[] {
  if (!addresses) return []
  if (Array.isArray(addresses)) {
    return addresses
      .map(address => address?.trim())
      .filter((value): value is string => Boolean(value))
  }
  return addresses.split(',').map(value => value.trim()).filter(Boolean)
}

function buildEmailHtml(
  order: Awaited<ReturnType<typeof fetchPurchaseOrderForIssuance>>['order'],
  message: string,
  templateBody = ''
) {
  if (!order) return ''

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  })

  const orderLines = order.items.map(item => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.name}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity_ordered}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.unit_type || 'each'}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${currencyFormatter.format(item.unit_cost)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${currencyFormatter.format(item.total_cost)}</td>
    </tr>
  `).join('')

  return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; color: #111827; background-color: #f9fafb; padding: 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
          <thead>
            <tr>
              <th style="background-color: #111827; color: #f9fafb; padding: 24px; text-align: left;">
                <h1 style="margin: 0; font-size: 20px;">Purchase Order ${order.order_number}</h1>
                <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.85;">Little Cafe • purchasing@jmcpastrycoffee.com</p>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 24px;">
                ${templateBody
                  ? `<div style="margin-bottom: 16px; color: #111827;">${formatMessageHtml(templateBody)}</div>`
                  : `<div>
                      <p style="margin: 0 0 12px;">Hello ${order.supplier.contact_person || order.supplier.name},</p>
                      <p style="margin: 0 0 16px;">Please find attached the purchase order for the upcoming delivery.</p>
                    </div>`}
                ${message ? `<div style="border-left: 3px solid #6366f1; padding-left: 16px; margin-bottom: 16px; color: #312e81;">${formatMessageHtml(message)}</div>` : ''}
                <div style="margin-bottom: 24px;">
                  <h2 style="font-size: 16px; margin: 0 0 8px;">Order Summary</h2>
                  <p style="margin: 4px 0;">PO Number: <strong>${order.order_number}</strong></p>
                  <p style="margin: 4px 0;">Order Date: <strong>${formatForEmail(order.order_date)}</strong></p>
                  <p style="margin: 4px 0;">Expected Delivery: <strong>${formatForEmail(order.expected_delivery_date) || 'Not specified'}</strong></p>
                  <p style="margin: 4px 0 0;">Total Amount: <strong>${currencyFormatter.format(order.total_amount)}</strong></p>
                </div>

                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; border: 1px solid #e5e7eb;">
                  <thead>
                    <tr style="background-color: #f3f4f6; color: #111827; text-align: left;">
                      <th style="padding: 10px;">Item</th>
                      <th style="padding: 10px; text-align:center;">Qty</th>
                      <th style="padding: 10px; text-align:center;">Unit</th>
                      <th style="padding: 10px; text-align:right;">Unit Cost</th>
                      <th style="padding: 10px; text-align:right;">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${orderLines}
                  </tbody>
                </table>

                ${order.notes ? `
                  <div style="margin-top: 20px; padding: 16px; background-color: #f3f4f6; border-radius: 8px;">
                    <h3 style="margin: 0 0 8px; font-size: 14px;">Internal Notes</h3>
                    <p style="margin: 0; font-size: 13px;">${order.notes.replace(/\n/g, '<br />')}</p>
                  </div>
                ` : ''}

                <p style="margin: 24px 0 8px; font-size: 13px; color: #6b7280;">
                  Please confirm receipt of this purchase order and advise if any changes are needed.
                </p>
                <p style="margin: 0; font-size: 13px; color: #6b7280;">Thank you,<br />Little Cafe Purchasing</p>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  `
}

function formatForEmail(value?: string | null) {
  if (!value) return ''
  const trimmed = value.trim()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00`)
    : new Date(trimmed)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date)
}

function formatMessageHtml(message: string) {
  return escapeHtml(message).replace(/\n/g, '<br />')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
