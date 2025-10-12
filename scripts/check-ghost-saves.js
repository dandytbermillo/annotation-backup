#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    const cutoff = new Date(Date.now() - 5 * 60 * 1000)

    const saves = await client.query(
      'SELECT note_id, panel_id, version, created_at FROM document_saves WHERE created_at > $1 ORDER BY created_at DESC LIMIT 10',
      [cutoff]
    )

    console.log('\n📊 Recent Database Saves (last 5 min):\n')

    if (saves.rows.length === 0) {
      console.log('No saves in the last 5 minutes\n')
      await client.end()
      return
    }

    for (const save of saves.rows) {
      const hashEvents = await client.query(
        `SELECT COUNT(*) as count FROM debug_logs
         WHERE action = 'SAVE_HASH_UPDATED'
         AND metadata->>'panelId' = 'main'
         AND created_at BETWEEN $1 AND $2`,
        [
          new Date(save.created_at.getTime() - 2000),
          new Date(save.created_at.getTime() + 2000)
        ]
      )

      const time = new Date(save.created_at).toLocaleTimeString()
      const hasEvent = hashEvents.rows[0].count > 0
      const icon = hasEvent ? '✅' : '❌'

      console.log(`${icon} Version ${save.version}: ${time}`)
      if (!hasEvent) {
        console.log('   ⚠️  GHOST SAVE - No corresponding SAVE_HASH_UPDATED event')
      } else {
        console.log('   ✓ Has corresponding save event')
      }
    }

    console.log('')

    // Count total ghost saves
    const ghostCount = saves.rows.filter(async (save) => {
      const hashEvents = await client.query(
        `SELECT COUNT(*) as count FROM debug_logs
         WHERE action = 'SAVE_HASH_UPDATED'
         AND metadata->>'panelId' = 'main'
         AND created_at BETWEEN $1 AND $2`,
        [
          new Date(save.created_at.getTime() - 2000),
          new Date(save.created_at.getTime() + 2000)
        ]
      )
      return hashEvents.rows[0].count === 0
    }).length

    if (ghostCount === 0) {
      console.log('✅ No ghost saves detected in the last 5 minutes!\n')
    } else {
      console.log(`⚠️  ${ghostCount} ghost save(s) detected\n`)
    }

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
