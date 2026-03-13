---
phase: 60-platform-control-plane
plan: 05
subsystem: platform-ui
tags: [onboarding, wizard, react-hook-form, zod, server-actions, multi-step-form]

# Dependency graph
requires:
  - 60-03  # Platform dashboard with tenant list
  - 60-04  # Square OAuth integration
provides:
  - Multi-step tenant onboarding wizard
  - Server Actions for tenant creation with validation
  - OAuth flow integration for Square credentials
affects:
  - 60-06  # Tenant detail and edit pages (may use same form patterns)
  - 60-07  # Additional tenant management features

# Tech tracking
tech-stack:
  added:
    - react-hook-form@7.71.1
    - "@hookform/resolvers"
    - "@radix-ui/react-slot"
  patterns:
    - Multi-step form wizard with React state
    - Zod schema validation (client and server)
    - Server Actions with direct invocation pattern
    - Success/error handling via URL query params

# File tracking
key-files:
  created:
    - src/components/ui/form.tsx
    - src/components/ui/select.tsx
    - src/components/ui/button.tsx
    - src/components/ui/input.tsx
  modified:
    - src/app/platform/tenants/actions.ts
    - src/app/platform/tenants/new/page.tsx
    - package.json

# Decisions
decisions:
  - id: DEC-60-05-01
    choice: Direct Server Action invocation instead of useActionState hook
    rationale: useActionState returns void when called; need direct return value for multi-step wizard logic
  - id: DEC-60-05-02
    choice: Slug uniqueness check in Server Action before tenant creation
    rationale: Prevent duplicate tenants with same subdomain slug
  - id: DEC-60-05-03
    choice: Success/error state via URL query params after OAuth callback
    rationale: OAuth redirects to callback route; query params preserve state when returning to onboarding page
  - id: DEC-60-05-04
    choice: Install form dependencies with --legacy-peer-deps flag
    rationale: Zod version conflict between openai@5.12.2 (requires zod ^3.23.8) and project's zod@4.0.5
  - id: DEC-60-05-05
    choice: Omit 'size' property from SelectHTMLAttributes in SelectProps
    rationale: Prevent conflict between HTML size attribute (number) and custom size prop (string)

# Metrics
metrics:
  duration: 8m
  completed: 2026-02-16
---

# Phase 60 Plan 05: Tenant Onboarding Wizard Summary

**One-liner:** Multi-step tenant onboarding wizard with React Hook Form + Zod validation, Server Actions for tenant creation, and Square OAuth integration for automatic credential capture.

## What Shipped

### Task 1: Form Components and Server Actions
- Installed react-hook-form and @hookform/resolvers with --legacy-peer-deps
- Installed @radix-ui/react-slot for Form component primitives
- Created Form component with React Hook Form integration (FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage)
- Created Select component with label, error, helper text support and variant/size options
- Updated createTenant Server Action with comprehensive Zod validation:
  - Slug validation (3-50 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphens)
  - Business name validation (1-200 chars)
  - Admin email validation with proper error messages
  - Slug uniqueness check before tenant creation
  - Returns tenantId on success for Step 2 integration
- Action state includes tenantId field for multi-step wizard flow
- Service client used to bypass RLS for tenant creation

### Task 2: Multi-Step Wizard UI
- Built multi-step wizard with currentStep state (Step 1: Basic Info, Step 2: Square OAuth)
- React Hook Form with Zod validation for Step 1 form
- Step 1 collects slug, name, admin_email with real-time validation
- Progress indicator shows current step (blue bar for completed steps)
- Step 1 submit calls createTenant Server Action directly
- Server validation errors mapped to React Hook Form fields
- Success transitions to Step 2 with tenantId stored in component state
- Step 2 displays Square OAuth environment selector (Sandbox/Production)
- OAuth redirect includes tenant_id and environment query params
- Back button returns to Step 1

### Task 3: OAuth Callback Success Handling
- Added useSearchParams to check for success/error query params
- Success state (success=square_connected) displays completion screen:
  - Green checkmark icon in circle
  - "Tenant Onboarded Successfully" heading
  - "View All Tenants" button redirects to /platform/tenants
- Error state shows red alert banner above form
- Error messages formatted with underscores replaced by spaces for readability

## Decisions Made

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Direct Server Action invocation | useActionState returns void; need direct return value for wizard logic | Form submit calls createTenant directly, receives ActionState response |
| Slug uniqueness check in action | Prevent duplicate tenants with same subdomain | Server Action queries tenants table before insert |
| Success/error via query params | OAuth redirects to callback; need state when returning to page | Callback adds ?success=square_connected or ?error=message to URL |
| --legacy-peer-deps for install | Zod version conflict (openai wants 3.x, project uses 4.x) | Successfully installed react-hook-form without breaking openai |
| Omit size from SelectProps | HTML size is number, custom size is string | TypeScript build passes without type conflicts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed EditTenantForm useActionState pattern**
- **Found during:** Task 2 build verification
- **Issue:** EditTenantForm (from Plan 60-06) used useActionState pattern that returns void, causing TypeScript error when accessing result.success
- **Fix:** Updated to call updateTenant Server Action directly, matching onboarding wizard pattern
- **Files:** src/app/platform/tenants/[tenantId]/edit/EditTenantForm.tsx
- **Commit:** 293e576

**2. [Rule 1 - Bug] Fixed Button import in onboarding wizard**
- **Found during:** Task 2 build verification
- **Issue:** Used named import { Button } from button.tsx, but button.tsx only exports default
- **Fix:** Changed to default import from Button.tsx (capital B) for consistency with existing codebase
- **Files:** src/app/platform/tenants/new/page.tsx
- **Commit:** efccf5a

**3. [Rule 1 - Bug] Fixed Select component TypeScript error**
- **Found during:** Task 2 build verification
- **Issue:** SelectProps extended SelectHTMLAttributes without excluding 'size' property, causing conflict between HTML size (number) and custom size (string)
- **Fix:** Used Omit<SelectHTMLAttributes, 'size'> to exclude conflicting property, matching Input component pattern
- **Files:** src/components/ui/select.tsx
- **Commit:** 039256f

## Authentication Gates

None - all operations performed as authenticated platform admin.

## Follow-ups

- **Admin user creation:** Server Action includes TODO for creating admin user account via Supabase Admin API or invite link (deferred to future plan)
- **OAuth state verification:** authorize route includes TODO for server-side state storage and verification in callback (noted in Plan 60-04 as follow-up)
- **Square token refresh:** Access tokens expire after 30 days; need pg_cron job for automatic refresh (deferred to Phase 60+)

## Next Phase Readiness

- [x] Platform admins can create tenants via /platform/tenants/new
- [x] Step 1 validates tenant info (slug, name, email) with Zod
- [x] Step 2 triggers Square OAuth flow (sandbox or production)
- [x] OAuth callback redirects with success/error state
- [x] Success screen shows completion and links to tenant list
- [x] Build passes with zero TypeScript errors
- [ ] Manual onboarding flow test (requires platform admin bootstrap and Square OAuth app configuration)

## Commits

- 4f1d76b: chore(60-05): install shadcn form components and create Server Actions
- 76b4439: feat(60-05): build multi-step onboarding wizard UI
- 028505f: feat(60-05): add success handling for OAuth callback
- 293e576: fix(60-05): fix EditTenantForm useActionState pattern
- efccf5a: fix(60-05): use default import for Button component
- 039256f: fix(60-05): fix Select component TypeScript error
