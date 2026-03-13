# Troubleshooting Square OAuth Empty Screen

## Problem
When clicking "Connect Sandbox" during tenant onboarding, Square redirects to an empty screen instead of showing the OAuth authorization page.

## OAuth URL Analysis
Your application is generating a correctly-formatted OAuth URL:

```
https://squareupsandbox.com/oauth2/authorize?
  client_id=sandbox-sq0idb-AURfPdiuJNmgsQ4XPRPsSQ
  &scope=MERCHANT_PROFILE_READ+PAYMENTS_WRITE+ORDERS_WRITE+ITEMS_READ+INVENTORY_READ
  &session=false
  &state=4d939a59-3aff-453d-829c-c9c71a4a3e31%3A5bfb20f9b056354a32eadcb285fa2995aa84ce5598d8f2298fb08a64ab1607c9%3Asandbox
  &redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fplatform%2Fsquare-oauth%2Fcallback
```

✅ All required parameters are present and correctly formatted.

## Root Cause
The empty screen indicates Square is rejecting the OAuth request, likely due to application configuration issues.

## Fix: Square Developer Dashboard Configuration

### Step 1: Access Square Developer Dashboard

1. Go to https://developer.squareup.com/apps
2. Find your application: `sandbox-sq0idb-AURfPdiuJNmgsQ4XPRPsSQ`
3. Click to open application settings

### Step 2: Verify OAuth Settings

Navigate to **OAuth** section in the left sidebar.

#### Check 1: OAuth Enabled
- Ensure "OAuth" toggle is **ON**
- If disabled, enable it and save

#### Check 2: Redirect URLs Whitelist
Add the following redirect URL to the whitelist:

```
http://localhost:3000/api/platform/square-oauth/callback
```

**Important Notes:**
- URL must match **exactly** (including protocol, port, path)
- No trailing slash
- For production, you'll need to add your production domain:
  ```
  https://yourdomain.com/api/platform/square-oauth/callback
  ```

#### Check 3: Scopes
Verify the application has these scopes enabled:
- ✅ MERCHANT_PROFILE_READ
- ✅ PAYMENTS_WRITE
- ✅ ORDERS_WRITE
- ✅ ITEMS_READ
- ✅ INVENTORY_READ

### Step 3: Verify Application Credentials

In **Credentials** section:

1. **Sandbox Application ID**
   - Copy the Sandbox Application ID
   - Verify it matches your `.env.local`:
     ```
     SQUARE_APPLICATION_ID=sandbox-sq0idb-AURfPdiuJNmgsQ4XPRPsSQ
     ```

2. **Sandbox Access Token**
   - Verify `SQUARE_ACCESS_TOKEN` is set in `.env.local`

3. **Application Secret** (Required for OAuth)
   - Copy the Application Secret
   - Add to `.env.local`:
     ```
     SQUARE_SECRET=YOUR_APPLICATION_SECRET_HERE
     ```
   - This is required for the OAuth callback to exchange the authorization code for access tokens

### Step 4: Save and Test

1. **Save all changes** in Square Developer Dashboard
2. **Restart your dev server** to pick up any `.env.local` changes:
   ```bash
   # Stop dev server (Ctrl+C)
   npm run dev:webpack
   ```
3. **Create a new test tenant** (test-cafe3)
4. **Click "Connect Sandbox"** again

## Common Mistakes

### ❌ Redirect URL Mismatch
```
# Wrong
https://localhost:3000/api/platform/square-oauth/callback  # HTTPS instead of HTTP
http://localhost:3000/api/platform/square-oauth/callback/  # Trailing slash
http://127.0.0.1:3000/api/platform/square-oauth/callback   # IP instead of localhost
```

```
# Correct
http://localhost:3000/api/platform/square-oauth/callback
```

### ❌ Using Production Credentials for Sandbox
Ensure you're using:
- Sandbox Application ID (starts with `sandbox-sq0idb-`)
- Sandbox Access Token (starts with `EAAA...`)
- Environment set to `sandbox` in `.env.local`:
  ```
  SQUARE_ENVIRONMENT=sandbox
  ```

### ❌ Missing Application Secret
The OAuth callback requires `SQUARE_SECRET` to exchange the authorization code. Without it:
- Authorization page may load
- But callback will fail with error

## Verification Checklist

Before testing again, verify:

- [ ] OAuth is **enabled** in Square Developer Dashboard
- [ ] `http://localhost:3000/api/platform/square-oauth/callback` is in redirect URLs whitelist
- [ ] Application ID in `.env.local` matches Square Developer Dashboard
- [ ] `SQUARE_SECRET` is set in `.env.local`
- [ ] `SQUARE_ENVIRONMENT=sandbox` in `.env.local`
- [ ] Dev server restarted after any `.env.local` changes

## Alternative: Test with Square Developer Console

To verify your application is configured correctly:

1. Go to Square Developer Dashboard → OAuth
2. Click "Test OAuth Flow" button
3. If test flow works but your app doesn't, the issue is in your code
4. If test flow also shows empty screen, the issue is in Square Dashboard configuration

## Need More Help?

If the issue persists after following these steps:

1. **Check browser console** for JavaScript errors
2. **Check dev server logs** for any errors from `/api/platform/square-oauth/authorize`
3. **Compare credentials**:
   ```bash
   # Print current environment variables (sensitive - don't share publicly)
   echo "App ID: $SQUARE_APPLICATION_ID"
   echo "Environment: $SQUARE_ENVIRONMENT"
   echo "Secret set: $([ -n "$SQUARE_SECRET" ] && echo "Yes" || echo "No")"
   ```

## Next Steps After OAuth Works

Once Square OAuth successfully redirects and authorizes:

1. Verify callback receives authorization code
2. Verify access token is stored in vault
3. Test KDS menu rendering with new tenant's Square data
4. Test customer menu rendering
5. Verify cross-tenant isolation (test-cafe can't see test-cafe2 data)

## Reference

- [Square OAuth Overview](https://developer.squareup.com/docs/oauth-api/overview)
- [Square OAuth Redirect URLs](https://developer.squareup.com/docs/oauth-api/redirect-urls)
- [Square Application Management](https://developer.squareup.com/docs/applications/manage-applications)
