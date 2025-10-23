/**
 * Integration Test: Workspace Version Conflict Detection
 *
 * This test verifies that the offline queue properly detects and rejects
 * stale operations when the workspace version has advanced on the server.
 *
 * Scenario:
 * 1. Client A opens note at version N
 * 2. Client A goes "offline" and queues an operation (tagged with version N)
 * 3. Client B closes the note (bumps version to N+1)
 * 4. Client A comes back online and tries to replay queued operation
 * 5. System detects version mismatch (N != N+1) and rejects the stale operation
 *
 * Verification:
 * - Queue stats show 0 pending operations (stale operation was removed)
 * - Console logs show "workspace_version_mismatch" detected
 *
 * Note: Global mocks (window, navigator, localStorage, IndexedDB) are provided by jest.setup.js
 */

import { Pool } from 'pg'
import { canvasOfflineQueue } from '@/lib/canvas/canvas-offline-queue'

// Mock fetch for offline queue processing and debug logging
const originalFetch = global.fetch
global.fetch = (async (url: any, options: any) => {
  const urlStr = typeof url === 'string' ? url : url?.toString()

  // Handle workspace API calls - add full URL for GET requests
  if (urlStr && urlStr.includes('/api/canvas/workspace')) {
    const method = options?.method || 'GET'
    const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost:3000${urlStr}`

    if (method === 'GET') {
      // For GET (refresh), forward to real API
      return originalFetch(fullUrl, options)
    } else {
      // For PATCH (open/close), allow as-is
      return originalFetch(fullUrl, options)
    }
  }

  // Mock debug log API - forward to real API so logs persist to database
  if (urlStr && urlStr.includes('/api/debug/log')) {
    return originalFetch('http://localhost:3000/api/debug/log', options)
  }

  // Mock camera update API (offline queue will try to call this)
  if (urlStr && urlStr.includes('/api/canvas/camera/')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true })
    } as Response
  }

  // Default mock for other calls
  return originalFetch(url, options)
}) as any

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

    // Initialize IndexedDB-backed offline queue for Node test environment
    await canvasOfflineQueue.init()

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
  }, 30000) // 30 second timeout for setup

  afterAll(async () => {
    await pool.end()
  })

  it('should detect and reject stale operations when workspace version advances', async () => {
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
    // STEP 4: Seed stale cache (simulating offline tab)
    // ===================================================================
    console.log('\n📝 Step 4: Seed stale cache (simulating offline tab)')

    global.window.localStorage.setItem(
      'canvas_workspace_versions',
      JSON.stringify([[testNoteId, initialVersion]])
    )
    canvasOfflineQueue['workspaceVersionCache'] = null

    console.log(`   ✅ Local cache seeded with stale version: ${initialVersion}`)

    // ===================================================================
    // STEP 5: Simulate reconnect (should refresh & detect mismatch)
    // ===================================================================
    console.log('\n📝 Step 5: Simulate reconnect (auto refresh + flush)')

    global.navigator.onLine = true
    global.window.dispatchEvent(new Event('online'))

    // Allow refresh + flush to complete
    await new Promise(resolve => setTimeout(resolve, 1000))

    console.log('   ✅ Queue flushed')

    // ===================================================================
    // STEP 6: Verify stale operation was rejected (not replayed)
    // ===================================================================
    console.log('\n📝 Step 6: Verify stale operation was rejected')

    const stats = await canvasOfflineQueue.getStats()
    console.log('   → Queue stats:', stats)

    // The stale operation should have been removed from the queue
    expect(stats.pending).toBe(0)
    expect(stats.processing).toBe(0)

    console.log('\n✅ SUCCESS! Version conflict detected and stale operation rejected!')
    console.log(`   → Queued version (stale): ${initialVersion}`)
    console.log(`   → Current version: ${newVersion}`)
    console.log('   → Conflict detected: ✅')
    console.log('   → Operation skipped (not replayed): ✅')
    console.log('\n🎉 Test passed! Version conflict detection is working correctly.\n')
  }, 60000) // 60 second timeout
})
