import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
})

// GET /api/items/[id] - Get single item details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    const query = `
      SELECT 
        id, type, parent_id, path, name, slug, position,
        content, metadata, icon, color, last_accessed_at,
        created_at, updated_at
      FROM items 
      WHERE id = $1 AND deleted_at IS NULL
    `
    
    const result = await pool.query(query, [id])
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }
    
    const row = result.rows[0]

    let content = row.content
    let contentText: string | null = null

    if (!content || (typeof content === 'object' && Object.keys(content).length === 0)) {
      const docResult = await pool.query(
        `SELECT content, document_text 
           FROM document_saves 
          WHERE note_id = $1 
          ORDER BY created_at DESC 
          LIMIT 1`,
        [id]
      )

      if (docResult.rows.length > 0) {
        content = docResult.rows[0].content || content
        contentText = docResult.rows[0].document_text || null
      }
    }

    if (!contentText) {
      const noteTextResult = await pool.query(
        `SELECT content_text 
           FROM notes 
          WHERE id = $1`,
        [id]
      )
      if (noteTextResult.rows.length > 0) {
        contentText = noteTextResult.rows[0].content_text
      }
    }

    const item = {
      id: row.id,
      type: row.type,
      parentId: row.parent_id,
      path: row.path,
      name: row.name,
      slug: row.slug,
      position: row.position,
      content,
      contentText,
      metadata: row.metadata,
      icon: row.icon,
      color: row.color,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
    
    return NextResponse.json({ item })
  } catch (error) {
    console.error('Error fetching item:', error)
    return NextResponse.json(
      { error: 'Failed to fetch item' },
      { status: 500 }
    )
  }
}

// PUT /api/items/[id] - Update item
// CRITICAL: Uses atomic transaction to update items, notes, AND panels tables
// This prevents data divergence where different tables have different titles
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect()

  try {
    const { id } = await params
    const body = await request.json()
    const { name, content, metadata, icon, color, position } = body

    const updates = []
    const values = []
    let valueIndex = 1

    if (name !== undefined) {
      updates.push(`name = $${valueIndex++}`)
      values.push(name)
    }
    if (content !== undefined) {
      updates.push(`content = $${valueIndex++}`)
      values.push(content)
    }
    if (metadata !== undefined) {
      updates.push(`metadata = $${valueIndex++}`)
      values.push(metadata)
    }
    if (icon !== undefined) {
      updates.push(`icon = $${valueIndex++}`)
      values.push(icon)
    }
    if (color !== undefined) {
      updates.push(`color = $${valueIndex++}`)
      values.push(color)
    }
    if (position !== undefined) {
      updates.push(`position = $${valueIndex++}`)
      values.push(position)
    }

    values.push(id)

    const query = `
      UPDATE items
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${valueIndex} AND deleted_at IS NULL
      RETURNING *
    `

    // BEGIN TRANSACTION - ensure atomic updates across all tables
    // Without this, partial failures leave items/notes/panels out of sync
    await client.query('BEGIN')

    try {
      // 1. Update items table (knowledge tree/popup overlay)
      const result = await client.query(query, values)

      if (result.rows.length === 0) {
        await client.query('ROLLBACK')
        return NextResponse.json(
          { error: 'Item not found' },
          { status: 404 }
        )
      }

      const updatedItem = result.rows[0]

      // 2. If this is a note-type item and name was updated, sync to notes and panels tables
      // This ensures consistency across all three tables for note items
      // Non-note items (folders) only exist in items table, so this is skipped for them
      if (updatedItem.type === 'note' && name !== undefined) {
        // Update notes table (canonical source for canvas panels on load)
        const notesResult = await client.query(
          'UPDATE notes SET title = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
          [name, id]
        )

        // CRITICAL: Fail transaction if note doesn't exist in notes table
        // This indicates data integrity violation - item says it's a note but no note exists
        // Continuing would cause divergence: items has new name, notes has old/missing name
        if (notesResult.rows.length === 0) {
          console.error(`[PUT /api/items/${id}] INTEGRITY ERROR: Note ${id} exists in items table but not in notes table`)
          throw new Error(`Data integrity violation: note ${id} not found in notes table`)
        }

        // Update panels table (layout/state for all panel instances)
        // Note: Multiple panels can show the same note, so this updates ALL of them
        await client.query(
          'UPDATE panels SET title = $1, updated_at = NOW() WHERE note_id = $2',
          [name, id]
        )

        console.log(`[PUT /api/items/${id}] Synced note title across all tables:`, name)
      }

      // COMMIT - all updates succeeded atomically
      // If any update failed, transaction would have been rolled back
      await client.query('COMMIT')

      return NextResponse.json({ item: updatedItem })

    } catch (txError) {
      // ROLLBACK on any error - ensure no partial updates
      // This prevents data divergence where some tables update and others don't
      await client.query('ROLLBACK')
      console.error(`[PUT /api/items/${id}] Transaction failed, rolled back:`, txError)
      throw txError
    }

  } catch (error) {
    console.error('Error updating item:', error)
    return NextResponse.json(
      { error: 'Failed to update item' },
      { status: 500 }
    )
  } finally {
    // Always release connection back to pool
    client.release()
  }
}

// PATCH /api/items/[id] - Partial update (alias to PUT for RESTful compliance)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return PUT(request, { params })
}

// DELETE /api/items/[id] - Soft delete item
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const query = `
      UPDATE items
      SET deleted_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `

    const result = await pool.query(query, [id])

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting item:', error)
    return NextResponse.json(
      { error: 'Failed to delete item' },
      { status: 500 }
    )
  }
}
