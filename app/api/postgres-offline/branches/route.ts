import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// POST /api/postgres-offline/branches - Create a branch
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      noteId = '', 
      parentId = '', 
      type = 'note', 
      originalText = '', 
      metadata = {}, 
      anchors 
    } = body
    
    const result = await pool.query(
      `INSERT INTO branches 
       (note_id, parent_id, type, original_text, metadata, anchors, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), NOW())
       RETURNING id, note_id as "noteId", parent_id as "parentId", 
                 type, original_text as "originalText", metadata, anchors, 
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [
        noteId, 
        parentId, 
        type, 
        originalText, 
        JSON.stringify(metadata), 
        anchors ? JSON.stringify(anchors) : null
      ]
    )
    
    return NextResponse.json(result.rows[0])
  } catch (error) {
    console.error('[POST /api/postgres-offline/branches] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create branch' },
      { status: 500 }
    )
  }
}

// GET /api/postgres-offline/branches?noteId=xxx - List branches
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const noteId = searchParams.get('noteId')
    
    if (!noteId) {
      return NextResponse.json(
        { error: 'noteId query parameter required' },
        { status: 400 }
      )
    }
    
    const result = await pool.query(
      `SELECT id, note_id as "noteId", parent_id as "parentId", 
              type, original_text as "originalText", metadata, anchors, 
              created_at as "createdAt", updated_at as "updatedAt"
       FROM branches 
       WHERE note_id = $1
       ORDER BY created_at ASC`,
      [noteId]
    )
    
    return NextResponse.json(result.rows)
  } catch (error) {
    console.error('[GET /api/postgres-offline/branches] Error:', error)
    return NextResponse.json(
      { error: 'Failed to list branches' },
      { status: 500 }
    )
  }
}