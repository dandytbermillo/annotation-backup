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
    const item = {
      id: row.id,
      type: row.type,
      parentId: row.parent_id,
      path: row.path,
      name: row.name,
      slug: row.slug,
      position: row.position,
      content: row.content,
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
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    
    const result = await pool.query(query, values)
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ item: result.rows[0] })
  } catch (error) {
    console.error('Error updating item:', error)
    return NextResponse.json(
      { error: 'Failed to update item' },
      { status: 500 }
    )
  }
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