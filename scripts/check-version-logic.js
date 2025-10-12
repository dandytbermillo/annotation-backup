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
        AND action = 'CONFLICT_DIFFERS'
        AND metadata->>'panelId' LIKE 'branch-f90aa650%'
        AND created_at > NOW() - INTERVAL '15 minutes'
      ORDER BY created_at DESC
      LIMIT 3
    `)

    console.log('\n📊 CONFLICT_DIFFERS Events - Full Metadata:\n')
    res.rows.forEach((row, i) => {
      console.log(`${i + 1}. Time: ${row.created_at}`)
      console.log('   Metadata:', JSON.stringify(row.metadata, null, 2))
      console.log('')
    })

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
