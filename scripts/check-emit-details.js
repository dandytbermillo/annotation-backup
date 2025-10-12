#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    const res = await client.query(`
      SELECT
        action,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND action = 'PROVIDER_EMIT_REMOTE_UPDATE'
        AND metadata->>'panelId' = 'main'
        AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
      LIMIT 5
    `)

    console.log('\n📊 PROVIDER_EMIT_REMOTE_UPDATE Events (with version tracking):\n')
    res.rows.forEach((row, i) => {
      console.log(`${i + 1}. Time: ${row.created_at}`)
      const meta = row.metadata
      console.log(`   Version: ${meta.version}`)
      console.log(`   Cached Version: ${meta.cachedVersion || 'N/A'}`)
      console.log(`   Version Changed: ${meta.versionChanged || 'N/A'}`)
      console.log(`   Reason: ${meta.reason}`)
      console.log(`   Had Cached: ${meta.hadCached}`)
      console.log('')
    })

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
