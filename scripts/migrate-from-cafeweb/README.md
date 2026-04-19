# Migrate cafe-web → cafe-pulse

Scripts for migrating the JMC Pastry & Coffee tenant from the legacy single-tenant `cafe-web-app-prod` Supabase project into the multi-tenant `cafe-pulse-dev` / `cafe-pulse-prod` projects.

See [Linear project](https://linear.app/mokesai/project/migrate-cafe-web-cafe-pulse-ffc712c1e10c) (MOK-86 through MOK-99) for the full plan.

## Prerequisites

- Node 20+ and `npx tsx` available
- Postgres connection strings for source and target Supabase projects

## Setup

```bash
cp scripts/migrate-from-cafeweb/.env.migration.example .env.migration
# Fill in SOURCE_DATABASE_URL and TARGET_DATABASE_URL
```

The `.env.migration` file is gitignored. Never commit it.

## Running

Each script is idempotent (safe to re-run). Run in this order:

```bash
# Phase 0 (read-only): inventory
npx tsx scripts/migrate-from-cafeweb/00-schema-inventory.ts

# Phases 1+2 (to be added — MOK-87 through MOK-95)
```

State files written during execution land in `scripts/migrate-from-cafeweb/state/` (gitignored):

- `source-schema.json` — every source table and its columns
- `target-schema.json` — every target table and its columns
- `source-row-counts.json` — row counts per source table
- `schema-diff-summary.md` — diff summary (source has X, target has Y, deltas per table)

Downstream scripts will write `*-uuid-map.json` files to track source→target UUID rewrites.

## Target switching

Point `TARGET_DATABASE_URL` at `cafe-pulse-dev` for Phases 0–5 (certification). Swap to `cafe-pulse-prod` only for Phase 6 cutover.

## See also

- `doc/cafe-web-to-cafe-pulse-migration-map.md` — hand-authored per-table migration plan built on top of the generated `state/schema-diff-summary.md`
