#!/usr/bin/env node
/**
 * MOK-110 Invoice Extraction Spike — entry point.
 *
 * Discovers PDFs in tests/fixtures/invoices/mok-110/pdfs/, matches each to its
 * ground-truth JSON in ../expected/, runs the configured workflow × model
 * matrix, and writes a JSON + markdown report.
 *
 * Usage:
 *   npx tsx scripts/spike-mok-110/run.ts
 *   npx tsx scripts/spike-mok-110/run.ts --workflows A,B
 *   npx tsx scripts/spike-mok-110/run.ts --models openai/gpt-4o,google/gemini-2.5-pro
 *   npx tsx scripts/spike-mok-110/run.ts --file bluepoint-2024-04-01.pdf
 *   npx tsx scripts/spike-mok-110/run.ts --no-cache
 *   npx tsx scripts/spike-mok-110/run.ts --dry-run
 *
 * Env:
 *   OPENROUTER_API_KEY (required)  — sourced from .env.local by default
 *   SPIKE_NO_CACHE=1              — equivalent to --no-cache
 *
 * Exit codes:
 *   0  success
 *   1  partial: some runs errored
 *   2  fatal: missing config / no fixtures / OPENROUTER_API_KEY missing
 */

import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { setCacheEnabled } from './cache'
import { EXPECTED_DIR, MODELS, PDFS_DIR, WORKFLOWS } from './config'
import { evaluate } from './evaluator'
import { writeReports } from './report'
import type {
  EvaluatedRun,
  ExpectedInvoice,
  ModelSlug,
  WorkflowId,
  WorkflowResult,
} from './types'
import { runWorkflowA } from './workflows/a-pdf2json-only'
import { runWorkflowB } from './workflows/b-pdf2json-then-vision'
import { runWorkflowC } from './workflows/c-vision-first'
import { runWorkflowD } from './workflows/d-vision-first-with-text-fallback'

interface CliArgs {
  workflows: WorkflowId[]
  models: ModelSlug[]
  file?: string
  cache: boolean
  dryRun: boolean
  envPath: string
  concurrency: number
}

