/**
 * Canvas Camera State API - Per-Note Camera Persistence
 *
 * GET   /api/canvas/camera/:noteId - Fetch camera state for a note
 * PATCH /api/canvas/camera/:noteId - Update camera state (debounced from client)
 *
 * Supports optional per-user camera state via query parameter ?userId=<uuid>
 * If userId is omitted, returns/updates shared camera state (user_id IS NULL)
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
 * GET /api/canvas/camera/:noteId
 *
 * Fetch camera state for a note (optionally per-user)
 * Query params:
 *   ?userId=<uuid> - Fetch user-specific camera state
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const client = await pool.connect()

  try {
    const { noteId } = await params
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!noteId) {
      return NextResponse.json(
        { error: 'Missing noteId parameter' },
        { status: 400 }
      )
    }

    // Query for user-specific or shared camera state
    const query = userId
      ? 'SELECT * FROM canvas_camera_state WHERE note_id = $1 AND user_id = $2'
      : 'SELECT * FROM canvas_camera_state WHERE note_id = $1 AND user_id IS NULL'

    const values = userId ? [noteId, userId] : [noteId]

    const result = await client.query(query, values)

    if (result.rows.length === 0) {
      // No camera state found, return defaults
      console.log(`[Canvas Camera API] No camera state found for note ${noteId}, returning defaults`)
      return NextResponse.json({
        success: true,
        noteId,
        userId: userId || null,
        camera: {
          x: 0,
          y: 0,
          zoom: 1.0
        },
        exists: false
      })
    }

    const row = result.rows[0]

    console.log(`[Canvas Camera API] Fetched camera state for note ${noteId}`)

    return NextResponse.json({
      success: true,
      noteId,
      userId: row.user_id,
      camera: {
        x: parseFloat(row.camera_x),
        y: parseFloat(row.camera_y),
        zoom: parseFloat(row.zoom_level)
      },
      updatedAt: row.updated_at,
      schemaVersion: row.schema_version,
      exists: true
    })
  } catch (error) {
    console.error('[Canvas Camera API] Fetch failed:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch camera state',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}

/**
 * PATCH /api/canvas/camera/:noteId
 *
 * Update camera state for a note (optionally per-user)
 * Uses UPSERT to create or update camera state
 *
 * Request body:
 * {
 *   camera: {
 *     x: number,
 *     y: number,
 *     zoom: number
 *   },
 *   userId?: string  // Optional: create/update per-user camera state
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const client = await pool.connect()

  try {
    const { noteId } = await params
    const { camera, userId } = await request.json()

    if (!noteId) {
      return NextResponse.json(
        { error: 'Missing noteId parameter' },
        { status: 400 }
      )
    }

    if (!camera || typeof camera.x !== 'number' || typeof camera.y !== 'number' || typeof camera.zoom !== 'number') {
      return NextResponse.json(
        {
          error: 'Invalid camera object',
          details: 'camera must have x, y, and zoom as numbers'
        },
        { status: 400 }
      )
    }

    // Validate zoom range
    if (camera.zoom < 0.5 || camera.zoom > 5.0) {
      return NextResponse.json(
        {
          error: 'Invalid zoom level',
          details: 'zoom must be between 0.5 and 5.0'
        },
        { status: 400 }
      )
    }

    console.log(`[Canvas Camera API] Updating camera state for note ${noteId}`)

    // UPSERT camera state
    const result = await client.query(
      `INSERT INTO canvas_camera_state (
        note_id,
        user_id,
        camera_x,
        camera_y,
        zoom_level,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (note_id, user_id) DO UPDATE SET
        camera_x = EXCLUDED.camera_x,
        camera_y = EXCLUDED.camera_y,
        zoom_level = EXCLUDED.zoom_level,
        updated_at = NOW()
      RETURNING id, updated_at`,
      [
        noteId,
        userId || null,
        camera.x,
        camera.y,
        camera.zoom
      ]
    )

    console.log(`[Canvas Camera API] Successfully updated camera state for note ${noteId}`)

    return NextResponse.json({
      success: true,
      noteId,
      userId: userId || null,
      camera,
      updatedAt: result.rows[0].updated_at
    })
  } catch (error) {
    console.error('[Canvas Camera API] Update failed:', error)
    return NextResponse.json(
      {
        error: 'Failed to update camera state',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
