import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'

const MAX_ROWS = 20

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const noteId = searchParams.get('noteId')
    const panelId = searchParams.get('panelId')
    const limit = Math.min(
      parseInt(searchParams.get('limit') || `${MAX_ROWS}`, 10),
      MAX_ROWS
    )

    if (!noteId || !panelId) {
      return NextResponse.json(
        { error: 'noteId and panelId are required' },
        { status: 400 }
      )
    }

    const history = await serverPool.query(
      `SELECT
         ds.id,
         ds.note_id,
         ds.panel_id,
         ds.workspace_id,
         ds.version,
         LEFT(md5(ds.content::text), 8) AS content_hash,
         ds.created_at
       FROM document_saves ds
       WHERE ds.note_id = $1 AND ds.panel_id = $2
       ORDER BY ds.created_at DESC
       LIMIT $3`,
      [noteId, panelId, limit]
    )

    const queueRows = await serverPool.query(
      `SELECT
         oq.id,
         oq.type,
         oq.status,
         oq.retry_count,
         LEFT(md5(COALESCE(oq.data->>'content', '')), 8) AS content_hash,
         (oq.data->>'version')::int AS payload_version,
         oq.created_at
       FROM offline_queue oq
       WHERE oq.table_name = 'document_saves'
         AND (oq.data->>'noteId')::uuid = $1
         AND (oq.data->>'panelId')::uuid = $2
       ORDER BY oq.created_at DESC
       LIMIT $3`,
      [noteId, panelId, limit]
    )

    return NextResponse.json({
      noteId,
      panelId,
      history: history.rows,
      queue: queueRows.rows,
    })
  } catch (error) {
    console.error('[debug/documents] error:', error)
    return NextResponse.json(
      { error: 'Failed to load document history' },
      { status: 500 }
    )
  }
}
