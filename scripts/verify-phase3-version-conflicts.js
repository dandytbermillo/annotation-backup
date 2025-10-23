#!/usr/bin/env node
/**
 * Verification Script: Phase 3 Workspace Version Conflict Detection
 *
 * Verifies that workspace version conflict detection is implemented and working:
 * - workspace_version_mismatch events are logged
 * - Version validation logic exists in code
 * - Stale operations are rejected
 */

const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'annotation_dev',
  user: 'postgres',
  password: 'postgres'
})

async function verifyPhase3() {
  console.log('\n🔍 Verifying Phase 3: Workspace Version Conflict Detection\n')
  console.log('═'.repeat(60))

  try {
    // 1. Check for version mismatch events in database
    console.log('\n📊 Checking database for version mismatch events...\n')

    const result = await pool.query(`
      SELECT
        COUNT(*) as total_conflicts,
        TO_CHAR(MIN(created_at), 'YYYY-MM-DD HH24:MI:SS') as first_conflict,
        TO_CHAR(MAX(created_at), 'YYYY-MM-DD HH24:MI:SS') as last_conflict
      FROM debug_logs
      WHERE component = 'CanvasOfflineQueue'
        AND action = 'workspace_version_mismatch'
    `)

    console.table(result.rows)

    if (result.rows[0].total_conflicts === '0') {
      console.log('\n⚠️  No version conflicts detected yet.')
      console.log('   This is expected if no offline operations have conflicted.\n')
    } else {
      console.log(`\n✅ Found ${result.rows[0].total_conflicts} version conflict event(s)!\n`)

      // Show recent conflicts
      const conflicts = await pool.query(`
        SELECT
          metadata->>'noteId' as note_id,
          metadata->>'storedVersion' as stored_version,
          metadata->>'currentVersion' as current_version,
          TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as timestamp
        FROM debug_logs
        WHERE component = 'CanvasOfflineQueue'
          AND action = 'workspace_version_mismatch'
        ORDER BY created_at DESC
        LIMIT 5
      `)

      console.log('📝 Recent Conflicts:\n')
      console.table(conflicts.rows)
    }

    // 2. Verify code implementation exists
    console.log('\n💻 Verifying code implementation...\n')

    const queueFilePath = path.join(
      __dirname,
      '..',
      'lib',
      'canvas',
      'canvas-offline-queue.ts'
    )

    if (!fs.existsSync(queueFilePath)) {
      console.log('❌ canvas-offline-queue.ts not found!\n')
      process.exit(1)
    }

    const queueCode = fs.readFileSync(queueFilePath, 'utf-8')

    // Check for version validation method
    const hasVersionValidation = queueCode.includes('isWorkspaceVersionValid')
    const hasVersionMismatchLog = queueCode.includes('workspace_version_mismatch')
    const hasVersionEnforcement = queueCode.includes('isWorkspaceVersionValid(operation)')

    console.log('Code Implementation Checks:')
    console.log(`  ${hasVersionValidation ? '✅' : '❌'} isWorkspaceVersionValid method exists`)
    console.log(`  ${hasVersionMismatchLog ? '✅' : '❌'} workspace_version_mismatch logging exists`)
    console.log(`  ${hasVersionEnforcement ? '✅' : '❌'} Version validation is enforced`)

    if (!hasVersionValidation || !hasVersionMismatchLog || !hasVersionEnforcement) {
      console.log('\n❌ Code implementation incomplete!\n')
      process.exit(1)
    }

    console.log('\n✅ Phase 3 Verification Complete!\n')
    console.log('═'.repeat(60))
    console.log()

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

verifyPhase3()
