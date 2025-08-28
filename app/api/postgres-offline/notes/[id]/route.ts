import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// GET /api/postgres-offline/notes/[id] - Get a note by ID
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await pool.query(
      `SELECT id, title, metadata, created_at, updated_at
       FROM notes WHERE id = $1`,
      [params.id]
    )
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Note not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(result.rows[0])
  } catch (error) {
    console.error('[GET /api/postgres-offline/notes/[id]] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get note' },
      { status: 500 }
    )
  }
}

// PATCH /api/postgres-offline/notes/[id] - Update a note
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const { title, metadata } = body
    
    // Build dynamic update query
    const updates: string[] = []
    const values: any[] = [params.id]
    let paramIndex = 2
    
    if (title !== undefined) {
      updates.push(`title = $${paramIndex}`)
      values.push(title)
      paramIndex++
    }
    
    if (metadata !== undefined) {
      updates.push(`metadata = $${paramIndex}::jsonb`)
      values.push(JSON.stringify(metadata))
      paramIndex++
    }
    
    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }
    
    updates.push('updated_at = NOW()')
    
    const result = await pool.query(
      `UPDATE notes 
       SET ${updates.join(', ')}
       WHERE id = $1
       RETURNING id, title, metadata, created_at, updated_at`,
      values
    )
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Note not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(result.rows[0])
  } catch (error) {
    console.error('[PATCH /api/postgres-offline/notes/[id]] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update note' },
      { status: 500 }
    )
  }
}