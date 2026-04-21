#!/usr/bin/env node
/**
 * MOK-86 — Phase 0: Schema inventory
 *
 * Connects to the source (cafe-web-app-prod) and target (cafe-pulse-*) databases
 * and dumps the `public` schema structure + source row counts so we can author
 * the per-table migration mapping document by hand.
 *
 * No writes to either database. Read-only.
 *
 * Usage:
 *   cp scripts/migrate-from-cafeweb/.env.migration.example .env.migration
 *   # fill in SOURCE_DATABASE_URL and TARGET_DATABASE_URL
 *   npx tsx scripts/migrate-from-cafeweb/00-schema-inventory.ts
 *
 * Output:
 *   scripts/migrate-from-cafeweb/state/source-schema.json
 *   scripts/migrate-from-cafeweb/state/target-schema.json
 *   scripts/migrate-from-cafeweb/state/source-row-counts.json
 *   scripts/migrate-from-cafeweb/state/schema-diff-summary.md
 */

import fs from 'fs'
import path from 'path'
import { sourcePool, targetPool, withClient, closePools } from './shared/clients'
import type { PoolClient } from 'pg'

interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: 'YES' | 'NO'
  column_default: string | null
  character_maximum_length: number | null
}

interface TableSchema {
  [tableName: string]: ColumnInfo[]
}

const STATE_DIR = path.resolve(__dirname, 'state')

async function listPublicTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `)
  return rows.map((r) => r.table_name)
}

async function listColumns(client: PoolClient): Promise<TableSchema> {
  const { rows } = await client.query<{
    table_name: string
    column_name: string
    data_type: string
    is_nullable: 'YES' | 'NO'
    column_default: string | null
    character_maximum_length: number | null
  }>(`
    SELECT
      table_name,
      column_name,
      data_type,
      is_nullable,
      column_default,
      character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `)

  const schema: TableSchema = {}
  for (const row of rows) {
    const { table_name, ...col } = row
    if (!schema[table_name]) schema[table_name] = []
    schema[table_name].push(col)
  }
  return schema
}

async function countRowsForAllTables(
  client: PoolClient,
  tables: string[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of tables) {
    try {
      const { rows } = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM public."${table}"`
      )
      counts[table] = Number(rows[0]?.c ?? 0)
    } catch (err) {
      console.warn(`  ⚠️  Could not count ${table}: ${(err as Error).message}`)
      counts[table] = -1
    }
  }
  return counts
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(path.join(STATE_DIR, file), JSON.stringify(data, null, 2))
  console.log(`  ✓ Wrote ${file}`)
}

