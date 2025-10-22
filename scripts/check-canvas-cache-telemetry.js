#!/usr/bin/env node

/**
 * Canvas cache telemetry smoke-test.
 *
 * This script queries recent debug_logs entries for Canvas cache and offline queue
 * events to confirm Phase 3 instrumentation is producing data.
 *
 * Usage:
 *   node scripts/check-canvas-cache-telemetry.js [--window HOURS]
 *
 * Example:
 *   node scripts/check-canvas-cache-telemetry.js --window 4
 *
 * Requirements:
 *   - DATABASE_URL environment variable must point at the Postgres instance.
 *   - debug_logs must be populated (run the app and exercise the canvas first).
 */

const { Client } = require('pg')

const args = process.argv.slice(2)
let hours = 24
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--window' || arg === '-w') {
    const next = args[i + 1]
    if (!next) {
      console.error('Missing value for --window')
      process.exit(1)
    }
    const parsed = Number(next)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      console.error(`Invalid hours value: ${next}`)
      process.exit(1)
    }
    hours = parsed
    i += 1
  } else {
    console.warn(`Ignoring unknown argument: ${arg}`)
  }
}

const windowExpr = `${hours} hours`

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  const client = new Client({ connectionString })
  await client.connect()

  const cacheQuery = `
    SELECT
      action,
      COUNT(*) AS count,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen
    FROM debug_logs
    WHERE component = 'CanvasCache'
      AND created_at > NOW() - INTERVAL '${windowExpr}'
    GROUP BY action
    ORDER BY action;
  `

  const queueQuery = `
    SELECT
      action,
      COUNT(*) AS count,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen
    FROM debug_logs
    WHERE component = 'CanvasOfflineQueue'
      AND created_at > NOW() - INTERVAL '${windowExpr}'
    GROUP BY action
    ORDER BY action;
  `

  const cacheRes = await client.query(cacheQuery)
  const queueRes = await client.query(queueQuery)

  await client.end()

  const now = new Date().toISOString()
  console.log(`Canvas telemetry snapshot @ ${now} (window = ${hours}h)\n`)

  if (cacheRes.rows.length === 0) {
    console.warn('No CanvasCache events found in the selected window.')
    console.warn('⚠️  Exercise the canvas (reload, invalidate cache) before rerunning.\n')
  } else {
    console.log('CanvasCache events:')
    console.table(cacheRes.rows)
    console.log()
  }

  if (queueRes.rows.length === 0) {
    console.warn('No CanvasOfflineQueue events found in the selected window.')
    console.warn('ℹ️  That is fine if the queue never activated; try queuing a change while offline if needed.\n')
  } else {
    console.log('CanvasOfflineQueue events:')
    console.table(queueRes.rows)
    console.log()
  }

  const hasCacheData = cacheRes.rows.some(row => Number(row.count) > 0)
  if (!hasCacheData) {
    process.exit(2)
  }
}

main().catch(error => {
  console.error('Telemetry check failed:', error)
  process.exit(1)
})

