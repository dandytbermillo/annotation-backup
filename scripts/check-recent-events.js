#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    console.log('\n🔍 Recent cross-browser sync events (last 10 minutes):\n')

    const res = await client.query(`
      SELECT
        action,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at ASC
    `)

    console.log(`Total events: ${res.rows.length}\n`)

    res.rows.forEach((row, i) => {
      const meta = row.metadata
      const time = new Date(row.created_at).toLocaleTimeString()

      if (row.action === 'REMOTE_UPDATE_BLOCKED' ||
          row.action === 'CONFLICT_BLOCKED' ||
          row.action === 'PROVIDER_EMIT_REMOTE_UPDATE' ||
          row.action === 'VISIBILITY_REFRESH') {
        console.log(`${i + 1}. [${time}] ${row.action}`)

        if (meta.panelId) console.log(`   Panel: ${meta.panelId}`)
        if (meta.version !== undefined) console.log(`   DB Version: ${meta.version}`)
        if (meta.cachedVersion !== undefined) console.log(`   Cached Version: ${meta.cachedVersion}`)
        if (meta.versionChanged !== undefined) console.log(`   Version Changed: ${meta.versionChanged}`)
        if (meta.reason) console.log(`   Reason: ${meta.reason}`)
        if (meta.hasUserEdited !== undefined) console.log(`   Has User Edited: ${meta.hasUserEdited}`)
        if (meta.hasUnsavedChanges !== undefined) console.log(`   Has Unsaved: ${meta.hasUnsavedChanges}`)

        console.log('')
      }
    })

    console.log('\n\n🚨 NOTIFICATION TRIGGERS (BLOCKED events):\n')

    const blocked = res.rows.filter(row =>
      row.action === 'REMOTE_UPDATE_BLOCKED' || row.action === 'CONFLICT_BLOCKED'
    )

    if (blocked.length === 0) {
      console.log('   ✅ No blocked events - notification should NOT appear\n')
    } else {
      blocked.forEach((row, i) => {
        const meta = row.metadata
        const time = new Date(row.created_at).toLocaleTimeString()
        console.log(`${i + 1}. [${time}] ${row.action}`)
        console.log(`   Panel: ${meta.panelId}`)
        console.log(`   Version: ${meta.version}`)
        console.log(`   Reason: ${meta.reason}`)
        console.log(`   ⚠️  THIS TRIGGERED A NOTIFICATION`)
        console.log('')
      })
    }

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
