'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MenuCategory, MenuItem } from '@/types/menu'
import { getItem, setItem, removeItem } from '@/lib/utils/localStorage'
import { useTenant } from '@/providers/TenantProvider'

interface CartItem {
  itemId: string
  variationId?: string
  quantity: number
}

export const useCart = (categories: MenuCategory[]) => {
  const { slug: tenantSlug } = useTenant()
  const [cart, setCart] = useState<Record<string, CartItem>>({})
  const [selectedVariations, setSelectedVariations] = useState<Record<string, string>>({})

  // Initialize default variations when categories change
  useEffect(() => {
    if (categories.length > 0) {
      const initialVariations: Record<string, string> = {}
      categories.forEach((category: MenuCategory) => {
        category.items?.forEach((item: MenuItem) => {
          if (item.variations && item.variations.length > 0) {
            initialVariations[item.id] = item.variations[0].id
          }
        })
      })
      setSelectedVariations(prev => ({ ...initialVariations, ...prev }))
    }
  }, [categories])

  // Load cart from localStorage on mount
  const loadCartFromStorage = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedCart = getItem(tenantSlug, 'cart')
        const savedVariations = getItem(tenantSlug, 'selected-variations')

        if (savedCart) {
          const parsedCart = JSON.parse(savedCart)
          // Check if old cart format (number values) and convert to new format
          const convertedCart: Record<string, CartItem> = {}

          Object.entries(parsedCart).forEach(([key, value]) => {
            if (typeof value === 'number') {
              // Old format: convert to new format
              convertedCart[key] = { itemId: key, quantity: value }
            } else {
              // New format: use as is
              convertedCart[key] = value as CartItem
            }
          })

          setCart(convertedCart)
        }

        if (savedVariations) {
          const parsedVariations = JSON.parse(savedVariations)
          setSelectedVariations(parsedVariations)
        }
      } catch (error) {
        console.error('Error loading cart from storage:', error)
      }
    }
  }, [tenantSlug])

  useEffect(() => {
    loadCartFromStorage()
  }, [loadCartFromStorage])

  // Save cart to localStorage whenever cart changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setItem(tenantSlug, 'cart', JSON.stringify(cart))
      setItem(tenantSlug, 'selected-variations', JSON.stringify(selectedVariations))
    }
  }, [cart, selectedVariations, tenantSlug])

  // Helper function to create cart keys
  const createCartKey = (itemId: string, variationId?: string): string => {
    return variationId ? `${itemId}-${variationId}` : itemId
  }

  // Helper function to get current cart quantity for item with selected variation
  const getCurrentCartQuantity = (itemId: string): number => {
    const variationId = selectedVariations[itemId]
    const cartKey = createCartKey(itemId, variationId)
    return cart[cartKey]?.quantity || 0
  }

  const addToCart = (itemId: string) => {
    const variationId = selectedVariations[itemId]
    const cartKey = createCartKey(itemId, variationId)
    
    setCart(prev => {
      const existing = prev[cartKey]
      if (existing) {
        return {
          ...prev,
          [cartKey]: { ...existing, quantity: existing.quantity + 1 }
        }
      } else {
        return {
          ...prev,
          [cartKey]: { itemId, variationId, quantity: 1 }
        }
      }
    })
  }

  const removeFromCart = (cartKey: string) => {
    setCart(prev => {
      const newCart = { ...prev }
      const existing = newCart[cartKey]
      if (existing && existing.quantity > 1) {
        newCart[cartKey] = { ...existing, quantity: existing.quantity - 1 }
      } else {
        delete newCart[cartKey]
      }
      return newCart
    })
  }

  // Helper function to remove from cart using current selection
  const removeFromCartCurrent = (itemId: string) => {
    const variationId = selectedVariations[itemId]
    const cartKey = createCartKey(itemId, variationId)
    removeFromCart(cartKey)
  }

  const updateCartQuantity = (cartKey: string, quantity: number) => {
    if (quantity <= 0) {
      removeItemFromCart(cartKey)
    } else {
      setCart(prev => {
        const existing = prev[cartKey]
        if (existing) {
          return {
            ...prev,
            [cartKey]: { ...existing, quantity }
          }
        }
        return prev
      })
    }
  }

  const removeItemFromCart = (cartKey: string) => {
    setCart(prev => {
      const newCart = { ...prev }
      delete newCart[cartKey]
      return newCart
    })
  }

  const clearCart = () => {
    setCart({})
    setSelectedVariations({})
    if (typeof window !== 'undefined') {
      removeItem(tenantSlug, 'cart')
      removeItem(tenantSlug, 'selected-variations')
    }
  }

  const selectVariation = (itemId: string, variationId: string) => {
    setSelectedVariations(prev => ({
      ...prev,
      [itemId]: variationId
    }))
  }

  const getTotalCartItems = (): number => {
    return Object.values(cart).reduce((sum, cartItem) => sum + cartItem.quantity, 0)
  }

  return {
    cart,
    selectedVariations,
    addToCart,
    removeFromCart,
    removeFromCartCurrent,
    updateCartQuantity,
    removeItemFromCart,
    clearCart,
    getCurrentCartQuantity,
    selectVariation,
    getTotalCartItems,
    createCartKey
  }
}