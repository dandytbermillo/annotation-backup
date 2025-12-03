import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

/**
 * GET /api/dashboard/preferences
 * Get user preferences including last workspace information
 */
export async function GET(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    // Query user preferences with last workspace details
    const query = `
      SELECT
        up.id,
        up.user_id,
        up.last_workspace_id,
        up.quick_capture_entry_id,
        up.settings,
        nw.name as workspace_name,
        nw.updated_at as workspace_updated_at,
        i.name as entry_name,
        i.id as entry_id
      FROM user_preferences up
      LEFT JOIN note_workspaces nw ON up.last_workspace_id = nw.id
      LEFT JOIN items i ON nw.item_id = i.id
      WHERE up.user_id = $1
    `

    const result = await serverPool.query(query, [userId])

    if (result.rows.length === 0) {
      // No preferences yet - return empty state
      return NextResponse.json({
        lastWorkspaceId: null,
        lastWorkspace: null,
        quickCaptureEntryId: null,
        settings: {},
      })
    }

    const row = result.rows[0]

    return NextResponse.json({
      lastWorkspaceId: row.last_workspace_id,
      lastWorkspace: row.last_workspace_id ? {
        id: row.last_workspace_id,
        name: row.workspace_name,
        entryName: row.entry_name,
        entryId: row.entry_id,
        updatedAt: row.workspace_updated_at,
      } : null,
      quickCaptureEntryId: row.quick_capture_entry_id,
      settings: row.settings || {},
    })
  } catch (error) {
    console.error('[dashboard/preferences] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch preferences' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/dashboard/preferences
 * Update user preferences
 */
export async function PATCH(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const body = await request.json()
    const { lastWorkspaceId, quickCaptureEntryId, settings } = body

    // Build dynamic update query based on provided fields
    const updates: string[] = []
    const values: any[] = [userId]
    let paramIndex = 2

    if (lastWorkspaceId !== undefined) {
      updates.push(`last_workspace_id = $${paramIndex}`)
      values.push(lastWorkspaceId)
      paramIndex++
    }

    if (quickCaptureEntryId !== undefined) {
      updates.push(`quick_capture_entry_id = $${paramIndex}`)
      values.push(quickCaptureEntryId)
      paramIndex++
    }

    if (settings !== undefined) {
      updates.push(`settings = $${paramIndex}`)
      values.push(JSON.stringify(settings))
      paramIndex++
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Upsert preferences
    const query = `
      INSERT INTO user_preferences (user_id, ${updates.map(u => u.split(' = ')[0]).join(', ')})
      VALUES ($1, ${values.slice(1).map((_, i) => `$${i + 2}`).join(', ')})
      ON CONFLICT (user_id) DO UPDATE SET
        ${updates.join(', ')},
        updated_at = NOW()
      RETURNING *
    `

    const result = await serverPool.query(query, values)

    return NextResponse.json({
      success: true,
      preferences: result.rows[0],
    })
  } catch (error) {
    console.error('[dashboard/preferences] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update preferences' },
      { status: 500 }
    )
  }
}
