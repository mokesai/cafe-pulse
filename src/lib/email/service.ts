import { Resend } from 'resend'
import { render } from '@react-email/render'
import OrderConfirmation from './templates/OrderConfirmation'
import OrderStatusUpdate from './templates/OrderStatusUpdate'
import TeamNotification, { getTeamNotificationSubject, type TeamEventType } from './templates/TeamNotification'
import { getTenantIdentity } from '@/lib/tenant/identity'

function getResend() { return new Resend(process.env.RESEND_API_KEY) }

export interface OrderEmailData {
  orderId: string
  customerEmail: string
  customerName: string
  items: Array<{
    name: string
    quantity: number
    price: number
    total: number
  }>
  subtotal: number
  tax: number
  total: number
  pickupTime?: string
  specialInstructions?: string
}

export class EmailService {
  static async sendOrderConfirmation(orderData: OrderEmailData) {
    try {
      // Load tenant identity for branding
      const tenant = await getTenantIdentity()

      // Render React Email template to HTML
      const html = await render(
        OrderConfirmation({
          ...orderData,
          businessName: tenant.business_name || tenant.name,
          businessAddress: tenant.business_address || undefined,
          businessPhone: tenant.business_phone || undefined,
          businessEmail: tenant.business_email || undefined,
          businessHours: tenant.business_hours
            ? typeof tenant.business_hours === 'string'
              ? tenant.business_hours
              : JSON.stringify(tenant.business_hours)
            : undefined,
          logoUrl: tenant.logo_url || undefined,
          primaryColor: tenant.primary_color || '#f59e0b',
        })
      )

      // Build sender from tenant config with fallback
      const from = tenant.email_sender_address
        ? `${tenant.email_sender_name || tenant.name} <${tenant.email_sender_address}>`
        : `${tenant.name} <noreply@jmcpastrycoffee.com>`

      const { data, error } = await getResend().emails.send({
        from,
        to: [orderData.customerEmail],
        subject: `Order Confirmation #${orderData.orderId.slice(-8)}`,
        html,
      })

      if (error) {
        console.error('Failed to send order confirmation email:', error)
        throw new Error(`Email send failed: ${error.message}`)
      }

      console.log('Order confirmation email sent:', data?.id)
      return data
    } catch (error) {
      console.error('Email service error:', error)
      throw error
    }
  }

  static async sendOrderStatusUpdate(
    customerEmail: string,
    orderId: string,
    status: string,
    customerName?: string
  ) {
    try {
      const tenant = await getTenantIdentity()

      const statusMessages = {
        confirmed: 'Your order has been confirmed and is being prepared.',
        preparing: 'Your order is currently being prepared.',
        ready: 'Your order is ready for pickup!',
        completed: 'Your order has been completed. Thank you!',
        cancelled: 'Your order has been cancelled.'
      }

      const message = statusMessages[status as keyof typeof statusMessages] ||
                     `Your order status has been updated to: ${status}`

      const html = await render(
        OrderStatusUpdate({
          orderId,
          status,
          message,
          customerName,
          businessName: tenant.business_name || tenant.name,
          businessAddress: tenant.business_address || undefined,
          businessPhone: tenant.business_phone || undefined,
          businessEmail: tenant.business_email || undefined,
          businessHours: tenant.business_hours
            ? typeof tenant.business_hours === 'string'
              ? tenant.business_hours
              : JSON.stringify(tenant.business_hours)
            : undefined,
          primaryColor: tenant.primary_color || '#f59e0b',
        })
      )

      const from = tenant.email_sender_address
        ? `${tenant.email_sender_name || tenant.name} <${tenant.email_sender_address}>`
        : `${tenant.name} <noreply@jmcpastrycoffee.com>`

      const { data, error } = await getResend().emails.send({
        from,
        to: [customerEmail],
        subject: `Order Update #${orderId.slice(-8)} - ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        html,
      })

      if (error) {
        console.error('Failed to send order status email:', error)
        throw new Error(`Email send failed: ${error.message}`)
      }

      console.log('Order status email sent:', data?.id)
      return data
    } catch (error) {
      console.error('Email service error:', error)
      throw error
    }
  }
  /**
   * Send a team notification email (invite, role change, or removal).
   * Fire-and-forget — logs errors but does not throw.
   */
  static async sendTeamNotification({
    recipientEmail,
    recipientName,
    eventType,
    tenantName,
    role,
    previousRole,
    loginUrl,
  }: {
    recipientEmail: string
    recipientName?: string
    eventType: TeamEventType
    tenantName: string
    role: string
    previousRole?: string
    loginUrl?: string
  }) {
    try {
      const html = await render(
        TeamNotification({
          eventType,
          recipientName,
          tenantName,
          role,
          previousRole,
          loginUrl,
        })
      )

      const subject = getTeamNotificationSubject(eventType, tenantName)

      const { data, error } = await getResend().emails.send({
        from: 'Cafe Pulse <noreply@jmcpastrycoffee.com>',
        to: [recipientEmail],
        subject,
        html,
      })

      if (error) {
        console.error(`Failed to send team ${eventType} email to ${recipientEmail}:`, error)
        return null
      }

      console.log(`Team ${eventType} email sent to ${recipientEmail}:`, data?.id)
      return data
    } catch (error) {
      console.error(`Team notification email error (${eventType}):`, error)
      return null
    }
  }
}

export default EmailService
