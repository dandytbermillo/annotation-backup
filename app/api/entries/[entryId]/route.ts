import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

/**
 * GET /api/entries/[entryId]
 * Get entry details by ID
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

    const result = await serverPool.query(
      `SELECT
        id,
        name,
        path,
        parent_id,
        is_system,
        created_at,
        updated_at
      FROM items
      WHERE id = $1 AND deleted_at IS NULL`,
      [entryId]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    const row = result.rows[0]
    const entry = {
      id: row.id,
      name: row.name,
      path: row.path,
      parentId: row.parent_id,
      isSystem: row.is_system || false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }

    return NextResponse.json({ entry })
  } catch (error) {
    console.error('[entries/[entryId]] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch entry' },
      { status: 500 }
    )
  }
}
