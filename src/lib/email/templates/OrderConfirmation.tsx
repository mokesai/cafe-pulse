import {
  Html, Head, Body, Container, Heading, Text, Section, Hr
} from '@react-email/components'

interface OrderConfirmationProps {
  // Order data
  orderId: string
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

  // Tenant branding (will be populated from getTenantIdentity)
  businessName: string
  businessAddress?: string
  businessPhone?: string
  businessEmail?: string
  businessHours?: string
  logoUrl?: string
  primaryColor?: string
}

export default function OrderConfirmation({
  orderId,
  customerName,
  items,
  subtotal,
  tax,
  total,
  pickupTime,
  specialInstructions,
  businessName,
  businessAddress,
  businessPhone,
  businessEmail,
  businessHours,
  primaryColor = '#f59e0b',
}: OrderConfirmationProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'Arial, sans-serif', lineHeight: '1.6', color: '#333' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
          <Section style={{ background: primaryColor, color: 'white', padding: '20px', textAlign: 'center', borderRadius: '8px 8px 0 0' }}>
            <Heading style={{ margin: 0 }}>Order Confirmation</Heading>
            <Text style={{ margin: '10px 0 0' }}>Thank you for your order, {customerName}!</Text>
          </Section>

          <Section style={{ background: '#f9f9f9', padding: '20px', borderRadius: '0 0 8px 8px' }}>
            <Section style={{ background: 'white', padding: '15px', borderRadius: '6px', margin: '15px 0' }}>
              <Heading as="h3" style={{ margin: '0 0 10px' }}>Order #{orderId.slice(-8)}</Heading>

              <Heading as="h4" style={{ margin: '15px 0 10px' }}>Items Ordered:</Heading>
              {items.map((item, idx) => (
                <Section key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                  <Text style={{ margin: 0 }}>{item.quantity}x {item.name}</Text>
                  <Text style={{ margin: 0 }}>${item.total.toFixed(2)}</Text>
                </Section>
              ))}

              <Hr style={{ margin: '15px 0', border: 'none', borderTop: `2px solid ${primaryColor}` }} />

              <Section style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <Text style={{ margin: 0 }}>Subtotal:</Text>
                <Text style={{ margin: 0 }}>${subtotal.toFixed(2)}</Text>
              </Section>
              <Section style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <Text style={{ margin: 0 }}>Tax:</Text>
                <Text style={{ margin: 0 }}>${tax.toFixed(2)}</Text>
              </Section>
              <Section style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 'bold' }}>
                <Text style={{ margin: 0 }}>Total:</Text>
                <Text style={{ margin: 0 }}>${total.toFixed(2)}</Text>
              </Section>

              {specialInstructions && (
                <Section style={{ marginTop: '15px' }}>
                  <Text style={{ fontWeight: 'bold', margin: '0 0 5px' }}>Special Instructions:</Text>
                  <Text style={{ margin: 0 }}>{specialInstructions}</Text>
                </Section>
              )}
            </Section>

            <Section style={{ background: '#fef3c7', padding: '15px', borderRadius: '6px', margin: '15px 0' }}>
              <Heading as="h4" style={{ margin: '0 0 10px' }}>Pickup Location:</Heading>
              <Text style={{ margin: 0, fontWeight: 'bold' }}>{businessName}</Text>
              {businessAddress && <Text style={{ margin: '5px 0 0' }}>{businessAddress}</Text>}
              {businessHours && <Text style={{ margin: '5px 0 0' }}>Hours: {businessHours}</Text>}
              {pickupTime && (
                <Text style={{ margin: '10px 0 0', fontWeight: 'bold' }}>
                  Estimated Pickup Time: {pickupTime}
                </Text>
              )}
            </Section>

            <Text>We&apos;ll send you another email when your order is ready for pickup!</Text>
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
