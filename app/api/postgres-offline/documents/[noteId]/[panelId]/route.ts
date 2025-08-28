import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// GET /api/postgres-offline/documents/[noteId]/[panelId] - Load a document
export async function GET(
  request: NextRequest,
  { params }: { params: { noteId: string; panelId: string } }
) {
  try {
    const result = await pool.query(
      `SELECT content, version 
       FROM document_saves 
       WHERE note_id = $1 AND panel_id = $2
       ORDER BY version DESC
       LIMIT 1`,
      [params.noteId, params.panelId]
    )
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }
    
    const { content, version } = result.rows[0]
    
    // Check if content is HTML string format
    if (content.html && typeof content.html === 'string') {
      return NextResponse.json({ content: content.html, version })
    }
    
    // Otherwise return as ProseMirror JSON
    return NextResponse.json({ content, version })
  } catch (error) {
    console.error('[GET /api/postgres-offline/documents/[noteId]/[panelId]] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load document' },
      { status: 500 }
    )
  }
}