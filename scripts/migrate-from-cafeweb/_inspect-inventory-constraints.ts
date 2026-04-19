#!/usr/bin/env node
/** Inspect constraints on suppliers + inventory_items + inventory_item_cost_history. */
import { targetPool, withClient, closePools } from './shared/clients'

async function main() {
  await withClient(targetPool, async (c) => {
    for (const tbl of ['suppliers', 'inventory_items', 'inventory_item_cost_history']) {
      console.log(`\n=== ${tbl} ===`)
      const { rows } = await c.query<{ constraint_name: string; constraint_type: string; columns: string }>(`
        SELECT tc.constraint_name, tc.constraint_type, string_agg(kcu.column_name, ',') AS columns
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema, table_name)
        WHERE tc.table_schema = 'public' AND tc.table_name = $1
        GROUP BY tc.constraint_name, tc.constraint_type
        ORDER BY tc.constraint_type
      `, [tbl])
      for (const r of rows) console.log(`  ${r.constraint_type.padEnd(14)} ${r.constraint_name.padEnd(60)} (${r.columns})`)

      const { rows: idx } = await c.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1`,
        [tbl]
      )
      console.log('  -- indexes --')
      for (const r of idx) console.log(`  ${r.indexname}: ${r.indexdef}`)
    }
  })
}
main().catch(e => console.error(e)).finally(() => closePools())
