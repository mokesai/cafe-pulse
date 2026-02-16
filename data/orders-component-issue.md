# OrdersManagement Component Loading Issue

**Status:** Unresolved - Component temporarily disabled with maintenance placeholder
**Date:** 2026-02-14
**Priority:** High - Blocks admin order management functionality

## Symptom

The `OrdersManagement` component fails to load with a runtime error:

```
Runtime TypeError: Cannot read properties of undefined (reading 'call')
```

**Error Location:** `src/app/admin/(protected)/orders/page.tsx`
**Call Stack:** Points to component instantiation in browser bundle

## Behavior

- **Dashboard page:** ✅ Loads correctly with AdminDashboardOverview component
- **Orders page:** ❌ Fails immediately on component load
- **Placeholder page:** ✅ Works (confirmed routing and auth are fine)

## What We Tried

### Attempt 1: Direct Import
```typescript
import { OrdersManagement } from '@/components/admin/OrdersManagement'
export default async function AdminOrdersPage() {
  return <OrdersManagement />
}
```
**Result:** ❌ Same error

### Attempt 2: Dynamic Import (Server Component)
```typescript
const OrdersManagement = dynamic(() => import('...'), { loading: ... })
export default async function AdminOrdersPage() {
  return <OrdersManagement />
}
```
**Result:** ❌ Build error - `ssr: false` not allowed in Server Components

### Attempt 3: Client Component with Dynamic Import
```typescript
'use client'
const OrdersManagement = dynamic(() => import('...'), { ssr: false })
export default function AdminOrdersPage() {
  return <OrdersManagement />
}
```
**Result:** ❌ Same runtime error

### Attempt 4: Clean Rebuild
```bash
rm -rf .next && npm run dev:webpack
```
**Result:** ❌ Error persists after clean rebuild

## Component Analysis

**OrdersManagement.tsx:**
- ✅ Valid structure - marked with `'use client'`
- ✅ Proper exports - `export function OrdersManagement()`
- ✅ No TypeScript errors (aside from config flags)
- ✅ Dependencies exist - Button, OrderDetailsModal all present
- ✅ No circular imports detected

**Comparison with Working Components:**
- AdminDashboardOverview (✅ works) has identical structure
- Both are client components with similar imports
- Both use lucide-react icons, useState, useEffect
- No obvious structural differences

## TypeScript Errors (Non-blocking)

Component shows TypeScript errors when checked with `tsc --noEmit`:
- Missing `--jsx` flag (config issue, not code issue)
- Module resolution works in Next.js build

## Current Workaround

Replaced component with maintenance placeholder in `src/app/admin/(protected)/orders/page.tsx`:

```typescript
export default async function AdminOrdersPage() {
  return (
    <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
      <h3>Orders Component Under Maintenance</h3>
      <p>The OrdersManagement component is experiencing loading issues...</p>
      <p className="text-xs">You can access order data via the API at /api/admin/orders</p>
    </div>
  )
}
```

## API Status

✅ **API routes are fully functional:**
- `GET /api/admin/orders` - Returns orders with tenant filtering
- `PATCH /api/admin/orders` - Updates order status
- All queries properly filter by tenant_id
- Authentication working correctly

## Next Steps for Investigation

1. **Check Webpack/Next.js module resolution:**
   - Inspect `.next/static/chunks` for malformed bundles
   - Look for module loading errors in browser console
   - Check if component is being bundled correctly

2. **Create minimal reproduction:**
   - Copy OrdersManagement to OrdersManagementTest
   - Strip down to bare minimum (just render a div)
   - Add features back incrementally to find breakpoint

3. **Compare compiled output:**
   - Inspect compiled JS for OrdersManagement vs AdminDashboardOverview
   - Look for differences in how they're bundled/exported

4. **Check for global state conflicts:**
   - Could be collision with React Query, toast, or other global providers
   - Try component in isolation outside admin layout

5. **Browser-specific issues:**
   - Test in different browsers
   - Check browser console for additional errors
   - Look for extension conflicts

## Suspicions

The "Cannot read properties of undefined (reading 'call')" error typically indicates:
- Module not loading correctly (exports undefined)
- Webpack/bundler issue creating malformed module
- Race condition in module initialization
- Potentially related to Next.js 15 App Router quirks

The fact that it persists across:
- Different import methods
- Clean rebuilds
- Both dev and production builds

...suggests a deeper bundling or module resolution issue rather than a code problem.

## References

- Component: `src/components/admin/OrdersManagement.tsx`
- Page: `src/app/admin/(protected)/orders/page.tsx`
- API: `src/app/api/admin/orders/route.ts`
- Screenshots: `data/Screenshot 2026-02-14 at 11.*.png`

## Workaround Impact

**User Impact:**
- ❌ Cannot manage orders via UI
- ✅ Can still access order data via API
- ✅ Dashboard shows order counts
- ✅ All other admin pages working

**Technical Debt:**
- Need to rebuild or fix OrdersManagement component
- Consider rewriting as simpler component if issue persists
- May need to investigate Next.js 15 App Router compatibility
