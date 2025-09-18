import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      component, 
      action, 
      noteId, 
      panelId, 
      contentPreview, 
      metadata,
      sessionId 
    } = body
    
    // Insert log entry
    await pool.query(
      `INSERT INTO debug_logs (component, action, note_id, panel_id, content_preview, metadata, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        component,
        action,
        noteId || null,
        panelId || null,
        contentPreview || null,
        metadata ? JSON.stringify(metadata) : null,
        sessionId || 'default'
      ]
    )
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Debug Log API] Error:', error)
    return NextResponse.json({ error: 'Failed to log' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const noteId = searchParams.get('noteId')
    const panelId = searchParams.get('panelId')
    const limit = parseInt(searchParams.get('limit') || '50')
    
    let query = 'SELECT * FROM debug_logs WHERE 1=1'
    const params: any[] = []
    
    if (noteId) {
      params.push(noteId)
      query += ` AND note_id = $${params.length}`
    }
    
    if (panelId) {
      params.push(panelId)
      query += ` AND panel_id = $${params.length}`
    }
    
    query += ' ORDER BY timestamp DESC'
    params.push(limit)
    query += ` LIMIT $${params.length}`
    
    const result = await pool.query(query, params)
    
    return NextResponse.json({ 
      logs: result.rows,
      count: result.rowCount 
    })
  } catch (error) {
    console.error('[Debug Log API] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 })
  }
}