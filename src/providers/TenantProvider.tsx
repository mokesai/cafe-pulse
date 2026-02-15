'use client'

import { createContext, useContext, ReactNode } from 'react'
import type { TenantPublic } from '@/lib/tenant/types'

const TenantContext = createContext<TenantPublic | undefined>(undefined)

export function TenantProvider({
  children,
  tenant
}: {
  children: ReactNode
  tenant: TenantPublic
}) {
  return (
    <TenantContext.Provider value={tenant}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  const context = useContext(TenantContext)
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider')
  }
  return context
}
