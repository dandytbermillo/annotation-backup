#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    console.log('\n🔍 Finding the most recent REMOTE_UPDATE_BLOCKED event:\n')

    const blocked = await client.query(`
      SELECT created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND action = 'REMOTE_UPDATE_BLOCKED'
      ORDER BY created_at DESC
      LIMIT 1
    `)

    if (blocked.rows.length === 0) {
      console.log('No REMOTE_UPDATE_BLOCKED events found\n')
      return
    }

    const blockedTime = blocked.rows[0].created_at
    const beforeTime = new Date(blockedTime.getTime() - 10000) // 10 seconds before
    const afterTime = new Date(blockedTime.getTime() + 2000) // 2 seconds after

    console.log(`Blocked event at: ${blockedTime.toLocaleTimeString()}`)
    console.log(`Checking events from ${beforeTime.toLocaleTimeString()} to ${afterTime.toLocaleTimeString()}\n`)

    const events = await client.query(`
      SELECT action, metadata, created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND created_at BETWEEN $1 AND $2
      ORDER BY created_at ASC
    `, [beforeTime, afterTime])

    events.rows.forEach((row, i) => {
      const meta = row.metadata
      const time = new Date(row.created_at).toLocaleTimeString() + '.' + row.created_at.getMilliseconds()

      console.log(`${i + 1}. [${time}] ${row.action}`)
      if (meta.panelId) console.log(`   Panel: ${meta.panelId}`)
      if (meta.version !== undefined) console.log(`   Version: ${meta.version}`)
      if (meta.cachedVersion !== undefined) console.log(`   Cached: ${meta.cachedVersion}`)
      if (meta.versionChanged !== undefined) console.log(`   Changed: ${meta.versionChanged}`)
      if (meta.reason) console.log(`   Reason: ${meta.reason}`)
      if (meta.hasUserEdited !== undefined) console.log(`   User Edited: ${meta.hasUserEdited}`)

      if (row.action === 'REMOTE_UPDATE_BLOCKED') {
        console.log(`   ⚠️  NOTIFICATION TRIGGERED HERE`)
      }

      console.log('')
    })

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
