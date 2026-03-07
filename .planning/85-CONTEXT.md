# Context — Phase 85: Multi-Tenant Schema Constraint Migration

## Goals
- Replace 12 single-column UNIQUE constraints with composite `(tenant_id, field)` constraints
- Fix all application-layer upsert patterns that reference old single-column constraints
- Fix all admin UI error handling that keys on old constraint names

## Constraints
- `webhook_events.event_id` is EXCLUDED — stays `UNIQUE(event_id)` globally (each tenant is a separate Square merchant account; event_ids are in separate namespaces; global idempotency is correct behavior)
- Each domain migration must be a single atomic transaction (all-or-nothing; no partial commits)
- All app code fixes ship in the same phase as the migrations (no follow-up plan)

## Tables in Scope (12 tables, 3 domains)

### KDS Domain
- `kds_settings` — `key` → `UNIQUE(tenant_id, key)`
- `kds_images` — `filename` → `UNIQUE(tenant_id, filename)`
- `kds_menu_items` — `square_variation_id` → `UNIQUE(tenant_id, square_variation_id)`

### COGS/Square Domain
- `cogs_products` — `square_item_id`, `product_code` → `UNIQUE(tenant_id, square_item_id)`, `UNIQUE(tenant_id, product_code)`
- `cogs_product_variations` — `square_variation_id` ×2 → `UNIQUE(tenant_id, square_variation_id)` (both constraints)
- `cogs_modifier_lists` — `square_modifier_list_id` → `UNIQUE(tenant_id, square_modifier_list_id)`
- `cogs_modifier_options` — `square_modifier_id` → `UNIQUE(tenant_id, square_modifier_id)`

### Operational Domain
- `inventory_items` — `name` → `UNIQUE(tenant_id, name)`
- `suppliers` — `name` → `UNIQUE(tenant_id, name)`
- `measurement_units` — `name`, `symbol` → `UNIQUE(tenant_id, name)`, `UNIQUE(tenant_id, symbol)`
- `purchase_orders` — `order_number` → `UNIQUE(tenant_id, order_number)`

## Decisions

### A — webhook_events excluded
`webhook_events.event_id` remains a global `UNIQUE(event_id)`. Rationale: tenants are separate Square merchant accounts; Square generates UUIDs scoped to the account so cross-tenant collision is impossible; global uniqueness provides correct idempotency for webhook retry handling.

### B — Application code
- Square-synced tables (`cogs_products`, `cogs_product_variations`, `cogs_modifier_lists`, `cogs_modifier_options`, `kds_menu_items`) use `ON CONFLICT(square_*_id) DO UPDATE` upsert patterns — these must be updated to reference the composite columns.
- Conflict resolution behavior: `DO UPDATE` (not `DO NOTHING`).
- Admin UI surfaces user-facing unique constraint errors. Researcher must find all code paths that key on old constraint names (e.g., `suppliers_name_key`) — those string references break when constraints are renamed. New composite constraint names must be used consistently.
- All code fixes are in Plan 85-04, shipping in the same phase as the DDL plans.

### C — Migration structure
- One migration file per domain, each wrapped in a single atomic transaction.
- No concern about DDL lock duration (dev + production acceptable).
- Plan structure:
  - **85-01** — KDS domain DDL (kds_settings, kds_images, kds_menu_items)
  - **85-02** — COGS/Square domain DDL (cogs_products, cogs_product_variations, cogs_modifier_lists, cogs_modifier_options)
  - **85-03** — Operational domain DDL (inventory_items, suppliers, measurement_units, purchase_orders)
  - **85-04** — App code: ON CONFLICT clause updates + constraint error name fixes in admin UI

## Open Questions
- None — all decisions locked above.

## Deferred Ideas
- None raised during discussion.
