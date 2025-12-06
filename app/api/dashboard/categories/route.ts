import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { resolveNoteWorkspaceUserId } from '@/app/api/note-workspaces/user-id'
import type { CategoryPanelData, CategoryEntryReference } from '@/lib/dashboard/panel-registry'

/**
 * GET /api/dashboard/categories
 * Get all category panels across all workspaces for the current user
 * Used by CategoryNavigatorPanel to show all categories
 */
export async function GET(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    // Optional: filter by workspace
    const workspaceId = request.nextUrl.searchParams.get('workspaceId')

    // Get all category panels for the user
    let query = `
      SELECT
        wp.id,
        wp.workspace_id,
        wp.title,
        wp.position_x,
        wp.position_y,
        wp.config,
        wp.created_at
      FROM workspace_panels wp
      JOIN note_workspaces nw ON wp.workspace_id = nw.id
      WHERE wp.panel_type = 'category'
        AND nw.user_id = $1
    `
    const params: (string | null)[] = [userId]

    if (workspaceId) {
      query += ' AND wp.workspace_id = $2'
      params.push(workspaceId)
    }

    query += ' ORDER BY wp.created_at ASC'

    const result = await serverPool.query(query, params)

    // Transform to CategoryPanelData format
    const categories: CategoryPanelData[] = result.rows.map(row => ({
      panelId: row.id,
      title: row.title || 'Untitled Category',
      icon: row.config?.categoryIcon || '📂',
      entryIds: row.config?.entryIds || [],
      visible: row.config?.categoryVisible !== false,
      position: { x: row.position_x, y: row.position_y },
    }))

    // Get entry details for all entry IDs across all categories
    const allEntryIds = [...new Set(categories.flatMap(c => c.entryIds))]

    let entries: CategoryEntryReference[] = []

    if (allEntryIds.length > 0) {
      // Get entry info (items table) and their workspaces
      const entriesQuery = `
        SELECT
          i.id as entry_id,
          i.name as entry_name,
          nw.id as workspace_id,
          nw.name as workspace_name,
          nw.is_default
        FROM items i
        LEFT JOIN note_workspaces nw ON nw.item_id = i.id AND nw.user_id = $1
        WHERE i.id = ANY($2::uuid[])
        ORDER BY i.name ASC, nw.is_default DESC, nw.name ASC
      `

      const entriesResult = await serverPool.query(entriesQuery, [userId, allEntryIds])

      // Group workspaces by entry
      const entryMap = new Map<string, CategoryEntryReference>()

      for (const row of entriesResult.rows) {
        const entryId = row.entry_id

        if (!entryMap.has(entryId)) {
          // Find which category this entry belongs to
          const categoryPanelId = categories.find(c => c.entryIds.includes(entryId))?.panelId || null

          entryMap.set(entryId, {
            entryId,
            entryName: row.entry_name,
            workspaces: [],
            categoryPanelId,
          })
        }

        // Add workspace if exists
        if (row.workspace_id) {
          entryMap.get(entryId)!.workspaces.push({
            workspaceId: row.workspace_id,
            workspaceName: row.workspace_name || 'Default',
            isDefault: row.is_default || false,
          })
        }
      }

      entries = Array.from(entryMap.values())
    }

    // Get uncategorized entries (entries that exist but are not in any category)
    // For now, we don't track uncategorized - entries must be added to categories explicitly

    return NextResponse.json({
      categories,
      entries,
    })
  } catch (error) {
    console.error('[dashboard/categories] GET Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/dashboard/categories/add-entry
 * Add an entry to a category panel
 */
export async function POST(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const body = await request.json()
    const { categoryPanelId, entryId, position } = body

    if (!categoryPanelId || !entryId) {
      return NextResponse.json(
        { error: 'categoryPanelId and entryId are required' },
        { status: 400 }
      )
    }

    // Verify the category panel belongs to user
    const panelCheck = await serverPool.query(
      `SELECT wp.id, wp.config
       FROM workspace_panels wp
       JOIN note_workspaces nw ON wp.workspace_id = nw.id
       WHERE wp.id = $1 AND nw.user_id = $2 AND wp.panel_type = 'category'`,
      [categoryPanelId, userId]
    )

    if (panelCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Category panel not found' }, { status: 404 })
    }

    const currentConfig = panelCheck.rows[0].config || {}
    const currentEntryIds: string[] = currentConfig.entryIds || []

    // Check if entry already exists in this category
    if (currentEntryIds.includes(entryId)) {
      return NextResponse.json({ error: 'Entry already in category' }, { status: 400 })
    }

    // Add entry at specified position or at the end
    const newEntryIds = [...currentEntryIds]
    if (typeof position === 'number' && position >= 0 && position <= newEntryIds.length) {
      newEntryIds.splice(position, 0, entryId)
    } else {
      newEntryIds.push(entryId)
    }

    // Update the panel config
    const updateResult = await serverPool.query(
      `UPDATE workspace_panels
       SET config = config || $1::jsonb, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify({ entryIds: newEntryIds }), categoryPanelId]
    )

    const row = updateResult.rows[0]

    return NextResponse.json({
      success: true,
      panel: {
        id: row.id,
        title: row.title,
        config: row.config,
      },
    })
  } catch (error) {
    console.error('[dashboard/categories] POST Error:', error)
    return NextResponse.json(
      { error: 'Failed to add entry to category' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/dashboard/categories/remove-entry
 * Remove an entry from a category panel
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = resolveNoteWorkspaceUserId(request)
    if (userId === 'invalid') {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }

    const categoryPanelId = request.nextUrl.searchParams.get('categoryPanelId')
    const entryId = request.nextUrl.searchParams.get('entryId')

    if (!categoryPanelId || !entryId) {
      return NextResponse.json(
        { error: 'categoryPanelId and entryId are required' },
        { status: 400 }
      )
    }

    // Verify the category panel belongs to user
    const panelCheck = await serverPool.query(
      `SELECT wp.id, wp.config
       FROM workspace_panels wp
       JOIN note_workspaces nw ON wp.workspace_id = nw.id
       WHERE wp.id = $1 AND nw.user_id = $2 AND wp.panel_type = 'category'`,
      [categoryPanelId, userId]
    )

    if (panelCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Category panel not found' }, { status: 404 })
    }

    const currentConfig = panelCheck.rows[0].config || {}
    const currentEntryIds: string[] = currentConfig.entryIds || []

    // Remove entry
    const newEntryIds = currentEntryIds.filter(id => id !== entryId)

    // Update the panel config
    const updateResult = await serverPool.query(
      `UPDATE workspace_panels
       SET config = config || $1::jsonb, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify({ entryIds: newEntryIds }), categoryPanelId]
    )

    const row = updateResult.rows[0]

    return NextResponse.json({
      success: true,
      panel: {
        id: row.id,
        title: row.title,
        config: row.config,
      },
    })
  } catch (error) {
    console.error('[dashboard/categories] DELETE Error:', error)
    return NextResponse.json(
      { error: 'Failed to remove entry from category' },
      { status: 500 }
    )
  }
}
