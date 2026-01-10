/**
 * Shared Open Drawer Handler
 *
 * POST /api/panels/open-drawer
 * Opens a panel drawer by semantic panel ID (e.g., "navigator", "quick-capture").
 * This is the fallback handler when visibleWidgets/DB lookup doesn't find the panel.
 *
 * Used by manifests for: Navigator, Quick Capture, Links Overview, Continue, Widget Manager
 */

import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

// Mapping of semantic panel IDs to panel_type values
const PANEL_TYPE_MAP: Record<string, string> = {
  navigator: 'navigator',
  'quick-capture': 'quick_capture',
  'links-overview': 'category_navigator',
  continue: 'continue',
  'widget-manager': 'widget_manager',
}

// Human-readable titles
const PANEL_TITLE_MAP: Record<string, string> = {
  navigator: 'Navigator',
  'quick-capture': 'Quick Capture',
  'links-overview': 'Links Overview',
  continue: 'Continue',
  'widget-manager': 'Widget Manager',
}

export async function POST(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const body = await request.json()
    const { panelId: semanticPanelId, params } = body

    // Validate semantic panel ID
    const panelType = PANEL_TYPE_MAP[semanticPanelId]
    if (!panelType) {
      return NextResponse.json({
        success: false,
        error: 'Unknown panel',
        message: `Panel "${semanticPanelId}" is not a supported widget panel.`,
      }, { status: 400 })
    }

    // Get the dashboard workspace ID
    const dashboardResult = await serverPool.query(
      `SELECT nw.id as workspace_id
       FROM note_workspaces nw
       JOIN items i ON nw.item_id = i.id
       WHERE nw.user_id = $1
         AND nw.is_default = true
         AND i.deleted_at IS NULL
       LIMIT 1`,
      [userId]
    )

    if (dashboardResult.rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Dashboard not found',
        message: 'Could not find your dashboard workspace.',
      }, { status: 404 })
    }

    const dashboardWorkspaceId = dashboardResult.rows[0].workspace_id

    // Find the panel by panel_type in the dashboard
    const panelResult = await serverPool.query(
      `SELECT id, title, panel_type
       FROM workspace_panels
       WHERE workspace_id = $1
         AND panel_type = $2
         AND deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [dashboardWorkspaceId, panelType]
    )

    if (panelResult.rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Panel not found',
        message: `${PANEL_TITLE_MAP[semanticPanelId]} widget is not on your dashboard.`,
      })
    }

    const panel = panelResult.rows[0]
    const panelTitle = panel.title || PANEL_TITLE_MAP[semanticPanelId]

    // Return the drawer open action
    return NextResponse.json({
      success: true,
      action: 'open_panel_drawer',
      panelId: panel.id,
      panelTitle,
      semanticPanelId,
      message: `Opening ${panelTitle}...`,
    })

  } catch (error) {
    console.error('[POST /api/panels/open-drawer] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to open panel drawer' },
      { status: 500 }
    )
  }
}
