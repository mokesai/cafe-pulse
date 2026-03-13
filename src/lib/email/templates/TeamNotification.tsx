import {
  Html, Head, Body, Container, Heading, Text, Section, Button, Hr
} from '@react-email/components'

export type TeamEventType = 'invited' | 'role_changed' | 'removed'

interface TeamNotificationProps {
  eventType: TeamEventType
  recipientName?: string
  tenantName: string
  role: string
  previousRole?: string
  loginUrl?: string
}

const eventConfig: Record<TeamEventType, { subject: string; heading: string; color: string }> = {
  invited: {
    subject: 'You\'ve been invited to join a team',
    heading: 'Team Invitation',
    color: '#f59e0b',
  },
  role_changed: {
    subject: 'Your team role has been updated',
    heading: 'Role Updated',
    color: '#3b82f6',
  },
  removed: {
    subject: 'You\'ve been removed from a team',
    heading: 'Team Membership Removed',
    color: '#ef4444',
  },
}

function getEventMessage(props: TeamNotificationProps): string {
  switch (props.eventType) {
    case 'invited':
      return `You've been invited to join ${props.tenantName} as ${props.role}. Log in to get started.`
    case 'role_changed':
      return props.previousRole
        ? `Your role at ${props.tenantName} has been changed from ${props.previousRole} to ${props.role}.`
        : `Your role at ${props.tenantName} has been updated to ${props.role}.`
    case 'removed':
      return `You've been removed from the ${props.tenantName} team. If you believe this is a mistake, contact your team owner.`
  }
}

export function getTeamNotificationSubject(eventType: TeamEventType, tenantName: string): string {
  return `${eventConfig[eventType].subject} - ${tenantName}`
}

export default function TeamNotification(props: TeamNotificationProps) {
  const config = eventConfig[props.eventType]
  const message = getEventMessage(props)

  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f9fafb', fontFamily: 'Arial, sans-serif', margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: '480px', margin: '40px auto', backgroundColor: '#ffffff', borderRadius: '8px', overflow: 'hidden' }}>
          {/* Header */}
          <Section style={{ backgroundColor: config.color, padding: '24px 32px' }}>
            <Heading style={{ color: '#ffffff', fontSize: '20px', fontWeight: 'bold', margin: 0 }}>
              {config.heading}
            </Heading>
          </Section>

          {/* Body */}
          <Section style={{ padding: '32px' }}>
            {props.recipientName && (
              <Text style={{ fontSize: '16px', color: '#111827', margin: '0 0 16px' }}>
                Hi {props.recipientName},
              </Text>
            )}

            <Text style={{ fontSize: '15px', color: '#374151', lineHeight: '24px', margin: '0 0 24px' }}>
              {message}
            </Text>

            {props.eventType !== 'removed' && props.loginUrl && (
              <Button
                href={props.loginUrl}
                style={{
                  backgroundColor: config.color,
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  padding: '12px 24px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  display: 'inline-block',
                }}
              >
                {props.eventType === 'invited' ? 'Accept Invitation' : 'Go to Dashboard'}
              </Button>
            )}
          </Section>

          <Hr style={{ borderColor: '#e5e7eb', margin: 0 }} />

          {/* Footer */}
          <Section style={{ padding: '16px 32px' }}>
            <Text style={{ fontSize: '12px', color: '#9ca3af', margin: 0 }}>
              Sent by Cafe Pulse
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
