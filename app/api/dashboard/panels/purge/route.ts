import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

/**
 * POST /api/dashboard/panels/purge
 * Permanently delete panels that have been in trash for more than 30 days
 *
 * Query params:
 * - workspaceId: Required - workspace to purge
 * - daysOld: Optional - days threshold (default 30)
 * - dryRun: Optional - if true, just return count without deleting
 */
export async function POST(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const workspaceId = request.nextUrl.searchParams.get('workspaceId')
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const daysOld = parseInt(request.nextUrl.searchParams.get('daysOld') || '30', 10)
    const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true'

    // Verify workspace belongs to user
    const workspaceCheck = await serverPool.query(
      'SELECT id FROM note_workspaces WHERE id = $1 AND user_id = $2',
      [workspaceId, userId]
    )

    if (workspaceCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (dryRun) {
      // Just count how many would be purged
      const countResult = await serverPool.query(
        `SELECT COUNT(*) as count
         FROM workspace_panels
         WHERE workspace_id = $1
           AND deleted_at IS NOT NULL
           AND deleted_at < NOW() - INTERVAL '1 day' * $2`,
        [workspaceId, daysOld]
      )

      return NextResponse.json({
        dryRun: true,
        wouldPurge: parseInt(countResult.rows[0].count, 10),
        daysOld,
      })
    }

    // Actually purge old deleted panels
    const result = await serverPool.query(
      `DELETE FROM workspace_panels
       WHERE workspace_id = $1
         AND deleted_at IS NOT NULL
         AND deleted_at < NOW() - INTERVAL '1 day' * $2
       RETURNING id`,
      [workspaceId, daysOld]
    )

    return NextResponse.json({
      success: true,
      purged: result.rows.length,
      daysOld,
      purgedIds: result.rows.map(r => r.id),
    })
  } catch (error) {
    console.error('[dashboard/panels/purge] POST Error:', error)
    return NextResponse.json(
      { error: 'Failed to purge panels' },
      { status: 500 }
    )
  }
}
