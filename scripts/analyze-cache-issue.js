#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    // Find recent PROVIDER_SKIP_IDENTICAL events
    const res = await client.query(`
      SELECT
        action,
        metadata->>'version' as version,
        metadata->>'reason' as reason,
        metadata->>'hadCached' as had_cached,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND metadata->>'panelId' = 'main'
        AND created_at > NOW() - INTERVAL '10 minutes'
        AND (action = 'PROVIDER_SKIP_IDENTICAL' OR action = 'PROVIDER_EMIT_REMOTE_UPDATE')
      ORDER BY created_at DESC
      LIMIT 15
    `)

    console.log('\n📊 Provider Cache Behavior (main panel):\n')
    res.rows.forEach((row, i) => {
      console.log(`${i + 1}. [${row.action}]`)
      console.log(`   Time: ${row.created_at}`)
      console.log(`   Version: ${row.version}`)
      console.log(`   Reason: ${row.reason}`)
      if (row.had_cached !== null) console.log(`   Had Cached: ${row.had_cached}`)
      console.log('')
    })

    // Check if we're seeing SKIP when we should be seeing EMIT
    const skipped = res.rows.filter(r => r.action === 'PROVIDER_SKIP_IDENTICAL')
    const emitted = res.rows.filter(r => r.action === 'PROVIDER_EMIT_REMOTE_UPDATE')

    console.log(`\n⚠️  Analysis:`)
    console.log(`   Skipped updates: ${skipped.length}`)
    console.log(`   Emitted updates: ${emitted.length}`)
    console.log(`\n   If skipped > emitted on visibility changes, cache is stale.`)

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
