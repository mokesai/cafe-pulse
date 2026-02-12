# API Routes

## Route Organization
- `/api/admin/*` — Protected admin endpoints (require admin role)
- `/api/square/*` — Square payment and catalog operations
- `/api/webhooks/square/*` — Square webhook handlers (catalog sync, inventory sync)
- `/api/email/*` — Email sending endpoints
- `/api/orders/*`, `/api/favorites/*`, `/api/menu/*` — Customer-facing endpoints
- `/api/public/*` — Unauthenticated public endpoints
- `/api/debug-*`, `/api/test-*` — Debug and test endpoints

## Admin Route Pattern
All admin API routes must follow this pattern:
1. Authenticate user via `supabase.auth.getUser()`
2. Check admin role via `profiles.role === 'admin'`
3. Return `401` if not authenticated, `403` if not admin
4. Use `requireAdminAuth()` from `src/lib/admin/middleware.ts` for enhanced protection (rate limiting, CSRF)

## Auth Utilities
- `requireAdminAuth()` (`src/lib/admin/middleware.ts`) — Full middleware with rate limiting, CSRF, auth, and role check
- `createClient()` (`src/lib/supabase/server.ts`) — User-scoped Supabase client
- `createServiceClient()` (`src/lib/supabase/server.ts`) — Bypasses RLS (use sparingly)

## Do NOT
- Don't use `createServiceClient()` unless the operation genuinely needs to bypass RLS
- Don't expose Square access tokens to the client — server-side only
- Don't forget to handle both GET and POST/PUT/DELETE in route files where needed
- Don't skip the admin auth check on any `/api/admin/*` route

## Webhook Routes
Square webhooks receive events for catalog and inventory changes:
- Verify webhook signature using `SQUARE_WEBHOOK_SIGNATURE_KEY`
- Log events to `webhook_events` table for audit trail
- Webhooks run with service role permissions (no user context)

## Response Conventions
- GET requests to most endpoints return API documentation when called without params
- Error responses: `{ error: string }` with appropriate HTTP status code
- Success responses: `{ data: T }` or direct JSON payload
