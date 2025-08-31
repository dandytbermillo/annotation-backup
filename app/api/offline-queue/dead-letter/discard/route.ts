import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/annotation_dev'
})

// POST /api/offline-queue/dead-letter/discard
// Body: { ids: string[] }
export async function POST(request: NextRequest) {
  const adminKey = process.env.ADMIN_API_KEY
  const providedKey = request.headers.get('x-admin-key') || ''
  if (adminKey && providedKey !== adminKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  try {
    const body = await request.json()
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 })
    }
    
    const result = await pool.query(
      `UPDATE offline_dead_letter SET archived = true WHERE id = ANY($1::uuid[]) AND archived = false`,
      [ids]
    )
    
    return NextResponse.json({ success: true, discarded: result.rowCount })
  } catch (error) {
    console.error('[dead-letter:discard] Error:', error)
    return NextResponse.json({ error: 'Failed to discard items', details: String(error) }, { status: 500 })
  }
}