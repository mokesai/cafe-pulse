'use client'

import { ReactNode } from 'react'
import { SquareProvider } from '@/providers/SquareProvider'

export interface SquarePublicConfig {
  applicationId: string
  locationId: string
  environment: 'sandbox' | 'production'
}

interface DynamicSquareProviderProps {
  children: ReactNode
  config: SquarePublicConfig | null
}

export default function DynamicSquareProvider({ children, config }: DynamicSquareProviderProps) {
  if (!config) {
    // No Square config = render children without payments SDK
    // This handles unconfigured tenants gracefully
    return <>{children}</>
  }

  return (
    <SquareProvider
      applicationId={config.applicationId}
      locationId={config.locationId}
      environment={config.environment}
    >
      {children}
    </SquareProvider>
  )
}
