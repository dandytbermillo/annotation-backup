/**
 * Canvas Panels API - Panel Creation
 *
 * POST /api/canvas/panels - Create a new panel with world-space coordinates
 *
 * @see docs/proposal/canvas_state_persistence/implementation.md
 */

import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { debugLog } from '@/lib/utils/debug-logger'

// Ensure Node.js runtime (pg requires Node)
export const runtime = 'nodejs'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

/**
 * POST /api/canvas/panels
 *
 * Create a new panel with world-space coordinates
 *
 * Request body:
 * {
 *   id: string,
 *   noteId: string,
 *   type: 'editor' | 'branch' | 'context' | 'toolbar' | 'annotation',
 *   position: { x: number, y: number },
 *   size: { width: number, height: number },
 *   zIndex?: number,
 *   state?: string,
 *   updatedBy?: string
 * }
 */
export async function POST(request: NextRequest) {
  const client = await pool.connect()
  let id: string | undefined

  try {
    const body = await request.json()
    id = body.id
    const {
      noteId,
      type,
      position,
      size,
      zIndex = 0,
      state = 'active',
      title,
      metadata,
      updatedBy
    } = body

    // Validate required fields
    if (!id || !noteId || !type || !position || !size) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          required: ['id', 'noteId', 'type', 'position', 'size']
        },
        { status: 400 }
      )
    }

    // Validate panel type
    const validTypes = ['editor', 'branch', 'context', 'toolbar', 'annotation']
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        {
          error: 'Invalid panel type',
          validTypes
        },
        { status: 400 }
      )
    }

    // Validate position and size
    if (
      typeof position.x !== 'number' ||
      typeof position.y !== 'number' ||
      typeof size.width !== 'number' ||
      typeof size.height !== 'number'
    ) {
      return NextResponse.json(
        {
          error: 'Invalid position or size values',
          details: 'position.x, position.y, size.width, and size.height must be numbers'
        },
        { status: 400 }
      )
    }

    console.log(`[Canvas Panels API] Creating panel ${id} for note ${noteId}`)

    // Get workspace_id from note
    const workspaceResult = await client.query(
      'SELECT workspace_id FROM notes WHERE id = $1',
      [noteId]
    )

    if (workspaceResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Note not found' },
        { status: 404 }
      )
    }

    const workspaceId = workspaceResult.rows[0].workspace_id

    debugLog({
      component: 'PanelsAPI',
      action: 'inserting_panel',
      metadata: {
        id,
        noteId,
        type,
        position,
        size,
        zIndex,
        state,
        workspaceId,
        updatedBy
      }
    })

    const result = await client.query(
      `INSERT INTO panels (
        id,
        note_id,
        type,
        position_x_world,
        position_y_world,
        width_world,
        height_world,
        z_index,
        state,
        updated_by,
        revision_token,
        schema_version,
        position,
        dimensions,
        workspace_id,
        panel_id,
        title,
        metadata,
        last_accessed,
        updated_at
      )
      VALUES (
        gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8, $9, $10, '1', 1,
        $11::jsonb, $12::jsonb, $13, $1, $14, $15::jsonb, NOW(), NOW()
      )
      ON CONFLICT (note_id, panel_id) DO UPDATE SET
        position_x_world = EXCLUDED.position_x_world,
        position_y_world = EXCLUDED.position_y_world,
        width_world = EXCLUDED.width_world,
        height_world = EXCLUDED.height_world,
        z_index = EXCLUDED.z_index,
        state = EXCLUDED.state,
        updated_by = EXCLUDED.updated_by,
        title = COALESCE(EXCLUDED.title, panels.title),  -- Update title if provided
        metadata = COALESCE(EXCLUDED.metadata, panels.metadata),  -- Update metadata if provided
        revision_token = (COALESCE(panels.revision_token::integer, 0) + 1)::text,
        position = EXCLUDED.position,
        dimensions = EXCLUDED.dimensions,
        updated_at = NOW(),
        last_accessed = NOW()
      RETURNING id, panel_id, revision_token, updated_at`,
      [
        id,  // This is the panel_id (text) like "main" or "branch-xxx"
        noteId,
        type,
        position.x,
        position.y,
        size.width,
        size.height,
        zIndex,
        state,
        updatedBy || null,
        JSON.stringify(position), // Keep JSONB in sync for backward compatibility
        JSON.stringify(size),
        workspaceId,
        title || null,  // $14 - panel title
        metadata ? JSON.stringify(metadata) : null  // $15 - panel metadata (includes annotationType)
      ]
    )

    console.log(`[Canvas Panels API] Successfully created/updated panel ${id}`)

    debugLog({
      component: 'PanelsAPI',
      action: 'panel_created_success',
      metadata: {
        panelId: result.rows[0].panel_id,
        uuid: result.rows[0].id,
        revisionToken: result.rows[0].revision_token
      }
    })

    return NextResponse.json({
      success: true,
      panel: {
        id: result.rows[0].panel_id,  // Return panel_id as 'id' for client compatibility
        revisionToken: result.rows[0].revision_token,
        updatedAt: result.rows[0].updated_at
      }
    })
  } catch (error) {
    console.error('[Canvas Panels API] Panel creation failed:', error)

    debugLog({
      component: 'PanelsAPI',
      action: 'panel_creation_error',
      metadata: {
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      }
    })

    return NextResponse.json(
      {
        error: 'Panel creation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
