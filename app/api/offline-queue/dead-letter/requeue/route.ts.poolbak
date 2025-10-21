import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/annotation_dev'
})

// POST /api/offline-queue/dead-letter/requeue
// Body: { ids: string[] }
export async function POST(request: NextRequest) {
  const adminKey = process.env.ADMIN_API_KEY
  const providedKey = request.headers.get('x-admin-key') || ''
  if (adminKey && providedKey !== adminKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const client = await pool.connect()
  try {
    const body = await request.json()
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 })
    }
    
    await client.query('BEGIN')
    
    // Fetch items
    const { rows } = await client.query(
      `SELECT id, idempotency_key, type, table_name, entity_id, data
       FROM offline_dead_letter
       WHERE id = ANY($1::uuid[]) AND archived = false`,
      [ids]
    )
    
    // Requeue each
    for (const row of rows) {
      await client.query(
        `INSERT INTO offline_queue
         (type, table_name, entity_id, data, idempotency_key, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, 'pending', NOW(), NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [row.type, row.table_name, row.entity_id, row.data, row.idempotency_key]
      )
      await client.query(
        `UPDATE offline_dead_letter SET archived = true WHERE id = $1`,
        [row.id]
      )
    }
    
    await client.query('COMMIT')
    return NextResponse.json({ success: true, requeued: rows.length })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[dead-letter:requeue] Error:', error)
    return NextResponse.json({ error: 'Failed to requeue items', details: String(error) }, { status: 500 })
  } finally {
    client.release()
  }
}