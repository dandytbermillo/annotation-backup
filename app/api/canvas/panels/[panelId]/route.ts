/**
 * Canvas Panel API - Individual Panel Operations
 *
 * DELETE /api/canvas/panels/:panelId - Delete a specific panel
 *
 * @see docs/proposal/canvas_state_persistence/implementation.md
 */

import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

// Ensure Node.js runtime (pg requires Node)
export const runtime = 'nodejs'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

/**
 * DELETE /api/canvas/panels/:panelId
 *
 * Delete a specific panel by panel_id (TEXT field) or UUID id
 * Accepts optional noteId query parameter for composite key lookup
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ panelId: string }> }
) {
  const client = await pool.connect()

  try {
    const { panelId } = await params
    const { searchParams } = new URL(request.url)
    const noteId = searchParams.get('noteId')

    if (!panelId) {
      return NextResponse.json(
        { error: 'Missing panelId parameter' },
        { status: 400 }
      )
    }

    console.log(`[Canvas Panels API] Deleting panel ${panelId}${noteId ? ` (note: ${noteId})` : ''}`)

    // Try to delete by panel_id (TEXT field) first if noteId is provided
    // Otherwise try UUID id
    let result
    if (noteId) {
      // Delete by composite key (note_id, panel_id)
      result = await client.query(
        'DELETE FROM panels WHERE note_id = $1 AND panel_id = $2 RETURNING id, note_id, panel_id',
        [noteId, panelId]
      )
    } else {
      // Try both panel_id (TEXT) and id (UUID) for backwards compatibility
      // First try as UUID id
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (uuidPattern.test(panelId)) {
        result = await client.query(
          'DELETE FROM panels WHERE id = $1 RETURNING id, note_id, panel_id',
          [panelId]
        )
      } else {
        // Try as panel_id (TEXT) - delete all panels with this panel_id
        result = await client.query(
          'DELETE FROM panels WHERE panel_id = $1 RETURNING id, note_id, panel_id',
          [panelId]
        )
      }
    }

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Panel not found' },
        { status: 404 }
      )
    }

    console.log(`[Canvas Panels API] Successfully deleted panel ${panelId}`)

    return NextResponse.json({
      success: true,
      deleted: {
        id: result.rows[0].id,
        noteId: result.rows[0].note_id,
        panelId: result.rows[0].panel_id
      }
    })
  } catch (error) {
    console.error('[Canvas Panels API] Panel deletion failed:', error)
    return NextResponse.json(
      {
        error: 'Panel deletion failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
