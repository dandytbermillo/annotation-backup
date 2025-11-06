import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { WorkspaceStore } from '@/lib/workspace/workspace-store'

interface SkippedItem {
  id: string
  reason: string
}

export async function POST(request: NextRequest) {
  const client = await serverPool.connect()

  try {
    const body = await request.json()
    const { itemIds, targetFolderId } = body
    const bodyWorkspaceId = typeof body.workspaceId === 'string' && body.workspaceId.length > 0 ? body.workspaceId : undefined
    const headerWorkspaceId = request.headers.get('x-overlay-workspace-id') ?? undefined
    const requestedWorkspaceId = bodyWorkspaceId ?? headerWorkspaceId ?? null

    // Validate request
    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json(
        { error: 'itemIds array is required' },
        { status: 400 }
      )
    }

    if (!targetFolderId) {
      return NextResponse.json(
        { error: 'targetFolderId is required' },
        { status: 400 }
      )
    }

    // Get workspace ID for validation
    let workspaceId: string
    if (requestedWorkspaceId) {
      const exists = await client.query('SELECT 1 FROM workspaces WHERE id = $1', [requestedWorkspaceId])
      if (exists.rowCount === 0) {
        client.release()
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }
      workspaceId = requestedWorkspaceId
    } else {
      try {
        workspaceId = await WorkspaceStore.getDefaultWorkspaceId(serverPool)
      } catch (e) {
        console.error('Failed to get workspace ID:', e)
        client.release()
        return NextResponse.json(
          { error: 'Failed to get workspace' },
          { status: 500 }
        )
      }
    }

    await client.query('SELECT set_config($1, $2, false)', [
      'app.current_workspace_id',
      workspaceId,
    ])

    // BEGIN TRANSACTION
    await client.query('BEGIN')

    try {
      // Validate target folder exists and belongs to workspace
      const folderCheck = await client.query(
        `SELECT id, path FROM items
         WHERE id = $1
         AND type = $2
         AND workspace_id = $3
         AND deleted_at IS NULL`,
        [targetFolderId, 'folder', workspaceId]
      )

      if (folderCheck.rows.length === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json(
          { error: 'Target folder not found', targetFolderId },
          { status: 404 }
        )
      }

      const targetPath = folderCheck.rows[0].path
      const movedItems: any[] = []
      const skippedItems: SkippedItem[] = []

      // Process each item
      for (const itemId of itemIds) {
        // Get item info and validate workspace (select all fields needed for OrgItem)
        const itemResult = await client.query(
          `SELECT id, name, type, path, parent_id, slug, position, metadata, icon, color,
                  last_accessed_at, created_at, updated_at
           FROM items
           WHERE id = $1
           AND workspace_id = $2
           AND deleted_at IS NULL`,
          [itemId, workspaceId]
        )

        if (itemResult.rows.length === 0) {
          skippedItems.push({
            id: itemId,
            reason: 'Item not found or does not belong to workspace'
          })
          continue
        }

        const item = itemResult.rows[0]

        // Don't allow moving item to its current parent
        if (item.parent_id === targetFolderId) {
          skippedItems.push({
            id: itemId,
            reason: 'Item already in target folder'
          })
          continue
        }

        // Don't allow moving item to itself
        if (itemId === targetFolderId) {
          skippedItems.push({
            id: itemId,
            reason: 'Cannot move item to itself'
          })
          continue
        }

        // Check for circular move (folder moved into its own descendant)
        if (item.type === 'folder') {
          const cycleCheck = await client.query(
            `SELECT 1 FROM items
             WHERE id = $1
             AND path LIKE $2
             AND deleted_at IS NULL`,
            [targetFolderId, `${item.path}/%`]
          )

          if (cycleCheck.rows.length > 0) {
            skippedItems.push({
              id: itemId,
              reason: 'Would create circular reference (folder cannot be moved into its own descendant)'
            })
            continue
          }
        }

        const oldPath = item.path
        const newPath = `${targetPath}/${item.name}`

        // Update item's parent_id and path
        const updateResult = await client.query(
          `UPDATE items
           SET parent_id = $1,
               path = $2,
               updated_at = NOW()
           WHERE id = $3
           AND deleted_at IS NULL
           RETURNING id, parent_id, path, updated_at`,
          [targetFolderId, newPath, itemId]
        )

        if (updateResult.rows.length === 0) {
          skippedItems.push({
            id: itemId,
            reason: 'Update failed (item may have been deleted)'
          })
          continue
        }

        // If this is a folder, update all children's paths in the SAME transaction
        if (item.type === 'folder') {
          await client.query(
            `UPDATE items
             SET path = REPLACE(path, $1, $2),
                 updated_at = NOW()
             WHERE path LIKE $3
             AND workspace_id = $4
             AND deleted_at IS NULL`,
            [oldPath, newPath, `${oldPath}/%`, workspaceId]
          )
        }

        // Check if folder has children
        let hasChildren = false
        if (item.type === 'folder') {
          const childrenCheck = await client.query(
            `SELECT 1 FROM items WHERE parent_id = $1 AND deleted_at IS NULL LIMIT 1`,
            [itemId]
          )
          hasChildren = childrenCheck.rows.length > 0
        }

        // Calculate level from new path (count non-empty segments)
        const level = newPath.split('/').filter(Boolean).length

        // Build complete OrgItem-shaped object with all required fields
        const movedItem = {
          id: updateResult.rows[0].id,
          name: item.name,
          type: item.type,
          parentId: updateResult.rows[0].parent_id,
          path: updateResult.rows[0].path,
          slug: item.slug,
          position: item.position,
          metadata: item.metadata,
          icon: item.icon,
          color: item.color,
          level: level,
          hasChildren: hasChildren,
          lastAccessedAt: item.last_accessed_at,
          createdAt: item.created_at,
          updatedAt: updateResult.rows[0].updated_at
        }

        movedItems.push(movedItem)
      }

      // COMMIT TRANSACTION
      await client.query('COMMIT')

      // Return detailed response
      return NextResponse.json({
        success: true,
        movedCount: movedItems.length,
        skippedCount: skippedItems.length,
        movedItems,
        skippedItems
      })

    } catch (error) {
      // ROLLBACK on any error
      await client.query('ROLLBACK')
      throw error
    }

  } catch (error) {
    console.error('Error in bulk-move:', error)
    return NextResponse.json(
      { error: 'Failed to move items', message: String(error) },
      { status: 500 }
    )
  } finally {
    // Always release client back to pool
    client.release()
  }
}
