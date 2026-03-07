'use client'

import { useState, useEffect } from 'react'
import { Menu, X, ShoppingCart, Search, Heart, Coffee } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuthContainer, UserDropdown } from './auth'
import { Button } from './ui'
import { useCartState } from '@/hooks/useCartData'
import NotificationDropdown from './notifications/NotificationDropdown'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useTenant } from '@/providers/TenantProvider'

const Navigation = () => {
  const tenant = useTenant()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const pathname = usePathname()
  
  const supabase = createClient()
  const { itemCount, openCart } = useCartState()

  // Handle escape key for modals
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isMenuOpen) {
          setIsMenuOpen(false)
        }
        if (authModalOpen) {
          setAuthModalOpen(false)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isMenuOpen, authModalOpen])

  const navItems = [
    { name: 'Home', href: '/' },
    { name: 'About', href: '/about' },
    { name: 'Menu', href: '/menu' },
    { name: 'Gallery', href: '/gallery' },
    { name: 'Contact', href: '/contact' },
    { name: 'Profile', href: '/profile' },
  ]

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [supabase.auth])

  const closeMenu = () => {
    setIsMenuOpen(false)
  }

  const openAuthModal = (mode: 'login' | 'signup') => {
    setAuthMode(mode)
    setAuthModalOpen(true)
  }


  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      // Store search query for menu page to filter
      sessionStorage.setItem('menuSearch', searchQuery.trim())
      // Navigate to menu page
      window.location.href = '/menu'
    }
    setShowSearch(false)
    setSearchQuery('')
  }

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-b border-gray-100" style={{ zIndex: 1030 }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex-shrink-0">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <div className="text-2xl font-bold text-primary-800">
                {tenant.business_name || tenant.name}
              </div>
              {typeof (tenant.features as Record<string, unknown>)?.subtitle === 'string' && (
                <div className="text-xs text-gray-600 font-medium -mt-1">
                  {(tenant.features as Record<string, string>).subtitle}
                </div>
              )}
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:space-x-6">
            <div className="flex items-baseline space-x-6">
              {navItems.slice(0, 5).map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                    pathname === item.href
                      ? 'text-primary-600 bg-primary-50'
                      : 'text-gray-700 hover:text-primary-600'
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
            
            {/* Action Items */}
            <div className="flex items-center space-x-3">
              {/* Search */}
              <button
                onClick={() => setShowSearch(true)}
                className="text-gray-700 hover:text-primary-600 p-2 rounded-md transition-colors"
                title="Search"
              >
                <Search size={18} />
              </button>

              {/* Order Now Icon */}
              <Link href="/menu">
                <button
                  className="text-gray-700 hover:text-primary-600 p-2 rounded-md transition-colors"
                  title="Order Now"
                >
                  <Coffee size={20} />
                </button>
              </Link>
              
              {/* Favorites Icon - only show if user is logged in */}
              {user && (
                <Link href="/favorites">
                  <button
                    className="text-gray-700 hover:text-primary-600 p-2 rounded-md transition-colors"
                    title="View Favorites"
                  >
                    <Heart size={20} />
                  </button>
                </Link>
              )}
              
              {/* Cart Icon */}
              <button
                onClick={openCart}
                className="text-gray-700 hover:text-primary-600 p-2 rounded-md transition-colors relative"
                title="View Cart"
              >
                <ShoppingCart size={20} />
                {itemCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 bg-primary-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium"
                  >
                    {itemCount}
                  </motion.span>
                )}
              </button>
              
              {loading ? (
                <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
              ) : user ? (
                <div className="flex items-center space-x-2">
                  {/* Notifications */}
                  <NotificationDropdown user={user} />
                  <UserDropdown user={user} />
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openAuthModal('login')}
                  >
                    Sign In
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => openAuthModal('signup')}
                  >
                    Sign Up
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center space-x-2">
            {/* Mobile Cart Icon */}
            <button
              onClick={openCart}
              className="text-gray-700 hover:text-primary-600 p-2 rounded-md transition-colors relative"
            >
              <ShoppingCart size={20} />
              {itemCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 bg-primary-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium"
                >
                  {itemCount}
                </motion.span>
              )}
            </button>
            
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="text-gray-700 hover:text-primary-600 p-2 rounded-md"
            >
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="md:hidden overflow-hidden"
            >
              <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white border-t border-gray-100 shadow-lg">
                {navItems.map((item, index) => (
                  <motion.div
                    key={item.name}
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Link
                      href={item.href}
                      onClick={closeMenu}
                      className={`block px-3 py-3 rounded-lg text-base font-medium transition-all duration-200 ${
                        pathname === item.href
                          ? 'text-primary-600 bg-primary-50 border-l-4 border-primary-600'
                          : 'text-gray-700 hover:text-primary-600 hover:bg-primary-50'
                      }`}
                    >
                      {item.name}
                    </Link>
                  </motion.div>
                ))}
                
                {/* Mobile Auth Section */}
                <motion.div
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: navItems.length * 0.05 }}
                  className="border-t border-gray-100 pt-3 mt-3"
                >
                  {loading ? (
                    <div className="px-3 py-2">
                      <div className="w-full h-10 bg-gray-200 rounded-lg animate-pulse"></div>
                    </div>
                  ) : user ? (
                    <div className="px-3 py-2">
                      <UserDropdown user={user} />
                    </div>
                  ) : (
                    <div className="space-y-3 px-3">
                      <Button
                        variant="outline"
                        className="w-full justify-center py-3"
                        onClick={() => {
                          setIsMenuOpen(false)
                          openAuthModal('login')
                        }}
                      >
                        Sign In
                      </Button>
                      <Button
                        className="w-full py-3"
                        onClick={() => {
                          setIsMenuOpen(false)
                          openAuthModal('signup')
                        }}
                      >
                        Sign Up
                      </Button>
                    </div>
                  )}
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Search Modal */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center pt-20"
            onClick={() => setShowSearch(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <form onSubmit={handleSearch} className="p-6">
                <div className="flex items-center space-x-4">
                  <Search className="w-6 h-6 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search menu items, categories..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 text-lg border-none outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowSearch(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                {searchQuery && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-sm text-gray-600 mb-2">Popular searches:</p>
                    <div className="flex flex-wrap gap-2">
                      {['Coffee', 'Latte', 'Sandwich', 'Pastry', 'Breakfast'].map((term) => (
                        <button
                          key={term}
                          type="button"
                          onClick={() => setSearchQuery(term)}
                          className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm hover:bg-gray-200 transition-colors"
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auth Modal */}
      <AuthContainer 
        isOpen={authModalOpen} 
        onClose={() => setAuthModalOpen(false)}
        defaultMode={authMode}
      />
    </nav>
  )
}

export default Navigation 
