'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { SquarePayments, SquareWindow, SquareEnvironment } from '@/types/square'

interface SquareContextType {
  payments: SquarePayments | null
  isLoading: boolean
  error: string | null
  applicationId: string
  locationId: string
}

const SquareContext = createContext<SquareContextType>({
  payments: null,
  isLoading: true,
  error: null,
  applicationId: '',
  locationId: ''
})

export function useSquarePayments() {
  const context = useContext(SquareContext)
  if (!context) {
    throw new Error('useSquarePayments must be used within a SquareProvider')
  }
  return context
}

export function useSquareConfig() {
  const context = useContext(SquareContext)
  return { applicationId: context.applicationId, locationId: context.locationId }
}

interface SquareProviderProps {
  children: ReactNode
  applicationId: string
  locationId: string
  environment?: SquareEnvironment
}

export function SquareProvider({ 
  children, 
  applicationId, 
  locationId, 
  environment = 'sandbox' 
}: SquareProviderProps) {
  const [payments, setPayments] = useState<SquarePayments | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function initializeSquare() {
      try {
        setIsLoading(true)
        setError(null)

        // Load Square Web Payments SDK from CDN
        const squareWindow = window as SquareWindow

        if (!squareWindow.Square) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script')
            script.src = environment === 'production' 
              ? 'https://web.squarecdn.com/v1/square.js'
              : 'https://sandbox.web.squarecdn.com/v1/square.js'
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Failed to load Square SDK'))
            document.head.appendChild(script)
          })
        }

        if (!squareWindow.Square) {
          throw new Error('Square SDK unavailable after script load')
        }
        
        const paymentsInstance = await squareWindow.Square.payments(applicationId, locationId, environment)
        
        setPayments(paymentsInstance)
      } catch (err) {
        console.error('Failed to initialize Square Payments:', err)
        setError(err instanceof Error ? err.message : 'Failed to initialize Square Payments')
      } finally {
        setIsLoading(false)
      }
    }

    if (applicationId && locationId) {
      initializeSquare()
    } else {
      setError('Missing Square configuration')
      setIsLoading(false)
    }
  }, [applicationId, locationId, environment])

  return (
    <SquareContext.Provider value={{ payments, isLoading, error, applicationId, locationId }}>
      {children}
    </SquareContext.Provider>
  )
}
