#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    console.log('\n🔍 Checking if fix is effective:\n')

    // Find when fix was deployed
    const fixTime = await client.query(`
      SELECT MIN(created_at) as fix_deployed
      FROM debug_logs
      WHERE action = 'LOAD_CONTENT_SUPPRESSION_END'
    `)

    if (!fixTime.rows[0] || !fixTime.rows[0].fix_deployed) {
      console.log('❌ Fix not deployed yet (no SUPPRESSION_END events)\n')
      await client.end()
      return
    }

    const deployTime = fixTime.rows[0].fix_deployed
    console.log(`Fix deployed: ${deployTime.toLocaleTimeString()}\n`)

    // Check notifications BEFORE fix
    const beforeFix = await client.query(`
      SELECT COUNT(*) as count
      FROM debug_logs
      WHERE action = 'REMOTE_UPDATE_BLOCKED'
        AND created_at < $1
        AND created_at > $1 - INTERVAL '1 hour'
    `, [deployTime])

    console.log(`Before fix (1hr before deployment): ${beforeFix.rows[0].count} notifications`)

    // Check notifications AFTER fix
    const afterFix = await client.query(`
      SELECT COUNT(*) as count
      FROM debug_logs
      WHERE action = 'REMOTE_UPDATE_BLOCKED'
        AND created_at > $1
    `, [deployTime])

    console.log(`After fix (since deployment): ${afterFix.rows[0].count} notifications\n`)

    if (afterFix.rows[0].count === 0) {
      console.log('✅ FIX IS WORKING: No notifications since deployment!\n')
    } else {
      console.log(`❌ FIX NOT WORKING: ${afterFix.rows[0].count} notifications still occurring\n`)

      // Show recent notifications
      const recent = await client.query(`
        SELECT metadata->>'panelId' as panel_id, created_at
        FROM debug_logs
        WHERE action = 'REMOTE_UPDATE_BLOCKED'
          AND created_at > $1
        ORDER BY created_at DESC
        LIMIT 5
      `, [deployTime])

      console.log('Recent notifications after fix:')
      recent.rows.forEach((row, i) => {
        const time = row.created_at.toLocaleTimeString()
        console.log(`  ${i+1}. [${time}] ${row.panel_id}`)
      })
      console.log('')
    }

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
