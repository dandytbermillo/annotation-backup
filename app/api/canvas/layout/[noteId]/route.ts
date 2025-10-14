/**
 * Canvas Layout API - Per-Note Panel Management
 *
 * GET  /api/canvas/layout/:noteId - Fetch all panels for a note (with world-space coordinates)
 * PATCH /api/canvas/layout/:noteId - Batch update panel positions/dimensions in world-space
 *
 * @see docs/proposal/canvas_state_persistence/implementation.md lines 89-128
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
 * GET /api/canvas/layout/:noteId
 *
 * Fetch all panels for a note with world-space coordinates
 * Returns panels sorted by z_index ascending
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const client = await pool.connect()

  try {
    const { noteId } = await params

    if (!noteId) {
      return NextResponse.json(
        { error: 'Missing noteId parameter' },
        { status: 400 }
      )
    }

    const result = await client.query(
      `SELECT
        id,
        panel_id,
        note_id,
        type,
        position_x_world,
        position_y_world,
        width_world,
        height_world,
        z_index,
        state,
        revision_token,
        schema_version,
        updated_by,
        updated_at,
        last_accessed,
        title,
        metadata
      FROM panels
      WHERE note_id = $1
      ORDER BY z_index ASC, updated_at DESC`,
      [noteId]
    )

    console.log(`[Canvas Layout API] Fetched ${result.rows.length} panels for note ${noteId}`)

    return NextResponse.json({
      success: true,
      noteId,
      panels: result.rows.map(row => ({
        id: row.panel_id,  // Return panel_id (text) as 'id' for client compatibility
        noteId: row.note_id,
        type: row.type,
        position: {
          x: parseFloat(row.position_x_world),
          y: parseFloat(row.position_y_world)
        },
        size: {
          width: parseFloat(row.width_world),
          height: parseFloat(row.height_world)
        },
        zIndex: row.z_index,
        state: row.state,
        revisionToken: row.revision_token,
        schemaVersion: row.schema_version,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at,
        lastAccessed: row.last_accessed,
        title: row.title,
        metadata: row.metadata
      }))
    })
  } catch (error) {
    console.error('[Canvas Layout API] Fetch failed:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch canvas layout',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}

/**
 * PATCH /api/canvas/layout/:noteId
 *
 * Batch update panel positions/dimensions in world-space coordinates
 * Supports revision tokens for conflict detection
 *
 * Request body:
 * {
 *   updates: [
 *     {
 *       id: string,
 *       position?: { x: number, y: number },
 *       size?: { width: number, height: number },
 *       zIndex?: number,
 *       revisionToken?: string,
 *       updatedBy?: string
 *     }
 *   ]
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const client = await pool.connect()

  try {
    const { noteId } = await params
    const { updates } = await request.json()

    if (!noteId) {
      return NextResponse.json(
        { error: 'Missing noteId parameter' },
        { status: 400 }
      )
    }

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { error: 'Invalid updates array' },
        { status: 400 }
      )
    }

    console.log(`[Canvas Layout API] Processing ${updates.length} panel updates for note ${noteId}`)

    const results = []

    await client.query('BEGIN')

    for (const update of updates) {
      try {
        const { id, position, size, zIndex, revisionToken, updatedBy } = update

        if (!id) {
          results.push({
            error: 'Missing panel ID',
            update
          })
          continue
        }

        // Build dynamic update query
        const updateFields: string[] = []
        const values: any[] = []
        let valueIndex = 2 // $1 is panel ID

        if (position !== undefined) {
          updateFields.push(`position_x_world = $${valueIndex++}`)
          values.push(position.x)
          updateFields.push(`position_y_world = $${valueIndex++}`)
          values.push(position.y)
        }

        if (size !== undefined) {
          updateFields.push(`width_world = $${valueIndex++}`)
          values.push(size.width)
          updateFields.push(`height_world = $${valueIndex++}`)
          values.push(size.height)
        }

        if (zIndex !== undefined) {
          updateFields.push(`z_index = $${valueIndex++}`)
          values.push(zIndex)
        }

        if (updatedBy !== undefined) {
          updateFields.push(`updated_by = $${valueIndex++}`)
          values.push(updatedBy)
        }

        // Generate new revision token (simple incrementing version)
        updateFields.push(`revision_token = (COALESCE(revision_token::integer, 0) + 1)::text`)

        // Always update timestamp
        updateFields.push('updated_at = NOW()')
        updateFields.push('last_accessed = NOW()')

        if (updateFields.length === 0) {
          results.push({
            error: 'No fields to update',
            id
          })
          continue
        }

        // Check revision token if provided (optimistic concurrency control)
        // Note: 'id' here is actually panel_id (text), not the UUID id column
        let whereClause = 'panel_id = $1 AND note_id = $' + valueIndex
        values.push(noteId)
        valueIndex++

        if (revisionToken !== undefined) {
          whereClause += ' AND (revision_token IS NULL OR revision_token = $' + valueIndex + ')'
          values.push(revisionToken)
          valueIndex++
        }

        const result = await client.query(
          `UPDATE panels
           SET ${updateFields.join(', ')}
           WHERE ${whereClause}
           RETURNING id, revision_token, updated_at`,
          [id, ...values]
        )

        if (result.rows.length === 0) {
          // Either panel not found or revision conflict
          const checkResult = await client.query(
            'SELECT id, revision_token FROM panels WHERE panel_id = $1 AND note_id = $2',
            [id, noteId]
          )

          if (checkResult.rows.length === 0) {
            results.push({
              error: 'Panel not found',
              id
            })
          } else {
            results.push({
              error: 'Revision conflict',
              id,
              currentRevision: checkResult.rows[0].revision_token,
              providedRevision: revisionToken
            })
          }
        } else {
          results.push({
            success: true,
            id: result.rows[0].id,
            revisionToken: result.rows[0].revision_token,
            updatedAt: result.rows[0].updated_at
          })
        }
      } catch (error) {
        console.error('[Canvas Layout API] Update operation failed:', error)
        results.push({
          error: 'Update failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          update
        })
      }
    }

    await client.query('COMMIT')

    const successCount = results.filter(r => r.success).length
    const failureCount = results.filter(r => r.error).length

    console.log(`[Canvas Layout API] Batch update complete: ${successCount} succeeded, ${failureCount} failed`)

    return NextResponse.json({
      success: true,
      results,
      processed: successCount,
      failed: failureCount
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Canvas Layout API] Batch update failed:', error)
    return NextResponse.json(
      {
        error: 'Batch update failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
