import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// Deterministic mapping for non-UUID IDs (slugs) → UUID
const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a' // keep stable across services
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))

// POST /api/postgres-offline/branches - Create a branch
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      id,
      noteId = '', 
      parentId = '', 
      type = 'note', 
      originalText = '', 
      metadata = {}, 
      anchors 
    } = body
    
    // Accept only real UUIDs for primary key; otherwise let DB generate one
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
    const idOrNull = id && uuidRegex.test(String(id).trim()) ? String(id).trim() : null
    
    // parentId: TEXT column; keep non-empty values ("main", "branch-...") and coalesce blanks to null
    const parentIdOrNull = parentId && String(parentId).trim() ? String(parentId).trim() : null
    
    // Coerce noteId slug to UUID if needed
    const noteKey = coerceEntityId(noteId)
    
    const result = await pool.query(
      `INSERT INTO branches 
       (id, note_id, parent_id, type, original_text, metadata, anchors, created_at, updated_at)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW(), NOW())
       RETURNING id, note_id as "noteId", parent_id as "parentId", 
                 type, original_text as "originalText", metadata, anchors, 
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [
        idOrNull,
        noteKey, 
        parentIdOrNull, 
        type, 
        originalText, 
        JSON.stringify(metadata), 
        anchors ? JSON.stringify(anchors) : null
      ]
    )
    
    return NextResponse.json(result.rows[0])
  } catch (error) {
    console.error('[POST /api/postgres-offline/branches] Error:', error)
    console.error('Request body:', { id, noteId, parentId, type, originalText, anchors })
    return NextResponse.json(
      { error: 'Failed to create branch', details: error instanceof Error ? error.message : 'Unknown error' },
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
    
    // Coerce slug to UUID if needed
    const noteKey = coerceEntityId(noteId)
    
    const result = await pool.query(
      `SELECT id, note_id as "noteId", parent_id as "parentId", 
              type, original_text as "originalText", metadata, anchors, 
              created_at as "createdAt", updated_at as "updatedAt"
       FROM branches 
       WHERE note_id = $1
         AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [noteKey]
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