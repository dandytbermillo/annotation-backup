import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// POST /api/postgres-offline/notes - Create a new note
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, title = 'Untitled', metadata = {} } = body
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
    const idOrNull = typeof id === 'string' && uuidRegex.test(id.trim()) ? id.trim() : null
    
    // Insert with explicit id when provided; return existing on conflict
    const result = await pool.query(
      `INSERT INTO notes (id, title, metadata, created_at, updated_at)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING
       RETURNING id, title, metadata, created_at, updated_at`,
      [idOrNull, title, JSON.stringify(metadata)]
    )
    
    if (result.rows.length === 0 && idOrNull) {
      const existing = await pool.query(
        `SELECT id, title, metadata, created_at, updated_at
         FROM notes WHERE id = $1`,
        [idOrNull]
      )
      if (existing.rows.length > 0) {
        return NextResponse.json(existing.rows[0], { status: 200 })
      }
      // Anomalous: conflict path but no row found
      return NextResponse.json(
        { error: 'Note ID conflict but existing row not found' },
        { status: 409 }
      )
    }
    
    // Fresh insert path
    return NextResponse.json(result.rows[0], { status: 201 })
  } catch (error) {
    console.error('[POST /api/postgres-offline/notes] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create note' },
      { status: 500 }
    )
  }
}