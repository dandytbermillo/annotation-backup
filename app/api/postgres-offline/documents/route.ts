import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { v5 as uuidv5 } from 'uuid'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// Normalize panelId: accept human-readable IDs (e.g., "main") by mapping to a
// deterministic UUID per note using UUID v5 in the DNS namespace.
const normalizePanelId = (noteId: string, panelId: string): string => {
  const isUuid = /^(?:[0-9a-fA-F]{8}-){3}[0-9a-fA-F]{12}$/
  if (isUuid.test(panelId)) return panelId
  return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
}

// Check if a string is a valid UUID
const isUuid = (s: string): boolean => {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)
}

// POST /api/postgres-offline/documents - Save a document
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { noteId, panelId, content, version } = body
    
    console.log('[POST Document] Request:', { noteId, panelId, version, contentType: typeof content })
    
    if (!noteId || !panelId || !content || version === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: noteId, panelId, content, version' },
        { status: 400 }
      )
    }
    
    // Validate noteId is a UUID
    if (!isUuid(noteId)) {
      return NextResponse.json(
        { error: 'Invalid noteId: must be a valid UUID' },
        { status: 400 }
      )
    }
    
    // Store content as JSONB
    const contentJson = typeof content === 'string' 
      ? { html: content } 
      : content
    
    const normalizedPanelId = normalizePanelId(noteId, panelId)
    console.log('[POST Document] Normalized panelId:', normalizedPanelId)
    
    const result = await pool.query(
      `INSERT INTO document_saves 
       (note_id, panel_id, content, version, created_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (note_id, panel_id, version)
       DO UPDATE SET content = EXCLUDED.content, created_at = NOW()
       RETURNING id`,
      [noteId, normalizedPanelId, JSON.stringify(contentJson), version]
    )
    
    console.log('[POST Document] Save successful, document ID:', result.rows[0]?.id)
    
    return NextResponse.json({ success: true, id: result.rows[0]?.id })
  } catch (error) {
    console.error('[POST /api/postgres-offline/documents] Error:', error)
    return NextResponse.json(
      { error: 'Failed to save document' },
      { status: 500 }
    )
  }
}