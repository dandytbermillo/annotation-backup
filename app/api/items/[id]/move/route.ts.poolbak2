import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
})

// PUT /api/items/[id]/move - Move item to new parent
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { newParentId, position = 0 } = body
    
    // Use the move_item stored procedure
    const query = `SELECT move_item($1::uuid, $2::uuid, $3::integer)`
    
    await pool.query(query, [id, newParentId, position])
    
    // Fetch updated item
    const result = await pool.query(`
      SELECT 
        id, type, parent_id, path, name, slug, position,
        metadata, icon, color, last_accessed_at,
        created_at, updated_at
      FROM items 
      WHERE id = $1 AND deleted_at IS NULL
    `, [id])
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Item not found after move' },
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
      metadata: row.metadata,
      icon: row.icon,
      color: row.color,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
    
    return NextResponse.json({ item })
  } catch (error: any) {
    console.error('Error moving item:', error)
    
    // Check for circular reference error
    if (error.message?.includes('Circular reference')) {
      return NextResponse.json(
        { error: 'Cannot move item into its own subtree' },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to move item' },
      { status: 500 }
    )
  }
}