function summarizeDiff(
  sourceSchema: TableSchema,
  targetSchema: TableSchema,
  rowCounts: Record<string, number>
): string {
  const sourceTables = new Set(Object.keys(sourceSchema))
  const targetTables = new Set(Object.keys(targetSchema))

  const onlyInSource = [...sourceTables].filter((t) => !targetTables.has(t)).sort()
  const onlyInTarget = [...targetTables].filter((t) => !sourceTables.has(t)).sort()
  const inBoth = [...sourceTables].filter((t) => targetTables.has(t)).sort()

  const lines: string[] = []
  lines.push('# Schema diff summary — cafe-web (source) → cafe-pulse (target)')
  lines.push('')
  lines.push(`_Generated ${new Date().toISOString()} by \`00-schema-inventory.ts\`._`)
  lines.push('')
  lines.push(`- Source tables: ${sourceTables.size}`)
  lines.push(`- Target tables: ${targetTables.size}`)
  lines.push(`- In both: ${inBoth.length}`)
  lines.push(`- Only in source: ${onlyInSource.length}`)
  lines.push(`- Only in target: ${onlyInTarget.length}`)
  lines.push('')

  lines.push('## Tables with source data (need migration decisions)')
  lines.push('')
  lines.push('| Table | Rows | In target? |')
  lines.push('|---|---:|---|')
  for (const table of [...sourceTables].sort()) {
    const rows = rowCounts[table] ?? 0
    if (rows === 0) continue
    const inTarget = targetTables.has(table) ? '✅' : '❌ (needs mapping / new table on target)'
    lines.push(`| ${table} | ${rows} | ${inTarget} |`)
  }
  lines.push('')

  lines.push('## Empty source tables (skip unless schema is needed)')
  lines.push('')
  const empties = [...sourceTables].filter((t) => (rowCounts[t] ?? 0) === 0).sort()
  if (empties.length) {
    lines.push(empties.map((t) => `- ${t}`).join('\n'))
  } else {
    lines.push('_(none)_')
  }
  lines.push('')

  lines.push('## Tables only in target (new — not migrated from source)')
  lines.push('')
  if (onlyInTarget.length) {
    lines.push(onlyInTarget.map((t) => `- ${t}`).join('\n'))
  } else {
    lines.push('_(none)_')
  }
  lines.push('')

  lines.push('## Tables only in source (dropped in target or renamed)')
  lines.push('')
  if (onlyInSource.length) {
    lines.push(onlyInSource.map((t) => `- ${t} (${rowCounts[t] ?? '?'} rows)`).join('\n'))
  } else {
    lines.push('_(none)_')
  }
  lines.push('')

  lines.push('## Column-level differences for tables in both')
  lines.push('')
  for (const table of inBoth) {
    const sourceCols = new Set((sourceSchema[table] ?? []).map((c) => c.column_name))
    const targetCols = new Set((targetSchema[table] ?? []).map((c) => c.column_name))
    const addedInTarget = [...targetCols].filter((c) => !sourceCols.has(c)).sort()
    const removedInTarget = [...sourceCols].filter((c) => !targetCols.has(c)).sort()

    if (addedInTarget.length === 0 && removedInTarget.length === 0) continue

    lines.push(`### \`${table}\``)
    if (addedInTarget.length) {
      lines.push(`- Columns added in target: ${addedInTarget.map((c) => `\`${c}\``).join(', ')}`)
    }
    if (removedInTarget.length) {
      lines.push(`- Columns removed in target: ${removedInTarget.map((c) => `\`${c}\``).join(', ')}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function main() {
  console.log('📋 Phase 0: Schema inventory (read-only)')
  console.log('')

  console.log('→ Source (cafe-web-app-prod):')
  const { tables: sourceTables, schema: sourceSchema } = await withClient(sourcePool, async (c) => {
    const t = await listPublicTables(c)
    const s = await listColumns(c)
    console.log(`  Found ${t.length} tables`)
    return { tables: t, schema: s }
  })

  console.log('')
  console.log('→ Counting source rows (one COUNT(*) per table)...')
  const rowCounts = await withClient(sourcePool, (c) => countRowsForAllTables(c, sourceTables))
  const totalRows = Object.values(rowCounts)
    .filter((n) => n > 0)
    .reduce((a, b) => a + b, 0)
  console.log(`  Total rows across source: ${totalRows.toLocaleString()}`)

  console.log('')
  console.log('→ Target (cafe-pulse):')
  const targetSchema = await withClient(targetPool, async (c) => {
    const t = await listPublicTables(c)
    const s = await listColumns(c)
    console.log(`  Found ${t.length} tables`)
    return s
  })

  console.log('')
  console.log('→ Writing outputs to state/')
  writeJson('source-schema.json', sourceSchema)
  writeJson('target-schema.json', targetSchema)
  writeJson('source-row-counts.json', rowCounts)

  const summary = summarizeDiff(sourceSchema, targetSchema, rowCounts)
  fs.writeFileSync(path.join(STATE_DIR, 'schema-diff-summary.md'), summary)
  console.log('  ✓ Wrote schema-diff-summary.md')

  console.log('')
  console.log('✅ Inventory complete. Next: hand-author doc/cafe-web-to-cafe-pulse-migration-map.md')
  console.log('   using the generated state/ files as raw inputs.')
}

main()
  .catch((err) => {
    console.error('💥 Schema inventory failed:', err)
    process.exitCode = 1
  })
  .finally(() => closePools())
