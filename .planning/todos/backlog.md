# Todo Backlog

## Ideas
- [ ] Consider tenant-specific color themes (let each cafe customize their brand colors)
- [ ] Add tenant health monitoring dashboard to platform admin
- [ ] Investigate Supabase Vault for encrypting Square access tokens at rest

## Technical Debt
- [ ] Old KDS CSS files (`kds-warm.css`, `kds.css`) still on disk — safe to delete
- [ ] Several `test-*` and `debug-*` API routes should be removed before production

## Questions
- [ ] Should customers be able to see multiple cafes from a single landing page?
- [ ] How to handle Square webhook signature verification with per-tenant keys?
