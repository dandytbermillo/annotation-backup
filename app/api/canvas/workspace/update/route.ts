/**
 * Canvas Workspace Update API - Batched Updates with Optimistic Locking
 *
 * POST /api/canvas/workspace/update - Apply batched toolbar/position updates
 *
 * Implements optimistic concurrency control and retry logic for conflict resolution.
 *
 * @see docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md §5.2
 * @see docs/proposal/canvas_state_persistence/design/2025-10-19-tdd-blocker-resolution.md §5.6
 */

import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

// Ensure Node.js runtime (pg requires Node)
export const runtime = 'nodejs'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

interface WorkspaceUpdate {
  noteId: string
  isOpen?: boolean         // For close operations
  toolbarSequence?: number
  isFocused?: boolean
  mainPositionX?: number
  mainPositionY?: number
}

interface UpdateRequestBody {
  updates: WorkspaceUpdate[]
  optimisticLock?: boolean
  retryOnConflict?: boolean
  maxRetries?: number
}

/**
 * POST /api/canvas/workspace/update
 *
 * Batch update workspace state with optimistic locking.
 *
 * Request body:
 * {
 *   updates: [
 *     {
 *       noteId: "uuid",
 *       toolbarSequence?: number,
 *       isFocused?: boolean,
 *       mainPositionX?: number,
 *       mainPositionY?: number
 *     }
 *   ],
 *   optimisticLock?: boolean,     // Default: true
 *   retryOnConflict?: boolean,   // Default: true
 *   maxRetries?: number          // Default: 1
 * }
 *
 * Response:
 * {
 *   success: true,
 *   updated: number,
 *   conflicts: number
 * }
 */
export async function POST(request: NextRequest) {
  const client = await pool.connect()

  try {
    const body = await request.json() as UpdateRequestBody

    if (!body || !Array.isArray(body.updates)) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: 'Request must include an "updates" array'
        },
        { status: 400 }
      )
    }

    const {
      updates,
      optimisticLock = true,
      retryOnConflict = true,
      maxRetries = 1
    } = body

    // Validate updates
    for (let i = 0; i < updates.length; i++) {
      const update = updates[i]
      if (!update.noteId || typeof update.noteId !== 'string') {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: `updates[${i}].noteId is required and must be a string`
          },
          { status: 400 }
        )
      }
    }

    let attempt = 0
    let conflicts = 0
    let updated = 0

    while (attempt <= maxRetries) {
      try {
        await client.query('BEGIN')

        for (const update of updates) {
          // Handle close operation (isOpen: false)
          if (update.isOpen === false) {
            if (optimisticLock) {
              const currentResult = await client.query<{ updated_at: Date }>(
                'SELECT updated_at FROM canvas_workspace_notes WHERE note_id = $1',
                [update.noteId]
              )

              if (currentResult.rows.length === 0) {
                continue // Note doesn't exist, skip
              }

              const currentUpdatedAt = currentResult.rows[0].updated_at

              const result = await client.query(
                `UPDATE canvas_workspace_notes
                 SET
                   is_open = FALSE,
                   toolbar_sequence = NULL,
                   is_focused = FALSE,
                   updated_at = NOW()
                 WHERE note_id = $1
                   AND updated_at = $2
                 RETURNING note_id`,
                [update.noteId, currentUpdatedAt]
              )

              if (result.rowCount === 0) {
                throw new Error('CONFLICT')
              }
            } else {
              await client.query(
                `UPDATE canvas_workspace_notes
                 SET
                   is_open = FALSE,
                   toolbar_sequence = NULL,
                   is_focused = FALSE,
                   updated_at = NOW()
                 WHERE note_id = $1`,
                [update.noteId]
              )
            }

            updated++
            continue
          }

          // Handle position/focus updates (isOpen: true or undefined)
          if (optimisticLock) {
            // Read current updated_at for optimistic locking
            const currentResult = await client.query<{ updated_at: Date }>(
              'SELECT updated_at FROM canvas_workspace_notes WHERE note_id = $1',
              [update.noteId]
            )

            if (currentResult.rows.length === 0) {
              // Note doesn't exist in workspace, skip
              continue
            }

            const currentUpdatedAt = currentResult.rows[0].updated_at

            // Attempt update with WHERE clause checking updated_at
            const result = await client.query(
              `UPDATE canvas_workspace_notes
               SET
                 toolbar_sequence = COALESCE($2, toolbar_sequence),
                 is_focused = COALESCE($3, is_focused),
                 main_position_x = COALESCE($4, main_position_x),
                 main_position_y = COALESCE($5, main_position_y),
                 updated_at = NOW()
               WHERE note_id = $1
                 AND updated_at = $6
               RETURNING note_id`,
              [
                update.noteId,
                update.toolbarSequence,
                update.isFocused,
                update.mainPositionX,
                update.mainPositionY,
                currentUpdatedAt
              ]
            )

            if (result.rowCount === 0) {
              // Conflict detected - row was modified by another process
              throw new Error('CONFLICT')
            }
          } else {
            // No optimistic lock - just update
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

          updated++
        }

        // Emit telemetry (TDD §8)
        try {
          await client.query(
            `INSERT INTO debug_logs (component, action, metadata)
             VALUES ($1, $2, $3)`,
            [
              'CanvasWorkspace',
              'workspace_snapshot_persisted',
              JSON.stringify({
                mutationCount: updated,
                offlineQueued: false,
                timestamp: new Date().toISOString()
              })
            ]
          )
        } catch (logError) {
          // Non-fatal: telemetry logging failure
          console.warn('[Workspace Update API] Failed to log telemetry:', logError)
        }

        await client.query('COMMIT')

        console.log(`[Workspace Update API] Updated ${updated} notes (attempt ${attempt})`)

        return NextResponse.json({
          success: true,
          updated,
          conflicts
        })
      } catch (txError) {
        await client.query('ROLLBACK')

        if (txError instanceof Error && txError.message === 'CONFLICT') {
          conflicts++

          if (!retryOnConflict || attempt >= maxRetries) {
            // Max retries exceeded or retry disabled
            console.warn(`[Workspace Update API] Conflict detected, max retries exceeded`)
            return NextResponse.json(
              {
                error: 'Conflict detected',
                details: 'Workspace state was modified by another process',
                conflicts,
                suggestion: 'Refetch workspace state and retry'
              },
              { status: 409 }
            )
          }

          // Retry
          console.warn(`[Workspace Update API] Conflict detected, retrying... (attempt ${attempt + 1})`)
          attempt++
          updated = 0  // Reset counter for retry
          continue
        }

        // Other error - rethrow
        throw txError
      }
    }

    // Should not reach here
    return NextResponse.json(
      {
        error: 'Update failed after retries',
        conflicts
      },
      { status: 500 }
    )
  } catch (error) {
    console.error('[Workspace Update API] POST failed:', error)
    return NextResponse.json(
      {
        error: 'Failed to update workspace',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
