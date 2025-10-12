#!/usr/bin/env node

const { Client } = require('pg')

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    const res = await client.query(`
      SELECT
        id,
        action,
        metadata->>'panelId' as panel_id,
        metadata->>'version' as version,
        metadata->>'conflictVersion' as conflict_version,
        metadata->>'lastAppliedVersion' as last_applied_version,
        metadata->>'reason' as reason,
        metadata->>'hasUserEdited' as has_user_edited,
        metadata->>'timeSinceProcessed' as time_since_processed,
        metadata->>'timeSinceLastEdit' as time_since_last_edit,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND metadata->>'panelId' LIKE 'branch-f90aa650%'
        AND (
          metadata->>'version' = '11'
          OR action LIKE 'CONFLICT_%'
        )
        AND created_at > NOW() - INTERVAL '15 minutes'
      ORDER BY created_at ASC
    `)

    console.log('\n🔍 Conflict Event Details (version 11, branch panel):\n')
    res.rows.forEach((row, i) => {
      console.log(`${i + 1}. [${row.action}]`)
      console.log(`   Time: ${row.created_at}`)
      if (row.conflict_version) console.log(`   Conflict Version: ${row.conflict_version}`)
      if (row.last_applied_version) console.log(`   Last Applied Version: ${row.last_applied_version}`)
      if (row.reason) console.log(`   Reason: ${row.reason}`)
      if (row.has_user_edited) console.log(`   Has User Edited: ${row.has_user_edited}`)
      if (row.time_since_processed) console.log(`   Time Since Processed: ${row.time_since_processed}ms`)
      if (row.time_since_last_edit) console.log(`   Time Since Last Edit: ${row.time_since_last_edit}ms`)

      const metadata = row.metadata
      if (metadata.lastAppliedVersion !== undefined) {
        console.log(`   📊 Metadata Last Applied: ${metadata.lastAppliedVersion}`)
      }

      console.log('')
    })

  } catch (err) {
    console.error('Error:', err.message)
  } finally {
    await client.end()
  }
})()
