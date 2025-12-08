import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import { isValidPanelType, createDefaultPanel } from '@/lib/dashboard/panel-registry'
import type { PanelTypeId } from '@/lib/dashboard/panel-registry'

/**
 * GET /api/dashboard/panels
 * Get all panels for a workspace
 */
export async function GET(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const workspaceId = request.nextUrl.searchParams.get('workspaceId')
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    // Optional: include hidden panels (for Links Overview which needs to show hidden Quick Links)
    const includeHidden = request.nextUrl.searchParams.get('includeHidden') === 'true'
    // Optional: include deleted panels (for Trash view in Links Overview)
    const includeDeleted = request.nextUrl.searchParams.get('includeDeleted') === 'true'
    // Optional: get ONLY deleted panels (for Trash section)
    const onlyDeleted = request.nextUrl.searchParams.get('onlyDeleted') === 'true'

    // Verify workspace belongs to user
    const workspaceCheck = await serverPool.query(
      'SELECT id FROM note_workspaces WHERE id = $1 AND user_id = $2',
      [workspaceId, userId]
    )

    if (workspaceCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Build filters based on params
    // By default: only visible (is_visible = true) AND not deleted (deleted_at IS NULL)
    // includeHidden=true: include hidden panels (still excludes deleted)
    // includeDeleted=true: include deleted panels too
    // onlyDeleted=true: ONLY deleted panels (for Trash section)
    let visibilityFilter = ''
    let deletedFilter = ''

    if (onlyDeleted) {
      // Only get deleted panels
      deletedFilter = 'AND deleted_at IS NOT NULL'
    } else {
      // Normal filtering
      if (!includeHidden) {
        visibilityFilter = 'AND is_visible = true'
      }
      if (!includeDeleted) {
        deletedFilter = 'AND deleted_at IS NULL'
      }
    }

    const query = `
      SELECT
        id,
        workspace_id,
        panel_type,
        title,
        position_x,
        position_y,
        width,
        height,
        z_index,
        config,
        badge,
        is_visible,
        deleted_at,
        created_at,
        updated_at
      FROM workspace_panels
      WHERE workspace_id = $1 ${visibilityFilter} ${deletedFilter}
      ORDER BY ${onlyDeleted ? 'deleted_at DESC' : 'z_index ASC'}, created_at ASC
    `

    const result = await serverPool.query(query, [workspaceId])

    const panels = result.rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id,
      panelType: row.panel_type,
      title: row.title,
      positionX: row.position_x,
      positionY: row.position_y,
      width: row.width,
      height: row.height,
      zIndex: row.z_index,
      config: row.config || {},
      badge: row.badge || null,
      isVisible: row.is_visible,
      deletedAt: row.deleted_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    return NextResponse.json({ panels })
  } catch (error) {
    console.error('[dashboard/panels] GET Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch panels' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/dashboard/panels
 * Create a new panel in a workspace
 */
export async function POST(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const body = await request.json()
    const { workspaceId, panelType, title, positionX, positionY, width, height, config } = body

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    if (!panelType || !isValidPanelType(panelType)) {
      return NextResponse.json({ error: 'Invalid panel type' }, { status: 400 })
    }

    // Verify workspace belongs to user
    const workspaceCheck = await serverPool.query(
      'SELECT id FROM note_workspaces WHERE id = $1 AND user_id = $2',
      [workspaceId, userId]
    )

    if (workspaceCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Get default panel data
    const defaultPanel = createDefaultPanel(
      panelType as PanelTypeId,
      workspaceId,
      { x: positionX ?? 40, y: positionY ?? 40 },
      title
    )

    // Get max z-index for the workspace
    const zIndexResult = await serverPool.query(
      'SELECT COALESCE(MAX(z_index), 0) + 1 as next_z FROM workspace_panels WHERE workspace_id = $1',
      [workspaceId]
    )
    const nextZIndex = zIndexResult.rows[0].next_z

    // Auto-assign badge for links_note and links_note_tiptap panels
    let badge: string | null = null
    if (panelType === 'links_note' || panelType === 'links_note_tiptap') {
      // Get existing badges for links_note/links_note_tiptap panels in this workspace
      const badgeResult = await serverPool.query(
        `SELECT badge FROM workspace_panels
         WHERE workspace_id = $1 AND panel_type IN ('links_note', 'links_note_tiptap') AND badge IS NOT NULL
         ORDER BY badge ASC`,
        [workspaceId]
      )
      const usedBadges = new Set(badgeResult.rows.map(r => r.badge))

      // Find the next available letter (A-Z)
      for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(65 + i) // A=65, B=66, etc.
        if (!usedBadges.has(letter)) {
          badge = letter
          break
        }
      }
    }

    // Create the panel
    const query = `
      INSERT INTO workspace_panels (
        workspace_id, panel_type, title,
        position_x, position_y, width, height,
        z_index, config, badge, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()
      )
      RETURNING *
    `

    const result = await serverPool.query(query, [
      workspaceId,
      panelType,
      title ?? defaultPanel.title,
      positionX ?? defaultPanel.positionX,
      positionY ?? defaultPanel.positionY,
      width ?? defaultPanel.width,
      height ?? defaultPanel.height,
      nextZIndex,
      JSON.stringify(config ?? defaultPanel.config),
      badge,
    ])

    const row = result.rows[0]
    const panel = {
      id: row.id,
      workspaceId: row.workspace_id,
      panelType: row.panel_type,
      title: row.title,
      positionX: row.position_x,
      positionY: row.position_y,
      width: row.width,
      height: row.height,
      zIndex: row.z_index,
      config: row.config || {},
      badge: row.badge || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }

    return NextResponse.json({ panel }, { status: 201 })
  } catch (error) {
    console.error('[dashboard/panels] POST Error:', error)
    return NextResponse.json(
      { error: 'Failed to create panel' },
      { status: 500 }
    )
  }
}
