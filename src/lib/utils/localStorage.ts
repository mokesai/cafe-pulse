/**
 * Tenant-aware localStorage utility module
 *
 * Purpose: Prevent cross-tenant data pollution by prefixing all localStorage keys
 * with the tenant slug. Browser localStorage is domain-scoped, not subdomain-scoped
 * on localhost, so tenant-a.localhost and tenant-b.localhost share the same storage.
 *
 * Example usage:
 *   getItem('littlecafe', 'cart')  // reads from key 'littlecafe:cart'
 *   setItem('tenant-b', 'cart', data) // writes to key 'tenant-b:cart'
 */

/**
 * Generate a tenant-scoped localStorage key
 * @param tenantSlug - The tenant identifier (e.g., 'littlecafe', 'tenant-a')
 * @param key - The base key name (e.g., 'cart', 'selected-variations')
 * @returns Prefixed key in format 'tenantSlug:key'
 */
export function getLocalStorageKey(tenantSlug: string, key: string): string {
  return `${tenantSlug}:${key}`
}

/**
 * Get an item from localStorage with tenant scoping
 * @param tenantSlug - The tenant identifier
 * @param key - The base key name
 * @returns The stored value or null if not found/unavailable
 */
export function getItem(tenantSlug: string, key: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const scopedKey = getLocalStorageKey(tenantSlug, key)
    return localStorage.getItem(scopedKey)
  } catch (error) {
    console.error(`Failed to get localStorage item for tenant ${tenantSlug}, key ${key}:`, error)
    return null
  }
}

/**
 * Set an item in localStorage with tenant scoping
 * @param tenantSlug - The tenant identifier
 * @param key - The base key name
 * @param value - The value to store (must be a string; use JSON.stringify for objects)
 */
export function setItem(tenantSlug: string, key: string, value: string): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const scopedKey = getLocalStorageKey(tenantSlug, key)
    localStorage.setItem(scopedKey, value)
  } catch (error) {
    console.error(`Failed to set localStorage item for tenant ${tenantSlug}, key ${key}:`, error)
  }
}

/**
 * Remove an item from localStorage with tenant scoping
 * @param tenantSlug - The tenant identifier
 * @param key - The base key name
 */
export function removeItem(tenantSlug: string, key: string): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const scopedKey = getLocalStorageKey(tenantSlug, key)
    localStorage.removeItem(scopedKey)
  } catch (error) {
    console.error(`Failed to remove localStorage item for tenant ${tenantSlug}, key ${key}:`, error)
  }
}
