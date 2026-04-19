#!/usr/bin/env node
/** Check CHECK constraints and enum values for PO-family tables. */
import { sourcePool, targetPool, withClient, closePools } from './shared/clients'

async function main() {
  // Check source distinct values for status / movement_type
  console.log('── SOURCE distinct status / movement_type values ──')
  await withClient(sourcePool, async (c) => {
    const { rows: poStatuses } = await c.query<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text AS n FROM purchase_orders GROUP BY status ORDER BY n DESC`
    )
    console.log('purchase_orders.status:')
    for (const r of poStatuses) console.log(`  ${r.status.padEnd(20)} (${r.n})`)

    const { rows: mvTypes } = await c.query<{ movement_type: string; n: string }>(
      `SELECT movement_type, COUNT(*)::text AS n FROM stock_movements GROUP BY movement_type ORDER BY n DESC`
    )
    console.log('stock_movements.movement_type:')
    for (const r of mvTypes) console.log(`  ${r.movement_type.padEnd(20)} (${r.n})`)

    const { rows: hStatuses } = await c.query<{ new_status: string; n: string }>(
      `SELECT new_status, COUNT(*)::text AS n FROM purchase_order_status_history GROUP BY new_status ORDER BY n DESC`
    )
    console.log('purchase_order_status_history.new_status:')
    for (const r of hStatuses) console.log(`  ${r.new_status.padEnd(20)} (${r.n})`)
  })

  // Check target CHECK constraints
  console.log('\n── TARGET CHECK constraints ──')
  await withClient(targetPool, async (c) => {
    const { rows } = await c.query<{ table_name: string; constraint_name: string; clause: string }>(`
      SELECT tc.table_name, tc.constraint_name, cc.check_clause AS clause
      FROM information_schema.table_constraints tc
      JOIN information_schema.check_constraints cc USING (constraint_schema, constraint_name)
      WHERE tc.table_schema = 'public'
        AND tc.table_name IN ('purchase_orders','purchase_order_items','purchase_order_receipts',
                              'purchase_order_status_history','purchase_order_attachments','stock_movements')
        AND tc.constraint_type = 'CHECK'
      ORDER BY tc.table_name, tc.constraint_name
    `)
    for (const r of rows) console.log(`  ${r.table_name}.${r.constraint_name}: ${r.clause}`)
  })
}

main().catch(e => console.error(e)).finally(() => closePools())
