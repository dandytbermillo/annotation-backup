#!/usr/bin/env node

/**
 * Query Main Panel Debug Logs
 */

const { Client } = require('pg')

const minutes = process.argv[2] || 10

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    console.log('\n🔍 Querying main panel events...\n')

    // Query main panel events
    const mainRes = await client.query(`
      SELECT
        id,
        component,
        action,
        metadata->>'noteId' as note_id,
        metadata->>'panelId' as panel_id,
        metadata->>'version' as version,
        metadata->>'reason' as reason,
        metadata->>'hasUserEdited' as has_user_edited,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND metadata->>'panelId' = 'main'
        AND created_at > NOW() - INTERVAL '${minutes} minutes'
      ORDER BY created_at DESC
      LIMIT 30
    `)

    if (mainRes.rows.length === 0) {
      console.log(' No main panel events in the last ${minutes} minutes.\n')
    } else {
      console.log(`📊 Main Panel Events (last ${minutes} minutes):\n`)
      mainRes.rows.forEach((row, i) => {
        console.log(`${i + 1}. [${row.action}]`)
        console.log(`   Time: ${row.created_at}`)
        console.log(`   Panel: ${row.panel_id}`)
        if (row.version) console.log(`   Version: ${row.version}`)
        if (row.reason) console.log(`   Reason: ${row.reason}`)
        if (row.has_user_edited) console.log(`   Has User Edited: ${row.has_user_edited}`)

        const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
        if (metadata?.hasChanges !== undefined) console.log(`   Has Changes: ${metadata.hasChanges}`)
        if (metadata?.currentHash && metadata?.savedHash) {
          console.log(`   Current Hash: ${metadata.currentHash}`)
          console.log(`   Saved Hash: ${metadata.savedHash}`)
        }
        console.log('')
      })
    }

    // Query blocked events (notifications shown)
    console.log('\n🚫 Notification Events (all panels):\n')
    const blockedRes = await client.query(`
      SELECT
        id,
        action,
        metadata->>'panelId' as panel_id,
        metadata->>'version' as version,
        metadata->>'reason' as reason,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND (action = 'REMOTE_UPDATE_BLOCKED' OR action = 'CONFLICT_BLOCKED')
        AND created_at > NOW() - INTERVAL '${minutes} minutes'
      ORDER BY created_at DESC
      LIMIT 10
    `)

    if (blockedRes.rows.length === 0) {
      console.log('   ✅ No notifications shown in the last ${minutes} minutes.\n')
    } else {
      blockedRes.rows.forEach((row, i) => {
        console.log(`${i + 1}. [${row.action}] ⚠️`)
        console.log(`   Time: ${row.created_at}`)
        console.log(`   Panel: ${row.panel_id}`)
        if (row.version) console.log(`   Version: ${row.version}`)
        if (row.reason) console.log(`   Reason: ${row.reason}`)

        const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
        if (metadata?.hasUserEdited !== undefined) console.log(`   Has User Edited: ${metadata.hasUserEdited}`)
        console.log('')
      })
    }

  } catch (err) {
    console.error('Error querying logs:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
})()
