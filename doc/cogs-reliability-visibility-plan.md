# COGS Reliability & Visibility — Design Plan

**Status:** Validated design (brainstorming complete). Issues to be created in Linear MOK team under project _COGS Reliability & Visibility_.
**Date:** 2026-06-27
**Owner:** Jerry McCommas

## North Star

> "Entering, editing, approving, and submitting purchase orders is where much of cafe operations management occurs… still, I don't have an understanding of my weekly COGS status."

Two root causes:

1. **Data trust** — the invoice/inventory data a weekly-COGS view would draw on isn't trustworthy or automated (over-firing exceptions, package-cost drift, a packaging-model gap, manual Square syncs).
2. **Visibility** — COGS status isn't surfaced anywhere prominent; the data exists but the app leads with revenue/orders, not COGS.

This effort is **one Linear project, two sequenced clusters**: fix data trust first (Cluster A), then make COGS status dominate the app (Cluster B).

## Guiding principle (item #7)

**COGS status (good and bad) should dominate the app.** This is the project's design principle, not a single ticket — it informs Cluster B's information architecture.

## Assumptions

- **A1** #7 is the project principle; it materializes as the COGS-first IA issue (B2) + the dashboard (B1), not a standalone "make it dominate" ticket.
- **A2** #5 splits: a data-backed price-warning issue (B3) + a gamification icebox issue (B4).
- **A3** Sequence Cluster A before Cluster B — the dashboard is only as honest as the data feeding it.
- **A4** Every issue carries acceptance criteria + a test note (per "tests with every PR"). No implementation in this session.
- **A5** No new `variety_pack` table; #2 is solved with a discriminator column + widened constraint + linkage UI.

## Decision Log

| # | Decision | Alternatives considered | Why |
|---|----------|-------------------------|-----|
| D1 | One project, two clusters (milestones) | Two projects; flat issues | Keeps the north star coherent and lets data-trust precede visibility |
| D2 | #2 is a real identity-model gap, not covered by MOK-63 | "Already solved" | MOK-63 added multi-supplier; it did **not** allow two distinct supplier products sharing square_item + pack_size |
| D3 | #4 automates **both** menu-sync and sales-sync | One of the two | Operator runs both manually today |
| D4 | #1 surfaces sub-threshold variance as an aggregate FYI, not per-line | Fully suppress; log-only | Stops the flood without violating the silent-miss principle |
| D5 | #5 splits; #7 = project principle + IA issue | Keep all literal | Removes #6/#7 duplication; isolates the actionable half of #5 |
| D6 | A1 FYI count is **per-invoice** | Per-run | Matches how operators review (one invoice at a time) |
| D7 | A2 uses a free-form `package_label` nullable discriminator | `product_code`-style code | Operator-friendly; migration must handle NULL distinctness |
| D8 | A3 stores `package_cost` as canonical (small migration); `unit_cost` derived | Round-trip guard on unit_cost | Matches how purchasing actually works |
| D9 | A4 — menu-sync **before** match, sales-sync **after** confirm (inline) | Scheduled job | Fresh items to match against; fresh stock for COGS |

---

## Cluster A — Data trust (fix first)

### A1 · `price_variance` exceptions over-fire — aggregate sub-threshold variance · `bug` · Urgent

- **Problem:** `supabase/functions/invoice-pipeline/stages/04-match-items.ts:559` creates a `price_variance` exception whenever `variancePct > 0`. Sub-threshold variances (< `invoice_price_variance_threshold_pct`, default 10, `orchestrator.ts:272`) are tagged `info` but **still render per-line** (own `PriceVarianceForm`). Near every line — incl. rounding noise and per-pack division artifacts — becomes an exception. Pipeline feels un-automated.
- **Desired (option c):** sub-threshold variance does **not** create a per-line exception. Cost flows/auto-confirms (already does, `05-confirm.ts:107`); the invoice reports a single **non-blocking "N lines had minor price changes" FYI count** (per-invoice). Above-threshold variance still creates a per-line `block` exception.
- **Guardrail:** sub-threshold changes must still be recorded (cost-history/audit + the FYI count) — suppressed from the queue, never silently dropped (silent-miss principle).
- **Approach:** stop emitting `info`-severity `price_variance` per-line; aggregate a per-invoice count on the run summary instead.
- **Tests:** unit on stage 4 — zero / sub-threshold / over-threshold → 0 / 0 / 1 exceptions + correct FYI count; cost still updates on sub-threshold.

### A2 · One `square_item_id` → multiple packaged products per supplier · `bug`/`feature` · High

- **Problem:** identity key `inventory_items_tenant_supplier_square_pack_unique` = `(tenant_id, supplier_id, square_item_id, pack_size)` can't represent two distinct supplier products that map to the same Square item **and** same pack size (out-of-stock variety-pack-derived Coke Zero vs. a standalone pack from that same supplier). Save rejected as duplicate (bulk-upload path words it at `bulk-upload/route.ts:149`).
- **Desired:** a supplier can carry multiple packaged inventory rows for one `square_item_id`; cross-supplier already works (MOK-63).
- **Approach:** add a free-form `package_label` nullable discriminator; widen the unique index to include it. **Migration must decide NULL handling** (e.g. `NULLS NOT DISTINCT`, or "default packaging = NULL, additional packagings require a label") so two unlabeled rows can't silently collide/duplicate. Confirm exact repro + whether stage-4 matcher needs the discriminator.
- **Tests:** integration — two rows, same supplier+square_item+pack_size, different `package_label` → both persist, tenant-isolated; pack-pair sibling lookup still returns the group.

