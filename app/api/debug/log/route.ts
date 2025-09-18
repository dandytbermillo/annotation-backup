import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { component, action, metadata, content_preview, note_id } = body;
    
    // First, try to get the default workspace if it exists
    let workspaceId: string | null = null;
    try {
      const workspaceResult = await pool.query(
        `SELECT id FROM workspaces WHERE is_default = true LIMIT 1`
      );
      if (workspaceResult.rows.length > 0) {
        workspaceId = workspaceResult.rows[0].id;
      }
    } catch (e) {
      // Workspaces table might not exist, continue without it
    }
    
    // Build the insert query dynamically based on available fields
    const fields = ['component', 'action', 'content_preview', 'metadata', 'session_id'];
    const values = [
      component || 'unknown',
      action || 'unknown',
      content_preview || null,
      JSON.stringify(metadata || {}),
      body.session_id || 'web-session'
    ];
    const placeholders = ['$1', '$2', '$3', '$4', '$5'];
    
    // Add note_id if provided
    if (note_id) {
      fields.push('note_id');
      values.push(note_id);
      placeholders.push(`$${placeholders.length + 1}`);
    }
    
    // Add workspace_id if we have it
    if (workspaceId) {
      fields.push('workspace_id');
      values.push(workspaceId);
      placeholders.push(`$${placeholders.length + 1}`);
    }
    
    await pool.query(
      `INSERT INTO debug_logs (${fields.join(', ')}) 
       VALUES (${placeholders.join(', ')})`,
      values
    );
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Debug log error:', error);
    return NextResponse.json({ error: 'Failed to log debug info' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get last 20 debug logs
    const result = await pool.query(
      `SELECT * FROM debug_logs 
       ORDER BY timestamp DESC 
       LIMIT 20`
    );
    
    return NextResponse.json({ logs: result.rows });
  } catch (error) {
    console.error('Debug log fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch debug logs' }, { status: 500 });
  }
}