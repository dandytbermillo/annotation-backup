/**
 * Recent Panel - Open Recent Item
 *
 * POST /api/panels/recent/open
 * Opens a specific item from the recent list by position or name.
 */

import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

export async function POST(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const body = await request.json()
    const { params } = body
    const position = params?.position // 1-based index
    const name = params?.name

    if (!position && !name) {
      return NextResponse.json({
        success: false,
        error: 'Please specify a position or name',
        message: 'Tell me which item to open (e.g., "the first one" or "Project Notes")',
      }, { status: 400 })
    }

    // Query recent items to find the target
    const recentResult = await serverPool.query(
      `(
        SELECT id, name, 'entry' as type, last_accessed_at as accessed_at
        FROM items
        WHERE user_id = $1
          AND type = 'note'
          AND deleted_at IS NULL
          AND last_accessed_at IS NOT NULL
      )
      UNION ALL
      (
        SELECT nw.id, nw.name, 'workspace' as type, nw.updated_at as accessed_at
        FROM note_workspaces nw
        JOIN items i ON nw.item_id = i.id
        WHERE nw.user_id = $1
          AND nw.is_default = false
          AND i.deleted_at IS NULL
      )
      ORDER BY accessed_at DESC
      LIMIT 20`,
      [userId]
    )

    if (recentResult.rows.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No recent items found.',
      })
    }

    let targetItem

    if (position) {
      // Find by position (1-based)
      const idx = position - 1
      if (idx < 0 || idx >= recentResult.rows.length) {
        return NextResponse.json({
          success: false,
          message: `Position ${position} is out of range. You have ${recentResult.rows.length} recent items.`,
        })
      }
      targetItem = recentResult.rows[idx]
    } else if (name) {
      // Find by name (case-insensitive)
      const nameLower = name.toLowerCase()
      targetItem = recentResult.rows.find(
        (row: { name: string }) => row.name.toLowerCase().includes(nameLower)
      )
      if (!targetItem) {
        return NextResponse.json({
          success: false,
          message: `No recent item matching "${name}" found.`,
        })
      }
    }

    if (!targetItem) {
      return NextResponse.json({
        success: false,
        message: 'Could not find the specified item.',
      })
    }

    // Return navigation data for the item
    if (targetItem.type === 'entry') {
      return NextResponse.json({
        success: true,
        navigateTo: {
          type: 'entry',
          id: targetItem.id,
          name: targetItem.name,
        },
        message: `Opening entry "${targetItem.name}"`,
      })
    } else {
      // Get entry info for workspace
      const wsResult = await serverPool.query(
        `SELECT nw.item_id as entry_id, i.name as entry_name
         FROM note_workspaces nw
         JOIN items i ON nw.item_id = i.id
         WHERE nw.id = $1`,
        [targetItem.id]
      )

      const entryInfo = wsResult.rows[0] || {}

      return NextResponse.json({
        success: true,
        navigateTo: {
          type: 'workspace',
          id: targetItem.id,
          name: targetItem.name,
          entryId: entryInfo.entry_id,
          entryName: entryInfo.entry_name,
        },
        message: `Opening workspace "${targetItem.name}"`,
      })
    }

  } catch (error) {
    console.error('[POST /api/panels/recent/open] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to open recent item' },
      { status: 500 }
    )
  }
}
