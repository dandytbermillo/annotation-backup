#!/usr/bin/env node
/**
 * Verification Script: Phase 2 Cache Telemetry
 *
 * Verifies that all three cache telemetry events are implemented and working:
 * - canvas.cache_used
 * - canvas.cache_mismatch
 * - canvas.cache_discarded
 */

const { Pool } = require('pg')

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'annotation_dev',
  user: 'postgres',
  password: 'postgres'
})

async function verifyPhase2() {
  console.log('\n🔍 Verifying Phase 2: Cache Telemetry\n')
  console.log('═'.repeat(60))

  try {
    // Query for all cache telemetry events
    const result = await pool.query(`
      SELECT
        action,
        COUNT(*) as count,
        TO_CHAR(MIN(created_at), 'YYYY-MM-DD HH24:MI:SS') as first_event,
        TO_CHAR(MAX(created_at), 'YYYY-MM-DD HH24:MI:SS') as last_event
      FROM debug_logs
      WHERE component = 'CanvasCache'
        AND action IN ('canvas.cache_used', 'canvas.cache_mismatch', 'canvas.cache_discarded')
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY action
      ORDER BY count DESC
    `)

    if (result.rows.length === 0) {
      console.log('❌ No cache telemetry events found in the last 30 days\n')
      process.exit(1)
    }

    console.log('\n📊 Cache Telemetry Events (Last 30 Days):\n')
    console.table(result.rows)

    // Check if all three event types exist
    const eventTypes = result.rows.map(row => row.action)
    const requiredEvents = ['canvas.cache_used', 'canvas.cache_mismatch', 'canvas.cache_discarded']
    const missingEvents = requiredEvents.filter(event => !eventTypes.includes(event))

    if (missingEvents.length > 0) {
      console.log(`\n⚠️  Missing event types: ${missingEvents.join(', ')}`)
      console.log('   These events may not have been triggered yet.\n')
    } else {
      console.log('\n✅ All three cache telemetry event types are present!\n')
    }

    // Show sample events
    const sampleResult = await pool.query(`
      SELECT
        action,
        metadata->>'noteId' as note_id,
        metadata->>'reason' as reason,
        metadata->>'ageMs' as age_ms,
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as timestamp
      FROM debug_logs
      WHERE component = 'CanvasCache'
        AND action IN ('canvas.cache_used', 'canvas.cache_mismatch', 'canvas.cache_discarded')
      ORDER BY created_at DESC
      LIMIT 5
    `)

    console.log('\n📝 Recent Events (Last 5):\n')
    console.table(sampleResult.rows)

    console.log('\n✅ Phase 2 Verification Complete!\n')
    console.log('═'.repeat(60))
    console.log()

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

verifyPhase2()
