---
phase: 40-tenant-square-integration
plan: 09
subsystem: square
tags: [cleanup, square, dead-code, typescript]

# Dependency graph
requires: ["40-03", "40-04", "40-05", "40-06", "40-07", "40-08"]
provides: ["Clean Square client layer with only tenant-aware code"]
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

# File tracking
key-files:
  created: []
  modified: ["src/app/test/page.tsx"]
  deleted: [
    "src/lib/square/client.ts",
    "src/lib/square/simple-client.ts",
    "src/app/api/square/test-connection/route.ts",
    "src/app/api/test-square-simple/route.ts",
    "src/app/api/debug-tax/route.ts",
    "src/app/api/test-simple/route.ts"
  ]

# Decisions
decisions: []

# Metrics
metrics:
  duration: 2m 45s
  completed: 2026-02-15
---

# Phase 40 Plan 09: Dead Code Cleanup Summary

**One-liner:** Removed SDK singleton client, test client, and debug routes that bypassed tenant credential resolution

## What Shipped

- Deleted `client.ts` (SDK singleton) and `simple-client.ts` (test client) from `src/lib/square/`
- Deleted 4 API routes: `test-connection`, `test-square-simple`, `debug-tax`, `test-simple`
- Updated test page to remove broken test sections for deleted routes
- Cleaned `.next` cache to remove stale route references
- Verified no remaining imports of deleted files
- Clean TypeScript build (no new errors introduced)

## Decisions Made

No architectural decisions - straightforward deletion of dead code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated test page to remove broken test functions**
- Found during: Task 1
- Issue: Test page called `/api/test-square-simple` and `/api/test-simple` which were being deleted
- Fix: Removed `testSquare()` and `testConfig()` functions and their UI sections from `src/app/test/page.tsx`
- Files: `src/app/test/page.tsx`
- Commit: afc971a

**2. [Rule 3 - Blocking] Cleared Next.js cache**
- Found during: Task 1 verification
- Issue: `.next/types/validator.ts` had stale references to deleted routes causing TypeScript errors
- Fix: Deleted `.next` directory to regenerate type definitions
- Files: `.next/` (regenerated on next build)
- Commit: afc971a

## Authentication Gates

None - no authentication required for file deletions.

## Follow-ups

None - cleanup complete. Remaining TypeScript errors in `src/app/api/` are pre-existing issues in routes that haven't been updated yet for tenant-aware architecture (tracked in future plans).

## Next Phase Readiness

- [x] Dead Square client code removed
- [x] Debug/test routes that bypass tenant resolution removed
- [x] Clean build with no new errors
- [x] `src/lib/square/` contains only tenant-aware parameterized code