### A3 · Entered package cost must not drift when computing item cost · `bug` · High

- **Problem:** `src/components/admin/InventoryEditModal.tsx` stores only `unit_cost` (4dp); pack cost is re-derived → `$10.00 / 3 → $3.3333 → ×3 = $9.9999`. The operator's entered package cost silently changes.
- **Desired:** when the operator enters a **package cost**, that exact value is preserved; per-item cost is derived/displayed, not the source of truth.
- **Approach:** persist `package_cost` as canonical alongside `pack_size` (small migration); treat `unit_cost` as derived for pack rows.
- **Tests:** unit — enter package cost with a non-divisible pack size, reload → package cost unchanged; COGS uses correct per-unit.

### A4 · Run menu-sync + sales-sync automatically with the pipeline · `feature` · Medium

- **Problem:** both syncs are manual (`/api/admin/square/menu-sync`, `/api/admin/inventory/sales-sync`); the pipeline (stage 5) updates cost but triggers neither. Stale catalog → match misses; stale stock → wrong COGS.
- **Desired:** both run as part of the pipeline lifecycle without a manual click.
- **Approach:** menu-sync **before** match (fresh items to match against), sales-sync **after** confirm (fresh stock for COGS), inline in the pipeline. Failures non-fatal (matches existing catalog-webhook pattern).
- **Tests:** integration — pipeline run invokes both syncs; failure is non-fatal.

---

## Cluster B — Visibility & COGS-first UX

### B1 · `#6` COGS-first dashboard — overview always shows cafe status · `feature` · High

- **Problem:** `src/components/admin/AdminDashboardOverview.tsx` shows revenue/orders/customers + a hardcoded `+12.5%` growth, **zero COGS**. Data exists (`/api/admin/cogs/summary`, daily summaries, `/api/admin/dashboard/stats`).
- **Desired:** dashboard leads with weekly COGS status — this-week periodic COGS, **COGS % of sales**, trend vs. prior week, prominent good/bad signal — plus a "needs attention" strip (open block-exceptions, lines needing price review).
- **Approach:** new widgets fed by existing summary + stats APIs; compute COGS % by combining them; replace the hardcoded growth figure.
- **Open sub-question:** "good vs. bad" needs a per-tenant **target COGS %** (e.g. 30%) — decide default + where it's set.
- **Tests:** component/integration on the COGS widget data mapping.
- **Depends on:** A1, A3 (trustworthy data).

### B2 · `#7` COGS-first information architecture (app-wide) · `feature` · Medium

- **Problem/principle:** COGS status is buried in `/admin/cogs`; it should be present across the app.
- **Desired:** a persistent, always-visible cafe/COGS **status indicator** in the admin shell (`src/app/admin/(protected)/layout.tsx`) on every page, drilling into the dashboard. The "COGS dominates the app" principle made concrete.
- **Approach:** a lightweight status chip in the shell fed by a small status endpoint (today/this-week COGS health + open-exception count).
- **Tests:** shell renders chip; status endpoint health states.

### B3 · `#5a` Price-differential / margin warnings · `feature` · Medium

- **Problem:** when supplier costs rise (captured in invoice variance + cost-history), operators get no proactive signal that menu prices should go up.
- **Desired:** warning badges when an item's margin falls below target (or ingredient cost jumped beyond a threshold since last period), prompting a price review.
- **Approach (recommended):** margin-based — per-sellable margin = price − recipe cost; flag `< target`; cost-jump % as a secondary trigger. Surfaces on dashboard/items. Ties to A1's variance data.
- **Tests:** unit on the margin/threshold calc.

### B4 · `#5b` Gamification badges (icebox) · `feature` · Low

- **Idea:** badges for best day/month/period (lowest COGS %, best margin, on-time receiving). Separate from B3's alerts.
- **Status:** needs a design spike before implementation — capture badge types, criteria, placement. Icebox/low.

---

## Linear structure (created 2026-06-27)

- **Project:** [COGS Reliability & Visibility](https://linear.app/mokesai/project/cogs-reliability-and-visibility-8060e9a6f2f4) (MOK team).
- **Milestones:** _Cluster A — Data trust_ (A1–A4), _Cluster B — Visibility & COGS-first UX_ (B1–B4).

| Spec | Issue | Priority | Labels |
|------|-------|----------|--------|
| A1 — exceptions over-fire | MOK-169 | Urgent | Bug |
| A2 — multi-pack per supplier | MOK-170 | High | Bug, Feature |
| A3 — package-cost drift | MOK-171 | High | Bug |
| A4 — auto Square sync | MOK-172 | Medium | Feature |
| B1 — COGS-first dashboard (#6) | MOK-173 | High | Feature |
| B2 — COGS-first IA (#7) | MOK-174 | Medium | Feature |
| B3 — price/margin warnings (#5a) | MOK-175 | Medium | Feature |
| B4 — gamification badges (#5b, icebox) | MOK-176 | Low | Feature |

- **Blocking:** MOK-173 (B1) is blocked by MOK-169 (A1) and MOK-171 (A3).
