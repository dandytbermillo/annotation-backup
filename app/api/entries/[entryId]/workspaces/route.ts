import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

/**
 * GET /api/entries/[entryId]/workspaces
 * List all workspaces belonging to a specific entry
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const { entryId } = await params

    if (!entryId) {
      return NextResponse.json({ error: 'entryId is required' }, { status: 400 })
    }

    // Verify entry exists and get its details
    const entryResult = await serverPool.query(
      `SELECT id, name, is_system FROM items WHERE id = $1 AND deleted_at IS NULL`,
      [entryId]
    )

    if (entryResult.rows.length === 0) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    const entry = entryResult.rows[0]

    // Get workspaces for this entry
    const workspacesResult = await serverPool.query(
      `SELECT
        nw.id,
        nw.name,
        nw.item_id as entry_id,
        nw.is_default,
        nw.updated_at,
        (SELECT COUNT(*) FROM jsonb_array_elements(nw.payload->'openNotes')) as note_count
      FROM note_workspaces nw
      WHERE nw.user_id = $1
        AND nw.item_id = $2
      ORDER BY nw.is_default DESC, nw.updated_at DESC NULLS LAST`,
      [userId, entryId]
    )

    const workspaces = workspacesResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      entryId: row.entry_id,
      entryName: entry.name,
      isDefault: row.is_default || false,
      updatedAt: row.updated_at,
      noteCount: parseInt(row.note_count, 10) || 0,
    }))

    return NextResponse.json({
      entry: {
        id: entry.id,
        name: entry.name,
        isSystem: entry.is_system || false,
      },
      workspaces,
    })
  } catch (error) {
    console.error('[entries/workspaces] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workspaces' },
      { status: 500 }
    )
  }
}
