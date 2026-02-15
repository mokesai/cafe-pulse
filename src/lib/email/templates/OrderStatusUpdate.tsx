import {
  Html, Head, Body, Container, Heading, Text, Section
} from '@react-email/components'

interface OrderStatusUpdateProps {
  orderId: string
  status: string
  message: string
  customerName?: string

  // Tenant branding
  businessName: string
  businessAddress?: string
  businessPhone?: string
  businessEmail?: string
  businessHours?: string
  primaryColor?: string
}

const statusColors: Record<string, string> = {
  confirmed: '#10b981',
  preparing: '#f59e0b',
  ready: '#059669',
  completed: '#6b7280',
  cancelled: '#ef4444'
}

export default function OrderStatusUpdate({
  orderId,
  status,
  message,
  customerName,
  businessName,
  businessAddress,
  businessPhone,
  businessEmail,
  businessHours,
  primaryColor
}: OrderStatusUpdateProps) {
  const color = statusColors[status] || primaryColor || '#6b7280'

  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'Arial, sans-serif', lineHeight: '1.6', color: '#333' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
          <Section style={{ background: color, color: 'white', padding: '20px', textAlign: 'center', borderRadius: '8px 8px 0 0' }}>
            <Heading style={{ margin: 0 }}>Order Update</Heading>
            {customerName && <Text style={{ margin: '10px 0 0' }}>Hi {customerName}!</Text>}
          </Section>

          <Section style={{ background: '#f9f9f9', padding: '20px', borderRadius: '0 0 8px 8px' }}>
            <Text style={{ fontWeight: 'bold' }}>Order #{orderId.slice(-8)}</Text>

            <Section style={{ textAlign: 'center', margin: '20px 0' }}>
              <span style={{
                background: color,
                color: 'white',
                padding: '8px 16px',
                borderRadius: '20px',
                display: 'inline-block',
                fontWeight: 'bold',
                textTransform: 'uppercase'
              }}>
                {status}
              </span>
            </Section>

            <Text>{message}</Text>

            {status === 'ready' && (
              <Section style={{ background: '#fef3c7', padding: '15px', borderRadius: '6px', margin: '15px 0' }}>
                <Heading as="h4" style={{ margin: '0 0 10px' }}>Pickup Location:</Heading>
                <Text style={{ margin: 0, fontWeight: 'bold' }}>{businessName}</Text>
                {businessAddress && <Text style={{ margin: '5px 0 0' }}>{businessAddress}</Text>}
                {businessHours && <Text style={{ margin: '5px 0 0' }}>Hours: {businessHours}</Text>}
              </Section>
            )}
          </Section>

          <Section style={{ textAlign: 'center', marginTop: '20px', color: '#666', fontSize: '14px' }}>
            {businessEmail && <Text style={{ margin: '5px 0' }}>Questions? Contact us at {businessEmail}</Text>}
            <Text style={{ margin: '5px 0' }}>{businessName} - Fresh coffee, made with care</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
