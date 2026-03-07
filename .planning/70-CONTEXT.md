# Context: Phase 70 — Integration Testing & Hardening

## Goals
- Comprehensive cross-tenant isolation testing (automated test suite)
- Security audit of all service-role queries with explicit tenant_id filtering
- Verify zero cache pollution across all caching layers
- Establish performance baselines with 10-tenant scale testing

## Constraints
- Automated testing only (Jest + Playwright) - no manual checklists
- All security findings are blocking - must fix before phase complete
- Zero tolerance for cache pollution - any unkeyed cache blocks launch
- MVP scale testing: 10 tenants (sufficient to catch index and isolation issues)

## Decisions

### Test Coverage & Scenarios
- **Automated tests only**: Jest for API/isolation tests, Playwright for E2E flows - repeatable and CI-ready
- **Four must-test scenarios**:
  1. Admin cross-tenant access - Tenant A admin cannot see/edit Tenant B data (orders, inventory, settings)
  2. Concurrent customer orders - Two customers from different tenants ordering simultaneously don't leak data
  3. API endpoint isolation - All customer-facing and admin API routes respect tenant context
  4. Platform admin bypass - Platform admins can see all tenants but don't pollute tenant-scoped data
- **Race conditions in scope**: Must test concurrent writes, race conditions, and timing issues (not deferred)
- **Separate platform admin test suite**: Platform admins bypass RLS, need dedicated tests to verify no data corruption

### Security Audit Rigor
- **Audit every service-role query**: No sampling or risk-based prioritization - comprehensive audit required
- **Four audit criteria per query**:
  1. Explicit tenant_id filter - Query includes WHERE tenant_id = ... or uses tenant-scoped RLS client
  2. Service role justification - Document why service role is needed (e.g., cross-tenant read for platform admin)
  3. No hardcoded tenant IDs - Verify no queries hardcode default tenant UUID or test data
  4. Input validation present - User-supplied tenant_id values are validated against user's memberships
- **All findings are blocking**: Any tenant isolation issue must be fixed before Phase 70 complete
- **Include client-side security**: Verify localStorage keys tenant-prefixed, cookies scoped, no client-side tenant leakage

### Cache Pollution Detection
- **All four caching layers audited**:
  1. Module-level caches (globalThis) - tenant config, Square credentials, menu caches must be tenant-keyed
  2. React cache() functions - getTenantIdentity, getTenantSquareConfig must use tenant_id in cache keys
  3. Next.js ISR/SSR caching - page-level caching must respect tenant context, no cross-tenant page serving
  4. Client-side caches (localStorage) - keys must be tenant-prefixed (covered in security audit)
- **Automated detection tests**: Write tests that switch tenants and verify cache isolation - repeatable in CI
- **Zero tolerance for pollution**: Any cache without tenant-keying is a blocking issue
- **Include external caches**: Audit Vercel edge cache, CDN, or other external caching if present

### Performance Acceptance Criteria
- **Specific latency targets**: Define formal SLIs with measurable targets (p95 latency, throughput, page load times)
- **10-tenant scale testing**: Sufficient to catch obvious performance issues, reasonable to test locally
- **Four critical operations** must stay fast:
  1. Customer menu loading - public-facing menu page must load quickly regardless of tenant count
  2. Admin dashboard queries - orders, inventory, reports must be responsive for daily operations
  3. Platform admin tenant list - platform dashboard must load tenant list quickly as count grows
  4. Payment processing - checkout and payment flows must not degrade with multi-tenancy
- **Formal SLIs/SLOs required**: Define and measure objective targets (not qualitative "feels fast")

## Open Questions
None - all gray areas resolved during discussion.
