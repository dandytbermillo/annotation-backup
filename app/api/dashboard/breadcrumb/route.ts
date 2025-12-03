import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

/**
 * GET /api/dashboard/breadcrumb
 * Get breadcrumb information for a workspace (Entry Name / Workspace Name)
 */
export async function GET(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const workspaceId = request.nextUrl.searchParams.get('workspaceId')
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    // Query workspace and its associated entry
    const query = `
      SELECT
        nw.id as workspace_id,
        nw.name as workspace_name,
        i.id as entry_id,
        i.name as entry_name,
        i.icon as entry_icon,
        i.is_system as is_system_entry
      FROM note_workspaces nw
      LEFT JOIN items i ON nw.item_id = i.id
      WHERE nw.id = $1
        AND nw.user_id = $2
    `

    const result = await serverPool.query(query, [workspaceId, userId])

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const row = result.rows[0]

    // Handle case where workspace has no associated entry (legacy workspaces)
    const entryId = row.entry_id || null
    const entryName = row.entry_name || 'Unknown Entry'
    const entryIcon = row.entry_icon || null
    const isSystemEntry = row.is_system_entry || false

    return NextResponse.json({
      entryId,
      entryName,
      entryIcon,
      isSystemEntry,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
    })
  } catch (error) {
    console.error('[dashboard/breadcrumb] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch breadcrumb' },
      { status: 500 }
    )
  }
}
