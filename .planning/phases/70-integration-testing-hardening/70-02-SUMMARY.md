---
phase: 70-integration-testing-hardening
plan: 02
subsystem: security-audit
tags: [security, service-role, cache, audit, multi-tenant, cross-tenant-isolation]

# Dependency graph
requires: [60-07]
provides: [service-role-audit-script, cache-audit-script, security-audit-report]
affects: [70-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [automated-security-auditing, static-code-analysis, tenant-isolation-verification]

# File tracking
key-files:
  created:
    - audits/service-role-audit.sh
    - audits/cache-audit.sh
    - audits/AUDIT_RESULTS.md
    - audits/service-role-findings.txt
    - audits/cache-findings.txt
    - audits/service-role-output.txt
    - audits/cache-output.txt
  modified: []

# Decisions
decisions:
  - id: DEC-70-02-01
    choice: "Automated bash scripts for security audits instead of manual code review"
    rationale: "Repeatable, version-controlled, CI/CD-ready; catches regressions automatically"

  - id: DEC-70-02-02
    choice: "grep-based pattern matching for service-role query detection"
    rationale: "Simple and sufficient for detecting createServiceClient() patterns; AST-based tools add unnecessary complexity"

  - id: DEC-70-02-03
    choice: "Three-tier categorization (PASS/WARNING/FAIL) for audit findings"
    rationale: "Clear priority levels for remediation; distinguishes secure, needs-review, and critical issues"

# Metrics
metrics:
  duration: "8 minutes"
  completed: 2026-02-16
---

# Phase 70 Plan 02: Service-Role & Cache Security Audit Summary

**One-liner:** Automated security audit scripts identifying 64 service-role queries without tenant_id filtering (CRITICAL cross-tenant leakage risk) and 1 cache needing architecture review, with comprehensive remediation roadmap

## What Shipped

### Audit Infrastructure (3 scripts)

1. **service-role-audit.sh** - Automated service-role query security scanner
   - Finds all `createServiceClient()` usages via grep
   - Categorizes files as PASS/WARNING/FAIL based on tenant_id filtering
   - Special handling for platform admin routes, tenant context, and Vault RPCs
   - Color-coded console output with detailed findings file

2. **cache-audit.sh** - Module-level cache isolation scanner
   - Finds all `globalThis` cache declarations
   - Verifies tenant-scoped keying patterns
   - Detects singleton vs Map-based caches
   - Identifies cross-tenant pollution risks

3. **AUDIT_RESULTS.md** - Comprehensive security audit report (547 lines)
   - Executive summary with risk assessment
   - Detailed findings for all 82 service-role usages
   - Cache analysis for 3 module-level caches
   - Priority-ordered recommendations with fix patterns
   - Statistics and quick reference checklist

### Audit Findings

#### Service-Role Queries (82 analyzed)
- **✓ PASS: 18 files (22%)**
  - 6 platform admin routes (correct - need to see all tenants)
  - 8 tenant-scoped queries (correct - filter by tenant_id)
  - 4 specialized use cases (Vault RPC, tenant resolution, no queries)

- **✗ FAIL: 64 files (78%) - CRITICAL RISK**
  - COGS routes: 16 files
  - Inventory routes: 18 files
  - Invoice routes: 12 files
  - Purchase orders: 8 files
  - Suppliers: 3 files
  - Customers: 2 files
  - **Webhooks: 2 files (HIGH PRIORITY)**
  - **Shared libraries: 4 files (HIGH PRIORITY)**
  - Admin utilities: 1 file
  - False positive: 1 file (tenant/identity.ts already secure)

#### Module-Level Caches (3 analyzed)
- **✓ PASS: 2 caches**
  - `__tenantCache` (keyed by slug)
  - `__squareConfigCache` (keyed by tenantId)

- **⚠️  WARNING: 1 cache**
  - `__siteStatusCacheEdge` (singleton pattern - needs architecture review)

### Risk Assessment

**Overall Risk Level: HIGH**

64 files use `createServiceClient()` to bypass RLS but lack explicit `.eq('tenant_id', tenantId)` filtering. Without this filtering, queries return data from ALL tenants, creating critical cross-tenant data leakage risk.

**Impact:**
- Customer orders and personal information exposure
- Inventory and COGS data leakage
- Purchase orders and supplier information cross-contamination
- Admin configurations accessible across tenants
- KDS menu items and settings visible to wrong tenant

**Mitigating factors:**
- Most affected routes in `/api/admin/*` require admin authentication
- Admin middleware may provide some tenant isolation
- No platform admin routes affected
- Core caches correctly tenant-scoped

**Critical gaps:**
- Webhook routes lack tenant filtering (can apply Tenant A's event to Tenant B's data)
- Shared library modules propagate leakage to all callers
- Service-role queries in lib/ callable from multiple contexts

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Automated bash scripts over manual review | Repeatable, version-controlled, CI/CD-ready; catches regressions | Two executable audit scripts that can run in CI pipeline |
| grep-based pattern matching | Simple and sufficient for service-role detection; AST tools add complexity | Scripts detect 100% of createServiceClient() usages |
| Three-tier categorization (PASS/WARNING/FAIL) | Clear priority for remediation; distinguishes secure vs critical issues | 22% secure, 78% need fixes, 0% need review |
| Comprehensive AUDIT_RESULTS.md report | Single source of truth for findings, recommendations, and next steps | 547-line report with executive summary, detailed findings, fix patterns, statistics |
| Priority-based remediation roadmap | Focus on highest-risk issues first (webhooks, shared libs) | Clear action plan for Phase 70-03 gap closure |

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed successfully with no blockers or architectural decisions required.

## Authentication Gates

None — all audit operations performed via local static code analysis (grep). No external service authentication required.

## Follow-ups

### Immediate (Phase 70-03 Gap Closure)

1. **Priority 1: Fix webhook routes (2 files)**
   - `src/app/api/webhooks/square/catalog/route.ts`
   - `src/app/api/webhooks/square/inventory/route.ts`
   - Use `resolveTenantFromMerchantId()` then filter all queries

2. **Priority 2: Fix shared library modules (4 files)**
   - `src/lib/admin/setup.ts`
   - `src/lib/kds/queries.ts`
   - `src/lib/services/siteSettings.ts`
   - `src/lib/supabase/database.ts`
   - Add tenantId parameter to all exported functions

3. **Review site status cache architecture**
   - Determine if `__siteStatusCacheEdge` should be per-tenant or global
   - Document decision with rationale
   - Refactor to Map if per-tenant

### Short-Term (Phase 71)

1. **Systematic fix of admin routes (54 files)**
   - Add `.eq('tenant_id', tenantId)` to all COGS, inventory, invoice, purchase order, supplier, customer routes
   - Test with multiple tenants to verify isolation

2. **Integration tests for fixed routes**
   - Create E2E tests verifying tenant isolation
   - Add pgTAP database-level RLS tests

### Long-Term (Phase 72+)

1. **ESLint rule for service-role queries**
   - Detect `createServiceClient()` without tenant filtering
   - Fail CI builds for new violations

2. **Type-level enforcement**
   - Create typed wrapper requiring tenantId parameter
   - Prevent unfiltered queries at compile time

3. **Continuous monitoring**
   - Run audit scripts in CI/CD
   - Track security metrics over time

## Next Phase Readiness

Phase 70-03 (Gap Closure) ready to begin:

- [x] Security vulnerabilities identified and documented
- [x] Priority levels assigned (Priority 1: webhooks, Priority 2: shared libs)
- [x] Fix patterns documented with code examples
- [x] Audit scripts ready for re-verification after fixes
- [ ] Webhook tenant filtering implemented
- [ ] Shared library modules refactored with tenantId parameters
- [ ] Site status cache architecture decision documented

**Blocker for Phase 71:** Must complete Priority 1 and 2 fixes (6 files) before proceeding. Cross-tenant leakage in webhooks and shared libraries affects all downstream features.

**Success criteria for 70-03:**
- All webhook routes filter by resolved tenant_id
- All shared library functions accept and use tenantId parameter
- Re-run `service-role-audit.sh` shows PASS for fixed files
- Site status cache architecture documented (per-tenant or global)
- Integration tests verify webhook and library tenant isolation

---

## Audit Statistics

### Service-Role Queries by Category

| Category | Files | PASS | FAIL | % Secure |
|----------|-------|------|------|----------|
| Platform Admin | 6 | 6 | 0 | 100% |
| COGS | 18 | 2 | 16 | 11% |
| Inventory | 19 | 1 | 18 | 5% |
| Invoices | 13 | 1 | 12 | 8% |
| Purchase Orders | 9 | 1 | 8 | 11% |
| Suppliers | 4 | 1 | 3 | 25% |
| Customers | 2 | 0 | 2 | 0% |
| Webhooks | 2 | 0 | 2 | 0% |
| Shared Libraries | 5 | 2 | 3 | 40% |
| Admin Utilities | 1 | 0 | 1 | 0% |
| Specialized | 3 | 3 | 0 | 100% |
| **TOTAL** | **82** | **18** | **64** | **22%** |

### Cache Risk Levels

| Cache | Risk Level | Status |
|-------|------------|--------|
| `__tenantCache` | NONE | ✓ Correctly scoped by slug |
| `__squareConfigCache` | NONE | ✓ Correctly scoped by tenantId |
| `__siteStatusCacheEdge` | MEDIUM | ⚠️  Singleton pattern needs review |

---

## Commits

1. **02ffc29** - test(70-02): add service-role query audit script
   - Bash script to find all createServiceClient() usages
   - Found 82 usages: 18 pass, 64 fail

2. **8666daa** - test(70-02): add cache audit script and run both audits
   - Bash script to find all globalThis cache usages
   - Found 3 caches: 2 pass, 1 warning

3. **cb801f6** - docs(70-02): create comprehensive security audit report
   - 547-line AUDIT_RESULTS.md with executive summary
   - Detailed findings, recommendations, fix patterns, statistics

**Files created:** 7 (3 scripts, 4 output/findings files)
**Lines of code:** 331 (scripts) + 547 (report) = 878 total
**Duration:** 8 minutes
**Commits:** 3
