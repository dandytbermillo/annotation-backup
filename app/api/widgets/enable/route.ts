/**
 * Widget Manager - Enable/Disable Widget
 *
 * POST /api/widgets/enable
 * Body: { id: string, enabled: boolean }
 * Enables or disables a widget for chat integration.
 *
 * Reference: docs/proposal/chat-navigation/plan/panels/widget_manager/widget-manager-plan.md
 */

import { NextRequest, NextResponse } from 'next/server'
import { setWidgetEnabled, getInstalledWidget } from '@/lib/widgets/widget-store'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

export async function POST(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const body = await request.json()
    const { id, enabled } = body

    if (!id || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: id, enabled' },
        { status: 400 }
      )
    }

    // Check widget exists
    const widget = await getInstalledWidget(id, userId)
    if (!widget) {
      return NextResponse.json(
        { success: false, error: 'Widget not found' },
        { status: 404 }
      )
    }

    // Update enabled state
    const success = await setWidgetEnabled(id, userId, enabled)

    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Failed to update widget state' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Widget "${widget.name}" ${enabled ? 'enabled' : 'disabled'} for chat`,
      widget: {
        id: widget.id,
        name: widget.name,
        enabled,
      },
    })
  } catch (error) {
    console.error('[POST /api/widgets/enable] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update widget state' },
      { status: 500 }
    )
  }
}
