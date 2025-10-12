#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    console.log('\n🔍 Verifying suppression fix:\n')

    // Find the most recent load with suppression
    const suppressStart = await client.query(`
      SELECT metadata->>'noteId' as note_id,
             metadata->>'panelId' as panel_id,
             created_at
      FROM debug_logs
      WHERE action = 'LOAD_CONTENT_SUPPRESSION_START'
      ORDER BY created_at DESC
      LIMIT 1
    `)

    if (suppressStart.rows.length === 0) {
      console.log('❌ No LOAD_CONTENT_SUPPRESSION_START events found')
      console.log('   Have you opened a panel in Firefox yet?\n')
      await client.end()
      return
    }

    const noteId = suppressStart.rows[0].note_id
    const panelId = suppressStart.rows[0].panel_id
    const startTime = suppressStart.rows[0].created_at

    console.log(`Panel load detected:`)
    console.log(`  Time: ${startTime.toLocaleTimeString()}`)
    console.log(`  Note: ${noteId}`)
    console.log(`  Panel: ${panelId}\n`)

    // Check for suppression end
    const endTime = new Date(startTime.getTime() + 2000)

    const suppressEnd = await client.query(`
      SELECT created_at
      FROM debug_logs
      WHERE action = 'LOAD_CONTENT_SUPPRESSION_END'
        AND metadata->>'noteId' = $1
        AND metadata->>'panelId' = $2
        AND created_at BETWEEN $3 AND $4
    `, [noteId, panelId, startTime, endTime])

    if (suppressEnd.rows.length === 0) {
      console.log('⚠️  Suppression started but never ended')
      console.log('   This might indicate the RAF callback did not fire\n')
    } else {
      const endT = suppressEnd.rows[0].created_at
      const duration = endT.getTime() - startTime.getTime()
      console.log(`✅ Suppression lifecycle complete:`)
      console.log(`   Started: ${startTime.toLocaleTimeString()}.${startTime.getMilliseconds()}`)
      console.log(`   Ended: ${endT.toLocaleTimeString()}.${endT.getMilliseconds()}`)
      console.log(`   Duration: ${duration}ms\n`)
    }

    // Check for hash initialization
    const hashInit = await client.query(`
      SELECT created_at
      FROM debug_logs
      WHERE action = 'LOAD_HASH_INITIALIZED'
        AND metadata->>'noteId' = $1
        AND metadata->>'panelId' = $2
        AND created_at BETWEEN $3 AND $4
    `, [noteId, panelId, startTime, endTime])

    if (hashInit.rows.length > 0) {
      console.log(`✅ Hash tracking initialized after load`)
    } else {
      console.log(`⚠️  No hash initialization logged`)
    }

    // Check for ghost saves during suppression
    const afterStart = startTime
    const afterEnd = new Date(endTime.getTime() + 1000)

    const saves = await client.query(`
      SELECT version, created_at
      FROM document_saves
      WHERE note_id = $1
        AND created_at BETWEEN $2 AND $3
      ORDER BY created_at
    `, [noteId, afterStart, afterEnd])

    if (saves.rows.length > 0) {
      console.log(`\n❌ GHOST SAVES DETECTED (FIX FAILED):`)
      saves.rows.forEach(row => {
        const delay = row.created_at.getTime() - startTime.getTime()
        console.log(`   Version ${row.version}: +${delay}ms after load`)
      })
      console.log(`\n   The suppression is not working correctly\n`)
    } else {
      console.log(`\n✅ NO GHOST SAVES: No saves within 3 seconds of panel load`)
      console.log(`   Suppression is working correctly!\n`)
    }

    // Check for false notifications after this load
    const notifications = await client.query(`
      SELECT created_at
      FROM debug_logs
      WHERE action = 'REMOTE_UPDATE_BLOCKED'
        AND metadata->>'panelId' = $1
        AND created_at BETWEEN $2 AND $3
    `, [panelId, startTime, afterEnd])

    if (notifications.rows.length > 0) {
      console.log(`⚠️  Notification triggered after this load:`)
      notifications.rows.forEach(row => {
        const delay = row.created_at.getTime() - startTime.getTime()
        console.log(`   +${delay}ms after load`)
      })
      console.log(`\n   If this is immediate, the fix may not be working\n`)
    } else {
      console.log(`✅ No false notifications after this load\n`)
    }

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
