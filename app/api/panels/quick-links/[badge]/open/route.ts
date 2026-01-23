/**
 * Quick Links Panel - Open Link
 *
 * POST /api/panels/quick-links/[badge]/open
 * Opens a specific link from the Quick Links panel by position or name.
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
    const { params: reqParams } = body
    const position = reqParams?.position // 1-based index
    const name = reqParams?.name

    if (!position && !name) {
      return NextResponse.json({
        success: false,
        message: 'Please specify a position or name of the link to open.',
      }, { status: 400 })
    }

    // Find the Quick Links panel
    const panelResult = await serverPool.query(
      `SELECT wp.id, wp.config
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
        message: `No Links Panel panel with badge "${badge.toUpperCase()}" found.`,
      })
    }

    const panel = panelResult.rows[0]
    const contentJson = panel.config?.contentJson

    if (!contentJson) {
      return NextResponse.json({
        success: false,
        message: `Links Panel ${badge.toUpperCase()} is empty.`,
      })
    }

    // Parse the content to extract items
    const viewItems = buildQuickLinksViewItems(panel.id, contentJson)

    if (viewItems.length === 0) {
      return NextResponse.json({
        success: false,
        message: `No links found in Links Panel ${badge.toUpperCase()}.`,
      })
    }

    let targetItem

    if (position) {
      // Find by position (1-based)
      const idx = position - 1
      if (idx < 0 || idx >= viewItems.length) {
        return NextResponse.json({
          success: false,
          message: `Position ${position} is out of range. Links Panel ${badge.toUpperCase()} has ${viewItems.length} items.`,
        })
      }
      targetItem = viewItems[idx]
    } else if (name) {
      // Find by name (case-insensitive partial match)
      const nameLower = name.toLowerCase()
      targetItem = viewItems.find(
        (item: { title?: string }) => item.title?.toLowerCase().includes(nameLower)
      )
      if (!targetItem) {
        return NextResponse.json({
          success: false,
          message: `No link matching "${name}" found in Links Panel ${badge.toUpperCase()}.`,
        })
      }
    }

    if (!targetItem) {
      return NextResponse.json({
        success: false,
        message: 'Could not find the specified link.',
      })
    }

    // Return appropriate navigation/action based on item type
    if (targetItem.type === 'link' && targetItem.url) {
      return NextResponse.json({
        success: true,
        openUrl: targetItem.url,
        message: `Opening ${targetItem.title || targetItem.url}`,
      })
    } else if (targetItem.type === 'note' && targetItem.data?.noteId) {
      return NextResponse.json({
        success: true,
        navigateTo: {
          type: 'entry',
          id: targetItem.data.noteId,
          name: targetItem.title || 'Note',
        },
        message: `Opening note "${targetItem.title}"`,
      })
    }

    return NextResponse.json({
      success: false,
      message: 'This item cannot be opened.',
    })

  } catch (error) {
    console.error('[POST /api/panels/quick-links/[badge]/open] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to open link note' },
      { status: 500 }
    )
  }
}
