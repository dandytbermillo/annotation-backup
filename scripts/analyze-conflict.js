#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    // Find the most recent notification
    const notif = await client.query(`
      SELECT metadata->>'panelId' as panel_id,
             metadata->>'version' as version,
             created_at
      FROM debug_logs
      WHERE action = 'REMOTE_UPDATE_BLOCKED'
      ORDER BY created_at DESC
      LIMIT 1
    `)

    if (notif.rows.length === 0) {
      console.log('\nNo recent notification found\n')
      return
    }

    const panelId = notif.rows[0].panel_id
    const conflictVersion = parseInt(notif.rows[0].version)
    const notifTime = notif.rows[0].created_at

    console.log(`\n🔍 Analyzing conflict for panel: ${panelId}`)
    console.log(`Notification time: ${notifTime.toLocaleTimeString()}`)
    console.log(`Conflict version: ${conflictVersion}\n`)

    // Get saves around that time
    const beforeTime = new Date(notifTime.getTime() - 10000)
    const afterTime = new Date(notifTime.getTime() + 2000)

    const saves = await client.query(`
      SELECT version,
             content,
             created_at
      FROM document_saves
      WHERE panel_id = $1
        AND created_at BETWEEN $2 AND $3
      ORDER BY version ASC
    `, [panelId, beforeTime, afterTime])

    console.log(`Found ${saves.rows.length} saves around conflict time:\n`)

    saves.rows.forEach((row, i) => {
      const time = new Date(row.created_at).toLocaleTimeString()
      let content
      try {
        content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content
      } catch {
        content = row.content
      }

      const contentStr = JSON.stringify(content)
      console.log(`${i + 1}. Version ${row.version} at ${time}`)
      console.log(`   Content length: ${contentStr.length} chars`)
      console.log(`   First 150 chars: ${contentStr.substring(0, 150)}...`)
      console.log('')
    })

    // Check if version 3 and 4 differ
    const v3 = saves.rows.find(r => r.version === conflictVersion - 1)
    const v4 = saves.rows.find(r => r.version === conflictVersion)

    if (v3 && v4) {
      const v3content = JSON.stringify(typeof v3.content === 'string' ? JSON.parse(v3.content) : v3.content)
      const v4content = JSON.stringify(typeof v4.content === 'string' ? JSON.parse(v4.content) : v4.content)

      if (v3content === v4content) {
        console.log(`✅ Content IDENTICAL between v${conflictVersion-1} and v${conflictVersion}`)
        console.log(`   This should have been a SILENT CATCHUP!\n`)
      } else {
        console.log(`⚠️  Content DIFFERS between v${conflictVersion-1} and v${conflictVersion}`)
        console.log(`   Difference in length: ${v4content.length - v3content.length} chars`)

        // Show what changed
        if (v4content.length > v3content.length) {
          const added = v4content.substring(v3content.length)
          console.log(`   Added: ${added.substring(0, 100)}...`)
        }
        console.log(`   This is a REAL CONFLICT.\n`)
      }
    }

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
