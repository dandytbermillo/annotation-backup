#!/usr/bin/env node
/**
 * Show proof of cache_mismatch event
 */

const { Pool } = require('pg')

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'annotation_dev',
  user: 'postgres',
  password: 'postgres'
})

async function showProof() {
  try {
    console.log('\n🔍 Fetching cache_mismatch event proof...\n')

    const result = await pool.query(`
      SELECT
        component,
        action,
        metadata,
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS.MS') as timestamp
      FROM debug_logs
      WHERE component = 'CanvasCache'
        AND action = 'canvas.cache_mismatch'
      ORDER BY created_at DESC
      LIMIT 5
    `)

    if (result.rows.length === 0) {
      console.log('❌ No cache_mismatch events found\n')
    } else {
      console.log(`✅ Found ${result.rows.length} cache_mismatch event(s):\n`)

      result.rows.forEach((row, i) => {
        console.log(`Event ${i + 1}:`)
        console.log(`  Component: ${row.component}`)
        console.log(`  Action: ${row.action}`)
        console.log(`  Timestamp: ${row.timestamp}`)
        console.log(`  Metadata:`)
        console.log(JSON.stringify(row.metadata, null, 4))
        console.log()
      })
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await pool.end()
  }
}

showProof()
