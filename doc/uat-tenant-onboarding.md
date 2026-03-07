# UAT: Tenant Onboarding & Menu Rendering

**Test Date:** _________
**Tester:** _________
**Milestone:** 1.0 Multi-Tenant MVP

## Overview

This document guides you through manual User Acceptance Testing of the complete tenant onboarding workflow, including Square OAuth integration and menu rendering verification.

**What we're testing:**
- Platform admin onboarding wizard (2-step flow)
- Square OAuth integration with real sandbox account
- Tenant-isolated menu rendering (customer-facing + KDS)
- Admin invite and first-login claim flow
- Cross-tenant data isolation

---

## Prerequisites Check

### 1. Platform Admin Access

First, verify you have platform admin access:

```bash
# Check if your user is a platform admin
# Replace with your email
psql $DATABASE_URL -c "SELECT * FROM platform_admins WHERE user_id = (SELECT id FROM auth.users WHERE email = 'your-email@example.com');"
```

If not found, bootstrap yourself as platform admin:

```sql
SELECT bootstrap_platform_admin('your-email@example.com');
```

### 2. MFA Enrollment (if not already done)

- Visit `http://localhost:3000/platform`
- If redirected to `/mfa-enroll`, scan QR code with authenticator app
- Enter 6-digit code to complete enrollment

### 3. Second Square Sandbox Account

- ✓ Created second Square sandbox account at https://squareupsandbox.com/
- ✓ Imported menu items/catalog into second sandbox
- ✓ Have login credentials ready

---

## Test Flow

### Step 1: Create New Tenant via Onboarding Wizard

**Navigate to:** `http://localhost:3000/platform/tenants/new`

**Fill Step 1 (Basic Info):**
- **Tenant Slug:** `test-cafe` (or your choice - must be unique, lowercase, no spaces)
- **Business Name:** `Test Cafe`
- **Admin Email:** Your email or a test email you can access

**Click:** "Next: Connect Square"

**Expected Result:**
- ✓ Form validates successfully
- ✓ Tenant record created in database
- ✓ Page advances to Step 2 (Square OAuth)

**Actual Result:** _________

**Pass/Fail:** _________

---

### Step 2: Connect Square Sandbox Account

**You should see:** Environment selector (Sandbox vs Production)

**Click:** "Connect Sandbox" button

**Expected Result:**
1. ✓ Browser redirects to Square login page (external URL: squareupsandbox.com)
2. ✓ Square shows your second sandbox account email or login form
3. ✓ Square authorization screen displays: "Allow [App Name] to access your Square account?"

**Click:** "Allow" on Square authorization screen

**Expected Result:**
1. ✓ Redirects back to `http://localhost:3000/platform/tenants/new?success=square_connected`
2. ✓ Success message displays: "Square account connected successfully"
3. ✓ Merchant ID shown (optional, depends on UI implementation)

**Actual Result:** _________

**Pass/Fail:** _________

---

### Step 3: Verify Tenant Detail Page

**Navigate to:** `http://localhost:3000/platform/tenants`

**Find your new tenant in the list**

**Click:** Tenant row to view details

**Expected Result:**
- ✓ Tenant slug, name, status displayed (status should be "trial")
- ✓ Square Configuration section shows:
  - Environment: `sandbox`
  - Merchant ID: (your second sandbox merchant ID)
  - Access Token: `****` (redacted for security)
- ✓ Admin invite status shows "Pending" or "Invited"

**Actual Result:** _________

**Pass/Fail:** _________

---

### Step 4: Test Customer Menu on New Tenant Subdomain

**Navigate to:** `http://test-cafe.localhost:3000/menu`

(Use the slug you chose in Step 1)

**Expected Result:**
- ✓ Page loads without errors (no 500, no blank screen)
- ✓ Menu items from your **second Square sandbox account** appear
- ✓ **NO** menu items from your default Little Cafe account appear
- ✓ Categories match what you set up in the second sandbox
- ✓ Item names, descriptions, prices match second sandbox data

**Actual Result:** _________

**Items visible:** _________

**Pass/Fail:** _________

---

#### Debug: If Menu is Empty

If the menu doesn't load, debug with these steps:

