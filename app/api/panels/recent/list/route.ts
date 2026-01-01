/**
 * Recent Panel - List Recent Items
 *
 * POST /api/panels/recent/list
 * Returns recently accessed entries and workspaces.
 */

import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

interface RecentItem {
  id: string
  type: 'entry' | 'workspace'
  name: string
  parentName?: string
  accessedAt: string
}

export async function POST(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const body = await request.json()
    const { params } = body
    const limit = params?.limit || 10
    const typeFilter = params?.type || 'all' // 'entry', 'workspace', or 'all'

    const items: RecentItem[] = []

    // Query recent entries (from items table)
    if (typeFilter === 'all' || typeFilter === 'entry') {
      const entriesResult = await serverPool.query(
        `SELECT i.id, i.name, i.last_accessed_at, p.name as parent_name
         FROM items i
         LEFT JOIN items p ON i.parent_id = p.id
         WHERE i.user_id = $1
           AND i.type = 'note'
           AND i.deleted_at IS NULL
           AND i.last_accessed_at IS NOT NULL
         ORDER BY i.last_accessed_at DESC
         LIMIT $2`,
        [userId, limit]
      )

      for (const row of entriesResult.rows) {
        items.push({
          id: row.id,
          type: 'entry',
          name: row.name,
          parentName: row.parent_name || undefined,
          accessedAt: row.last_accessed_at,
        })
      }
    }

    // Query recent workspaces (from note_workspaces table)
    if (typeFilter === 'all' || typeFilter === 'workspace') {
      const workspacesResult = await serverPool.query(
        `SELECT nw.id, nw.name, nw.updated_at as accessed_at, i.name as entry_name
         FROM note_workspaces nw
         JOIN items i ON nw.item_id = i.id
         WHERE nw.user_id = $1
           AND nw.is_default = false
           AND i.deleted_at IS NULL
         ORDER BY nw.updated_at DESC
         LIMIT $2`,
        [userId, limit]
      )

      for (const row of workspacesResult.rows) {
        items.push({
          id: row.id,
          type: 'workspace',
          name: row.name,
          parentName: row.entry_name || undefined,
          accessedAt: row.accessed_at,
        })
      }
    }

    // Sort combined results by access time
    items.sort((a, b) =>
      new Date(b.accessedAt).getTime() - new Date(a.accessedAt).getTime()
    )

    // Limit to requested count
    const finalItems = items.slice(0, limit)

    return NextResponse.json({
      success: true,
      items: finalItems.map(item => ({
        id: item.id,
        type: item.type === 'entry' ? 'note' : 'link',
        title: item.name,
        subtitle: item.parentName,
        data: {
          itemType: item.type,
          id: item.id,
          name: item.name,
          parentName: item.parentName,
        },
      })),
      title: 'Recent Items',
      subtitle: `${finalItems.length} item${finalItems.length !== 1 ? 's' : ''}`,
      message: finalItems.length > 0
        ? `Found ${finalItems.length} recent items`
        : 'No recent items found',
    })

  } catch (error) {
    console.error('[POST /api/panels/recent/list] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list recent items' },
      { status: 500 }
    )
  }
}
