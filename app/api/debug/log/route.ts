import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { promises as fs } from 'fs'
import path from 'path'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev',
})

const DEBUG_LOG_FILE = path.join(process.cwd(), 'logs', 'debug.log')

async function appendFileSafe(payload: unknown) {
  try {
    const line = `${new Date().toISOString()} ${JSON.stringify(payload)}\n`
    await fs.appendFile(DEBUG_LOG_FILE, line, { encoding: 'utf8' })
  } catch (fileError) {
    console.warn('[debug-log] failed to append to file', fileError)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Handle empty or malformed request bodies gracefully
    let body
    try {
      body = await request.json()
    } catch (jsonError) {
      // Request body is empty or invalid JSON - likely cancelled request
      return NextResponse.json({ success: false, error: 'Empty or invalid request body' }, { status: 400 })
    }

    const { component, action, metadata, content_preview, note_id } = body
    
    // First, try to get the default workspace if it exists
    let workspaceId: string | null = null
    try {
      const workspaceResult = await pool.query(
        `SELECT id FROM workspaces WHERE is_default = true LIMIT 1`,
      )
      if (workspaceResult.rows.length > 0) {
          workspaceId = workspaceResult.rows[0].id
      }
    } catch (e) {
      // Workspaces table might not exist, continue without it
    }

    // Build the insert query dynamically based on available fields
    const fields = ['component', 'action', 'content_preview', 'metadata', 'session_id']
    const values = [
      component || 'unknown',
      action || 'unknown',
      content_preview || null,
      JSON.stringify(metadata || {}),
      body.session_id || 'web-session',
    ]
    const placeholders = ['$1', '$2', '$3', '$4', '$5']
    
    // Add note_id if provided
    if (note_id) {
      fields.push('note_id')
      values.push(note_id)
      placeholders.push(`$${placeholders.length + 1}`)
    }
    
    // Add workspace_id if we have it
    if (workspaceId) {
      fields.push('workspace_id')
      values.push(workspaceId)
      placeholders.push(`$${placeholders.length + 1}`)
    }

    await pool.query(
      `INSERT INTO debug_logs (${fields.join(', ')}) 
       VALUES (${placeholders.join(', ')})`,
      values,
    )

    await appendFileSafe({ component, action, metadata, note_id, workspaceId, timestamp: new Date().toISOString() })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Debug log error:', error)
    return NextResponse.json({ error: 'Failed to log debug info' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get last 20 debug logs
    const result = await pool.query(
      `SELECT * FROM debug_logs 
       ORDER BY timestamp DESC 
       LIMIT 20`,
    )

    return NextResponse.json({ logs: result.rows })
  } catch (error) {
    console.error('Debug log fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch debug logs' }, { status: 500 })
  }
}
