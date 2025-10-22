/**
 * E2E Test: Workspace Version Conflict Detection
 *
 * This test verifies that the offline queue properly detects and rejects
 * stale operations when the workspace version has advanced on the server.
 *
 * Uses Playwright to test in real browser with IndexedDB support.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { Pool } from 'pg'

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'annotation_dev',
  user: 'postgres',
  password: 'postgres'
})

// Use an existing note from the database
let testNoteId: string

test.beforeAll(async () => {
  const result = await pool.query(`
    SELECT id FROM notes
    WHERE workspace_id = '13716608-6f27-4e54-b246-5e9ca7b61064'
    LIMIT 1
  `)

  if (result.rows.length === 0) {
    throw new Error('No notes found in database for testing')
  }

  testNoteId = result.rows[0].id
  console.log(`\n✅ Using test note: ${testNoteId}\n`)
})

test.afterAll(async () => {
  // Cleanup debug logs from this test
  await pool.query(`
    DELETE FROM debug_logs
    WHERE metadata->>'noteId' = $1
      AND action = 'workspace_version_mismatch'
      AND created_at > NOW() - INTERVAL '5 minutes'
  `, [testNoteId])

  await pool.end()
})

test.describe('Workspace Version Conflict Detection (E2E)', () => {
  test('should detect version mismatch when offline operation replays with stale version', async ({ browser }) => {
    console.log('\n🔬 Starting E2E workspace version conflict test...\n')

    // ===================================================================
    // SETUP: Create two browser contexts (simulate two clients)
    // ===================================================================
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()

    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      // ===================================================================
      // STEP 1: Client A opens note and gets initial version
      // ===================================================================
      console.log('📝 Step 1: Client A opens note')

      await pageA.goto(`http://localhost:3000/?noteId=${testNoteId}`)
      await pageA.waitForLoadState('networkidle')

      // Get initial workspace version
      const initialVersion = await pageA.evaluate(() => {
        const raw = localStorage.getItem('canvas_workspace_versions')
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed[0]?.[1] ?? null
      })

      console.log(`   ✅ Initial version: ${initialVersion}`)
      expect(initialVersion).not.toBeNull()

      // ===================================================================
      // STEP 2: Enqueue operation BEFORE going offline
      // ===================================================================
      console.log('\n📝 Step 2: Enqueue camera operation (before going offline)')

      // Directly enqueue a camera update operation while still online
      await pageA.evaluate(async (params) => {
        // Import using absolute path that browser can resolve
        const module = await import('/lib/canvas/canvas-offline-queue.ts')
        const queue = module.canvasOfflineQueue

        // Enqueue a camera update with the initial version
        await queue.enqueue({
          type: 'camera_update',
          noteId: params.noteId,
          workspaceVersion: params.version,
          data: {
            camera: { x: 100, y: 100, zoom: 1 },
            userId: 'test-user-a'
          }
        })
      }, { noteId: testNoteId, version: initialVersion })

      console.log(`   ✅ Operation queued with version: ${initialVersion}`)

      // NOW go offline
      console.log('\n📝 Step 2b: Client A goes offline')
      await contextA.setOffline(true)

      // Wait a bit for the operation to be written
      await pageA.waitForTimeout(1000)

      // Verify operation is queued
      const queuedOps = await pageA.evaluate(async () => {
        return new Promise((resolve) => {
          const request = indexedDB.open('canvas_offline_queue', 1)
          request.onsuccess = (e: any) => {
            const db = e.target.result
            const tx = db.transaction(['operations'], 'readonly')
            const store = tx.objectStore('operations')
            store.getAll().onsuccess = (ev: any) => {
              resolve(ev.target.result)
            }
          }
        })
      })

      console.log(`   ✅ Queued ${(queuedOps as any[]).length} operations`)
      expect((queuedOps as any[]).length).toBeGreaterThan(0)

      // ===================================================================
      // STEP 3: Client B bumps version (simpler - just API call)
      // ===================================================================
      console.log('\n📝 Step 3: Client B closes note (version bump)')

      // Use pageB just to make an API call (no full page load)
      await pageB.goto('about:blank')

      const closeResponse = await pageB.evaluate(async (noteId) => {
        const response = await fetch('http://localhost:3000/api/canvas/workspace', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notes: [{
              noteId,
              isOpen: false
            }]
          })
        })
        return response.json()
      }, testNoteId)

      const newVersion = closeResponse.versions[0].version
      console.log(`   ✅ Version bumped to: ${newVersion}`)
      expect(newVersion).toBe(initialVersion + 1)

      // ===================================================================
      // STEP 4: Client A comes back online
      // ===================================================================
      console.log('\n📝 Step 4: Client A comes back online (triggers queue flush)')

      // Bring Client A back online
      await contextA.setOffline(false)

      // Update the version cache to the new version (simulating reconnect/refetch)
      await pageA.evaluate((params) => {
        localStorage.setItem('canvas_workspace_versions',
          JSON.stringify([[params.noteId, params.newVersion]]))
      }, { noteId: testNoteId, newVersion })

      console.log(`   ✅ Updated version cache to: ${newVersion}`)

      // Flush the offline queue manually
      await pageA.evaluate(async () => {
        const module = await import('/lib/canvas/canvas-offline-queue.ts')
        const queue: any = module.canvasOfflineQueue

        // Clear the internal cache so it reloads from localStorage
        queue.workspaceVersionCache = null

        // Flush the queue
        await queue.flush()
      })

      // Wait for async debug logging
      console.log('   ⏳ Waiting for debug logs (3 seconds)...')
      await pageA.waitForTimeout(3000)

      // ===================================================================
      // STEP 5: Verify workspace_version_mismatch was logged
      // ===================================================================
      console.log('\n📝 Step 5: Verify workspace_version_mismatch event')

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
          AND created_at > NOW() - INTERVAL '1 minute'
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

    } finally {
      // Cleanup
      await pageA.close()
      await pageB.close()
      await contextA.close()
      await contextB.close()
    }
  })
})
