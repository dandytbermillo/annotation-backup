import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// POST /api/postgres-offline/queue/flush - Process all queued operations
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { operations = [] } = body
    
    const results: any[] = []
    const errors: any[] = []
    
    // Process each operation
    for (const op of operations) {
      try {
        const { noteId, panelId, operation, data } = op
        
        if (!noteId || !panelId) {
          throw new Error('noteId and panelId are required')
        }
        
        // Process based on operation type
        switch (operation) {
          case 'update': {
            // Create a new version for document (Schema option B: no updated_at)
            const content = JSON.stringify(data?.content ?? {})
            await pool.query(
              `WITH next AS (
                 SELECT COALESCE(MAX(version), 0) + 1 AS v
                 FROM document_saves
                 WHERE note_id = $1 AND panel_id = $2
               )
               INSERT INTO document_saves (note_id, panel_id, content, version, created_at)
               SELECT $1, $2, $3::jsonb, next.v, NOW()
               FROM next`,
              [noteId, panelId, content]
            )
            results.push({ ...op, status: 'success' })
            break
          }
            
          case 'create': {
            // Create the initial version (1) if none exists, otherwise append next
            const content = JSON.stringify(data?.content ?? {})
            await pool.query(
              `WITH next AS (
                 SELECT COALESCE(MAX(version), 0) + 1 AS v
                 FROM document_saves
                 WHERE note_id = $1 AND panel_id = $2
               )
               INSERT INTO document_saves (note_id, panel_id, content, version, created_at)
               SELECT $1, $2, $3::jsonb, next.v, NOW()
               FROM next`,
              [noteId, panelId, content]
            )
            results.push({ ...op, status: 'success' })
            break
          }
            
          case 'delete':
            // Delete all versions for this note/panel pair
            await pool.query(
              `DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2`,
              [noteId, panelId]
            )
            results.push({ ...op, status: 'success' })
            break
            
          default:
            errors.push({ ...op, error: `Unknown operation: ${operation}` })
        }
      } catch (error) {
        console.error(`[Queue Flush] Error processing operation:`, error)
        errors.push({ ...op, error: error instanceof Error ? error.message : 'Unknown error' })
      }
    }
    
    return NextResponse.json({
      processed: results.length,
      succeeded: results.length,
      failed: errors.length,
      results,
      errors
    })
  } catch (error) {
    console.error('[POST /api/postgres-offline/queue/flush] Error:', error)
    return NextResponse.json(
      { error: 'Failed to flush queue' },
      { status: 500 }
    )
  }
}