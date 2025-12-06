import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

interface AncestorEntry {
  entryId: string
  entryName: string
  entryIcon: string | null
  isSystemEntry: boolean
  dashboardWorkspaceId: string | null
}

/**
 * GET /api/dashboard/breadcrumb
 * Get breadcrumb information for a workspace including full ancestor chain
 * Returns: ancestors array (from root to current entry) + workspace info
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
    const workspaceQuery = `
      SELECT
        nw.id as workspace_id,
        nw.name as workspace_name,
        i.id as entry_id,
        i.name as entry_name,
        i.icon as entry_icon,
        i.is_system as is_system_entry,
        i.parent_id as parent_id
      FROM note_workspaces nw
      LEFT JOIN items i ON nw.item_id = i.id
      WHERE nw.id = $1
        AND nw.user_id = $2
    `

    const workspaceResult = await serverPool.query(workspaceQuery, [workspaceId, userId])

    if (workspaceResult.rows.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const row = workspaceResult.rows[0]

    // Handle case where workspace has no associated entry (legacy workspaces)
    const currentEntryId = row.entry_id || null
    const currentEntryName = row.entry_name || 'Unknown Entry'
    const currentEntryIcon = row.entry_icon || null
    const isSystemEntry = row.is_system_entry || false

    // Build ancestor chain using recursive CTE
    const ancestors: AncestorEntry[] = []

    if (currentEntryId) {
      // Use recursive CTE to get all ancestors from current entry up to root
      const ancestorQuery = `
        WITH RECURSIVE ancestors AS (
          -- Base case: start with current entry's parent
          SELECT
            i.id,
            i.name,
            i.icon,
            i.is_system,
            i.parent_id,
            1 as depth
          FROM items i
          WHERE i.id = $1 AND i.deleted_at IS NULL

          UNION ALL

          -- Recursive case: get parent of each ancestor
          SELECT
            p.id,
            p.name,
            p.icon,
            p.is_system,
            p.parent_id,
            a.depth + 1
          FROM items p
          INNER JOIN ancestors a ON p.id = a.parent_id
          WHERE p.deleted_at IS NULL
        )
        SELECT
          a.id as entry_id,
          a.name as entry_name,
          a.icon as entry_icon,
          a.is_system as is_system_entry,
          a.depth,
          -- Get the Dashboard workspace for each ancestor entry
          (
            SELECT nw.id FROM note_workspaces nw
            WHERE nw.item_id = a.id AND nw.name = 'Dashboard' AND nw.user_id = $2
            LIMIT 1
          ) as dashboard_workspace_id
        FROM ancestors a
        ORDER BY a.depth DESC
      `

      const ancestorResult = await serverPool.query(ancestorQuery, [currentEntryId, userId])

      for (const ancestorRow of ancestorResult.rows) {
        ancestors.push({
          entryId: ancestorRow.entry_id,
          entryName: ancestorRow.entry_name,
          entryIcon: ancestorRow.entry_icon,
          isSystemEntry: ancestorRow.is_system_entry || false,
          dashboardWorkspaceId: ancestorRow.dashboard_workspace_id,
        })
      }
    }

    // Response includes:
    // - ancestors: array from root to current entry (for breadcrumb)
    // - current entry and workspace info (for backward compatibility)
    return NextResponse.json({
      // Full ancestor chain (including current entry)
      ancestors,
      // Current entry info (backward compatibility)
      entryId: currentEntryId,
      entryName: currentEntryName,
      entryIcon: currentEntryIcon,
      isSystemEntry,
      // Current workspace info
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
