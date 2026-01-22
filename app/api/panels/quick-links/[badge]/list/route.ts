/**
 * Quick Links Panel - List Links
 *
 * POST /api/panels/quick-links/[badge]/list
 * Returns all links in the Quick Links panel for the specified badge (A, B, C, D).
 */

import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import { buildQuickLinksViewItems } from '@/lib/chat/parse-quick-links'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ badge: string }> }
) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const { badge } = await params
    const body = await request.json()
    const { panelId: _panelId } = body

    // Find the Quick Links panel in the user's current dashboard
    // First get the user's current entry from their recent activity
    const panelResult = await serverPool.query(
      `SELECT wp.id, wp.config, wp.title
       FROM workspace_panels wp
       JOIN note_workspaces nw ON wp.workspace_id = nw.id
       WHERE nw.user_id = $1
         AND wp.panel_type IN ('links_note', 'links_note_tiptap')
         AND UPPER(wp.badge) = UPPER($2)
         AND wp.deleted_at IS NULL
       ORDER BY wp.created_at DESC
       LIMIT 1`,
      [userId, badge]
    )

    if (panelResult.rows.length === 0) {
      return NextResponse.json({
        success: false,
        message: `No Link Notes panel with badge "${badge.toUpperCase()}" found.`,
      })
    }

    const panel = panelResult.rows[0]
    const contentJson = panel.config?.contentJson

    if (!contentJson) {
      return NextResponse.json({
        success: false,
        message: `Link Notes ${badge.toUpperCase()} needs content. Please add some links in the editor.`,
      })
    }

    // Parse the content to extract items
    const viewItems = buildQuickLinksViewItems(panel.id, contentJson)

    const linkCount = viewItems.filter((i: { type: string }) => i.type === 'link').length
    const noteCount = viewItems.filter((i: { type: string }) => i.type === 'note').length

    return NextResponse.json({
      success: true,
      items: viewItems,
      title: `Link Notes ${badge.toUpperCase()}`,
      subtitle: `${linkCount} link${linkCount !== 1 ? 's' : ''} · ${noteCount} note${noteCount !== 1 ? 's' : ''}`,
      message: `Found ${viewItems.length} items in Link Notes ${badge.toUpperCase()}`,
    })

  } catch (error) {
    console.error('[POST /api/panels/quick-links/[badge]/list] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list link notes' },
      { status: 500 }
    )
  }
}
