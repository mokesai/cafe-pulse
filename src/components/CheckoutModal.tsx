'use client'

import { useState, useEffect } from 'react'
import { X, CreditCard, Loader2 } from 'lucide-react'
import { PaymentForm, CreditCard as SquareCreditCard } from 'react-square-web-payments-sdk'
import type { MenuItem, MenuCategory } from '@/types/menu'
import { useSquareConfig } from '@/providers/SquareProvider'

interface SquarePaymentToken {
  token?: string
  detail?: string
}

type SquareVerifiedBuyer = unknown

interface CheckoutModalProps {
  isOpen: boolean
  onClose: () => void
  cart: Record<string, { itemId: string; variationId?: string; quantity: number }>
  categories: MenuCategory[]
  subtotal: number
  tax: number
  total: number
  onPaymentSuccess: () => void
}

export default function CheckoutModal({
  isOpen,
  onClose,
  cart,
  categories,
  subtotal,
  tax,
  total,
  onPaymentSuccess
}: CheckoutModalProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [isPaymentFormReady, setIsPaymentFormReady] = useState(false)
  const [customerInfo, setCustomerInfo] = useState({
    email: '',
    name: '',
    phone: '',
    postalCode: ''
  })

  // Call hooks before any conditional returns
  const { applicationId, locationId } = useSquareConfig()

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setIsPaymentFormReady(false)
      setPaymentError(null)
      setIsProcessing(false)

      // Add global error handler for uncaught Square SDK errors
      const handleGlobalError = (event: ErrorEvent) => {
        if (event.error && event.error.message && event.error.message.includes('Tokenization failed')) {
          console.error('Caught Square SDK error:', event.error)

          // Parse Square error message
          const errorMessage = event.error.message
          if (errorMessage.includes('Credit card number is not valid')) {
            setPaymentError('Please enter a valid credit card number')
          } else if (errorMessage.includes('expiration')) {
            setPaymentError('Please enter a valid expiration date')
          } else if (errorMessage.includes('CVV') || errorMessage.includes('cvv')) {
            setPaymentError('Please enter a valid CVV')
          } else if (errorMessage.includes('postal')) {
            setPaymentError('Please enter a valid postal code')
          } else {
            setPaymentError('Please check your card information and try again')
          }

          // Prevent the error from propagating
          event.preventDefault()
          return false
        }
      }

      window.addEventListener('error', handleGlobalError)

      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        setIsPaymentFormReady(true)
      }, 500)

      return () => {
        clearTimeout(timer)
        window.removeEventListener('error', handleGlobalError)
      }
    } else {
      setIsPaymentFormReady(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  // Helper function to find item by ID across all categories
  const findItemById = (itemId: string): MenuItem | null => {
    for (const category of categories) {
      const item = category.items?.find(item => item.id === itemId)
      if (item) return item
    }
    return null
  }

  // Get cart items for order creation
  const getCartItems = () => {
    return Object.entries(cart).map(([, cartData]) => {
      const item = findItemById(cartData.itemId)
      if (!item) return null

      const variation = cartData.variationId ? 
        item.variations?.find(v => v.id === cartData.variationId) : null
      
      return {
        id: cartData.variationId || cartData.itemId, // Use variation ID for Square if available
        name: item.name,
        quantity: cartData.quantity,
        price: item.price + (variation?.priceDifference || 0),
        variationId: cartData.variationId,
        variationName: variation?.name
      }
    }).filter(Boolean)
  }

  const formatPrice = (price: number) => `$${price.toFixed(2)}`

  const handlePaymentToken = async (token: SquarePaymentToken, verifiedBuyer: SquareVerifiedBuyer) => {
    console.log('Payment token received:', token)
    
    if (!token || !token.token) {
      setPaymentError('Invalid payment token received. Please try again.')
      return
    }

    setIsProcessing(true)
    setPaymentError(null)

    try {
      console.log('Sending payment request...')
      
      // Create order and process payment
      const response = await fetch('/api/square/process-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          paymentToken: token.token,
          amount: total,
          customerInfo,
          cartItems: getCartItems(),
          verifiedBuyer
        })
      })

      const result = await response.json()
      console.log('Payment response:', result)

      if (!response.ok) {
        throw new Error(result.error || 'Payment processing failed')
      }

      // Payment successful
      console.log('Payment successful!')
      onPaymentSuccess()
      onClose()
    } catch (error) {
      console.error('Payment error:', error)
      setPaymentError(error instanceof Error ? error.message : 'Payment failed. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  return !applicationId || !locationId ? (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold text-red-600 mb-2">Payment Configuration Error</h3>
          <p className="text-gray-600">Square payment system is not properly configured.</p>
          <button
            onClick={onClose}
            className="mt-4 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CreditCard className="h-6 w-6" />
            Checkout
          </h2>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Order Summary */}
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Order Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium">{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Tax (8%)</span>
                <span className="font-medium">{formatPrice(tax)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t border-gray-200 pt-2">
                <span>Total</span>
                <span className="text-amber-600">{formatPrice(total)}</span>
              </div>
            </div>
          </div>

          {/* Customer Information */}
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Contact Information</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={customerInfo.email}
                  onChange={(e) => setCustomerInfo(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="your@email.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={customerInfo.name}
                  onChange={(e) => setCustomerInfo(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={customerInfo.phone}
                  onChange={(e) => setCustomerInfo(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Postal Code *
                </label>
                <input
                  type="text"
                  required
                  value={customerInfo.postalCode}
                  onChange={(e) => setCustomerInfo(prev => ({ ...prev, postalCode: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="12345"
                  maxLength={10}
                />
              </div>
            </div>
          </div>

          {/* Payment Error */}
          {paymentError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{paymentError}</p>
            </div>
          )}

          {/* Payment Form */}
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Payment Information</h3>
            {!customerInfo.email || !customerInfo.postalCode ? (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
                <p className="text-sm text-gray-600">Please enter your email address and postal code to continue with payment.</p>
              </div>
            ) : !isPaymentFormReady ? (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                  <p className="text-sm text-gray-600">Loading payment form...</p>
                </div>
              </div>
            ) : (
              <div className="min-h-[80px]">
                <PaymentForm
                  applicationId={applicationId}
                  locationId={locationId}
                  cardTokenizeResponseReceived={(token, verifiedBuyer) => {
                    // Only process if we have a valid token
                    if (token && token.token) {
                      handlePaymentToken(token, verifiedBuyer)
                    }
                  }}
                  createVerificationDetails={() => ({
                    amount: (total * 100).toString(), // Convert to cents
                    currencyCode: 'USD',
                    intent: 'CHARGE',
                    billingContact: {
                      emailAddress: customerInfo.email,
                      givenName: customerInfo.name?.split(' ')[0] || '',
                      familyName: customerInfo.name?.split(' ').slice(1).join(' ') || '',
                      postalCode: customerInfo.postalCode
                    }
                  })}
                >
                  <SquareCreditCard 
                    includeInputLabels
                    style={{
                      input: {
                        fontSize: '16px',
                        color: '#374151'
                      },
                      'input.is-focus': {
                        color: '#111827'
                      },
                      'input.is-error': {
                        color: '#DC2626'
                      }
                    }}
                  />
                </PaymentForm>
              </div>
            )}
          </div>
        </div>

        {/* Fixed Footer - Payment Summary */}
        {customerInfo.email && customerInfo.postalCode && isPaymentFormReady && (
          <div className="border-t border-gray-200 bg-gray-50 p-4 flex-shrink-0">
            <div className="text-center mb-3">
              <div className="text-sm text-gray-600">Total Amount</div>
              <div className="text-2xl font-bold text-amber-600">{formatPrice(total)}</div>
            </div>
            <div className="text-xs text-gray-500 text-center">
              Complete your card information above and click Pay to process your order
            </div>
          </div>
        )}

        {/* Processing Indicator */}
        {isProcessing && (
          <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center z-10 rounded-2xl">
            <div className="bg-white rounded-lg p-6 flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
              <span className="text-gray-900">Processing payment...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
