# CI/CD Setup Guide

This document covers everything Jerry needs to configure manually in GitHub to get the E2E
pipeline running. No tooling can do this for you — it requires admin access to the repo.

---

## 1. GitHub Actions Secrets

Go to: **GitHub → mokesai/cafe-pulse → Settings → Secrets and variables → Actions → New repository secret**

### Test Credentials

These are the accounts the E2E tests log in as. Create them in your Supabase (staging/test)
database first, then add the credentials here.

| Secret name             | Value                                             | Notes                                             |
|-------------------------|---------------------------------------------------|---------------------------------------------------|
| `TEST_EMAIL`            | Platform/super-admin email                        | The `super_admin` account used for platform tests |
| `TEST_PASSWORD`         | Platform/super-admin password                     | Must have MFA disabled (use `SKIP_MFA_FOR_TESTING`) |
| `TEST_OWNER_EMAIL`      | Tenant owner email (`owner` role)                 | e.g. `test-owner@cafe-pulse.test`                 |
| `TEST_OWNER_PASSWORD`   | Tenant owner password                             |                                                   |
| `TEST_ADMIN_EMAIL`      | Tenant admin email (`admin` role)                 | e.g. `test-admin@cafe-pulse.test`                 |
| `TEST_ADMIN_PASSWORD`   | Tenant admin password                             |                                                   |
| `TEST_STAFF_EMAIL`      | Staff email (`staff` role)                        | e.g. `test-staff@cafe-pulse.test`                 |
| `TEST_STAFF_PASSWORD`   | Staff password                                    |                                                   |

> **Note:** All test accounts must have `SKIP_MFA_FOR_TESTING=true` effective or MFA disabled.
> The workflow already sets this env var. Make sure the app respects it in your Supabase
> auth config (dev/staging project, not prod).

---

### Supabase (Test Database)

The tests need a Supabase project with test data seeded. Use the **dev** project
(`cafe-pulse-dev`) or a dedicated CI project — never prod.

| Secret name                      | Value                                        |
|----------------------------------|----------------------------------------------|
| `SUPABASE_URL`                   | `https://<project-ref>.supabase.co`          |
| `SUPABASE_ANON_KEY`              | Supabase anon/public key                     |
| `NEXT_PUBLIC_SUPABASE_URL`       | Same as `SUPABASE_URL`                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Same as `SUPABASE_ANON_KEY`                  |

> These are the same values as your local `.env.local` pointing at the dev project.
> **Do not use the production project ref.**

---

### BASE_URL (Optional)

| Secret name | Value                              | Notes                                                        |
|-------------|-------------------------------------|--------------------------------------------------------------|
| `BASE_URL`  | e.g. `https://staging.cafepulse.org` | **Optional.** If set, tests hit this URL and the local dev server is NOT started. If omitted, Playwright spins up `next dev` automatically. |

When `BASE_URL` is set, the app must already be deployed and running at that URL before the
CI run. The workflow handles both modes automatically.

---

### Square (Sandbox — needed to boot the app)

The app imports Square env vars at startup. Use sandbox credentials (never live).

| Secret name                         | Value                         |
|--------------------------------------|-------------------------------|
| `NEXT_PUBLIC_SQUARE_APPLICATION_ID` | Sandbox application ID        |
| `NEXT_PUBLIC_SQUARE_LOCATION_ID`    | Sandbox location ID           |

> Server-side Square secrets (`SQUARE_ACCESS_TOKEN`, `SQUARE_SECRET`) are only needed if
> tests exercise Square payment flows. Add them if/when those tests exist.

---

### Other App Secrets (add as needed)

The following are used by the app at runtime. Add them if tests exercise those features:

| Secret name          | Feature                      |
|----------------------|------------------------------|
| `OPENAI_API_KEY`     | AI invoice parsing           |
| `RESEND_API_KEY`     | Email (order receipts, etc.) |
| `GOOGLE_CLIENT_ID`   | KDS Google Sheets pipeline   |
| `GOOGLE_CLIENT_SECRET` | KDS Google Sheets pipeline |
| `GOOGLE_REFRESH_TOKEN` | KDS Google Sheets pipeline |

