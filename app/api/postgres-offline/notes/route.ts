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
    const { title = 'Untitled', metadata = {} } = body
    
    const result = await pool.query(
      `INSERT INTO notes (title, metadata, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())
       RETURNING id, title, metadata, created_at, updated_at`,
      [title, JSON.stringify(metadata)]
    )
    
    return NextResponse.json(result.rows[0])
  } catch (error) {
    console.error('[POST /api/postgres-offline/notes] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create note' },
      { status: 500 }
    )
  }
}