# MOK-153 — Migration Drift Reconciliation

**Spec:** [MOK-153](https://linear.app/mokesai/issue/MOK-153)
**Script:** [`scripts/migrations/mok-153-drift-reconciliation-2026-05-15.sql`](../../scripts/migrations/mok-153-drift-reconciliation-2026-05-15.sql)
**Branch:** `jerrym/mok-153-migration-drift-reconciliation`

---

## Background

The Supabase MCP `apply_migration` tool generates its own version at apply-time, separate from the on-disk file's timestamp prefix. Past sessions used it as the default path for applying migrations to cafe-pulse-dev and cafe-pulse-prod, which left `supabase_migrations.schema_migrations` with version IDs that don't match any local file. The result: `supabase db push --dry-run` errors with **"Remote migration versions not found in local migrations directory"** and refuses to dry-run anything against either env.

The drift habit predates KDS v3 — the affected migrations (mok121–139) shipped 2026-04-26 to 2026-05-02, before phase 1 of KDS v3 started on 2026-05-07.

## Scope

This reconciliation **only touches the 4 pre-KDS-v3 migrations** (mok121, mok122, mok123, mok139). On dev there are *also* drift entries for `kds_v3_phase_1` (two rows from an early draft + the final) and `kds_v3_phase_2` T1 (`20260512015508`), but those are intentionally **out of scope**:

- KDS v3 is on a long-lived integration branch (`kds-v3`); the rollout is a single staging PR after all 7 phases land. None of those migrations have shipped to staging or prod yet.
- The cleanest exit either way:
  - **KDS v3 ships eventually:** when `kds-v3` → `staging`, `supabase db push` will apply the migrations to staging/prod with the local file timestamps — zero drift introduced. Dev's stale entries can be cleaned up at that point (or left alone since dev is sandbox).
  - **KDS v3 is abandoned:** run `PHASE-1-ROLLBACK.sql` + `PHASE-2-ROLLBACK.sql` on dev to wipe tables + schema_migrations entries cleanly.

Keeping kds-v3 out of this PR means it can merge to `staging` with zero kds-v3 surface area.

## Side-by-side drift table

### cafe-pulse-dev (`ettmabcwfhidcpapphgm`)

| Remote version (before) | Migration name | Local file | Remote version (after) |
|---|---|---|---|
| `20260426011425` | mok121_invoice_exception_severity | `20260425191406_…` | `20260425191406` |
| `20260426152749` | mok122_invoice_variance_history | `20260426092709_…` | `20260426092709` |
| `20260426155853` | mok123_exception_status_acknowledged | `20260426095840_…` | `20260426095840` |
| `20260502214755` | mok139_inventory_unit_cost_precision | `20260502214725_…` | `20260502214725` |

### cafe-pulse-prod (`tjxarjzohmwqiqdruczv`)

| Remote version (before) | Migration name | Local file | Remote version (after) |
|---|---|---|---|
| `20260426193647` | mok121_invoice_exception_severity | `20260425191406_…` | `20260425191406` |
| `20260426193705` | mok122_invoice_variance_history | `20260426092709_…` | `20260426092709` |
| `20260426193715` | mok123_exception_status_acknowledged | `20260426095840_…` | `20260426095840` |
| `20260502220525` | mok139_inventory_unit_cost_precision | `20260502214725_…` | `20260502214725` |

Each env has its own drift IDs (different wall-clock apply times) but the same on-disk source-of-truth file timestamps. The reconciliation SQL has separate `BEGIN/COMMIT` blocks for dev and prod.

## Safety analysis

- **Table structure:** `supabase_migrations.schema_migrations` PK is `version` (text); no FK constraints reference this table. `UPDATE` of `version` is safe and atomic.
- **Schema integrity:** these migrations have already been applied (the schema is correct on both envs and has been for weeks). The reconciliation only rewrites the bookkeeping row's `version` value — it does not re-run any DDL.
- **Idempotent:** each `UPDATE` is qualified by both the drift version AND the migration name. Re-running the script after the first execution is a no-op (no matching rows). Marked "ONE-TIME, DO NOT RE-RUN" anyway for clarity.
- **Reversibility:** if needed, the inverse UPDATEs (swap WHERE/SET clauses) restore the drift versions exactly. The script preserves enough context (drift version + name + local file path) to reconstruct the inverse if required. No content is destroyed.

## Execution log

### cafe-pulse-dev — 2026-05-15 (paired session)

Pre-reconciliation snapshot:

```
version          name
20260426011425   mok121_invoice_exception_severity
20260426152749   mok122_invoice_variance_history
20260426155853   mok123_exception_status_acknowledged
20260502214755   mok139_inventory_unit_cost_precision
```

Post-reconciliation snapshot:

```
version          name
20260425191406   mok121_invoice_exception_severity   ✓ matches local
20260426092709   mok122_invoice_variance_history     ✓ matches local
20260426095840   mok123_exception_status_acknowledged ✓ matches local
20260502214725   mok139_inventory_unit_cost_precision ✓ matches local
```

All 4 UPDATEs applied; 0 rows affected on re-run (idempotent).

### cafe-pulse-prod — TBD (will be filled in after the PR merges to staging)

```
-- same shape
```

## Going-forward rule

Always author + apply migrations via the Supabase CLI:

```bash
supabase migration new <descriptive_name>   # creates the file with the right timestamp
# ...edit the SQL...
supabase db push                            # records the file's timestamp in schema_migrations
```

Captured in working-style memory at `feedback_supabase_cli_for_migrations.md`. The mcp `apply_migration` and raw `execute_sql` paths must not be used for authoring migrations that will land on staging/prod.

## Acceptance

- [x] Dev execution: pre-snapshot recorded → SQL run → post-snapshot recorded → 4 rows show local-file versions (2026-05-15)
- [ ] PR merged to `staging`
- [ ] Prod execution: pre-snapshot recorded → SQL run → post-snapshot recorded → 4 rows show local-file versions
- [ ] MOK-153 closed with link to this doc + the PR
