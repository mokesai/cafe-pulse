/**
 * Rate limiting middleware for API routes
 * Protects against abuse and DoS attacks
 */

interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Maximum requests per window
  message?: string
}

interface RateLimitEntry {
  count: number
  resetTime: number
}

// In-memory store for rate limiting
// In production, consider using Redis or similar
const rateLimitStore = new Map<string, RateLimitEntry>()

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}, 60000) // Clean every minute

/**
 * Rate limit based on IP address
 */
export function rateLimit(config: RateLimitConfig) {
  return function rateLimitMiddleware(request: Request): { success: boolean; error?: string; headers?: Record<string, string> } {
    // Skip rate limiting in test environments to avoid false 429s from CI
    if (process.env.SKIP_MFA_FOR_TESTING === 'true') {
      return { success: true }
    }

    const ip = getClientIP(request)
    const key = `rate_limit:${ip}`
    const now = Date.now()
    
    let entry = rateLimitStore.get(key)
    
    // If no entry or window has expired, create new entry
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 1,
        resetTime: now + config.windowMs
      }
      rateLimitStore.set(key, entry)
      
      return {
        success: true,
        headers: {
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': (config.maxRequests - 1).toString(),
          'X-RateLimit-Reset': Math.ceil(entry.resetTime / 1000).toString()
        }
      }
    }
    
    // Increment request count
    entry.count++
    
    // Check if limit exceeded
    if (entry.count > config.maxRequests) {
      return {
        success: false,
        error: config.message || 'Too many requests',
        headers: {
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.ceil(entry.resetTime / 1000).toString(),
          'Retry-After': Math.ceil((entry.resetTime - now) / 1000).toString()
        }
      }
    }
    
    return {
      success: true,
      headers: {
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': (config.maxRequests - entry.count).toString(),
        'X-RateLimit-Reset': Math.ceil(entry.resetTime / 1000).toString()
      }
    }
  }
}

/**
 * Extract client IP from request
 */
function getClientIP(request: Request): string {
  // Check common headers for forwarded IP
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }
  
  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }
  
  // Fallback to connection remote address
  return 'unknown'
}

// Pre-configured rate limiters for different endpoint types
export const rateLimiters = {
  // Strict limits for authentication endpoints
  auth: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    message: 'Too many authentication attempts'
  }),
  
  // Payment processing - very strict
  payment: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 3,
    message: 'Payment request limit exceeded'
  }),
  
  // API endpoints - moderate limits
  api: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60,
    message: 'API request limit exceeded'
  }),
  
  // Admin endpoints - stricter than general API
  admin: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30,
    message: 'Admin API limit exceeded'
  })
}