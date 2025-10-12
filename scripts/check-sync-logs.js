#!/usr/bin/env node

/**
 * Query Cross-Browser Sync Debug Logs
 *
 * Usage:
 *   node scripts/check-sync-logs.js [minutes]
 *
 * Example:
 *   node scripts/check-sync-logs.js 5    # Last 5 minutes
 *   node scripts/check-sync-logs.js      # Last 10 minutes (default)
 */

const { Client } = require('pg')

const minutes = process.argv[2] || 10

;(async () => {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
  })

  try {
    await client.connect()

    const res = await client.query(`
      SELECT
        id,
        component,
        action,
        metadata->>'noteId' as note_id,
        metadata->>'panelId' as panel_id,
        metadata->>'version' as version,
        metadata->>'reason' as reason,
        metadata->>'hasUserEdited' as has_user_edited,
        metadata->>'hash' as hash,
        metadata->>'remoteHash' as remote_hash,
        metadata->>'currentHash' as current_hash,
        metadata,
        created_at
      FROM debug_logs
      WHERE component = 'CrossBrowserSync'
        AND created_at > NOW() - INTERVAL '${minutes} minutes'
      ORDER BY id DESC
      LIMIT 50
    `)

    if (res.rows.length === 0) {
      console.log(`\n No sync events in the last ${minutes} minutes.\n`)
      console.log(' Try reproducing the issue:')
      console.log('   1. Edit in Chrome')
      console.log('   2. Switch to Firefox')
      console.log('   3. Run this script again\n')
    } else {
      console.log(`\n📊 Cross-Browser Sync Events (last ${minutes} minutes):\n`)

      res.rows.forEach((row, i) => {
        console.log(`${i + 1}. [${row.action}]`)
        console.log(`   Time: ${row.created_at}`)
        console.log(`   Panel: ${row.panel_id}`)
        console.log(`   Version: ${row.version}`)
        if (row.reason) console.log(`   Reason: ${row.reason}`)
        if (row.has_user_edited) console.log(`   Has User Edited: ${row.has_user_edited}`)
        if (row.hash) console.log(`   Hash: ${row.hash}`)
        if (row.remote_hash && row.current_hash) {
          console.log(`   Remote Hash: ${row.remote_hash}`)
          console.log(`   Current Hash: ${row.current_hash}`)
          console.log(`   Hashes Match: ${row.remote_hash === row.current_hash ? '✅ YES' : '❌ NO'}`)
        }

        // Show hash details from hash tracking actions
        const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
        if (metadata?.remoteHash) console.log(`   📊 Remote Hash: ${metadata.remoteHash}`)
        if (metadata?.actualContentHash) console.log(`   📊 Actual Content Hash: ${metadata.actualContentHash}`)
        if (metadata?.canonizedHash) console.log(`   📊 Canonized Hash: ${metadata.canonizedHash}`)
        if (metadata?.oldHash) console.log(`   📊 Old Hash: ${metadata.oldHash}`)
        if (metadata?.loadedHash) console.log(`   📊 Loaded Hash: ${metadata.loadedHash}`)
        if (metadata?.currentHash && metadata?.savedHash) {
          console.log(`   📊 Current Hash: ${metadata.currentHash}`)
          console.log(`   📊 Saved Hash: ${metadata.savedHash}`)
          console.log(`   📊 Has Changes: ${metadata.hasChanges ? '❌ YES' : '✅ NO'}`)
        }

        console.log('')
      })

      console.log(`\n📌 Key Actions to Look For:`)
      console.log(`   - REMOTE_UPDATE_IDENTICAL: Good (no notification)`)
      console.log(`   - REMOTE_UPDATE_DIFFERS: Content changed`)
      console.log(`   - REMOTE_UPDATE_BLOCKED: Notification shown (check Has User Edited)`)
      console.log(`   - REMOTE_UPDATE_APPLYING: Applying remote update`)
      console.log(`   - APPLY_START: Starting to apply remote content`)
      console.log(`   - APPLY_HASH_UPDATE: Hash recalculated after apply (check canonizedHash)`)
      console.log(`   - INIT_HASH_SET: Initial hash set on load (check canonizedHash)`)
      console.log(`   - HAS_UNSAVED_CHECK: Checking for unsaved changes (check hasChanges)`)
      console.log(`   - CONFLICT_BLOCKED: Conflict notification shown`)
      console.log(`   - CONFLICT_RESOLVED_AUTO: Conflict resolved (no notification)`)
      console.log(`   - CONFLICT_DUPLICATE_IGNORED: ✅ Duplicate conflict ignored (version-based)`)
      console.log(`   - CONFLICT_STALE_VERSION_IGNORED: ✅ Stale conflict ignored (already applied)`)
      console.log(`   - CONFLICT_GRACE_PERIOD_DEFERRED: ⚠️ Conflict deferred (user just typed)\n`)
    }

  } catch (err) {
    console.error('Error querying logs:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
})()
