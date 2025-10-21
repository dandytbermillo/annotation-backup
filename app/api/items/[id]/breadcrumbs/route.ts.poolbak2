import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
})

// GET /api/items/[id]/breadcrumbs - Get ancestor chain for breadcrumb navigation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    const query = `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, path, name, type, 0 as depth
        FROM items 
        WHERE id = $1 AND deleted_at IS NULL
        
        UNION ALL
        
        SELECT i.id, i.parent_id, i.path, i.name, i.type, a.depth + 1
        FROM items i
        JOIN ancestors a ON i.id = a.parent_id
        WHERE i.deleted_at IS NULL
      )
      SELECT * FROM ancestors ORDER BY depth DESC
    `
    
    const result = await pool.query(query, [id])
    
    const breadcrumbs = result.rows.map(row => ({
      id: row.id,
      parentId: row.parent_id,
      path: row.path,
      name: row.name,
      type: row.type,
      depth: row.depth
    }))
    
    return NextResponse.json({ breadcrumbs })
  } catch (error) {
    console.error('Error fetching breadcrumbs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch breadcrumbs' },
      { status: 500 }
    )
  }
}