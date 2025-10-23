/**
 * Canvas Workspace API - Multi-Note Workspace Persistence
 *
 * GET   /api/canvas/workspace - Fetch all notes that should hydrate at startup
 * PATCH /api/canvas/workspace - Add/remove notes from workspace or update positions
 *
 * This API manages which notes are "open in canvas" and tracks their main
 * panel positions for multi-note workspace layout persistence.
 *
 * Feature flag NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY controls new ordered toolbar behavior.
 *
 * @see docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md
 * @see docs/proposal/canvas_state_persistence/affected_files/implementation.md lines 51-70
 */

import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { validatePosition } from '@/lib/utils/coordinate-validation'

// Ensure Node.js runtime (pg requires Node)
export const runtime = 'nodejs'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// Feature flag for new ordered toolbar behavior (TDD §5.4 line 227)
const FEATURE_ENABLED = process.env.NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY === 'enabled'

interface OpenNote {
  noteId: string
  title?: string
  toolbarSequence?: number
  isFocused?: boolean
  mainPosition: { x: number; y: number }
  updatedAt: string
  openedAt?: string
  version: number
}

interface PanelSnapshot {
  id: string
  noteId: string
  panelId: string
  type: string
  positionXWorld: number
  positionYWorld: number
  widthWorld: number
  heightWorld: number
  zIndex: number
  metadata: Record<string, unknown>
}

interface WorkspaceNote {
  noteId: string
  isOpen: boolean
  mainPosition?: { x: number; y: number }
  expectedVersion?: number
}

/**
 * GET /api/canvas/workspace
 *
 * Returns all notes flagged as "open" in the workspace.
 * These notes will hydrate into the canvas at app startup.
 *
 * When NEXT_PUBLIC_CANVAS_TOOLBAR_REPLAY=enabled:
 *   - Returns ordered toolbar with focus state
 *   - Includes all active panels for snapshot replay
 *
 * Legacy mode (flag disabled):
 *   - Returns unordered open notes
 *
 * Response (new mode):
 * {
 *   success: true,
 *   openNotes: [{ noteId, title, toolbarSequence, isFocused, mainPosition, updatedAt, openedAt }],
 *   panels: [{ id, noteId, panelId, type, positionXWorld, positionYWorld, ... }]
 * }
 *
 * @see TDD §3 lines 162-164
 */
