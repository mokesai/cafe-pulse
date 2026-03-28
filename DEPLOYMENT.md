# Deployment & Branching Strategy

## Branch Structure

| Branch | Environment | Domain | Purpose |
|---|---|---|---|
| `main` | Production | `cafepulse.org` | Live production — only receives merges from `staging` |
| `staging` | Staging/QA | `staging.cafepulse.org` | Pre-production gate — all features merge here first |
| `feature/*` | Preview | auto Vercel URL | Feature development |
| `fix/*` | Preview | auto Vercel URL | Bug fixes |

## Workflow

```
staging → feature/my-feature   (branch from staging)
feature/my-feature → staging   (PR, QA review, merge)
staging → main                 (PR, certified release)
```

1. **Branch from `staging`** for all new work
2. **PR to `staging`** — code review + QA on staging environment
3. **Test on `staging.cafepulse.org`** — verify everything works
4. **PR `staging → main`** — production release
5. **Auto-deploy** to `cafepulse.org` on merge to main

## Tenant Testing

| Environment | Tenant URL format |
|---|---|
| Staging | `https://bigcafe.staging.cafepulse.org` |
| Production | `https://bigcafe.cafepulse.org` |

## Rules

- **Never commit directly to `main`**
- **Never branch from `main`** — always branch from `staging`
- All PRs must pass: `npm run lint` + `npm run build` + `npx tsc --noEmit`
- QA review required before merging to `staging`
- Jerry approves all `staging → main` PRs

## Vercel Configuration

| Domain | Branch | Environment |
|---|---|---|
| `cafepulse.org` | `main` | Production |
| `*.cafepulse.org` | `main` | Production (tenant subdomains) |
| `staging.cafepulse.org` | `staging` | Staging |
| `*.staging.cafepulse.org` | `staging` | Staging (tenant subdomains) |
