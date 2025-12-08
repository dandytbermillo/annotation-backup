import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import { panelTypeRegistry, type PanelTypeId } from '@/lib/dashboard/panel-registry'

/**
 * POST /api/entries/create-for-workspace
 * Create an entry for a legacy workspace that doesn't have one
 * This is used when clicking a Quick Link that points to a workspace without an entry
 *
 * Body:
 * - workspaceId: string - The workspace to create an entry for
 * - workspaceName: string - The name to use for the entry
 * - parentEntryId?: string - Optional parent entry ID (for hierarchical entries)
 */

// Default panel layout for new entry dashboards
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

export async function POST(request: NextRequest) {
  const client = await serverPool.connect()

  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const body = await request.json()
    const { workspaceId, workspaceName, parentEntryId, badge } = body

    if (!workspaceId || !workspaceName) {
      return NextResponse.json(
        { error: 'workspaceId and workspaceName are required' },
        { status: 400 }
      )
    }

    await client.query('BEGIN')

    // Verify workspace exists and get current item_id
    const workspaceResult = await client.query(
      `SELECT id, name, item_id FROM note_workspaces WHERE id = $1 AND user_id = $2`,
      [workspaceId, userId]
    )

    if (workspaceResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const workspace = workspaceResult.rows[0]

    // If workspace already has an item_id that's not the Legacy folder, return that entry
    if (workspace.item_id) {
      const existingEntry = await client.query(
        `SELECT id, name, path, parent_id, is_system, created_at, updated_at
         FROM items WHERE id = $1 AND deleted_at IS NULL`,
        [workspace.item_id]
      )

      if (existingEntry.rows.length > 0) {
        const row = existingEntry.rows[0]
        // Check if it's not a Legacy Workspaces folder
        if (row.name !== 'Legacy Workspaces') {
          await client.query('ROLLBACK')
          return NextResponse.json({
            entry: {
              id: row.id,
              name: row.name,
              path: row.path,
              parentId: row.parent_id,
              isSystem: row.is_system || false,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
            alreadyExists: true,
          })
        }
      }
    }

    // Determine parent entry
    // If parentEntryId is provided, use that entry as the parent
    // Otherwise, fall back to Knowledge Base folder
    let parentId: string | null = null
    let parentPath = ''

    if (parentEntryId) {
      // Use the provided parent entry
      const parentResult = await client.query(
        `SELECT id, path FROM items WHERE id = $1 AND deleted_at IS NULL`,
        [parentEntryId]
      )
      if (parentResult.rows.length > 0) {
        parentId = parentResult.rows[0].id
        parentPath = parentResult.rows[0].path
      }
    }

    // Fall back to Knowledge Base if no parent specified or not found
    if (!parentId) {
      const kbResult = await client.query(
        `SELECT id, path FROM items WHERE path = '/knowledge-base' AND deleted_at IS NULL LIMIT 1`
      )
      if (kbResult.rows.length > 0) {
        parentId = kbResult.rows[0].id
        parentPath = kbResult.rows[0].path
      }
    }

    // Get the default workspace from workspaces table (required for items.workspace_id)
    const defaultWorkspaceResult = await client.query(
      `SELECT id FROM workspaces WHERE is_default = true LIMIT 1`
    )
    if (defaultWorkspaceResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { error: 'No default workspace found' },
        { status: 500 }
      )
    }
    const defaultWorkspaceId = defaultWorkspaceResult.rows[0].id

    // Generate unique path for the new entry
    const basePath = parentPath || ''

    // If badge is provided, use it as suffix (e.g., "test5 A")
    // Otherwise fall back to numeric suffix for conflicts
    let entryPath = badge
      ? `${basePath}/${workspaceName} ${badge}`
      : `${basePath}/${workspaceName}`
    let entryName = badge
      ? `${workspaceName} ${badge}`
      : workspaceName
    let counter = 0

    // Check for path conflicts
    while (true) {
      const pathCheck = await client.query(
        `SELECT id FROM items WHERE path = $1 AND deleted_at IS NULL`,
        [entryPath]
      )
      if (pathCheck.rows.length === 0) break
      counter++
      // If badge is provided, append number after badge (e.g., "test5 A2")
      // Otherwise use plain number suffix (e.g., "test5 1")
      if (badge) {
        entryPath = `${basePath}/${workspaceName} ${badge}${counter}`
        entryName = `${workspaceName} ${badge}${counter}`
      } else {
        entryPath = `${basePath}/${workspaceName} ${counter}`
        entryName = `${workspaceName} ${counter}`
      }
      if (counter > 100) {
        entryPath = `${basePath}/${workspaceName}-${Date.now()}`
        entryName = `${workspaceName}-${Date.now()}`
        break
      }
    }
    const createEntryResult = await client.query(
      `INSERT INTO items (type, parent_id, path, name, is_system, workspace_id, created_at, updated_at)
       VALUES ('folder', $1, $2, $3, false, $4, NOW(), NOW())
       RETURNING id, name, path, parent_id, is_system, created_at, updated_at`,
      [parentId, entryPath, entryName, defaultWorkspaceId]
    )

    const newEntry = createEntryResult.rows[0]

    // Update the workspace to point to this entry
    await client.query(
      `UPDATE note_workspaces SET item_id = $1, updated_at = NOW() WHERE id = $2`,
      [newEntry.id, workspaceId]
    )

    // Create a Dashboard workspace for this entry
    const defaultPayload = {
      schemaVersion: '1.1.0',
      openNotes: [],
      activeNoteId: null,
      camera: { x: 0, y: 0, scale: 1 },
      panels: [],
      components: [],
    }

    // Dashboard is a separate view (not in workspace dropdown), so is_default = false
    // The original workspace (e.g., "test4") keeps is_default = true
    const dashboardResult = await client.query(
      `INSERT INTO note_workspaces (user_id, name, payload, item_id, is_default)
       VALUES ($1, 'Dashboard', $2::jsonb, $3, false)
       RETURNING id`,
      [userId, JSON.stringify(defaultPayload), newEntry.id]
    )

    const dashboardWorkspaceId = dashboardResult.rows[0].id

    // Seed dashboard panels
    // Track badge assignment for links_note panels (A, B, C...)
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
    }

    // Set original workspace (e.g., "test4") as is_default = true
    // It's the default workspace in the dropdown (cannot be deleted)
    // Dashboard is separate from the dropdown
    await client.query(
      `UPDATE note_workspaces SET is_default = true WHERE id = $1`,
      [workspaceId]
    )

    await client.query('COMMIT')

    return NextResponse.json({
      entry: {
        id: newEntry.id,
        name: newEntry.name,
        path: newEntry.path,
        parentId: newEntry.parent_id,
        isSystem: newEntry.is_system || false,
        createdAt: newEntry.created_at,
        updatedAt: newEntry.updated_at,
      },
      dashboardWorkspaceId,
      defaultWorkspaceId: workspaceId,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[entries/create-for-workspace] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create entry for workspace' },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}
