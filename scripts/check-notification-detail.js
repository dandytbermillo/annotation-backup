#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    console.log('\n🔍 Events around 4:50:33 PM (notification trigger):\n')

    const res = await client.query(`
      SELECT
        action,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND created_at BETWEEN '2025-10-11 16:50:25' AND '2025-10-11 16:50:40'
      ORDER BY created_at ASC
    `)

    res.rows.forEach((row, i) => {
      const meta = row.metadata
      const time = new Date(row.created_at).toISOString().split('T')[1].substring(0, 12)

      console.log(`${i + 1}. [${time}] ${row.action}`)

      if (meta.panelId) console.log(`   Panel: ${meta.panelId}`)
      if (meta.version !== undefined) console.log(`   Version: ${meta.version}`)
      if (meta.cachedVersion !== undefined) console.log(`   Cached Version: ${meta.cachedVersion}`)
      if (meta.versionChanged !== undefined) console.log(`   Version Changed: ${meta.versionChanged}`)
      if (meta.reason) console.log(`   Reason: ${meta.reason}`)
      if (meta.hasUserEdited !== undefined) console.log(`   Has User Edited: ${meta.hasUserEdited}`)
      if (meta.message) console.log(`   Message: ${meta.message}`)

      console.log('')
    })

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
