/**
 * Widget Manager - List Installed Widgets
 *
 * GET /api/widgets/list
 * Returns all installed widgets for the current user.
 *
 * Reference: docs/proposal/chat-navigation/plan/panels/widget_manager/widget-manager-plan.md
 */

import { NextRequest, NextResponse } from 'next/server'
import { listInstalledWidgets } from '@/lib/widgets/widget-store'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'

export async function GET(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    // Get query params
    const { searchParams } = new URL(request.url)
    const enabledOnly = searchParams.get('enabledOnly') === 'true'

    const widgets = await listInstalledWidgets(userId, { enabledOnly })

    return NextResponse.json({
      success: true,
      widgets: widgets.map(w => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        source_type: w.source_type,
        source_ref: w.source_ref,
        version: w.version,
        enabled: w.enabled,
        created_at: w.created_at,
        updated_at: w.updated_at,
        manifest: {
          panelId: w.manifest.panelId,
          panelType: w.manifest.panelType,
          title: w.manifest.title,
          intents: w.manifest.intents.map(i => ({
            name: i.name,
            description: i.description,
            examples: i.examples.slice(0, 3), // Limit examples for UI
          })),
        },
      })),
    })
  } catch (error) {
    console.error('[GET /api/widgets/list] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list widgets' },
      { status: 500 }
    )
  }
}
