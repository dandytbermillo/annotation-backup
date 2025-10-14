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
 * Delete a specific panel by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ panelId: string }> }
) {
  const client = await pool.connect()

  try {
    const { panelId } = await params

    if (!panelId) {
      return NextResponse.json(
        { error: 'Missing panelId parameter' },
        { status: 400 }
      )
    }

    console.log(`[Canvas Panels API] Deleting panel ${panelId}`)

    const result = await client.query(
      'DELETE FROM panels WHERE id = $1 RETURNING id, note_id',
      [panelId]
    )

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
        noteId: result.rows[0].note_id
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
