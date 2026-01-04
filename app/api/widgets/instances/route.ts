/**
 * Widget Instances API
 * POST - Add widget to dashboard (create instance + workspace panel)
 * DELETE - Remove widget from dashboard (delete instance + panel)
 *
 * Phase 3.2: When creating an instance, we also create a workspace_panel
 * with panel_type='sandbox_widget' so it appears on the dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  createWidgetInstance,
  deleteWidgetInstance,
  listWidgetInstances,
  getInstalledWidget,
} from '@/lib/widgets/widget-store'
import { serverPool } from '@/lib/db/pool'

// Default user ID for single-user mode
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000'

/**
 * POST /api/widgets/instances
 * Add an installed widget to a dashboard/workspace
 *
 * Body: {
 *   widgetId: string,      // ID of the installed widget
 *   workspaceId?: string,  // Target workspace (optional)
 *   entryId?: string,      // Target entry (optional)
 *   panelId?: string,      // Custom panel ID (auto-generated if not provided)
 *   config?: object        // Widget-specific config (optional)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { widgetId, workspaceId, entryId, panelId, config } = body

    if (!widgetId) {
      return NextResponse.json(
        { error: 'widgetId is required' },
        { status: 400 }
      )
    }

    // Verify the widget exists
    const widget = await getInstalledWidget(widgetId, DEFAULT_USER_ID)
    if (!widget) {
      return NextResponse.json(
        { error: 'Widget not found or not installed' },
        { status: 404 }
      )
    }

    // Generate panelId if not provided: {widget.slug}-{timestamp}
    const instancePanelId = panelId || `${widget.slug}-${Date.now()}`

    const instance = await createWidgetInstance(widgetId, DEFAULT_USER_ID, {
      workspaceId: workspaceId || null,
      entryId: entryId || null,
      panelId: instancePanelId,
      config: config || null,
    })

    // Phase 3.2: Also create a workspace_panel so the widget appears on the dashboard
    // The panel config includes widgetId, instanceId, and sandbox config from manifest
    const panelConfig = {
      widgetId: widget.id,
      instanceId: instance.id,
      sandbox: widget.manifest.sandbox || null,
    }

    // Find a suitable position for the new panel (simple grid placement)
    // Get existing panels to find next available position
    const existingPanels = await serverPool.query(
      `SELECT position_x, position_y FROM workspace_panels
       WHERE workspace_id = $1 AND is_visible = true AND deleted_at IS NULL
       ORDER BY position_y DESC, position_x DESC LIMIT 1`,
      [workspaceId]
    )

    // Default position: cascade from last panel or start at (24, 24)
    let positionX = 24
    let positionY = 24
    if (existingPanels.rows.length > 0) {
      const lastPanel = existingPanels.rows[0]
      // Place new panel to the right of the last one, or below if too far right
      positionX = (lastPanel.position_x || 0) + 320
      positionY = lastPanel.position_y || 24
      if (positionX > 800) {
        positionX = 24
        positionY = (lastPanel.position_y || 0) + 240
      }
    }

    // Default size based on manifest or fallback
    const defaultWidth = widget.manifest.sandbox?.preferredSize?.width || widget.manifest.sandbox?.minSize?.width || 300
    const defaultHeight = widget.manifest.sandbox?.preferredSize?.height || widget.manifest.sandbox?.minSize?.height || 200

    await serverPool.query(
      `INSERT INTO workspace_panels
       (workspace_id, panel_type, title, position_x, position_y, width, height, z_index, config, is_visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        workspaceId,
        'sandbox_widget',
        widget.name,
        positionX,
        positionY,
        defaultWidth,
        defaultHeight,
        10, // z_index
        JSON.stringify(panelConfig),
        true,
      ]
    )

    return NextResponse.json({
      success: true,
      instance,
      // Include widget info for convenience
      widget: {
        id: widget.id,
        name: widget.name,
        slug: widget.slug,
      },
    })
  } catch (error) {
    console.error('[api/widgets/instances] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to add widget to dashboard' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/widgets/instances
 * Remove a widget instance from dashboard
 *
 * Body: { instanceId: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { instanceId } = body

    if (!instanceId) {
      return NextResponse.json(
        { error: 'instanceId is required' },
        { status: 400 }
      )
    }

    const deleted = await deleteWidgetInstance(instanceId, DEFAULT_USER_ID)

    if (!deleted) {
      return NextResponse.json(
        { error: 'Instance not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[api/widgets/instances] DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to remove widget from dashboard' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/widgets/instances?workspaceId=...
 * List widget instances for a workspace
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId query parameter is required' },
        { status: 400 }
      )
    }

    const instances = await listWidgetInstances(workspaceId, DEFAULT_USER_ID)

    return NextResponse.json({ instances })
  } catch (error) {
    console.error('[api/widgets/instances] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to list widget instances' },
      { status: 500 }
    )
  }
}
