# Project: Cafe Platform SaaS

## Vision
Transform the single-tenant Little Cafe web application into a multi-tenant SaaS platform where multiple cafe operators can sign up, each getting their own isolated instance with custom branding, Square integration, and independent data.

## Goals
- **Tenant isolation** — Complete data separation between cafes via RLS + tenant_id columns
- **Subdomain routing** — Each cafe gets `slug.platform.com` (e.g., `littlecafe.cafeplatform.com`)
- **Per-tenant Square** — Each cafe connects their own Square account for payments and catalog
- **Per-tenant branding** — Business name, address, hours, email sender all configurable per tenant
- **Platform admin** — Super-admin control plane to onboard and manage tenants
- **Zero-downtime migration** — Existing Little Cafe data migrated to a "default tenant" seamlessly

## Non-Goals
- Custom themes/CSS per tenant (use existing theme system for now)
- Tenant self-service signup (manual onboarding via platform admin initially)
- Multi-region deployment
- Per-tenant Supabase projects (shared database approach chosen)

## Tech Stack
- **Framework**: Next.js 15 (App Router) — existing
- **Database**: Supabase (PostgreSQL) with RLS — existing, adding tenant_id
- **Payments**: Square Web Payments SDK — existing, making per-tenant
- **Auth**: Supabase Auth — existing, adding tenant_memberships table
- **Email**: Resend — existing, making per-tenant sender config

## Target Users
1. **Cafe operators** — Small business owners who want an online ordering platform with POS integration
2. **Platform admin** (you) — Manages tenant onboarding, monitors health, handles support
3. **Cafe customers** — End users who order from a specific cafe (isolated per tenant)

## Success Criteria
- Two test tenants can operate simultaneously with zero data leakage
- Each tenant has independent Square credentials, branding, and customer base
- Existing Little Cafe functionality is preserved as the default tenant
- New tenants can be onboarded via platform admin in under 30 minutes

## Key Reference
- Detailed architecture plan: `doc/multi-tenant-saas-plan.md`
