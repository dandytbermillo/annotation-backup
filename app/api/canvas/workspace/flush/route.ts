/**
 * Canvas Workspace Flush API - Emergency sendBeacon Handler
 *
 * POST /api/canvas/workspace/flush - Emergency flush for beforeunload
 *
 * Accepts sendBeacon payloads and applies updates without optimistic locking
 * to ensure data is saved even if the page is closing.
 *
 * @see docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md §5.2
 * @see docs/proposal/canvas_state_persistence/design/2025-10-19-tdd-blocker-resolution.md §5.7
 */

import { NextRequest } from 'next/server'
import { Pool } from 'pg'

// Ensure Node.js runtime (pg requires Node)
export const runtime = 'nodejs'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

interface WorkspaceUpdate {
  noteId: string
  toolbarSequence?: number
  isFocused?: boolean
  mainPositionX?: number
  mainPositionY?: number
}

/**
 * POST /api/canvas/workspace/flush
 *
 * Emergency flush endpoint for navigator.sendBeacon.
 * Skips optimistic locking to ensure updates are applied.
 *
 * Request body:
 * [
 *   {
 *     noteId: "uuid",
 *     toolbarSequence?: number,
 *     isFocused?: boolean,
 *     mainPositionX?: number,
 *     mainPositionY?: number
 *   }
 * ]
 *
 * Response: 204 No Content (sendBeacon doesn't wait for response)
 */
export async function POST(request: NextRequest) {
  const client = await pool.connect()

  try {
    const updates = await request.json() as WorkspaceUpdate[]

    if (!Array.isArray(updates)) {
      // Return 204 anyway - sendBeacon doesn't handle errors
      console.warn('[Workspace Flush API] Invalid payload - expected array')
      return new Response(null, { status: 204 })
    }

    console.log(`[Workspace Flush API] Emergency flush: ${updates.length} updates`)

    await client.query('BEGIN')

    try {
      for (const update of updates) {
        if (!update.noteId) {
          continue
        }

        // Apply update without optimistic lock (emergency flush)
        await client.query(
          `UPDATE canvas_workspace_notes
           SET
             toolbar_sequence = COALESCE($2, toolbar_sequence),
             is_focused = COALESCE($3, is_focused),
             main_position_x = COALESCE($4, main_position_x),
             main_position_y = COALESCE($5, main_position_y),
             updated_at = NOW()
           WHERE note_id = $1`,
          [
            update.noteId,
            update.toolbarSequence,
            update.isFocused,
            update.mainPositionX,
            update.mainPositionY
          ]
        )
      }

      // Emit telemetry
      try {
        await client.query(
          `INSERT INTO debug_logs (component, action, metadata)
           VALUES ($1, $2, $3)`,
          [
            'CanvasWorkspace',
            'workspace_emergency_flush',
            JSON.stringify({
              updateCount: updates.length,
              timestamp: new Date().toISOString()
            })
          ]
        )
      } catch (logError) {
        // Non-fatal: telemetry logging failure
        console.warn('[Workspace Flush API] Failed to log telemetry:', logError)
      }

      await client.query('COMMIT')

      console.log(`[Workspace Flush API] Emergency flush completed: ${updates.length} updates`)

      // Return 204 No Content (sendBeacon spec)
      return new Response(null, { status: 204 })
    } catch (txError) {
      await client.query('ROLLBACK')
      console.error('[Workspace Flush API] Transaction failed:', txError)

      // Return 204 anyway - sendBeacon can't handle errors
      return new Response(null, { status: 204 })
    }
  } catch (error) {
    console.error('[Workspace Flush API] POST failed:', error)

    // Return 204 anyway - sendBeacon doesn't wait for response
    return new Response(null, { status: 204 })
  } finally {
    client.release()
  }
}
