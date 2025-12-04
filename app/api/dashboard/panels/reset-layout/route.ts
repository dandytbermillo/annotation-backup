import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import { panelTypeRegistry, type PanelTypeId } from '@/lib/dashboard/panel-registry'

/**
 * POST /api/dashboard/panels/reset-layout
 * Resets the dashboard layout to default panel positions
 *
 * Request body:
 * - workspaceId: string (required) - The workspace to reset
 * - deleteExisting?: boolean (default: true) - Whether to delete existing panels first
 */

// Default panel layout (from implementation plan)
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
]

export async function POST(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const body = await request.json()
    const { workspaceId, deleteExisting = true } = body

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    // Verify workspace exists and belongs to user
    const workspaceCheck = await serverPool.query(
      `SELECT id FROM note_workspaces WHERE id = $1 AND user_id = $2`,
      [workspaceId, userId]
    )

    if (workspaceCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Start transaction
    const client = await serverPool.connect()
    try {
      await client.query('BEGIN')

      // Optionally delete existing panels
      if (deleteExisting) {
        await client.query(
          `DELETE FROM workspace_panels WHERE workspace_id = $1`,
          [workspaceId]
        )
      }

      // Insert default panels
      const insertedPanels = []
      for (const panel of DEFAULT_PANEL_LAYOUT) {
        const panelDef = panelTypeRegistry[panel.panelType]
        const result = await client.query(
          `INSERT INTO workspace_panels (
            workspace_id, panel_type, position_x, position_y, width, height, title, config
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, workspace_id, panel_type, position_x, position_y, width, height, title, config, created_at`,
          [
            workspaceId,
            panel.panelType,
            panel.positionX,
            panel.positionY,
            panel.width,
            panel.height,
            panel.title,
            JSON.stringify(panelDef.defaultConfig || {}),
          ]
        )
        insertedPanels.push(result.rows[0])
      }

      await client.query('COMMIT')

      return NextResponse.json({
        success: true,
        message: 'Dashboard layout reset to defaults',
        panels: insertedPanels.map(p => ({
          id: p.id,
          workspaceId: p.workspace_id,
          panelType: p.panel_type,
          positionX: p.position_x,
          positionY: p.position_y,
          width: p.width,
          height: p.height,
          title: p.title,
          config: p.config,
        })),
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('[dashboard/panels/reset-layout] Error:', error)
    return NextResponse.json(
      { error: 'Failed to reset dashboard layout' },
      { status: 500 }
    )
  }
}
