import type { Metadata } from 'next'
import './globals.css'
import QueryProvider from '@/providers/QueryProvider'

export const metadata: Metadata = {
  title: 'Cafe Pulse - Multi-Tenant Cafe Management',
  description:
    'Cafe Pulse is a multi-tenant cafe management platform with Square payments, menu management, and admin dashboards.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          {children}
        </QueryProvider>
      </body>
    </html>
  )
}
