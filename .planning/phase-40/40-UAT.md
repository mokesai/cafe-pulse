---
phase: 40
phase_name: Tenant-Aware Square Integration
started: 2026-02-15
status: in_progress
total_tests: 8
passed: 0
failed: 0
---

# Phase 40 User Acceptance Testing

## Goal
Verify that Square integration is refactored to use tenant-aware credential loading while maintaining backward compatibility with the default tenant (env var fallback).

## Test Results

### Build & Runtime

#### Test 1: TypeScript Build Passes
**Status:** failed
**Expected:** `npm run build` completes without TypeScript errors
**Actual:** Build failed with type error in src/app/api/square/customers/cards/route.ts:29
**Issue:** searchSquareCustomerByEmail() expects 2 arguments (config, email) but route calls it with only 1 (email). Route needs tenant resolution and config loading added.

---

#### Test 2: Development Server Starts
**Status:** blocked
**Expected:** `npm run dev` starts without errors, shows "Ready" message
**Actual:** Cannot test - build broken
**Issue:** Blocked by Test 1 failure

---

### Customer-Facing Features (Default Tenant)

#### Test 3: Menu Page Loads
**Status:** blocked
**Expected:** Navigate to http://localhost:3000 → menu items display correctly
**Actual:** Cannot test - build broken
**Issue:** Blocked by Test 1 failure

---

#### Test 4: Checkout Flow Works
**Status:** blocked
**Expected:** Add item to cart → click checkout → Square payment form loads → can see card fields
**Actual:** Cannot test - build broken
**Issue:** Blocked by Test 1 failure

---

### Admin Features (Default Tenant)

#### Test 5: Admin Menu Categories Page
**Status:** blocked
**Expected:** Navigate to http://localhost:3000/admin/menu/categories → categories list loads without errors
**Actual:** Cannot test - build broken
**Issue:** Blocked by Test 1 failure

---

#### Test 6: Admin Menu Items Page
**Status:** blocked
**Expected:** Navigate to http://localhost:3000/admin/menu/items → items list loads without errors
**Actual:** Cannot test - build broken
**Issue:** Blocked by Test 1 failure

---

### CLI Tools

#### Test 7: Setup Scripts Support Tenant Flags
**Status:** passed
**Expected:** Run `npm run sync-square-catalog -- --help` → shows --tenant-id and --tenant-slug options in help text
**Actual:** Help text displays tenant flags correctly
**Issue:** None

---

### Code Quality

#### Test 8: No Env Var Reads in fetch-client
**Status:** passed
**Expected:** Check `src/lib/square/fetch-client.ts` → contains no `process.env` references
**Actual:** 0 matches found - fetch-client fully parameterized
**Issue:** None

---

## Summary

**Overall:** 2/8 tests passed (6 blocked by build failure)

**Issues Found:** 1
- **BLOCKING** - src/app/api/square/customers/cards/route.ts missing tenant resolution and config loading (calls searchSquareCustomerByEmail with wrong signature)

**Notes:**
- Multi-tenant isolation testing deferred (requires second tenant setup)
- Webhook testing deferred (requires live Square webhooks)
- Vault credential UI testing deferred to Phase 60
