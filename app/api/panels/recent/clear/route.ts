/**
 * Recent Panel - Clear Recent History
 *
 * POST /api/panels/recent/clear
 * Clears the recent items history by resetting last_accessed_at timestamps.
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

    // Clear last_accessed_at for all items
    const result = await serverPool.query(
      `UPDATE items
       SET last_accessed_at = NULL
       WHERE user_id = $1
         AND last_accessed_at IS NOT NULL
       RETURNING id`,
      [userId]
    )

    const clearedCount = result.rowCount || 0

    return NextResponse.json({
      success: true,
      message: clearedCount > 0
        ? `Cleared ${clearedCount} recent item${clearedCount !== 1 ? 's' : ''}`
        : 'No recent items to clear',
    })

  } catch (error) {
    console.error('[POST /api/panels/recent/clear] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to clear recent history' },
      { status: 500 }
    )
  }
}
