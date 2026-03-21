import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import { isValidPanelType, createDefaultPanel } from '@/lib/dashboard/panel-registry'
import type { PanelTypeId } from '@/lib/dashboard/panel-registry'
import { allocateInstanceLabel } from '@/lib/dashboard/instance-label-allocator'

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
        instance_label,
        duplicate_family,
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
      instanceLabel: row.instance_label || null,
      duplicateFamily: row.duplicate_family || null,
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

    // Auto-assign instance label for duplicable panel families (generic allocator)
    const instanceResult = await allocateInstanceLabel(workspaceId, panelType)
    const badge = instanceResult?.label ?? null
    const duplicateFamily = instanceResult?.family ?? null

    // Create the panel
    const query = `
      INSERT INTO workspace_panels (
        workspace_id, panel_type, title,
        position_x, position_y, width, height,
        z_index, config, badge, instance_label, duplicate_family, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
      )
      RETURNING *
    `

    const result = await serverPool.query(query, [
      workspaceId,
      panelType,
      title ?? (badge ? `${defaultPanel.title} ${badge}` : defaultPanel.title),
      positionX ?? defaultPanel.positionX,
      positionY ?? defaultPanel.positionY,
      width ?? defaultPanel.width,
      height ?? defaultPanel.height,
      nextZIndex,
      JSON.stringify(config ?? defaultPanel.config),
      badge,
      badge, // instance_label = same as badge
      duplicateFamily,
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
    // Surface allocator overflow as a clear 409 (conflict) instead of generic 500
    if (error instanceof Error && error.message.includes('Maximum')) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to create panel' },
      { status: 500 }
    )
  }
}
