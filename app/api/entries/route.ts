import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

/**
 * GET /api/entries
 * Get all entries (items that have workspaces) for the current user
 * Used by CategoryPanel to show available entries to add
 */
export async function GET(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    // Get all unique entries (items with workspaces) for this user
    const query = `
      SELECT DISTINCT ON (nw.item_id)
        nw.item_id as id,
        COALESCE(i.name, nw.name) as name
      FROM note_workspaces nw
      LEFT JOIN items i ON nw.item_id = i.id
      WHERE nw.user_id = $1
      ORDER BY nw.item_id, nw.created_at DESC
    `

    const result = await serverPool.query(query, [userId])

    const entries = result.rows.map(row => ({
      id: row.id,
      name: row.name || 'Untitled',
    }))

    return NextResponse.json({ entries })
  } catch (error) {
    console.error('[entries] GET Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    )
  }
}
