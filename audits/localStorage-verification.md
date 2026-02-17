# localStorage Cross-Tenant Pollution Fix - Verification

## Section 1: Problem

**Issue:** Hardcoded localStorage keys caused cross-tenant data pollution

**Root Cause:**
- Cart data used hardcoded keys: `'cafe-cart'` and `'cafe-selected-variations'`
- Browser localStorage is domain-scoped, not subdomain-scoped on localhost
- `tenant-a.localhost:3000` and `tenant-b.localhost:3000` share the same localStorage
- When switching between tenants, Tenant A's cart appeared for Tenant B

**Impact:**
- Data leakage between tenants on same browser/domain
- User confusion (seeing another tenant's cart items)
- Security concern (could expose sensitive cart data across tenants)

**Files Affected:**
- `src/hooks/useCart.ts` - Used `localStorage.getItem('cafe-cart')`
- `src/hooks/useCartData.ts` - Used `localStorage.getItem('cafe-cart')`
- `src/components/onboarding/UserOnboarding.tsx` - Uses `'cafe-onboarding-complete'` (acceptable, onboarding state is tenant-agnostic)

---

## Section 2: Solution

**Created tenant-aware localStorage utility module:**
- **File:** `src/lib/utils/localStorage.ts`
- **Exports:** 4 wrapper functions
  - `getLocalStorageKey(tenantSlug, key)` - Generates prefixed key
  - `getItem(tenantSlug, key)` - Reads with tenant prefix
  - `setItem(tenantSlug, key, value)` - Writes with tenant prefix
  - `removeItem(tenantSlug, key)` - Removes with tenant prefix

**Key Format:**
```
${tenantSlug}:${key}
```

**Examples:**
- `'littlecafe:cart'` - Default tenant cart
- `'tenant-a:cart'` - Tenant A cart
- `'tenant-b:selected-variations'` - Tenant B variations

**Cart Hooks Updated:**
- Both `useCart.ts` and `useCartData.ts` now:
  - Import from `@/lib/utils/localStorage`
  - Use `useTenant()` hook to get tenantSlug
  - Pass tenantSlug to all localStorage operations
  - No more hardcoded 'cafe-' prefixes

**Before:**
```typescript
localStorage.getItem('cafe-cart')
localStorage.setItem('cafe-cart', data)
```

**After:**
```typescript
const { slug: tenantSlug } = useTenant()
getItem(tenantSlug, 'cart')
setItem(tenantSlug, 'cart', data)
```

---

## Section 3: Verification Steps

### Manual Testing Procedure

1. **Start development server:**
   ```bash
   npm run dev:webpack
   ```

2. **Test Tenant A:**
   - Visit http://tenant-a.localhost:3000/menu
   - Add items to cart (e.g., Coffee, Sandwich)
   - Open browser DevTools → Application → Local Storage → http://tenant-a.localhost:3000
   - **Verify:** Key is `'tenant-a:cart'` (NOT `'cafe-cart'`)
   - **Verify:** Value contains the items you added

3. **Test Tenant B:**
   - Visit http://tenant-b.localhost:3000/menu
   - **Verify:** Cart is EMPTY (should NOT show Tenant A's items)
   - Open browser DevTools → Application → Local Storage
   - **Verify:** No `'tenant-b:cart'` key yet (cart empty)
   - Add different items to cart (e.g., Tea, Muffin)
   - **Verify:** Key is `'tenant-b:cart'`
   - **Verify:** Value contains ONLY Tenant B's items

4. **Switch back to Tenant A:**
   - Visit http://tenant-a.localhost:3000/menu or /cart
   - **Verify:** Original cart still there (Coffee, Sandwich)
   - **Verify:** Tenant B's items (Tea, Muffin) are NOT present

5. **Verify selected variations:**
   - On Tenant A, add item with variations (e.g., Coffee with size options)
   - Open DevTools → Local Storage
   - **Verify:** Key is `'tenant-a:selected-variations'`
   - Switch to Tenant B
   - **Verify:** Selected variations are separate (key is `'tenant-b:selected-variations'`)

### Automated E2E Verification (Optional)

If E2E tests from Plan 70-01 exist, extend `checkout-flow.spec.ts`:

```typescript
test('cart data is tenant-scoped in localStorage', async ({ page }) => {
  // Navigate to Tenant A
  await page.goto('http://tenant-a.localhost:3000/menu')

  // Add item to cart
  await page.click('[data-testid="add-to-cart-button"]')

  // Check localStorage key
  const tenantACart = await page.evaluate(() => {
    return localStorage.getItem('tenant-a:cart')
  })
  expect(tenantACart).toBeTruthy()

  // Navigate to Tenant B
  await page.goto('http://tenant-b.localhost:3000/menu')

  // Verify cart is empty (no tenant-a cart)
  const tenantBCart = await page.evaluate(() => {
    return localStorage.getItem('tenant-b:cart')
  })
  expect(tenantBCart).toBeNull()

  // Verify tenant-a cart still exists
  const tenantACartStillExists = await page.evaluate(() => {
    return localStorage.getItem('tenant-a:cart')
  })
  expect(tenantACartStillExists).toBeTruthy()
})
```

---

## Section 4: Impact

**localStorage Usages Fixed:**
- ✅ `useCart.ts` - 4 localStorage calls now tenant-scoped
- ✅ `useCartData.ts` - 3 localStorage calls now tenant-scoped
- ⚠️ `UserOnboarding.tsx` - Still uses hardcoded `'cafe-onboarding-complete'` (acceptable, see note below)

**UserOnboarding.tsx Note:**
- Onboarding state is intentionally tenant-agnostic
- User sees onboarding once per browser, not once per tenant
- This is acceptable UX (user shouldn't see same tour on every tenant)
- If per-tenant onboarding is desired later, update to use:
  ```typescript
  const { slug: tenantSlug } = useTenant()
  const seen = getItem(tenantSlug, 'onboarding-completed')
  ```

**Breaking Changes:**
- None - Cart API remains unchanged
- Keys automatically scoped by tenantSlug from TenantProvider

**Performance:**
- No performance impact
- localStorage operations same speed
- Tenant slug lookup cached in React context

---

## Section 5: Remaining Work

**Other localStorage Usages:**
Based on Phase 70-02 security audit, these are the only localStorage usages in the codebase:
- `src/hooks/useCart.ts` - ✅ Fixed
- `src/hooks/useCartData.ts` - ✅ Fixed
- `src/components/onboarding/UserOnboarding.tsx` - ⚠️ Acceptable (see Section 4)

**Future Considerations:**

1. **Session Storage:**
   - Check if any components use `sessionStorage` (domain-scoped like localStorage)
   - If found, create similar tenant-aware wrapper in `src/lib/utils/sessionStorage.ts`

2. **IndexedDB:**
   - If app adds IndexedDB in future, ensure database names are tenant-scoped
   - Example: `${tenantSlug}_app_db` instead of `app_db`

3. **Service Workers:**
   - If PWA features added, ensure cache names are tenant-scoped
   - Example: `${tenantSlug}_app_cache_v1`

4. **Cookies:**
   - Cookies are already subdomain-scoped by browser
   - `tenant-a.localhost` cookies != `tenant-b.localhost` cookies
   - No additional scoping needed

**Next Steps:**
- Manual testing (see Section 3) to verify tenant isolation
- Consider adding E2E test for localStorage isolation
- Monitor for new localStorage usage in code reviews

---

## Verification Checklist

- [x] `src/lib/utils/localStorage.ts` created with 4 functions
- [x] `getLocalStorageKey` uses `${tenantSlug}:${key}` format
- [x] `useCart.ts` imports from localStorage utility
- [x] `useCartData.ts` imports from localStorage utility
- [x] Both hooks use `useTenant()` to get tenantSlug
- [x] No hardcoded 'cafe-cart' or 'cafe-selected-variations' remain
- [x] Build clean (`npm run build` passes)
- [x] Lint clean (`npm run lint` passes)
- [ ] Manual testing completed (see Section 3)
- [ ] E2E test added (optional)

**Status:** Implementation complete, manual testing required to verify isolation.
