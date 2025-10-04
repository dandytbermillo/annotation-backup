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
    try {
      workspaceId = await WorkspaceStore.getDefaultWorkspaceId(serverPool)
    } catch (e) {
      console.error('Failed to get workspace ID:', e)
      return NextResponse.json(
        { error: 'Failed to get workspace' },
        { status: 500 }
      )
    }

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
        // Get item info and validate workspace
        const itemResult = await client.query(
          `SELECT id, name, type, path, parent_id
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

        movedItems.push(updateResult.rows[0])
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