const WORKFLOW_RUNNERS: Record<WorkflowId, (args: { pdfPath: string; pdfFile: string; model: ModelSlug }) => Promise<WorkflowResult>> = {
  A: runWorkflowA,
  B: runWorkflowB,
  C: runWorkflowC,
  D: runWorkflowD,
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  loadEnv({ path: args.envPath })
  setCacheEnabled(args.cache)

  if (!process.env.OPENROUTER_API_KEY) {
    console.error(`✗ OPENROUTER_API_KEY not set (looked in ${args.envPath}).`)
    return 2
  }

  // Discover fixtures
  if (!existsSync(PDFS_DIR)) {
    console.error(`✗ ${PDFS_DIR} does not exist.`)
    return 2
  }
  const allPdfs = (await readdir(PDFS_DIR))
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort()
  const pdfs = args.file ? allPdfs.filter((f) => f === args.file) : allPdfs

  if (pdfs.length === 0) {
    console.error(args.file
      ? `✗ Fixture ${args.file} not found in ${PDFS_DIR}.`
      : `✗ No PDFs found in ${PDFS_DIR}. Drop fixtures there and re-run.`)
    return 2
  }

  // Load ground truth per file
  const fixtures: Array<{ pdfFile: string; pdfPath: string; expected: ExpectedInvoice }> = []
  const missingExpected: string[] = []
  for (const pdfFile of pdfs) {
    const expectedPath = join(EXPECTED_DIR, pdfFile.replace(/\.pdf$/i, '.json'))
    if (!existsSync(expectedPath)) {
      missingExpected.push(pdfFile)
      continue
    }
    const expected = JSON.parse(await readFile(expectedPath, 'utf8')) as ExpectedInvoice
    fixtures.push({ pdfFile, pdfPath: join(PDFS_DIR, pdfFile), expected })
  }

  if (missingExpected.length > 0) {
    console.warn(`⚠ Skipping ${missingExpected.length} PDF(s) without ground truth:`)
    for (const f of missingExpected) console.warn(`  - ${f}`)
  }
  if (fixtures.length === 0) {
    console.error(`✗ No fixtures with ground truth. Create JSON files in ${EXPECTED_DIR}/ matching each PDF's basename.`)
    return 2
  }

  // Build matrix
  const jobs: Array<{ pdfFile: string; pdfPath: string; expected: ExpectedInvoice; workflow: WorkflowId; model: ModelSlug }> = []
  for (const fix of fixtures) {
    for (const workflow of args.workflows) {
      for (const model of args.models) {
        jobs.push({ ...fix, workflow, model })
      }
    }
  }

  console.log(`▶ ${jobs.length} run(s): ${fixtures.length} fixture(s) × ${args.workflows.length} workflow(s) × ${args.models.length} model(s)`)
  console.log(`  cache: ${args.cache ? 'on' : 'off'}, concurrency: ${args.concurrency}`)
  if (args.dryRun) {
    for (const j of jobs) console.log(`  [plan] ${j.workflow} | ${j.model} | ${j.pdfFile}`)
    return 0
  }

  // Execute with concurrency cap
  const evaluated: EvaluatedRun[] = []
  let errCount = 0
  let done = 0
  await mapConcurrent(jobs, args.concurrency, async (job) => {
    const label = `[${job.workflow} | ${job.model.padEnd(36)} | ${job.pdfFile}]`
    try {
      const result = await WORKFLOW_RUNNERS[job.workflow]({
        pdfPath: job.pdfPath,
        pdfFile: job.pdfFile,
        model: job.model,
      })
      const ev = evaluate(result, job.expected)
      evaluated.push(ev)
      done++
      const pass = ev.passedTier1 ? '✅' : '❌'
      const cached = result.steps.some((s) => s.kind.startsWith('openrouter')) ? '' : ''
      console.log(`  ${pass} (${done}/${jobs.length}) ${label} ${cached}— $${result.totalCostUsd.toFixed(4)}, ${result.totalLatencyMs}ms`)
      if (result.error) {
        console.log(`     error: ${result.error}`)
        errCount++
      }
    } catch (err) {
      done++
      errCount++
      console.error(`  ✗ (${done}/${jobs.length}) ${label} threw: ${err instanceof Error ? err.message : String(err)}`)
      // Push an empty result so it shows up in the report
      evaluated.push(evaluate({
        pdfFile: job.pdfFile,
        workflow: job.workflow,
        model: job.model,
        steps: [],
        totalCostUsd: 0,
        totalLatencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      }, job.expected))
    }
  })

  const { jsonPath, mdPath } = await writeReports(evaluated)
  console.log('')
  console.log(`Reports written:`)
  console.log(`  JSON: ${jsonPath}`)
  console.log(`  MD:   ${mdPath}`)
  console.log('')
  const tier1Pass = evaluated.filter((r) => r.passedTier1).length
  console.log(`Summary: ${tier1Pass}/${evaluated.length} runs passed tier-1 (invoice#, total, line count). ${errCount} errors.`)

  return errCount > 0 ? 1 : 0
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    workflows: [...WORKFLOWS],
    models: [...MODELS],
    cache: process.env.SPIKE_NO_CACHE !== '1',
    dryRun: false,
    envPath: '.env.local',
    concurrency: 3,
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = argv[i + 1]
    switch (flag) {
      case '--workflows':
        args.workflows = parseList(next, WORKFLOWS, (v) => v.toUpperCase() as WorkflowId, 'workflow')
        i++
        break
      case '--models':
        args.models = parseList(next, MODELS, (v) => v as ModelSlug, 'model')
        i++
        break
      case '--file':
        args.file = next
        i++
        break
      case '--no-cache':
        args.cache = false
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--env':
        args.envPath = next
        i++
        break
      case '--concurrency':
        args.concurrency = Math.max(1, Number(next) || 3)
        i++
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break
      default:
        if (flag.startsWith('--')) {
          console.warn(`Unknown flag: ${flag}`)
        }
    }
  }
  return args
}

function parseList<T extends string>(value: string | undefined, allowed: readonly T[], parse: (v: string) => T, kind: string): T[] {
  if (!value) return [...allowed]
  const requested = value.split(',').map((s) => parse(s.trim()))
  const allowedSet = new Set<string>(allowed)
  for (const r of requested) {
    if (!allowedSet.has(r as string)) {
      throw new Error(`Unknown ${kind}: "${r}". Allowed: ${[...allowedSet].join(', ')}`)
    }
  }
  return requested
}

async function mapConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers: Promise<void>[] = []
  const next = async (): Promise<void> => {
    while (queue.length > 0) {
      const item = queue.shift()!
      await fn(item)
    }
  }
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(next())
  await Promise.all(workers)
}

function printHelp(): void {
  console.log(`MOK-110 Invoice Extraction Spike

Usage:
  npx tsx scripts/spike-mok-110/run.ts [options]

Options:
  --workflows A,B,C,D       Subset of workflows (default: all)
  --models <slug,slug,...>  Subset of model slugs (default: all)
  --file <name.pdf>         Run only one fixture
  --no-cache                Don't read/write the response cache
  --dry-run                 Print job plan and exit
  --env <path>              Env file (default: .env.local)
  --concurrency <n>         Parallel runs (default: 3)
  -h, --help                Show this help
`)
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('Fatal:', err)
  process.exit(2)
})
