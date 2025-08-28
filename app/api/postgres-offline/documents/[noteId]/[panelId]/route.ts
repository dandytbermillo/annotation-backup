import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { v5 as uuidv5 } from 'uuid'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// Check if a string is a valid UUID
const isUuid = (s: string): boolean => {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)
}

// Normalize panelId: accept human-readable IDs (e.g., "main") by mapping to a
// deterministic UUID per note using UUID v5 in the DNS namespace.
const normalizePanelId = (noteId: string, panelId: string): string => {
  if (isUuid(panelId)) return panelId
  return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
}

// GET /api/postgres-offline/documents/[noteId]/[panelId] - Load a document
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string; panelId: string }> }
) {
  try {
    const { noteId, panelId } = await params
    console.log('[GET Document] Raw params:', { noteId, panelId })
    
    // Validate noteId is a UUID
    if (!isUuid(noteId)) {
      return NextResponse.json(
        { error: 'Invalid noteId: must be a valid UUID' },
        { status: 400 }
      )
    }
    
    const normalizedPanelId = normalizePanelId(noteId, panelId)
    console.log('[GET Document] Normalized panelId:', normalizedPanelId)
    
    const result = await pool.query(
      `SELECT content, version 
       FROM document_saves 
       WHERE note_id = $1 AND panel_id = $2
       ORDER BY version DESC
       LIMIT 1`,
      [noteId, normalizedPanelId]
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