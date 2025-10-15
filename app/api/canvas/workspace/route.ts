/**
 * Canvas Workspace API - Multi-Note Workspace Persistence
 *
 * GET   /api/canvas/workspace - Fetch all notes that should hydrate at startup
 * PATCH /api/canvas/workspace - Add/remove notes from workspace or update positions
 *
 * This API manages which notes are "open in canvas" and tracks their main
 * panel positions for multi-note workspace layout persistence.
 *
 * @see docs/proposal/canvas_state_persistence/affected_files/implementation.md lines 51-70
 */

import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { validatePosition, type ValidationError } from '@/lib/utils/coordinate-validation'

// Ensure Node.js runtime (pg requires Node)
export const runtime = 'nodejs'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

interface OpenNote {
  noteId: string
  mainPosition: { x: number; y: number }
  updatedAt: string
}

interface WorkspaceNote {
  noteId: string
  isOpen: boolean
  mainPosition?: { x: number; y: number }
}

/**
 * GET /api/canvas/workspace
 *
 * Returns all notes flagged as "open" in the workspace.
 * These notes will hydrate into the canvas at app startup.
 *
 * Response:
 * {
 *   success: true,
 *   openNotes: [
 *     {
 *       noteId: "uuid",
 *       mainPosition: { x: 2000, y: 1500 },
 *       updatedAt: "2025-10-14T00:00:00Z"
 *     }
 *   ]
 * }
 */
export async function GET(request: NextRequest) {
  const client = await pool.connect()

  try {
    console.log('[Canvas Workspace API] Fetching open notes')

    // Query all notes where is_open = true
    const result = await client.query<{
      note_id: string
      main_position_x: string
      main_position_y: string
      updated_at: Date
    }>(
      `SELECT note_id, main_position_x, main_position_y, updated_at
       FROM canvas_workspace_notes
       WHERE is_open = TRUE
       ORDER BY updated_at DESC`
    )

    const openNotes: OpenNote[] = result.rows.map(row => ({
      noteId: row.note_id,
      mainPosition: {
        x: parseFloat(row.main_position_x),
        y: parseFloat(row.main_position_y)
      },
      updatedAt: row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString()
    }))

    console.log(`[Canvas Workspace API] Fetched ${openNotes.length} open notes`)

    // Log telemetry
    if (openNotes.length > 0) {
      try {
        await client.query(
          `INSERT INTO debug_logs (component, action, metadata)
           VALUES ($1, $2, $3)`,
          [
            'CanvasWorkspace',
            'workspace_loaded',
            JSON.stringify({
              noteCount: openNotes.length,
              timestamp: new Date().toISOString()
            })
          ]
        )
      } catch (logError) {
        // Non-fatal: telemetry logging failure
        console.warn('[Canvas Workspace API] Failed to log telemetry:', logError)
      }
    }

    return NextResponse.json({
      success: true,
      openNotes
    })
  } catch (error) {
    console.error('[Canvas Workspace API] GET failed:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch workspace notes',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}

/**
 * PATCH /api/canvas/workspace
 *
 * Update workspace state: add/remove notes or update main panel positions
 *
 * Request body:
 * {
 *   notes: [
 *     {
 *       noteId: "uuid",
 *       isOpen: true,
 *       mainPosition: { x: 2100, y: 1600 }  // Optional, required when isOpen=true
 *     },
 *     {
 *       noteId: "uuid",
 *       isOpen: false  // Remove from workspace (soft delete)
 *     }
 *   ]
 * }
 *
 * Response:
 * {
 *   success: true,
 *   updated: ["uuid1", "uuid2"],
 *   errors: []  // Field-level validation errors if any
 * }
 */
export async function PATCH(request: NextRequest) {
  const client = await pool.connect()

  try {
    const body = await request.json()

    if (!body || !Array.isArray(body.notes)) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: 'Request must include a "notes" array'
        },
        { status: 400 }
      )
    }

    const notes: WorkspaceNote[] = body.notes

    // Validate all notes before making any changes
    const errors: Record<string, string> = {}

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i]
      const prefix = `notes[${i}]`

      if (!note.noteId || typeof note.noteId !== 'string') {
        errors[`${prefix}.noteId`] = 'Note ID is required and must be a string'
        continue
      }

      if (typeof note.isOpen !== 'boolean') {
        errors[`${prefix}.isOpen`] = 'isOpen is required and must be a boolean'
        continue
      }

      // Validate position when opening a note
      if (note.isOpen) {
        if (!note.mainPosition) {
          errors[`${prefix}.mainPosition`] = 'mainPosition is required when isOpen is true'
          continue
        }

        const posError = validatePosition(note.mainPosition, `${prefix}.mainPosition`)
        if (posError) {
          errors[posError.field] = posError.message
        }
      }
    }

    // Return validation errors if any
    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          fields: errors
        },
        { status: 400 }
      )
    }

    // Apply updates in a transaction
    await client.query('BEGIN')

    const updated: string[] = []

    try {
      for (const note of notes) {
        if (note.isOpen) {
          // UPSERT: Insert or update to open state
          await client.query(
            `INSERT INTO canvas_workspace_notes (
              note_id,
              is_open,
              main_position_x,
              main_position_y,
              updated_at
            )
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (note_id) DO UPDATE SET
              is_open = EXCLUDED.is_open,
              main_position_x = EXCLUDED.main_position_x,
              main_position_y = EXCLUDED.main_position_y,
              updated_at = NOW()`,
            [
              note.noteId,
              true,
              note.mainPosition!.x,
              note.mainPosition!.y
            ]
          )
        } else {
          // Soft delete: Set is_open = false
          await client.query(
            `UPDATE canvas_workspace_notes
             SET is_open = FALSE, updated_at = NOW()
             WHERE note_id = $1`,
            [note.noteId]
          )
        }

        updated.push(note.noteId)

        // Log telemetry for each update
        await client.query(
          `INSERT INTO debug_logs (component, action, metadata)
           VALUES ($1, $2, $3)`,
          [
            'CanvasWorkspace',
            'workspace_updated',
            JSON.stringify({
              noteId: note.noteId,
              isOpen: note.isOpen,
              timestamp: new Date().toISOString()
            })
          ]
        )
      }

      await client.query('COMMIT')

      console.log(`[Canvas Workspace API] Updated ${updated.length} notes`)

      return NextResponse.json({
        success: true,
        updated,
        errors: []
      })
    } catch (txError) {
      await client.query('ROLLBACK')
      throw txError
    }
  } catch (error) {
    console.error('[Canvas Workspace API] PATCH failed:', error)
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
