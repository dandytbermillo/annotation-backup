import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

/**
 * GET /api/dashboard/info
 * Get dashboard information including Home entry, Dashboard workspace, and Ideas Inbox
 */
export async function GET(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    // Query for Home entry, Dashboard workspace, and Ideas Inbox
    const query = `
      SELECT
        home.id as home_entry_id,
        home.name as home_entry_name,
        dashboard.id as dashboard_workspace_id,
        dashboard.name as dashboard_workspace_name,
        inbox.id as ideas_inbox_id,
        inbox.name as ideas_inbox_name
      FROM items home
      LEFT JOIN note_workspaces dashboard ON dashboard.item_id = home.id
        AND dashboard.name = 'Dashboard'
        AND dashboard.user_id = $1
      LEFT JOIN items inbox ON inbox.parent_id = home.id
        AND inbox.name = 'Ideas Inbox'
        AND inbox.deleted_at IS NULL
      WHERE home.is_system = TRUE
        AND home.name = 'Home'
        AND home.user_id = $1
        AND home.deleted_at IS NULL
      LIMIT 1
    `

    const result = await serverPool.query(query, [userId])

    if (result.rows.length === 0) {
      // No Home entry found - dashboard not set up
      return NextResponse.json(
        { error: 'Dashboard not configured' },
        { status: 404 }
      )
    }

    const row = result.rows[0]

    // If Home exists but Dashboard workspace doesn't, that's an error state
    if (!row.dashboard_workspace_id) {
      return NextResponse.json(
        { error: 'Dashboard workspace not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      homeEntryId: row.home_entry_id,
      homeEntryName: row.home_entry_name,
      dashboardWorkspaceId: row.dashboard_workspace_id,
      dashboardWorkspaceName: row.dashboard_workspace_name,
      ideasInboxId: row.ideas_inbox_id,
      ideasInboxName: row.ideas_inbox_name,
    })
  } catch (error) {
    console.error('[dashboard/info] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard info' },
      { status: 500 }
    )
  }
}
