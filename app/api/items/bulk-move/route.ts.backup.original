import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
})

export async function POST(request: NextRequest) {
  try {
    const { itemIds, targetFolderId } = await request.json()
    
    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json(
        { error: 'Invalid item IDs' },
        { status: 400 }
      )
    }
    
    // Get target folder info (or use root)
    let targetPath = '/knowledge-base'
    let actualTargetId = targetFolderId
    
    if (targetFolderId) {
      const folderResult = await pool.query(
        'SELECT id, path FROM items WHERE id = $1 AND type = $2 AND deleted_at IS NULL',
        [targetFolderId, 'folder']
      )
      
      if (folderResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Target folder not found' },
          { status: 404 }
        )
      }
      
      targetPath = folderResult.rows[0].path
    } else {
      // If no target specified, move to Knowledge Base root
      const kbResult = await pool.query(
        'SELECT id FROM items WHERE path = $1 AND type = $2 AND deleted_at IS NULL',
        ['/knowledge-base', 'folder']
      )
      if (kbResult.rows.length > 0) {
        actualTargetId = kbResult.rows[0].id
      }
    }
    
    // Move each item to the new parent
    const movedItems = []
    for (const itemId of itemIds) {
      // Get current item info
      const itemResult = await pool.query(
        'SELECT id, name, type, path FROM items WHERE id = $1 AND deleted_at IS NULL',
        [itemId]
      )
      
      if (itemResult.rows.length === 0) continue
      
      const item = itemResult.rows[0]
      const newPath = `${targetPath}/${item.name}`
      
      // Check for potential cycles (don't move a folder into its own descendant)
      if (item.type === 'folder' && targetFolderId) {
        const cycleCheck = await pool.query(
          `SELECT 1 FROM items 
           WHERE id = $1 
           AND path LIKE $2
           AND deleted_at IS NULL`,
          [targetFolderId, `${item.path}/%`]
        )
        
        if (cycleCheck.rows.length > 0) {
          console.log(`Skipping ${item.name}: would create cycle`)
          continue
        }
      }
      
      // Update the item's parent and path
      // Note: Using a simpler update to avoid trigger issues
      await pool.query(
        `UPDATE items 
         SET parent_id = $1, 
             path = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [actualTargetId, newPath, itemId]
      )
      
      // Fetch the updated item
      const updateResult = await pool.query(
        'SELECT * FROM items WHERE id = $1',
        [itemId]
      )
      
      if (updateResult.rows.length > 0) {
        movedItems.push(updateResult.rows[0])
        
        // If this is a folder, update all children's paths
        if (item.type === 'folder') {
          const oldPath = item.path
          await pool.query(
            `UPDATE items 
             SET path = REPLACE(path, $1, $2),
                 updated_at = CURRENT_TIMESTAMP
             WHERE path LIKE $3 AND deleted_at IS NULL`,
            [oldPath, newPath, `${oldPath}/%`]
          )
        }
      }
    }
    
    return NextResponse.json({ 
      success: true,
      movedItems,
      count: movedItems.length 
    })
    
  } catch (error) {
    console.error('Error moving items:', error)
    return NextResponse.json(
      { error: 'Failed to move items' },
      { status: 500 }
    )
  }
}