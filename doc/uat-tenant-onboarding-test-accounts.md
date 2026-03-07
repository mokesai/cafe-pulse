# UAT: Multi-Tenant Onboarding (Using Square Test Accounts)

**Purpose:** Verify multi-tenant architecture works correctly with Square integration using Test Accounts instead of OAuth.

**Why Test Accounts?** Square's Test Account feature generates access tokens directly, bypassing OAuth. This is simpler and more reliable for testing.

## Prerequisites

- [x] Dev server running: `npm run dev:webpack`
- [x] Logged in as platform admin
- [x] 2 Square test accounts created with different catalog data

## Setup: Create Square Test Accounts

1. Go to https://developer.squareup.com/console
2. Click **"Test Accounts"** in the left sidebar
3. Create **Test Account 1**:
   - Name: `Test Cafe 1`
   - Copy the **Access Token** (starts with `EAAA...`)
   - Copy the **Location ID** (starts with `L...`)
   - Import menu items (if you haven't already)
4. Create **Test Account 2**:
   - Name: `Test Cafe 2`
   - Copy the **Access Token**
   - Copy the **Location ID**
   - Import menu items (different from Test Account 1 to verify isolation)

**Save these credentials** - you'll need them in Step 3 below.

## Test Flow

### Step 1: Create First Tenant (test-cafe)

1. Navigate to http://localhost:3000/platform/tenants
2. Click **"Create New Tenant"**
3. Fill in tenant form:
   - **Slug:** `test-cafe`
   - **Business Name:** `Test Cafe One`
   - **Admin Email:** (your email)
4. Click **"Create Tenant & Send Invite"**
5. ✓ Verify success screen appears
6. ✓ Verify invite status (should show "User can access this tenant by logging in")
7. **Skip Square OAuth** - we'll add credentials manually

### Step 2: Create Second Tenant (test-cafe2)

1. Click **"View All Tenants"** or navigate back to `/platform/tenants`
2. Click **"Create New Tenant"** again
3. Fill in tenant form:
   - **Slug:** `test-cafe2`
   - **Business Name:** `Test Cafe Two`
   - **Admin Email:** (your email)
4. Click **"Create Tenant & Send Invite"**
5. ✓ Verify success screen appears
6. **Skip Square OAuth** - we'll add credentials manually

### Step 3: Add Square Credentials (Test Account Tokens)

Run the script to add Square credentials for each tenant:

**For test-cafe (using Test Account 1 credentials):**
```bash
npx tsx scripts/add-tenant-square-credentials.ts test-cafe <ACCESS_TOKEN_1> <LOCATION_ID_1>
```

**For test-cafe2 (using Test Account 2 credentials):**
```bash
npx tsx scripts/add-tenant-square-credentials.ts test-cafe2 <ACCESS_TOKEN_2> <LOCATION_ID_2>
```

Replace:
- `<ACCESS_TOKEN_1>` with Test Account 1's access token
- `<LOCATION_ID_1>` with Test Account 1's location ID
- `<ACCESS_TOKEN_2>` with Test Account 2's access token
- `<LOCATION_ID_2>` with Test Account 2's location ID

✓ Verify each script shows: `✅ Square credentials configured successfully!`

### Step 4: Verify Subdomain Routing

**Test tenant 1:**
1. Navigate to http://test-cafe.localhost:3000
2. ✓ Verify page loads (not 404)
3. ✓ Verify tenant context is correct (check page title, branding)

**Test tenant 2:**
1. Navigate to http://test-cafe2.localhost:3000
2. ✓ Verify page loads
3. ✓ Verify tenant context is different from test-cafe

**Test invalid subdomain:**
1. Navigate to http://nonexistent.localhost:3000
2. ✓ Verify shows error or redirect (not tenant data)

### Step 5: Verify Menu Rendering (Tenant 1)

Navigate to http://test-cafe.localhost:3000/menu

1. ✓ Menu page loads without errors
2. ✓ Menu items appear (from Test Account 1's catalog)
3. ✓ Images load correctly
4. ✓ Prices display
5. ✓ Categories are organized
6. Open browser console:
   - ✓ No 404 errors
   - ✓ No authentication errors
   - ✓ No Square API errors

### Step 6: Verify Menu Rendering (Tenant 2)

Navigate to http://test-cafe2.localhost:3000/menu

1. ✓ Menu page loads
2. ✓ Menu items appear (from Test Account 2's catalog)
3. ✓ **Menu items are DIFFERENT from test-cafe** (cross-tenant isolation)
4. ✓ Images, prices, categories all correct for Test Account 2

### Step 7: Verify KDS Rendering (Tenant 1)

**Drinks screen:**
1. Navigate to http://test-cafe.localhost:3000/kds/drinks
2. ✓ KDS drinks screen loads
3. ✓ Uses Test Account 1's catalog items
4. ✓ Theme applies correctly

**Food screen:**
1. Navigate to http://test-cafe.localhost:3000/kds/food
2. ✓ KDS food screen loads
3. ✓ Uses Test Account 1's catalog items

### Step 8: Verify KDS Rendering (Tenant 2)

**Drinks screen:**
1. Navigate to http://test-cafe2.localhost:3000/kds/drinks
2. ✓ Shows Test Account 2's drinks (different from tenant 1)

**Food screen:**
1. Navigate to http://test-cafe2.localhost:3000/kds/food
2. ✓ Shows Test Account 2's food items

### Step 9: Verify Tenant Isolation (Database)

1. Open Supabase Studio
2. Navigate to **Table Editor → tenants**
3. ✓ Verify both tenants exist with different IDs
4. ✓ Verify each has different `square_location_id`
5. ✓ Verify `square_access_token_vault_id` is set for both
6. Navigate to **Table Editor → tenant_memberships**
7. ✓ Verify your user has memberships for both tenants with role `owner`

### Step 10: Verify Admin Access (Cross-Tenant)

**As platform admin, verify you can manage both tenants:**

1. Navigate to http://localhost:3000/platform/tenants
2. ✓ Both tenants appear in list
3. Click on **test-cafe**
4. ✓ Tenant details page loads
5. ✓ Shows correct Square configuration (location ID, environment)
6. Go back and click on **test-cafe2**
7. ✓ Tenant details page loads with different data

### Step 11: Verify Tenant Admin Access

**Login as tenant admin for test-cafe:**

1. Navigate to http://test-cafe.localhost:3000/admin
2. ✓ Login page loads (or redirects if already authenticated)
3. Login with your email
4. ✓ Dashboard shows test-cafe context
5. ✓ Can access admin features for test-cafe

**Switch to test-cafe2:**

1. Navigate to http://test-cafe2.localhost:3000/admin
2. ✓ Dashboard shows test-cafe2 context (different from test-cafe)
3. ✓ Can access admin features for test-cafe2

## Expected Results

### ✅ Pass Criteria

- [x] Both tenants created successfully
- [x] Square credentials configured via Test Accounts
- [x] Subdomain routing works (test-cafe.localhost, test-cafe2.localhost)
- [x] Customer menus render with correct Square catalog data
- [x] KDS screens render with correct catalog data
- [x] **Cross-tenant isolation:** test-cafe and test-cafe2 show different menu items
- [x] Platform admin can manage both tenants
- [x] Tenant admin can access both tenants via subdomain

### ❌ Fail Criteria

- Blank screens when accessing tenant subdomains
- Same menu items appear for both tenants (isolation failure)
- Square API errors in browser console
- Cannot access tenant admin pages
- Database shows incorrect tenant associations

## Test Results

| Test | Status | Notes |
|------|--------|-------|
| Tenant 1 created | ⬜ Pass / ⬜ Fail | |
| Tenant 2 created | ⬜ Pass / ⬜ Fail | |
| Square credentials added (T1) | ⬜ Pass / ⬜ Fail | |
| Square credentials added (T2) | ⬜ Pass / ⬜ Fail | |
| Subdomain routing works | ⬜ Pass / ⬜ Fail | |
| Menu renders (Tenant 1) | ⬜ Pass / ⬜ Fail | |
| Menu renders (Tenant 2) | ⬜ Pass / ⬜ Fail | |
| Menus are different | ⬜ Pass / ⬜ Fail | |
| KDS renders (Tenant 1) | ⬜ Pass / ⬜ Fail | |
| KDS renders (Tenant 2) | ⬜ Pass / ⬜ Fail | |
| Tenant isolation verified | ⬜ Pass / ⬜ Fail | |
| Admin access works | ⬜ Pass / ⬜ Fail | |

## Troubleshooting

### Issue: Script fails with "tenant not found"
- Verify tenant slug is correct (use exact slug from Step 1/2)
- Check Supabase connection (verify NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local)

### Issue: Menu doesn't load
- Check browser console for errors
- Verify access token is valid (regenerate in Square Developer Console if needed)
- Check dev server logs for API errors

### Issue: Same menu for both tenants
- Verify you used different test accounts with different catalog data
- Check tenant_id in database queries (possible RLS bypass issue)

### Issue: Subdomain doesn't resolve
- Verify dev server is running
- Try http://localhost:3000/<slug> instead of subdomain
- Check middleware.ts for subdomain routing logic

## Next Steps After UAT

If all tests pass:
- ✅ Multi-tenant architecture is verified
- ✅ Square integration works via Test Accounts
- ✅ Tenant isolation is confirmed
- Ready to complete Milestone 1.0: `/gsd:complete-milestone 1.0`

If tests fail:
- Document failures in test results table
- Create Phase 1.1 to address issues: `/gsd:insert-phase 1 "Fix UAT failures"`
