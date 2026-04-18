# Phase 8: E2E Testing Infrastructure Roadmap

## Overview

We've established Playwright E2E testing framework on staging.cafepulse.org. This document outlines the 6 priority work items for Wanda's planning and architecture review.

## Completed Foundation

✅ **Playwright E2E Framework**
- Config: `playwright.config.ts` (Chrome, Firefox, WebKit)
- Fixtures: `e2e/fixtures/auth.ts` (basic auth)
- Test suite: `e2e/invoice-pipeline.spec.ts` (baseline tests)
- NPM scripts: `test:e2e`, `test:e2e:ui`, `test:e2e:debug`, `test:e2e:staging`

✅ **Test Accounts (all password: `TestPassword123!`)**
- Platform Admin: `lloyd.ops@agentmail.to`
- Tenant Admin: `wanda.dev@example.com`
- Admin: `milli.design@example.com`
- Staff: `jesse.business@example.com`
- Customer: `marvin.marketing@example.com`

✅ **Test Data**
- 7 seeded suppliers (Bluepoint, Walmart, Sam's Club, Odeko, Outrageous Bakery, Lulala, Gold Seal)
- 17 seeded inventory items across suppliers
- Database migrations: idempotent, reproducible

## Priority Work Items

### 1. **MOK-56: CI/CD - GitHub Actions E2E Pipeline**
**Owner:** Wanda (architecture)

Auto-run Playwright tests on pull requests.

**Requirements:**
- Trigger: push to staging or PR to staging
- Run all tests (Chrome, Firefox, WebKit)
- Report in PR checks
- Fail PR if tests fail
- Generate HTML report artifact
- Parallel workers for speed

**Acceptance:**
- Tests run automatically on PR
- PR blocked on failure
- Report generated
- Completes in <5 minutes

**Architecture notes:**
- Workflow file: `.github/workflows/e2e.yml`
- Base URL: `https://staging.cafepulse.org`
- Test credentials via secrets
- Report upload to artifacts

---

### 2. **MOK-57: Permission Tests - Role-Based Access Control**
**Owner:** Wanda (implementation) + Lloyd (QA)

Comprehensive permission testing for all 5 user roles.

**Test Coverage:**
- Platform Admin: all tenant data access
- Tenant Admin: single-tenant scoped
- Admin: management features
- Staff: operational tasks only
- Customer: public routes only

**Routes:**
- `/platform/*` — multi-tenant admin
- `/admin/*` — tenant-specific admin
- `/admin/invoices` — invoice management
- `/admin/settings` — configuration
- `/admin/invoice-exceptions` — exception handling

**Acceptance:**
- All 5 roles tested
- Unauthorized routes return 403
- Authorized routes accessible
- File: `e2e/permissions.spec.ts`
- 100% route coverage

---

### 3. **MOK-58: Test Fixtures - Purchase Orders & Line Items**
**Owner:** Wanda (data modeling) + Lloyd (implementation)

Realistic PO data for invoice matching testing.

**Generate:**
- 5 Purchase Orders (one per supplier)
- 20+ total line items
- Realistic pricing & quantities
- Dates within 90-day window

**Data mapping:**
- Bluepoint Bakery PO: bread products
- Gold Seal Distributors PO: dairy/dry goods
- Walmart Business PO: supplies
- Sam's Club PO: bulk items
- Odeko PO: specialty items

**Acceptance:**
- Migration creates test POs
- Dates support matching
- Line items match inventory
- Idempotent (re-runnable)
- Ready for invoice matching tests

---

### 4. **MOK-59: Test Assets - Invoice PDF Files**
**Owner:** Wanda (specification) + Lloyd (generation)

Sample invoices for upload testing.

**Generate 5 PDFs:**
- `bluepoint-bakery-001.pdf` — clean, text-extractable
- `walmart-business-001.pdf` — complex format, image-heavy
- `goldseal-001.pdf` — standard invoice
- `samclub-001.pdf` — bulk order format
- `odeko-001.pdf` — specialty items

**Requirements:**
- Match line items in test fixtures
- Realistic amounts and dates
- Include supplier details
- ~100KB each (realistic size)
- Text-extractable (for pipeline testing)

**Acceptance:**
- 5 PDFs in `e2e/fixtures/invoices/`
- Supplier details present
- Line items match test data
- Ready for upload/pipeline tests

---

### 5. **MOK-60: Exception Resolution Workflows**
**Owner:** Wanda (architecture) + Lloyd (implementation)

Full exception handling test suite.

**Test Scenarios:**
- No PO found → confirm without linking
- No PO found → manually link to existing PO
- Low extraction confidence → review and manual entry
- Price variance → approve or reject
- Quantity variance → adjust and approve
- Exception list pagination/filtering

**Acceptance:**
- All exception types resolvable
- Manual PO linking works
- Variance overrides persist
- Status updates correctly
- File: `e2e/exceptions.spec.ts`
- Happy path + error cases

---

### 6. **MOK-61: Performance & Load Testing**
**Owner:** Wanda (architecture) + Lloyd (implementation)

Baseline performance metrics and load testing.

**Scenarios:**
- Single invoice upload (baseline)
- 5 concurrent uploads
- 10 concurrent uploads
- Measure response times & success rate
- Monitor memory/CPU usage

**Metrics:**
- Upload time (by file size)
- Pipeline processing time
- Exception creation time
- Database query performance
- Concurrent request handling

**Acceptance:**
- Baseline metrics established
- Handle 10 concurrent uploads
- <2 second upload response
- <30 second pipeline completion
- Results documented
- Regression tests in CI

---

### 7. **MOK-62: GitHub Actions CI/CD Integration**
**Owner:** Wanda (implementation)

Wire up automated test execution.

**Implementation:**
- Workflow triggers on staging branch
- Runs full E2E suite (Chrome, Firefox, WebKit)
- Reports in PR checks
- Blocks merge on failure
- Generates HTML report artifact
- Parallel workers where possible

**Acceptance:**
- Tests auto-run on PR
- Results visible in PR checks
- PR blocked on failure
- Report accessible
- Workflow runs consistently

---

## Suggested Priority Order

1. **MOK-56** (GitHub Actions) — foundational, enables automated testing
2. **MOK-57** (Permission Tests) — validates access control
3. **MOK-58** (Test Fixtures) — data for other tests
4. **MOK-59** (PDF Files) — enables invoice upload testing
5. **MOK-60** (Exception Resolution) — tests business logic
6. **MOK-61** (Performance) — performance baseline

## Technical Decisions

- **Framework:** Playwright (Chrome, Firefox, WebKit)
- **Test environment:** staging.cafepulse.org
- **Test accounts:** 5 roles, all password `TestPassword123!`
- **Fixtures:** Database migrations (idempotent, reproducible)
- **CI/CD:** GitHub Actions (auto-run on PR to staging)
- **Reporting:** HTML reports, PR checks, artifacts

## Next Steps

1. Wanda reviews all 6 issues
2. Wanda estimates and prioritizes
3. Break down into smaller implementation tasks
4. Begin with MOK-56 (CI/CD) as blocking infrastructure
5. Run through remaining items sequentially

---

**Status:** Ready for architecture review
**Created:** 2026-03-28 22:20 UTC
**Owner:** Lloyd (discovery), Wanda (architecture/implementation)
