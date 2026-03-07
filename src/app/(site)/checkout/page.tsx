'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ShoppingCart, User, MapPin, CheckCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import Navigation from '@/components/Navigation'
import CheckoutFlow from '@/components/checkout/CheckoutFlow'
import Button from '@/components/ui/Button'
import PhoneInput from '@/components/ui/PhoneInput'
import { useCartState, useClearCart } from '@/hooks/useCartData'
import { useSquareCartTotals } from '@/hooks/useSquareCartTotals'
import { createClient } from '@/lib/supabase/client'
import { createClientDatabaseHelpers } from '@/lib/supabase/database-client'
import { toast } from 'react-hot-toast'
import { useTenant } from '@/providers/TenantProvider'

interface CustomerInfo {
  name: string
  email: string
  phone: string
}

export default function CheckoutPage() {
  const tenant = useTenant()
  const tenantName = tenant.business_name || tenant.name
  const router = useRouter()
  const { cart, itemCount, isEmpty } = useCartState()
  const squareTotals = useSquareCartTotals(cart?.items || null)
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: '',
    email: '',
    phone: ''
  })
  const [step, setStep] = useState<'customer-info' | 'payment' | 'success'>('customer-info')
  const [loading, setLoading] = useState(true)
  
  const supabase = useMemo(() => createClient(), [])
  const db = useMemo(() => createClientDatabaseHelpers(), [])
  const clearCartMutation = useClearCart()

  useEffect(() => {
    // Get user info if logged in
    const loadUserData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          // Load full profile including phone number
          const profile = await db.getMyProfile()
          
          setCustomerInfo(prev => ({
            ...prev,
            name: profile?.fullName || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '',
            email: session.user.email || '',
            phone: profile?.phone || session.user.user_metadata?.phone || ''
          }))
        }
      } catch (error) {
        console.error('Error loading user data:', error)
      } finally {
        setLoading(false)
      }
    }
    
    loadUserData()
  }, [db, supabase])

  // Redirect if cart is empty (with a small delay to ensure cart is loaded)
  useEffect(() => {
    if (!loading) {
      // Add a small delay to ensure cart state is fully loaded
      const timeoutId = setTimeout(() => {
        if (isEmpty) {
          toast.error('Your cart is empty')
          router.push('/menu')
        }
      }, 100)
      
      return () => clearTimeout(timeoutId)
    }
  }, [isEmpty, loading, router])

  const handleCustomerInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate customer info
    if (!customerInfo.name.trim()) {
      toast.error('Please enter your name')
      return
    }
    if (!customerInfo.email.trim() || !/\S+@\S+\.\S+/.test(customerInfo.email)) {
      toast.error('Please enter a valid email address')
      return
    }
    if (!customerInfo.phone.trim()) {
      toast.error('Please enter your phone number')
      return
    }
    if (!/^\([0-9]{3}\) [0-9]{3}-[0-9]{4}$/.test(customerInfo.phone)) {
      toast.error('Please enter a valid phone number in format (555) 123-4567')
      return
    }

    setStep('payment')
  }

  const handlePaymentSuccess = async (paymentData: unknown) => {
    try {
      // Order creation is handled by the payment processing route
      // which uses Square's calculated tax amounts
      console.log('Payment successful:', paymentData)
      
      // Clear the cart
      await clearCartMutation.mutateAsync()
      
      toast.success('Order placed successfully!')
      setStep('success')
      
      // Redirect to orders page after a short delay
      setTimeout(() => {
        router.push('/orders')
      }, 2000)
    } catch (error) {
      console.error('Payment processing error:', error)
      toast.error('Failed to process order. Please try again.')
    }
  }

  const handleCancel = () => {
    if (step === 'payment') {
      setStep('customer-info')
    } else {
      router.back()
    }
  }

  const formatPrice = (price: number) => `$${price.toFixed(2)}`

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <div className="pt-20 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      </div>
    )
  }

  if (isEmpty) {
    return null // Will redirect
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      {/* Header */}
      <div className="pt-20 pb-8 bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.back()}
                className="text-gray-600 hover:text-gray-900 p-2 rounded-md transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Checkout</h1>
                <p className="text-gray-600 mt-1">Complete your order</p>
              </div>
            </div>
            
            {/* Order Summary */}
            <div className="text-right">
              <p className="text-sm text-gray-600">{itemCount} {itemCount === 1 ? 'item' : 'items'}</p>
              <p className="text-lg font-semibold text-gray-900">
                {squareTotals.loading ? (
                  <span className="text-gray-500">Calculating...</span>
                ) : (
                  formatPrice(squareTotals.total)
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className={`flex items-center ${step === 'customer-info' ? 'text-primary-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === 'customer-info' ? 'bg-primary-600 text-white' : 
              step === 'payment' || step === 'success' ? 'bg-green-500 text-white' : 'bg-gray-200'
            }`}>
              {step === 'payment' || step === 'success' ? '✓' : '1'}
            </div>
            <span className="ml-2 text-sm font-medium">Customer Info</span>
          </div>
          
          <div className="flex-1 h-px bg-gray-200 mx-4"></div>
          
          <div className={`flex items-center ${step === 'payment' ? 'text-primary-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === 'payment' ? 'bg-primary-600 text-white' : 
              step === 'success' ? 'bg-green-500 text-white' : 'bg-gray-200'
            }`}>
              {step === 'success' ? '✓' : '2'}
            </div>
            <span className="ml-2 text-sm font-medium">Payment</span>
          </div>
          
          <div className="flex-1 h-px bg-gray-200 mx-4"></div>
          
          <div className={`flex items-center ${step === 'success' ? 'text-green-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step === 'success' ? 'bg-green-500 text-white' : 'bg-gray-200'
            }`}>
              {step === 'success' ? '✓' : '3'}
            </div>
            <span className="ml-2 text-sm font-medium">Complete</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {step === 'customer-info' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
              >
                <div className="flex items-center space-x-3 mb-6">
                  <User className="text-primary-600" size={24} />
                  <h2 className="text-xl font-semibold text-gray-900">Customer Information</h2>
                </div>

                <form onSubmit={handleCustomerInfoSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      value={customerInfo.name}
                      onChange={(e) => setCustomerInfo(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Enter your full name"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      value={customerInfo.email}
                      onChange={(e) => setCustomerInfo(prev => ({ ...prev, email: e.target.value }))} 
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Enter your email address"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone Number *
                    </label>
                    <PhoneInput
                      value={customerInfo.phone}
                      onChange={(value) => setCustomerInfo(prev => ({ ...prev, phone: value }))}
                      className="w-full"
                      placeholder="(555) 123-4567"
                      required
                    />
                  </div>

                  <div className="pt-4">
                    <Button type="submit" className="w-full">
                      Continue to Payment
                    </Button>
                  </div>
                </form>
              </motion.div>
            )}

            {step === 'payment' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <CheckoutFlow
                  customerInfo={customerInfo}
                  onSuccess={handlePaymentSuccess}
                  onCancel={handleCancel}
                />
              </motion.div>
            )}

            {step === 'success' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center"
              >
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="text-green-600" size={32} />
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">Order Confirmed!</h2>
                <p className="text-gray-600 mb-6">
                  Thank you for your order. You&apos;ll receive a confirmation email shortly.
                </p>
                <Button onClick={() => router.push('/orders')}>
                  View Order Status
                </Button>
              </motion.div>
            )}
          </div>

          {/* Order Summary Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sticky top-8">
              <div className="flex items-center space-x-3 mb-6">
                <ShoppingCart className="text-primary-600" size={20} />
                <h3 className="text-lg font-semibold text-gray-900">Order Summary</h3>
              </div>

              {cart?.items.map((item) => (
                <div key={item.id} className="flex justify-between py-3 border-b border-gray-100 last:border-b-0">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{item.name}</p>
                    {item.variationName && (
                      <p className="text-sm text-gray-600">{item.variationName}</p>
                    )}
                    <p className="text-sm text-gray-600">Qty: {item.quantity}</p>
                  </div>
                  <p className="font-medium text-gray-900">{formatPrice(item.totalPrice)}</p>
                </div>
              ))}

              <div className="space-y-2 pt-4 mt-4 border-t border-gray-200">
                <div className="flex justify-between text-sm">
                  <span>Subtotal:</span>
                  <span>{formatPrice(squareTotals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Tax:</span>
                  <span>
                    {squareTotals.loading ? (
                      <span className="text-gray-500">Calculating...</span>
                    ) : (
                      formatPrice(squareTotals.tax)
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-lg font-semibold border-t border-gray-200 pt-2">
                  <span>Total:</span>
                  <span>
                    {squareTotals.loading ? (
                      <span className="text-gray-500">Calculating...</span>
                    ) : (
                      formatPrice(squareTotals.total)
                    )}
                  </span>
                </div>
              </div>

              <div className="mt-6 p-4 bg-primary-50 rounded-lg">
                <div className="flex items-start space-x-3">
                  <MapPin className="text-primary-600 mt-0.5" size={16} />
                  <div className="text-sm">
                    <p className="font-medium text-primary-800">{tenantName}</p>
                    {tenant.business_address && <p className="text-primary-600">{tenant.business_address}</p>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
