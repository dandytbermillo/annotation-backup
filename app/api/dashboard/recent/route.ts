import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

/**
 * GET /api/dashboard/recent
 * Get recently accessed workspaces for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const limitParam = request.nextUrl.searchParams.get('limit')
    const limit = Math.min(Math.max(parseInt(limitParam || '10', 10), 1), 50)

    // Get recent workspaces excluding dashboard workspaces (those under Home entry)
    const query = `
      SELECT
        nw.id,
        nw.name,
        nw.item_id as entry_id,
        nw.updated_at as last_accessed_at,
        i.name as entry_name,
        i.is_system
      FROM note_workspaces nw
      LEFT JOIN items i ON nw.item_id = i.id
      WHERE nw.user_id = $1
        AND (i.is_system IS NULL OR i.is_system = FALSE)
      ORDER BY nw.updated_at DESC NULLS LAST
      LIMIT $2
    `

    const result = await serverPool.query(query, [userId, limit])

    const workspaces = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      entryId: row.entry_id,
      entryName: row.entry_name,
      lastAccessedAt: row.last_accessed_at,
    }))

    return NextResponse.json({ workspaces })
  } catch (error) {
    console.error('[dashboard/recent] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recent workspaces' },
      { status: 500 }
    )
  }
}
