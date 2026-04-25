# MOK-110 Invoice Extraction Spike

Permanent eval harness for invoice extraction across (workflow × model) pairs.
Built to investigate [MOK-110](https://linear.app/mokesai/issue/MOK-110) — when
pdf2json returns low-confidence text, the production pipeline raises an
exception instead of falling back to Vision. This harness lets us pick a
better workflow with data.

Once a winning workflow is identified, the same fixtures and ground-truth
files are used as a regression suite when adding new suppliers.

## Layout

```
scripts/spike-mok-110/
├── run.ts                # entry point (npm run spike:mok-110)
├── config.ts             # workflow × model matrix, pricing, thresholds
├── types.ts              # shared types
├── prompts.ts            # extraction system prompts (mirror production)
├── normalizer.ts         # raw model JSON → ParsedInvoice
├── evaluator.ts          # score WorkflowResult vs ExpectedInvoice
├── report.ts             # JSON + markdown report writer
├── cache.ts              # SHA-256 keyed file cache
├── providers/
│   ├── openrouter.ts     # chatText, chatPdf
│   └── pdf-text.ts       # pdf2json wrapper + heuristic confidence
├── workflows/
│   ├── a-pdf2json-only.ts             # baseline (current production PDF path)
│   ├── b-pdf2json-then-vision.ts      # proposed MOK-110 fix
│   ├── c-vision-first.ts              # PDF → model directly
│   └── d-vision-first-with-text-fallback.ts
├── cache/                # gitignored — response cache
└── reports/              # gitignored — timestamped JSON + MD reports

tests/fixtures/invoices/mok-110/
├── pdfs/                 # gitignored — drop your PDFs here
└── expected/             # ground truth, one .json per .pdf basename
```

## Running

```bash
# All workflows × all models on every fixture
npm run spike:mok-110

# Subset
npx tsx scripts/spike-mok-110/run.ts --workflows A,B --models openai/gpt-4o,google/gemini-2.5-pro

# Single PDF
npx tsx scripts/spike-mok-110/run.ts --file bluepoint-2024-04-01.pdf

# Force fresh API calls (skip cache)
npx tsx scripts/spike-mok-110/run.ts --no-cache

# Plan only — see what would run
npx tsx scripts/spike-mok-110/run.ts --dry-run
```

Requires `OPENROUTER_API_KEY` in `.env.local` (or pass `--env <path>`).

## Adding a fixture

1. Drop the PDF into `tests/fixtures/invoices/mok-110/pdfs/` (gitignored).
2. Create `tests/fixtures/invoices/mok-110/expected/<same-basename>.json`.
   Start with the tier-1 template:

   ```json
   {
     "pdf_filename": "<filename>.pdf",
     "invoice_number": "INV-12345",
     "total_amount": 423.55,
     "line_items_count": 12
   }
   ```

3. Re-run the spike. PDFs without a matching expected JSON are skipped with a
   warning.

To upgrade a fixture from tier-1 to tier-2 scoring (per-line accuracy and
optional inventory matching), copy `expected/_template-full.json` and fill in
`line_items` and (optionally) `expected_inventory_matches`.

## Workflows

| ID | Description | Mirrors |
|----|---|---|
| **A** | pdf2json → model (text mode) | Current production PDF path |
| **B** | A; if confidence < threshold, run C and prefer its result | **Proposed MOK-110 fix** |
| **C** | Send PDF directly to model (vision/native PDF) | What an "always Vision" path looks like |
| **D** | C; if confidence < threshold, run A and prefer its result | Vision-first with text safety net |

Threshold defaults to 0.7 (`CONFIDENCE_FALLBACK_THRESHOLD` in `config.ts`),
matching production's `visionConfidenceThresholdPct`.

## Models

Configured in `config.ts`. Includes pricing for cost reporting and a
`MODEL_PDF_NATIVE` map indicating whether the model accepts PDFs directly via
OpenRouter (Claude, Gemini) vs. needing the file-parser plugin to rasterize
server-side (GPT-4o, Pixtral).

To add a model: append its slug to `MODELS`, add an entry to
`MODEL_PDF_NATIVE` and `MODEL_PRICING`, and update the `ModelSlug` union type
in `types.ts`.

## Caching

Every OpenRouter call is keyed by SHA-256 of (model + mode + system prompt +
user payload) and cached to `cache/<key>.json`. Iterating on prompts
invalidates entries automatically. Disable with `--no-cache` or
`SPIKE_NO_CACHE=1` env.

## Output

Reports are written to `scripts/spike-mok-110/reports/<timestamp>.{json,md}`.
The markdown contains:

1. An aggregate matrix table — one row per (workflow × model) — with tier-1
   pass rate, mean cost, mean latency, error count.
2. A per-fixture breakdown — one block per PDF — with the raw extraction for
   each (workflow, model) combination.

## Caveats

- **Edge runtime portability:** workflows that beat the baseline still need a
  Deno-compatible implementation in
  `supabase/functions/invoice-pipeline/stages/01-extract.ts`. The harness uses
  Node so we can iterate quickly; OpenRouter's `file-parser` plugin works the
  same way from Deno, so portability for workflows B/C/D is straightforward.
- **Tier-2 inventory matching is stubbed.** Wiring it up requires running the
  production alias-service (`supabase/functions/invoice-pipeline/alias-service.ts`)
  against a tenant. Add when needed.
- **Confidence is self-reported by the model.** If a model is overconfident,
  the fallback threshold may not trigger. The spike will surface this.
