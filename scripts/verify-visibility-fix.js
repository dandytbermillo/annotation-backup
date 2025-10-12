#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    console.log('\n🔍 Verifying Visibility Save Fix:\n')

    // Find the most recent panel load
    const loadEvent = await client.query(`
      SELECT metadata->>'noteId' as note_id,
             metadata->>'panelId' as panel_id,
             created_at
      FROM debug_logs
      WHERE action = 'LOAD_CONTENT_SUPPRESSION_START'
      ORDER BY created_at DESC
      LIMIT 1
    `)

    if (loadEvent.rows.length === 0) {
      console.log('❌ No panel load events found\n')
      await client.end()
      return
    }

    const noteId = loadEvent.rows[0].note_id
    const panelId = loadEvent.rows[0].panel_id
    const loadTime = loadEvent.rows[0].created_at

    console.log(`Last panel load:`)
    console.log(`  Time: ${loadTime.toLocaleTimeString()}`)
    console.log(`  Note: ${noteId}`)
    console.log(`  Panel: ${panelId}\n`)

    // Check for visibility save events after load
    const visibilitySaves = await client.query(`
      SELECT action, created_at, metadata->>'reason' as reason
      FROM debug_logs
      WHERE (action = 'VISIBILITY_SAVE_TRIGGERED' OR action = 'VISIBILITY_SAVE_SKIPPED')
        AND metadata->>'noteId' = $1
        AND metadata->>'panelId' = $2
        AND created_at > $3
        AND created_at < $3 + INTERVAL '10 seconds'
      ORDER BY created_at
    `, [noteId, panelId, loadTime])

    if (visibilitySaves.rows.length > 0) {
      console.log(`✅ Fix is working! Visibility events after load:`)
      visibilitySaves.rows.forEach(row => {
        const delay = row.created_at.getTime() - loadTime.getTime()
        const icon = row.action === 'VISIBILITY_SAVE_SKIPPED' ? '✅' : '⚠️'
        console.log(`  ${icon} [${row.action}]`)
        console.log(`     Time: +${delay}ms after load`)
        console.log(`     Reason: ${row.reason}`)
      })
      console.log('')
    } else {
      console.log(`ℹ️  No visibility save events found after load\n`)
    }

    // Check for ghost saves (saves without corresponding debug events)
    const endTime = new Date(loadTime.getTime() + 10000)
    const saves = await client.query(`
      SELECT version, created_at
      FROM document_saves
      WHERE note_id = $1
        AND created_at BETWEEN $2 AND $3
      ORDER BY created_at
    `, [noteId, loadTime, endTime])

    if (saves.rows.length > 0) {
      console.log(`⚠️  Database saves within 10 seconds of load:`)
      saves.rows.forEach(row => {
        const delay = row.created_at.getTime() - loadTime.getTime()
        console.log(`   Version ${row.version}: +${delay}ms after load`)
      })

      // Check if these saves have corresponding SAVE_HASH_UPDATED events
      for (const save of saves.rows) {
        const hashEvent = await client.query(`
          SELECT COUNT(*) as count
          FROM debug_logs
          WHERE action = 'SAVE_HASH_UPDATED'
            AND metadata->>'noteId' = $1
            AND metadata->>'panelId' = $2
            AND created_at BETWEEN $3 AND $4
        `, [noteId, panelId, new Date(save.created_at.getTime() - 1000), new Date(save.created_at.getTime() + 1000)])

        if (hashEvent.rows[0].count === 0) {
          console.log(`   ❌ GHOST SAVE: Version ${save.version} has NO corresponding SAVE_HASH_UPDATED event`)
        } else {
          console.log(`   ✅ OK: Version ${save.version} has corresponding save event`)
        }
      }
      console.log('')
    } else {
      console.log(`✅ NO GHOST SAVES: No database saves within 10 seconds of load\n`)
    }

    // Check for false notifications
    const notifications = await client.query(`
      SELECT created_at, metadata->>'version' as version
      FROM debug_logs
      WHERE action = 'REMOTE_UPDATE_BLOCKED'
        AND metadata->>'panelId' = $1
        AND created_at > $2
        AND created_at < $2 + INTERVAL '30 seconds'
    `, [panelId, loadTime])

    if (notifications.rows.length > 0) {
      console.log(`⚠️  Notifications triggered after load:`)
      notifications.rows.forEach(row => {
        const delay = row.created_at.getTime() - loadTime.getTime()
        console.log(`   +${delay}ms: Version ${row.version}`)
      })
      console.log(`\n   Check if these are legitimate (user actually edited)\n`)
    } else {
      console.log(`✅ No notifications after this load\n`)
    }

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