export async function GET(_request: NextRequest) {
  const client = await pool.connect()

  try {
    console.log(`[Canvas Workspace API] Fetching open notes (feature flag: ${FEATURE_ENABLED})`)

    if (FEATURE_ENABLED) {
      // New path: Load ordered toolbar + active panels (TDD §3 lines 162-164)
      const notesResult = await client.query<{
        note_id: string
        toolbar_sequence: number
        is_focused: boolean
        title: string
        main_position_x: string
        main_position_y: string
        opened_at: Date
        updated_at: Date
        version: number
      }>(
        `SELECT
          cwn.note_id,
          cwn.toolbar_sequence,
          cwn.is_focused,
          n.title,
          cwn.main_position_x,
          cwn.main_position_y,
          cwn.opened_at,
          cwn.updated_at,
          cwn.version
        FROM canvas_workspace_notes cwn
        JOIN notes n ON n.id = cwn.note_id
        WHERE cwn.is_open = TRUE
        ORDER BY cwn.toolbar_sequence NULLS LAST, cwn.opened_at ASC`
      )

      const openNotes: OpenNote[] = notesResult.rows.map(row => ({
        noteId: row.note_id,
        title: row.title,
        toolbarSequence: row.toolbar_sequence,
        isFocused: row.is_focused,
        mainPosition: {
          x: parseFloat(row.main_position_x),
          y: parseFloat(row.main_position_y)
        },
        openedAt: row.opened_at instanceof Date
          ? row.opened_at.toISOString()
          : new Date(row.opened_at).toISOString(),
        updatedAt: row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at).toISOString(),
        version: typeof row.version === 'number' ? row.version : Number(row.version ?? 0)
      }))

      // Load all active panels for open notes (TDD §3 line 163)
      const openNoteIds = openNotes.map(n => n.noteId)
      let panels: PanelSnapshot[] = []

      if (openNoteIds.length > 0) {
        const panelsResult = await client.query<{
          id: string
          note_id: string
          panel_id: string
          type: string
          position_x_world: string
          position_y_world: string
          width_world: string
          height_world: string
          z_index: number
          metadata: unknown
        }>(
          `SELECT
            p.id,
            p.note_id,
            p.panel_id,
            p.type,
            p.position_x_world,
            p.position_y_world,
            p.width_world,
            p.height_world,
            p.z_index,
            p.metadata
          FROM panels p
          JOIN canvas_workspace_notes cwn ON cwn.note_id = p.note_id
          WHERE cwn.is_open = TRUE
            AND p.state = 'active'`,
          []
        )

        panels = panelsResult.rows.map(row => ({
          id: row.id,
          noteId: row.note_id,
          panelId: row.panel_id,
          type: row.type,
          positionXWorld: parseFloat(row.position_x_world),
          positionYWorld: parseFloat(row.position_y_world),
          widthWorld: parseFloat(row.width_world),
          heightWorld: parseFloat(row.height_world),
          zIndex: row.z_index,
          metadata: typeof row.metadata === 'object' && row.metadata !== null
            ? row.metadata as Record<string, unknown>
            : {}
        }))
      }

      const versionsResult = await client.query<{ note_id: string; version: number }>(
        `SELECT note_id, version FROM canvas_workspace_notes`
      )
      const versions = versionsResult.rows.map(row => ({
        noteId: row.note_id,
        version: typeof row.version === 'number' ? row.version : Number(row.version ?? 0)
      }))

      console.log(`[Canvas Workspace API] Fetched ${openNotes.length} notes, ${panels.length} panels, ${versions.length} versions`)

      return NextResponse.json({
        success: true,
        openNotes,
        panels,
        versions
      })
    } else {
      // Legacy path: Unordered loading (TDD §5.4 line 228)
      const result = await client.query<{
        note_id: string
        main_position_x: string
        main_position_y: string
        updated_at: Date
        version: number
      }>(
        `SELECT note_id, main_position_x, main_position_y, updated_at, version
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
          : new Date(row.updated_at).toISOString(),
        version: typeof row.version === 'number'
          ? row.version
          : Number(row.version ?? 0)
      }))

      console.log(`[Canvas Workspace API] Fetched ${openNotes.length} open notes (legacy)`)

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

      const versionsResult = await client.query<{ note_id: string; version: number }>(
        `SELECT note_id, version FROM canvas_workspace_notes`
      )
      const versions = versionsResult.rows.map(row => ({
        noteId: row.note_id,
        version: typeof row.version === 'number'
          ? row.version
          : Number(row.version ?? 0)
      }))

      return NextResponse.json({
        success: true,
        openNotes,
        versions
      })
    }
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

    const updated: Array<{ noteId: string; version: number }> = []

    try {
      for (const note of notes) {
        if (note.isOpen) {
          // Get next toolbar_sequence for new notes
          const seqResult = await client.query<{ next_seq: number }>(
            `SELECT COALESCE(MAX(toolbar_sequence), -1) + 1 AS next_seq
             FROM canvas_workspace_notes
             WHERE is_open = TRUE`
          )
          const nextSequence = seqResult.rows[0].next_seq

          // UPSERT: Insert or update to open state
          const params: any[] = [
            note.noteId,
            nextSequence,
            note.mainPosition!.x,
            note.mainPosition!.y,
          ]

          let versionClause = ''
          if (note.expectedVersion !== undefined) {
            params.push(note.expectedVersion)
            versionClause = ` AND canvas_workspace_notes.version = $${params.length}`
          }

          const result = await client.query<{
            version: number
            was_inserted: boolean
          }>(
            `WITH upsert AS (
               INSERT INTO canvas_workspace_notes (
                 note_id,
                 is_open,
                 toolbar_sequence,
                 is_focused,
                 main_position_x,
                 main_position_y,
                 opened_at,
                 updated_at,
                 version
               )
               VALUES ($1, TRUE, $2, FALSE, $3, $4, NOW(), NOW(), 1)
               ON CONFLICT (note_id) DO UPDATE SET
                 is_open = TRUE,
                 toolbar_sequence = CASE
                   WHEN canvas_workspace_notes.toolbar_sequence IS NULL
                   THEN EXCLUDED.toolbar_sequence
                   ELSE canvas_workspace_notes.toolbar_sequence
                 END,
                 main_position_x = EXCLUDED.main_position_x,
                 main_position_y = EXCLUDED.main_position_y,
                 updated_at = NOW(),
                 version = canvas_workspace_notes.version + 1
               RETURNING note_id, version, xmax = 0 AS was_inserted
             )
             SELECT version, was_inserted
             FROM upsert
             WHERE 1=1${versionClause}`,
            params,
          )

          if (result.rows.length === 0) {
            throw new Error('VERSION_CONFLICT')
          }

          const newVersion = result.rows[0]?.version ?? 0
          updated.push({ noteId: note.noteId, version: newVersion })

          // Ensure main panel is marked active on open
          await client.query(
            `UPDATE panels
             SET state = 'active',
                 updated_at = NOW(),
                 revision_token = (COALESCE(revision_token::integer, 0) + 1)::text
             WHERE note_id = $1 AND panel_id = 'main'`,
            [note.noteId],
          )
        } else {
          // Soft delete: Set is_open = false and clear sequence
          const params: any[] = [note.noteId]
          let versionClause = ''
          if (note.expectedVersion !== undefined) {
            params.push(note.expectedVersion)
            versionClause = ` AND version = $2`
          }

          const result = await client.query<{ version: number }>(
            `UPDATE canvas_workspace_notes
             SET is_open = FALSE,
                 toolbar_sequence = NULL,
                 is_focused = FALSE,
                 updated_at = NOW(),
                 version = canvas_workspace_notes.version + 1
             WHERE note_id = $1${versionClause}
             RETURNING version`,
            params,
          )

          if (result.rows.length === 0) {
            throw new Error('VERSION_CONFLICT')
          }

          const newVersion = result.rows[0]?.version ?? 0
          updated.push({ noteId: note.noteId, version: newVersion })

          await client.query(
            `UPDATE panels
             SET state = 'closed',
                 updated_at = NOW(),
                 revision_token = (COALESCE(revision_token::integer, 0) + 1)::text
             WHERE note_id = $1 AND panel_id = 'main'`,
            [note.noteId],
          )
        }

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
        updated: updated.map(entry => entry.noteId),
        versions: updated,
        errors: []
      })
    } catch (txError) {
      await client.query('ROLLBACK')

      if (txError instanceof Error && txError.message === 'VERSION_CONFLICT') {
        return NextResponse.json(
          {
            error: 'Version conflict',
            message: 'Workspace version has advanced. Refetch workspace state and retry.',
          },
          { status: 409 },
        )
      }

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
