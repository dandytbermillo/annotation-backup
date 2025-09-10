import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev',
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { note_id, panel_id, position, dimensions, state, title, type } = body;

    // Generate a panel_id if not provided
    const actualPanelId = panel_id || `panel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const result = await pool.query(
      `INSERT INTO panels (id, note_id, panel_id, position, dimensions, state, title, type, last_accessed) 
       VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, NOW()) 
       RETURNING *`,
      [
        note_id, 
        actualPanelId,
        JSON.stringify(position || { x: 0, y: 0 }), 
        JSON.stringify(dimensions || { width: 400, height: 300 }), 
        state || 'active',
        title || null,
        type || 'editor'
      ]
    );

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating panel:', error);
    return NextResponse.json(
      { error: 'Failed to create panel' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const noteId = searchParams.get('note_id');
    
    let query = 'SELECT * FROM panels';
    const params: string[] = [];
    
    if (noteId) {
      query += ' WHERE note_id = $1';
      params.push(noteId);
    }
    
    query += ' ORDER BY last_accessed DESC';
    
    const result = await pool.query(query, params);
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error fetching panels:', error);
    return NextResponse.json(
      { error: 'Failed to fetch panels' },
      { status: 500 }
    );
  }
}