```bash
# 1. Check API response
curl http://test-cafe.localhost:3000/api/menu

# 2. Verify tenant exists and has Square credentials
psql $DATABASE_URL -c "SELECT id, slug, square_merchant_id FROM tenants WHERE slug = 'test-cafe';"

# 3. Check Vault secrets (shows key names, not values)
psql $DATABASE_URL -c "SELECT key_id, name FROM vault.decrypted_secrets WHERE name LIKE '%test-cafe%' OR name LIKE '%merchant-id%';"

# 4. Check if catalog webhook fired
psql $DATABASE_URL -c "SELECT event_type, created_at FROM webhook_events WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'test-cafe') ORDER BY created_at DESC LIMIT 5;"
```

**If no webhook events:** Square webhook might not be configured for second sandbox. Manual catalog sync may be needed.

---

### Step 5: Test KDS Menu on New Tenant

**Navigate to:** `http://test-cafe.localhost:3000/kds/drinks`

**Expected Result:**
- ✓ KDS drinks screen loads without errors
- ✓ Shows items from **second Square sandbox** catalog
- ✓ No cross-tenant contamination (no Little Cafe items visible)
- ✓ Items display in KDS format (large fonts, appropriate for kitchen display)

**Also test these KDS screens:**
- `http://test-cafe.localhost:3000/kds/food`
- `http://test-cafe.localhost:3000/admin/(kds)/kds/drinks` (admin-editable version)

**Actual Result:** _________

**Pass/Fail:** _________

---

### Step 6: Verify Admin Panel Access (First Login Flow)

**Open a new incognito/private browser window** (to test fresh login)

**Navigate to:** `http://test-cafe.localhost:3000/admin`

**Expected Result:**
1. ✓ Redirected to Supabase login page
2. ✓ After login, can access admin panel (not "no access" error)

**Steps:**
1. Navigate to `http://test-cafe.localhost:3000/admin`
2. Click login link or enter credentials
3. Check email for Supabase invite link (if first time user)
4. Click invite link, set password
5. Navigate back to `http://test-cafe.localhost:3000/admin`

**Expected Result:**
- ✓ Phase 90 invite claim logic auto-creates `tenant_memberships` row (no manual DB insert needed)
- ✓ Admin panel loads successfully
- ✓ Dashboard shows **only test-cafe data** (no Little Cafe orders/products visible)
- ✓ Orders, inventory, products are empty or show only test-cafe data

**Actual Result:** _________

**Pass/Fail:** _________

---

### Step 7: Verify Cross-Tenant Isolation

**In the same incognito window (still logged in as test-cafe admin):**

**Navigate to:** `http://localhost:3000/admin` (default tenant, no subdomain)

**Expected Result:**
- ✓ Either redirected to login page OR
- ✓ "Access denied" / "no access" error shown
- ✓ **Cannot** see Little Cafe admin data

**Why:** You're only a member of `test-cafe` tenant, not the default tenant

**Actual Result:** _________

**Pass/Fail:** _________

---

## Verification Checklist

Mark off each item as you complete the test:

- [ ] Platform admin can access `/platform/tenants/new`
- [ ] Step 1 form validates and creates tenant record
- [ ] Step 2 Square OAuth redirects to Square login
- [ ] Square authorization succeeds and redirects back with success message
- [ ] Tenant detail page shows merchant ID and sandbox environment
- [ ] Customer menu at `test-cafe.localhost:3000/menu` shows **only** second sandbox items
- [ ] KDS drinks screen shows **only** second sandbox items
- [ ] KDS food screen shows **only** second sandbox items
- [ ] Admin invite email received for new tenant admin
- [ ] First login auto-claims pending invite (no manual DB insert needed)
- [ ] Admin panel at `test-cafe.localhost:3000/admin` accessible after login
- [ ] Admin dashboard shows only test-cafe data (no cross-tenant contamination)
- [ ] Admin **cannot** access default tenant admin panel (cross-tenant isolation verified)

**Total Passed:** _____ / 13

---

## Common Issues & Troubleshooting

### Issue 1: Menu is empty on new tenant

**Symptoms:** `/menu` page loads but shows no items

