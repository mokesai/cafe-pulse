/**
 * Write spike results to disk: a complete JSON dump and a human-readable
 * markdown summary table.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPORTS_DIR } from './config'
import type { EvaluatedRun, ModelSlug, WorkflowId } from './types'

export async function writeReports(runs: EvaluatedRun[]): Promise<{ jsonPath: string; mdPath: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await mkdir(REPORTS_DIR, { recursive: true })

  const jsonPath = join(REPORTS_DIR, `${stamp}.json`)
  const mdPath = join(REPORTS_DIR, `${stamp}.md`)

  await writeFile(jsonPath, JSON.stringify(runs, null, 2), 'utf8')
  await writeFile(mdPath, buildMarkdown(runs), 'utf8')

  return { jsonPath, mdPath }
}

function buildMarkdown(runs: EvaluatedRun[]): string {
  const fileCount = new Set(runs.map((r) => r.pdfFile)).size
  const groups = groupByMatrix(runs)

  const lines: string[] = []
  lines.push(`# MOK-110 Invoice Extraction Spike — Report`)
  lines.push('')
  lines.push(`Run at: ${new Date().toISOString()}`)
  lines.push(`Fixtures: ${fileCount} PDF(s)`)
  lines.push(`Total runs: ${runs.length}`)
  lines.push('')
  lines.push(`## Aggregate by (workflow × model)`)
  lines.push('')
  lines.push(`| Workflow | Model | Tier-1 pass | Inv# | Total$ | #Lines | Per-line | Mean cost | Mean latency | Errors |`)
  lines.push(`|---|---|---:|---:|---:|---:|---:|---:|---:|---:|`)

  for (const g of groups) {
    const n = g.runs.length
    const passT1 = g.runs.filter((r) => r.passedTier1).length
    const inv = g.runs.filter((r) => r.score.invoice_number_match).length
    const tot = g.runs.filter((r) => r.score.total_amount_match).length
    const cnt = g.runs.filter((r) => r.score.line_items_count_match).length
    const perLineRuns = g.runs.filter((r) => r.score.per_line_match_rate != null)
    const perLineMean = perLineRuns.length === 0
      ? '—'
      : `${pct(mean(perLineRuns.map((r) => r.score.per_line_match_rate!)))}`
    const meanCost = mean(g.runs.map((r) => r.totalCostUsd))
    const meanLatency = mean(g.runs.map((r) => r.totalLatencyMs))
    const errors = g.runs.filter((r) => r.error).length

    lines.push(
      `| ${g.workflow} | \`${g.model}\` | ${passT1}/${n} | ${inv}/${n} | ${tot}/${n} | ${cnt}/${n} | ${perLineMean} | $${meanCost.toFixed(4)} | ${meanLatency.toFixed(0)}ms | ${errors} |`
    )
  }

  lines.push('')
  lines.push(`## Per-fixture results`)
  for (const file of [...new Set(runs.map((r) => r.pdfFile))].sort()) {
    lines.push('')
    lines.push(`### \`${file}\``)
    const fileRuns = runs.filter((r) => r.pdfFile === file)
    const exp = fileRuns[0]?.expected
    if (exp) {
      lines.push(`Expected: invoice# \`${exp.invoice_number}\`, total $${exp.total_amount}, ${exp.line_items_count} line items`)
    }
    lines.push('')
    lines.push(`| Workflow | Model | Pass | Got inv# | Got total | Got #lines | Conf | Cost | Latency | Steps |`)
    lines.push(`|---|---|---|---|---|---|---|---|---|---|`)
    for (const r of fileRuns) {
      const got = r.parsed
      const stepSummary = r.steps.map((s) =>
        `${s.kind}${s.confidence != null ? `(${s.confidence.toFixed(2)})` : ''}${s.accepted ? '✓' : '✗'}`
      ).join(' → ')
      lines.push(
        `| ${r.workflow} | \`${r.model}\` | ${r.passedTier1 ? '✅' : '❌'} | ${quote(got?.invoice_number)} | ${got?.total_amount ?? '—'} | ${got?.line_items.length ?? '—'} | ${got?.overall_confidence?.toFixed(2) ?? '—'} | $${r.totalCostUsd.toFixed(4)} | ${r.totalLatencyMs}ms | ${stepSummary} |`
      )
    }
  }

  return lines.join('\n') + '\n'
}

interface MatrixGroup {
  workflow: WorkflowId
  model: ModelSlug
  runs: EvaluatedRun[]
}

function groupByMatrix(runs: EvaluatedRun[]): MatrixGroup[] {
  const map = new Map<string, MatrixGroup>()
  for (const r of runs) {
    const key = `${r.workflow}|${r.model}`
    if (!map.has(key)) {
      map.set(key, { workflow: r.workflow, model: r.model, runs: [] })
    }
    map.get(key)!.runs.push(r)
  }
  return [...map.values()].sort((a, b) =>
    a.workflow.localeCompare(b.workflow) || a.model.localeCompare(b.model)
  )
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`
}

function quote(v: string | null | undefined): string {
  if (v == null) return '—'
  return `\`${v}\``
}
