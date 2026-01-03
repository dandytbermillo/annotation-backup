/**
 * POST /api/widgets/uninstall
 *
 * Uninstall a widget by ID.
 * Phase 2 of Widget Manager implementation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import { uninstallWidget, getInstalledWidget } from '@/lib/widgets/widget-store'

export async function POST(request: NextRequest) {
  try {
    // Get user ID
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json(
        { success: false, error: 'Invalid userId' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json()

    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Widget ID is required' },
        { status: 400 }
      )
    }

    // Get widget name for response message
    const widget = await getInstalledWidget(body.id, userId === 'global' ? null : userId)
    const widgetName = widget?.name || 'Unknown widget'

    // Uninstall widget
    const success = await uninstallWidget(body.id, userId === 'global' ? null : userId)

    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Widget not found or already uninstalled' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Widget "${widgetName}" uninstalled successfully`,
    })
  } catch (error) {
    console.error('[api/widgets/uninstall] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