**Possible Causes:**
1. Square credentials not stored correctly in Vault
2. Catalog webhook not configured for second sandbox
3. No menu items in second sandbox catalog

**Debug Steps:**

```bash
# Check tenant and merchant ID
psql $DATABASE_URL -c "SELECT id, slug, square_merchant_id, square_environment FROM tenants WHERE slug = 'test-cafe';"

# Verify Square config loads
curl http://test-cafe.localhost:3000/api/square/config

# Check if catalog data exists for this tenant
psql $DATABASE_URL -c "SELECT COUNT(*) FROM kds_menu_items WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'test-cafe');"
```

**Solution:** If no catalog data, you may need to trigger a manual Square catalog sync or wait for webhook to fire.

---

### Issue 2: "Tenant not found" error

**Symptoms:** 404 or "Tenant not found" when accessing subdomain

**Possible Causes:**
1. Subdomain spelling doesn't match tenant slug exactly
2. Tenant cookie not set
3. Tenant `is_active = false` or `deleted_at IS NOT NULL`

**Debug Steps:**

```bash
# Check cookie in browser
# DevTools → Application → Cookies → localhost → x-tenant-id

# Verify tenant is active
psql $DATABASE_URL -c "SELECT slug, is_active, deleted_at FROM tenants WHERE slug = 'test-cafe';"
```

**Solution:** Ensure slug matches exactly, tenant is active, and not soft-deleted.

---

### Issue 3: Square OAuth fails or redirects with error

**Symptoms:** OAuth callback returns error, or stuck on Square login page

**Possible Causes:**
1. `SQUARE_SECRET` env var not set
2. OAuth callback URL not configured in Square Developer Dashboard
3. Wrong Square environment (sandbox vs production)

**Debug Steps:**

```bash
# Check SQUARE_SECRET is set
grep SQUARE_SECRET .env.local

# Verify callback URL in Square Dashboard matches:
# http://localhost:3000/api/platform/square-oauth/callback
```

**Solution:** Add `SQUARE_SECRET` to `.env.local` and verify Square Developer Dashboard OAuth settings.

---

### Issue 4: Admin invite email not received

**Symptoms:** No Supabase invite email in inbox

**Possible Causes:**
1. Email in spam folder
2. Supabase SMTP not configured
3. Email address typo in onboarding form

**Debug Steps:**

```bash
# Check pending invite was created
psql $DATABASE_URL -c "SELECT invited_email, created_at FROM tenant_pending_invites WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'test-cafe');"

# Check Supabase logs for email delivery
# (Access via Supabase dashboard → Logs)
```

**Solution:** Check spam, verify SMTP config, or use Resend Invite button on tenant detail page.

---

### Issue 5: Admin can access other tenant's data (cross-tenant leak!)

**Symptoms:** test-cafe admin can see Little Cafe data in admin panel

**Severity:** CRITICAL - This is a data isolation bug

**Immediate Action:**
1. Document exactly what you can see
2. Note the URL and which admin panel section
3. Check browser console for errors
4. Take screenshots

**Report:** This should not happen - all gaps were closed in Phases 95-96. If you see this, stop testing and report immediately.

---

## Test Results Summary

**Test Date:** _________
**Environment:** localhost:3000 with dev Supabase
**Square Environment:** Sandbox
**Tenant Slug Used:** _________

**Overall Result:** PASS / FAIL / PARTIAL

**Issues Found:**

1. _________________________________________
2. _________________________________________
3. _________________________________________

**Notes:**

_________________________________________
_________________________________________
_________________________________________

**Tested By:** _________
**Signature:** _________

---

## Next Steps After UAT

### If All Tests Pass

1. Mark UAT complete in milestone tracking
2. Proceed to `/gsd:complete-milestone 1.0`
3. Archive milestone and tag release

### If Issues Found

1. Document all failures in this report
2. Create GitHub issues or task list for fixes
3. Use `/gsd:insert-phase` to add fix phases if needed
4. Re-test after fixes applied

---

**Document Version:** 1.0
**Last Updated:** 2026-02-18
**Related:** .planning/v1.0-MILESTONE-AUDIT.md
