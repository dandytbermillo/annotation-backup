import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

/**
 * GET /api/dashboard/workspaces/search
 * Search/list workspaces for the current user
 * Used by the workspace link picker
 *
 * Query params:
 * - q: Search query (optional)
 * - entryId: Filter by entry/item ID (optional)
 * - limit: Max results (default 50, max 100)
 */
export async function GET(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const searchQuery = request.nextUrl.searchParams.get('q') || ''
    const entryId = request.nextUrl.searchParams.get('entryId')
    const limit = Math.min(
      parseInt(request.nextUrl.searchParams.get('limit') || '50', 10),
      100
    )

    let query: string
    let values: any[]

    if (searchQuery.trim() && entryId) {
      // Search with query AND entry filter
      query = `
        SELECT
          nw.id,
          nw.name,
          nw.item_id as entry_id,
          nw.is_default,
          nw.updated_at,
          i.name as entry_name,
          i.is_system
        FROM note_workspaces nw
        LEFT JOIN items i ON nw.item_id = i.id
        WHERE nw.user_id = $1
          AND nw.item_id = $2
          AND (
            nw.name ILIKE $3
            OR i.name ILIKE $3
          )
        ORDER BY
          CASE WHEN nw.name ILIKE $3 THEN 0 ELSE 1 END,
          nw.updated_at DESC NULLS LAST
        LIMIT $4
      `
      values = [userId, entryId, `%${searchQuery}%`, limit]
    } else if (entryId) {
      // Filter by entry only (no search query)
      query = `
        SELECT
          nw.id,
          nw.name,
          nw.item_id as entry_id,
          nw.is_default,
          nw.updated_at,
          i.name as entry_name,
          i.is_system
        FROM note_workspaces nw
        LEFT JOIN items i ON nw.item_id = i.id
        WHERE nw.user_id = $1
          AND nw.item_id = $2
        ORDER BY nw.is_default DESC, nw.updated_at DESC NULLS LAST
        LIMIT $3
      `
      values = [userId, entryId, limit]
    } else if (searchQuery.trim()) {
      // Search with query (no entry filter)
      query = `
        SELECT
          nw.id,
          nw.name,
          nw.item_id as entry_id,
          nw.is_default,
          nw.updated_at,
          i.name as entry_name,
          i.is_system
        FROM note_workspaces nw
        LEFT JOIN items i ON nw.item_id = i.id
        WHERE nw.user_id = $1
          AND (
            nw.name ILIKE $2
            OR i.name ILIKE $2
          )
        ORDER BY
          CASE WHEN nw.name ILIKE $2 THEN 0 ELSE 1 END,
          nw.updated_at DESC NULLS LAST
        LIMIT $3
      `
      values = [userId, `%${searchQuery}%`, limit]
    } else {
      // List all workspaces (no filters)
      query = `
        SELECT
          nw.id,
          nw.name,
          nw.item_id as entry_id,
          nw.is_default,
          nw.updated_at,
          i.name as entry_name,
          i.is_system
        FROM note_workspaces nw
        LEFT JOIN items i ON nw.item_id = i.id
        WHERE nw.user_id = $1
        ORDER BY nw.updated_at DESC NULLS LAST
        LIMIT $2
      `
      values = [userId, limit]
    }

    const result = await serverPool.query(query, values)

    const workspaces = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      entryId: row.entry_id,
      entryName: row.entry_name || 'Unknown',
      isDefault: row.is_default || false,
      isSystemEntry: row.is_system || false,
      updatedAt: row.updated_at,
    }))

    return NextResponse.json({ workspaces })
  } catch (error) {
    console.error('[dashboard/workspaces/search] Error:', error)
    return NextResponse.json(
      { error: 'Failed to search workspaces' },
      { status: 500 }
    )
  }
}
