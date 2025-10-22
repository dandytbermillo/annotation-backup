/**
 * Integration Test: Workspace Version Conflict Detection
 *
 * This test verifies that the offline queue properly detects and rejects
 * stale operations when the workspace version has advanced on the server.
 *
 * Scenario:
 * 1. Client A opens note at version N
 * 2. Client A goes "offline" and queues an operation (tagged with version N)
 * 3. Client B opens same note and makes a change (bumps version to N+1)
 * 4. Client A comes back online and tries to replay queued operation
 * 5. System detects version mismatch (N != N+1) and logs workspace_version_mismatch
 */

import { Pool } from 'pg'
import { canvasOfflineQueue } from '@/lib/canvas/canvas-offline-queue'

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'annotation_dev',
  user: 'postgres',
  password: 'postgres'
})

const WORKSPACE_ID = '13716608-6f27-4e54-b246-5e9ca7b61064' // Default workspace
const TEST_USER_A = 'test-user-a-' + Date.now()
const TEST_USER_B = 'test-user-b-' + Date.now()

describe('Workspace Version Conflict Detection', () => {
  let testNoteId: string
  let initialVersion: number

  beforeAll(async () => {
    // Set workspace context for database triggers
    await pool.query(`SET app.current_workspace_id = '${WORKSPACE_ID}'`)

    // Find or create a test note
    const existingNote = await pool.query(`
      SELECT id FROM notes
      WHERE workspace_id = $1
      LIMIT 1
    `, [WORKSPACE_ID])

    if (existingNote.rows.length > 0) {
      testNoteId = existingNote.rows[0].id
      console.log(`\n📝 Using existing note: ${testNoteId}\n`)
    } else {
      // Create a test note if none exist
      const newNote = await pool.query(`
        INSERT INTO notes (title, workspace_id, content_text)
        VALUES ('Test Note for Version Conflict', $1, 'Test content')
        RETURNING id
      `, [WORKSPACE_ID])
      testNoteId = newNote.rows[0].id
      console.log(`\n📝 Created new test note: ${testNoteId}\n`)
    }
  })

  afterAll(async () => {
    // Cleanup debug logs
    await pool.query(`
      DELETE FROM debug_logs
      WHERE metadata->>'noteId' = $1
        AND action = 'workspace_version_mismatch'
    `, [testNoteId])
    await pool.end()
  })

  it('should detect and log workspace_version_mismatch when version advances', async () => {
    console.log('\n🔬 Starting workspace version conflict test...\n')

    // ===================================================================
    // STEP 1: Client A opens workspace
    // ===================================================================
    console.log('📝 Step 1: Client A opens workspace')

    const openResp = await fetch('http://localhost:3000/api/canvas/workspace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: [{
          noteId: testNoteId,
          isOpen: true,
          mainPosition: { x: 0, y: 0 }
        }]
      })
    })

    if (!openResp.ok) {
      throw new Error(`Failed to open workspace: ${await openResp.text()}`)
    }

    const openData = await openResp.json()
    console.log('   → Workspace opened:', openData)

    initialVersion = openData.versions[0].version
    console.log(`   ✅ Initial version: ${initialVersion}`)

    // ===================================================================
    // STEP 2: Client B closes workspace (bumps version)
    // ===================================================================
    console.log('\n📝 Step 2: Client B closes workspace (version bump)')

    const closeResp = await fetch('http://localhost:3000/api/canvas/workspace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: [{
          noteId: testNoteId,
          isOpen: false
        }]
      })
    })

    const closeData = await closeResp.json()
    console.log('   → Workspace closed:', closeData)

    const newVersion = closeData.versions[0].version
    expect(newVersion).toBe(initialVersion + 1)
    console.log(`   ✅ Version bumped to: ${newVersion}`)

    // ===================================================================
    // STEP 3: Simulate Client A's stale offline operation
    // ===================================================================
    console.log('\n📝 Step 3: Enqueue stale camera update from Client A')

    // Clear any existing operations
    await canvasOfflineQueue.clear()

    // Enqueue a stale operation (tagged with old version)
    await canvasOfflineQueue.enqueue({
      type: 'camera_update',
      noteId: testNoteId,
      workspaceVersion: initialVersion, // ← Stale version!
      data: {
        camera: { x: 100, y: 100, zoom: 1 },
        userId: TEST_USER_A
      }
    })

    console.log(`   ✅ Enqueued operation with version: ${initialVersion}`)

    // ===================================================================
    // STEP 4: Update version cache to simulate reconnection
    // ===================================================================
    console.log('\n📝 Step 4: Update version cache (simulating reconnect)')

    // Manually set the version cache to the NEW version
    // This simulates what happens when the client reconnects and re-fetches workspace state
    if (!canvasOfflineQueue['workspaceVersionCache']) {
      canvasOfflineQueue['workspaceVersionCache'] = new Map()
    }
    canvasOfflineQueue['workspaceVersionCache'].set(testNoteId, newVersion)

    console.log(`   ✅ Version cache updated to: ${newVersion}`)

    // ===================================================================
    // STEP 5: Flush the queue (trigger version validation)
    // ===================================================================
    console.log('\n📝 Step 5: Flush offline queue (should detect mismatch)')

    await canvasOfflineQueue.flush()

    console.log('   ✅ Queue flushed')

    // ===================================================================
    // STEP 6: Verify workspace_version_mismatch was logged
    // ===================================================================
    console.log('\n📝 Step 6: Verify workspace_version_mismatch event')

    // Wait for async logging
    await new Promise(resolve => setTimeout(resolve, 3000))

    const logResult = await pool.query(`
      SELECT
        component,
        action,
        metadata->>'noteId' as note_id,
        metadata->>'storedVersion' as stored_version,
        metadata->>'currentVersion' as current_version,
        created_at
      FROM debug_logs
      WHERE component = 'CanvasOfflineQueue'
        AND action = 'workspace_version_mismatch'
        AND metadata->>'noteId' = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [testNoteId])

    console.log('\n📊 Database query result:')
    console.table(logResult.rows)

    expect(logResult.rows.length).toBeGreaterThan(0)

    const mismatchLog = logResult.rows[0]
    expect(mismatchLog.action).toBe('workspace_version_mismatch')
    expect(mismatchLog.note_id).toBe(testNoteId)
    expect(parseInt(mismatchLog.stored_version)).toBe(initialVersion)
    expect(parseInt(mismatchLog.current_version)).toBe(newVersion)

    console.log('\n✅ SUCCESS! workspace_version_mismatch detected and logged!')
    console.log(`   → Stored version (stale): ${initialVersion}`)
    console.log(`   → Current version: ${newVersion}`)
    console.log('   → Conflict detected: ✅')
    console.log('\n🎉 Test passed! Version conflict detection is working correctly.\n')
  }, 60000) // 60 second timeout
})
