import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
})

// GET /api/items/recent - Get recent notes
export async function GET(request: NextRequest) {
  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '10')
    
    const query = `
      SELECT 
        id, type, parent_id, path, name, slug, position,
        metadata, icon, color, last_accessed_at,
        created_at, updated_at
      FROM items 
      WHERE type = 'note' 
        AND deleted_at IS NULL 
        AND last_accessed_at IS NOT NULL
      ORDER BY last_accessed_at DESC
      LIMIT $1
    `
    
    const result = await pool.query(query, [limit])
    
    const items = result.rows.map(row => ({
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
    
    return NextResponse.json({ items })
  } catch (error) {
    console.error('Error fetching recent items:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recent items' },
      { status: 500 }
    )
  }
}

// POST /api/items/recent - Track item access
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { itemId } = body
    
    if (!itemId) {
      return NextResponse.json(
        { error: 'Item ID is required' },
        { status: 400 }
      )
    }
    
    const query = `
      UPDATE items 
      SET last_accessed_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, last_accessed_at
    `
    
    const result = await pool.query(query, [itemId])
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ 
      success: true,
      lastAccessedAt: result.rows[0].last_accessed_at
    })
  } catch (error) {
    console.error('Error tracking item access:', error)
    return NextResponse.json(
      { error: 'Failed to track item access' },
      { status: 500 }
    )
  }
}