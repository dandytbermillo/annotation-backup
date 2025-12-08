import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import { panelTypeRegistry, type PanelTypeId } from '@/lib/dashboard/panel-registry'

/**
 * POST /api/entries/[entryId]/seed-dashboard
 * Seed dashboard panels for an entry
 * Creates a Dashboard workspace with default panels if it doesn't exist
 */

// Default panel layout for entry dashboards
const DEFAULT_PANEL_LAYOUT: Array<{
  panelType: PanelTypeId
  positionX: number
  positionY: number
  width: number
  height: number
  title: string
}> = [
  { panelType: 'continue', positionX: 40, positionY: 40, width: 320, height: 140, title: 'Continue' },
  { panelType: 'navigator', positionX: 40, positionY: 200, width: 280, height: 320, title: 'Navigator' },
  { panelType: 'recent', positionX: 380, positionY: 40, width: 280, height: 220, title: 'Recent' },
  { panelType: 'quick_capture', positionX: 380, positionY: 280, width: 280, height: 180, title: 'Quick Capture' },
  { panelType: 'links_note', positionX: 700, positionY: 40, width: 320, height: 320, title: 'Quick Links' },
]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const client = await serverPool.connect()

  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const { entryId } = await params

    if (!entryId) {
      return NextResponse.json({ error: 'entryId is required' }, { status: 400 })
    }

    await client.query('BEGIN')

    // Verify entry exists
    const entryResult = await client.query(
      `SELECT id, name FROM items WHERE id = $1 AND deleted_at IS NULL`,
      [entryId]
    )

    if (entryResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    // Check if a Dashboard workspace already exists for this entry
    const existingDashboard = await client.query(
      `SELECT id FROM note_workspaces
       WHERE user_id = $1 AND item_id = $2 AND name = 'Dashboard'
       LIMIT 1`,
      [userId, entryId]
    )

    let dashboardWorkspaceId: string

    if (existingDashboard.rows.length > 0) {
      dashboardWorkspaceId = existingDashboard.rows[0].id
    } else {
      // Create Dashboard workspace for this entry
      const defaultPayload = {
        schemaVersion: '1.1.0',
        openNotes: [],
        activeNoteId: null,
        camera: { x: 0, y: 0, scale: 1 },
        panels: [],
        components: [],
      }

      const createResult = await client.query(
        `INSERT INTO note_workspaces (user_id, name, payload, item_id, is_default)
         VALUES ($1, 'Dashboard', $2::jsonb, $3, true)
         RETURNING id`,
        [userId, JSON.stringify(defaultPayload), entryId]
      )

      dashboardWorkspaceId = createResult.rows[0].id
    }

    // Delete existing panels for this workspace (reset)
    await client.query(
      `DELETE FROM workspace_panels WHERE workspace_id = $1`,
      [dashboardWorkspaceId]
    )

    // Insert default panels
    // Track badge assignment for links_note and links_note_tiptap panels (A, B, C...)
    let panelCount = 0
    let linksNoteBadgeIndex = 0
    for (const panel of DEFAULT_PANEL_LAYOUT) {
      const panelDef = panelTypeRegistry[panel.panelType]

      // Assign badge for links_note and links_note_tiptap panels
      let badge: string | null = null
      if (panel.panelType === 'links_note' || panel.panelType === 'links_note_tiptap') {
        badge = String.fromCharCode(65 + linksNoteBadgeIndex) // A=65, B=66, etc.
        linksNoteBadgeIndex++
      }

      await client.query(
        `INSERT INTO workspace_panels (
          workspace_id, panel_type, position_x, position_y, width, height, title, config, badge
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          dashboardWorkspaceId,
          panel.panelType,
          panel.positionX,
          panel.positionY,
          panel.width,
          panel.height,
          panel.title,
          JSON.stringify(panelDef?.defaultConfig || {}),
          badge,
        ]
      )
      panelCount++
    }

    await client.query('COMMIT')

    return NextResponse.json({
      success: true,
      dashboardWorkspaceId,
      panelCount,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[entries/seed-dashboard] Error:', error)
    return NextResponse.json(
      { error: 'Failed to seed dashboard' },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
