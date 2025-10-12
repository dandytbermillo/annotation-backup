#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    console.log('\n🔍 Checking for ghost saves (saves during content load):\n')

    const res = await client.query(`
      SELECT
        action,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND action = 'LOAD_CONTENT_SUPPRESSED'
        AND created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY created_at DESC
      LIMIT 10
    `)

    if (res.rows.length === 0) {
      console.log('   ℹ️  No content load suppressions logged yet')
      console.log('   (This event logs when Firefox opens a panel)\n')
    } else {
      console.log(`Found ${res.rows.length} content load suppressions:\n`)
      res.rows.forEach((row, i) => {
        const meta = row.metadata
        const time = new Date(row.created_at).toLocaleTimeString()
        console.log(`${i + 1}. [${time}] ${meta.panelId}`)
        console.log(`   ✅ onUpdate suppressed during load (no ghost save)`)
        console.log('')
      })
    }

    // Check for recent conflicts
    console.log('\n📊 Recent conflict events:\n')

    const conflicts = await client.query(`
      SELECT action, COUNT(*) as count
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND (action = 'CONFLICT_CONTENT_DIFFERS' OR action = 'CONFLICT_SILENT_CATCHUP')
        AND created_at > NOW() - INTERVAL '5 minutes'
      GROUP BY action
    `)

    if (conflicts.rows.length === 0) {
      console.log('   ✅ No conflicts in last 5 minutes\n')
    } else {
      conflicts.rows.forEach(row => {
        if (row.action === 'CONFLICT_CONTENT_DIFFERS') {
          console.log(`   ⚠️  Real conflicts: ${row.count}`)
        } else if (row.action === 'CONFLICT_SILENT_CATCHUP') {
          console.log(`   ✅ Silent catchups: ${row.count}`)
        }
      })
      console.log('')
    }

    // Check for notification triggers
    console.log('📢 Notification triggers:\n')

    const blocked = await client.query(`
      SELECT COUNT(*) as count
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND action = 'REMOTE_UPDATE_BLOCKED'
        AND created_at > NOW() - INTERVAL '5 minutes'
    `)

    if (blocked.rows[0].count === 0) {
      console.log('   ✅ No false notifications in last 5 minutes\n')
    } else {
      console.log(`   ⚠️  ${blocked.rows[0].count} notifications triggered\n`)
    }

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
