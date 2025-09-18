import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev'
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { component, action, metadata, content_preview } = body;
    
    await pool.query(
      `INSERT INTO debug_logs (component, action, content_preview, metadata, session_id) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        component || 'unknown',
        action || 'unknown',
        content_preview || null,
        JSON.stringify(metadata || {}),
        body.session_id || 'web-session'
      ]
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