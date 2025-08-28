import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// POST /api/postgres-offline/documents - Save a document
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { noteId, panelId, content, version } = body
    
    if (!noteId || !panelId || !content || version === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: noteId, panelId, content, version' },
        { status: 400 }
      )
    }
    
    // Store content as JSONB
    const contentJson = typeof content === 'string' 
      ? { html: content } 
      : content
    
    await pool.query(
      `INSERT INTO document_saves 
       (note_id, panel_id, content, version, created_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (note_id, panel_id, version)
       DO UPDATE SET content = EXCLUDED.content, created_at = NOW()`,
      [noteId, panelId, JSON.stringify(contentJson), version]
    )
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[POST /api/postgres-offline/documents] Error:', error)
    return NextResponse.json(
      { error: 'Failed to save document' },
      { status: 500 }
    )
  }
}