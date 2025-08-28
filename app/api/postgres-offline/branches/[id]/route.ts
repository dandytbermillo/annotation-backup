import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// PATCH /api/postgres-offline/branches/[id] - Update a branch
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const { type, originalText, metadata, anchors, version } = body
    
    // Build dynamic update query
    const updates: string[] = []
    const values: any[] = [params.id]
    let paramIndex = 2
    
    if (type !== undefined) {
      updates.push(`type = $${paramIndex}`)
      values.push(type)
      paramIndex++
    }
    
    if (originalText !== undefined) {
      updates.push(`original_text = $${paramIndex}`)
      values.push(originalText)
      paramIndex++
    }
    
    if (metadata !== undefined) {
      updates.push(`metadata = $${paramIndex}::jsonb`)
      values.push(JSON.stringify(metadata))
      paramIndex++
    }
    
    if (anchors !== undefined) {
      updates.push(`anchors = $${paramIndex}::jsonb`)
      values.push(JSON.stringify(anchors))
      paramIndex++
    }
    
    if (version !== undefined) {
      updates.push(`version = $${paramIndex}`)
      values.push(version)
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
      `UPDATE branches 
       SET ${updates.join(', ')}
       WHERE id = $1
       RETURNING id, note_id as "noteId", parent_id as "parentId", 
                 type, original_text as "originalText", metadata, anchors, 
                 created_at as "createdAt", updated_at as "updatedAt"`,
      values
    )
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Branch not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(result.rows[0])
  } catch (error) {
    console.error('[PATCH /api/postgres-offline/branches/[id]] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update branch' },
      { status: 500 }
    )
  }
}