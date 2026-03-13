---
phase: 60-platform-control-plane
plan: 06
subsystem: ui
tags: [platform, tenant-management, react-hook-form, server-actions, shadcn]

# Dependency graph
requires: [60-03, 60-04]
provides: [tenant-detail-view, tenant-edit-ui, updateTenant-action]
affects: [60-07]

# Tech tracking
tech-stack:
  added: []
  patterns: [server-action-with-validation, react-hook-form-integration]

# File tracking
key-files:
  created:
    - src/app/platform/tenants/[tenantId]/page.tsx
    - src/app/platform/tenants/[tenantId]/edit/page.tsx
    - src/app/platform/tenants/[tenantId]/edit/EditTenantForm.tsx
    - src/app/platform/tenants/actions.ts
  modified: []

# Decisions
decisions:
  - id: DEC-60-06-01
    choice: Use React Hook Form with Zod resolver for edit form
    rationale: Provides client-side validation with same schema as server-side, better UX than pure Server Actions
  - id: DEC-60-06-02
    choice: Separate server page component from client form component
    rationale: Follows Next.js 15 best practice - server fetches data, client handles interactivity
  - id: DEC-60-06-03
    choice: Hex color validation with regex pattern
    rationale: Ensures consistent color format for branding, prevents invalid CSS values

# Metrics
metrics:
  duration: 3m33s
  completed: 2026-02-16
---

# Phase 60 Plan 06: Tenant Detail & Edit Pages Summary

**One-liner:** Platform admins can view full tenant configuration (status, Square credentials, branding) and edit tenant settings via validated form with React Hook Form.

## What Shipped

- Tenant detail page displaying three sections: Basic Information, Square Configuration, and Branding
- Status badge with color-coded variants (trial=blue, active=green, paused=yellow, suspended=red)
- Square configuration display showing environment, merchant ID, location ID, and token expiration
- Branding section with logo URL and color swatches for primary/secondary colors
- Tenant edit page with React Hook Form integration
- updateTenant Server Action with Zod validation
- Hex color validation (#RRGGBB format) for branding colors
- Form pre-population with existing tenant data
- Success redirect to detail page after save
- Revalidation of both list and detail pages after update
- createTenant Server Action stub for Plan 60-05

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use React Hook Form with Zod resolver | Provides client-side validation with same schema as server-side, better UX than pure Server Actions | Form validates locally before submission, shows immediate feedback |
| Separate server page from client form | Follows Next.js 15 best practice - server fetches data, client handles interactivity | Clean separation of concerns, optimal performance |
| Hex color validation with regex | Ensures consistent color format for branding, prevents invalid CSS values | Colors display correctly in color swatches and prevent CSS errors |
| Display color swatches in detail view | Visual confirmation of brand colors more useful than hex codes alone | Platform admins can see actual colors at a glance |
| Service client for tenant queries | Platform admins need to read any tenant regardless of their own memberships | Bypasses RLS correctly for platform operations |

## Deviations from Plan

None — plan executed as written.

## Implementation Notes

### Tenant Detail Page
- Fetches tenant via service client using tenantId from URL params
- Returns notFound() if tenant doesn't exist
- Three card sections for organized information display
- Trial expiration date shown only for trial status tenants
- Color swatches use inline styles with backgroundColor for visual feedback

### Edit Form
- Server Component wrapper fetches tenant data
- Client EditTenantForm component handles form state and submission
- useActionState hook connects form to updateTenant Server Action
- Zod validation matches server-side schema exactly
- Empty string handling for nullable fields (logo_url, colors)
- Checkbox styled with native input for is_active flag
- Cancel button navigates back to detail page without saving

### Server Actions
- updateTenant accepts tenantId as bound parameter (curried with .bind())
- FormData extraction handles string conversion for all field types
- Revalidates both /platform/tenants and /platform/tenants/[id] paths
- Returns ActionState with either errors or success flag
- createTenant included for upcoming Plan 60-05 onboarding wizard

## Next Phase Readiness

- [x] Platform admins can view full tenant configuration
- [x] Platform admins can edit tenant name and branding
- [x] Platform admins can toggle is_active flag
- [x] Server Action validates and updates tenant data
- [x] Changes revalidate affected pages
- [ ] Tenant onboarding wizard needs to be built (Plan 60-05)
- [ ] Status transition controls not yet implemented (future plan)
- [ ] Square credential rotation UI not yet built (future plan)
