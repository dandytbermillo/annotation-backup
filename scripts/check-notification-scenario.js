#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    console.log('\n🔍 Checking last 20 cross-browser sync events:\n')

    const res = await client.query(`
      SELECT
        action,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND created_at > NOW() - INTERVAL '30 minutes'
      ORDER BY created_at DESC
      LIMIT 20
    `)

    res.rows.forEach((row, i) => {
      const meta = row.metadata
      const time = new Date(row.created_at).toLocaleTimeString()

      console.log(`${i + 1}. [${time}] ${row.action}`)

      if (row.action === 'PROVIDER_EMIT_REMOTE_UPDATE' || row.action === 'PROVIDER_SKIP_IDENTICAL') {
        console.log(`   Panel: ${meta.panelId}`)
        console.log(`   Version: ${meta.version}, Cached: ${meta.cachedVersion}`)
        console.log(`   Version Changed: ${meta.versionChanged}`)
        console.log(`   Reason: ${meta.reason}`)
        console.log(`   Had Cached: ${meta.hadCached}`)
      } else if (row.action === 'REMOTE_UPDATE_RECEIVED') {
        console.log(`   Panel: ${meta.panelId}`)
        console.log(`   Version: ${meta.version}`)
        console.log(`   Reason: ${meta.reason}`)
      } else if (row.action === 'REMOTE_UPDATE_BLOCKED' || row.action === 'REMOTE_UPDATE_APPLYING') {
        console.log(`   Panel: ${meta.panelId}`)
        console.log(`   Version: ${meta.version}`)
        console.log(`   Reason: ${meta.reason}`)
        console.log(`   Has Unsaved: ${meta.reason === 'unsaved_changes'}`)
      } else if (row.action === 'VISIBILITY_REFRESH') {
        console.log(`   Panel: ${meta.panelId}`)
        console.log(`   Has User Edited: ${meta.hasUserEdited}`)
        console.log(`   Has Last Saved Hash: ${meta.hasLastSavedHash}`)
      } else if (row.action === 'CONFLICT_BLOCKED') {
        console.log(`   Panel: ${meta.panelId}`)
        console.log(`   Version: ${meta.version}`)
        console.log(`   Message: ${meta.message}`)
      }

      console.log('')
    })

    console.log('\n📊 Looking for notification triggers (BLOCKED events):\n')

    const blocked = await client.query(`
      SELECT
        action,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND (action = 'REMOTE_UPDATE_BLOCKED' OR action = 'CONFLICT_BLOCKED')
        AND created_at > NOW() - INTERVAL '30 minutes'
      ORDER BY created_at DESC
      LIMIT 5
    `)

    if (blocked.rows.length === 0) {
      console.log('   No BLOCKED events found (notification should NOT have appeared)')
    } else {
      blocked.rows.forEach((row, i) => {
        const meta = row.metadata
        const time = new Date(row.created_at).toLocaleTimeString()
        console.log(`${i + 1}. [${time}] ${row.action}`)
        console.log(`   Panel: ${meta.panelId}`)
        console.log(`   Version: ${meta.version}`)
        console.log(`   Reason: ${meta.reason}`)
        console.log('')
      })
    }

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
