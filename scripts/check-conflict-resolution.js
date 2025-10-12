#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    console.log('\n🔍 Checking conflict resolution events (last 10 minutes):\n')

    const res = await client.query(`
      SELECT
        action,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND (action = 'CONFLICT_CONTENT_DIFFERS' OR action = 'CONFLICT_SILENT_CATCHUP')
        AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
      LIMIT 20
    `)

    if (res.rows.length === 0) {
      console.log('   ℹ️  No conflict resolution events found\n')
    } else {
      res.rows.forEach((row, i) => {
        const meta = row.metadata
        const time = new Date(row.created_at).toLocaleTimeString()

        console.log(`${i + 1}. [${time}] ${row.action}`)
        console.log(`   Panel: ${meta.panelId}`)
        console.log(`   Base Version: ${meta.baseVersion}`)
        console.log(`   Remote Version: ${meta.remoteVersion}`)

        if (row.action === 'CONFLICT_CONTENT_DIFFERS') {
          console.log(`   ⚠️  REAL CONFLICT - Notification shown`)
        } else if (row.action === 'CONFLICT_SILENT_CATCHUP') {
          console.log(`   ✅ SILENT CATCHUP - No notification (content identical)`)
          console.log(`   Message: ${meta.message}`)
        }

        console.log('')
      })
    }

    console.log('\n📊 Summary of conflict handling:\n')

    const summary = await client.query(`
      SELECT
        action,
        COUNT(*) as count
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND (action = 'CONFLICT_CONTENT_DIFFERS' OR action = 'CONFLICT_SILENT_CATCHUP')
        AND created_at > NOW() - INTERVAL '10 minutes'
      GROUP BY action
    `)

    if (summary.rows.length === 0) {
      console.log('   No conflicts detected in the last 10 minutes\n')
    } else {
      summary.rows.forEach(row => {
        if (row.action === 'CONFLICT_CONTENT_DIFFERS') {
          console.log(`   Real Conflicts (notification shown): ${row.count}`)
        } else if (row.action === 'CONFLICT_SILENT_CATCHUP') {
          console.log(`   Silent Catchups (no notification): ${row.count}`)
        }
      })
      console.log('')
    }

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
