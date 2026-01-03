/**
 * Widget Instances API
 * POST - Add widget to dashboard (create instance)
 * DELETE - Remove widget from dashboard (delete instance)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  createWidgetInstance,
  deleteWidgetInstance,
  listWidgetInstances,
  getInstalledWidget,
} from '@/lib/widgets/widget-store'

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