> For pure E2E UI tests that don't exercise these integrations, these can be omitted or
> set to dummy values. If the app fails to boot without them, add them.

---

## 2. Branch Protection Rules

Go to: **GitHub → mokesai/cafe-pulse → Settings → Branches → Add branch ruleset**
(or use the classic "Branch protection rules" UI)

### `staging` branch

| Setting                                      | Value          | Reason                                      |
|----------------------------------------------|----------------|---------------------------------------------|
| Require a pull request before merging        | ✅ Enabled      | No direct pushes except from CI bots        |
| Required approvals                           | 1              | At least one review before merge            |
| Dismiss stale pull request approvals         | ✅ Enabled      | Force re-review after new commits           |
| Require status checks to pass before merging | ✅ Enabled      | Block merges if E2E fails                   |
| Required status checks                       | See list below | Specific jobs that must pass                |
| Require branches to be up to date            | ✅ Enabled      | Prevents stale-branch merges                |
| Restrict who can push                        | Optional       | Lock to `wandadevextraord` + Jerry if desired |
| Allow force pushes                           | ❌ Disabled     |                                             |
| Allow deletions                              | ❌ Disabled     |                                             |

**Required status checks for `staging`:**

```
E2E (chromium)
E2E (firefox)
E2E (webkit)
```

These names must match the `name:` field in the workflow job matrix exactly.
After the first workflow run, they'll appear in the status check autocomplete.

---

### `main` branch

| Setting                                      | Value          | Reason                                      |
|----------------------------------------------|----------------|---------------------------------------------|
| Require a pull request before merging        | ✅ Enabled      | All merges via PR (Jerry reviews)           |
| Required approvals                           | 1              | Jerry's final sign-off                      |
| Dismiss stale pull request approvals         | ✅ Enabled      |                                             |
| Require status checks to pass before merging | ✅ Enabled      | E2E must pass on PRs to main                |
| Required status checks                       | See list below |                                             |
| Require branches to be up to date            | ✅ Enabled      |                                             |
| Allow force pushes                           | ❌ Disabled     | Protect prod history                        |
| Allow deletions                              | ❌ Disabled     |                                             |

**Required status checks for `main`:**

```
E2E (chromium)
E2E (firefox)
E2E (webkit)
```

> **Note:** The E2E workflow only runs on pushes/PRs to `staging`. For PRs from `staging → main`,
> the checks should already have passed on the `staging` PR. If you want independent runs on
> `main` PRs too, the workflow's `pull_request.branches` already includes `main` — it will run.

---

## 3. Steps That Require Secrets to Actually Run

The following workflow steps **will silently fail or be skipped** if secrets are missing:

| Step / Feature               | Required secrets                                                |
|------------------------------|-----------------------------------------------------------------|
| App boots at all             | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`    |
| Any auth test                | `TEST_EMAIL` + `TEST_PASSWORD` (or role-specific variants)     |
| RBAC tests (owner/admin/staff) | All 4 role credential pairs                                   |
| Tests against staging URL    | `BASE_URL` (optional — without it, local server is used)       |
| Square payment flows         | `NEXT_PUBLIC_SQUARE_APPLICATION_ID`, `NEXT_PUBLIC_SQUARE_LOCATION_ID` |

If a test fails with a login error and credentials look correct, check that:
1. The test account exists in the Supabase project referenced by `SUPABASE_URL`.
2. `SKIP_MFA_FOR_TESTING=true` is respected by the app (it's set in the workflow).
3. The account's tenant slug matches `TEST_TENANT_1=bigcafe` (hardcoded in fixtures).

---

## 4. Quick Checklist

- [ ] All secrets added under **Settings → Secrets and variables → Actions**
- [ ] Branch protection rules configured on `staging`
- [ ] Branch protection rules configured on `main`
- [ ] At least one workflow run completed (so status check names appear in branch settings)
- [ ] Required status checks selected for both branches
- [ ] Test accounts exist and have correct roles in Supabase (dev/staging project)
- [ ] `SKIP_MFA_FOR_TESTING=true` confirmed working in staging/test environment
# CI Trigger\nFirst E2E workflow run - Wed Apr  1 01:55:31 UTC 2026
