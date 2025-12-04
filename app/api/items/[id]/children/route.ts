import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
})

// GET /api/items/[id]/children - Get direct children of an item
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    // Special handling for root items
    let query: string
    let values: any[]
    
    if (id === 'root') {
      // Get root level items
      query = `
        SELECT 
          id, type, parent_id, path, name, slug, position,
          metadata, icon, color, last_accessed_at,
          created_at, updated_at
        FROM items 
        WHERE parent_id IS NULL AND deleted_at IS NULL
        ORDER BY position, name
      `
      values = []
    } else {
      // Get children of specific item
      query = `
        SELECT 
          id, type, parent_id, path, name, slug, position,
          metadata, icon, color, last_accessed_at,
          created_at, updated_at
        FROM items 
        WHERE parent_id = $1 AND deleted_at IS NULL
        ORDER BY type DESC, position, name
      `
      values = [id]
    }
    
    const result = await pool.query(query, values)
    
    // Transform snake_case to camelCase
    const children = result.rows.map(row => ({
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
    }))
    
    // Return as 'items' to match what Navigator panel expects
    return NextResponse.json({ items: children })
  } catch (error) {
    console.error('Error fetching children:', error)
    return NextResponse.json(
      { error: 'Failed to fetch children' },
      { status: 500 }
    )
  }
}