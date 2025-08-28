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
        const { noteId, panelId, operation, data, timestamp } = op
        
        // Process based on operation type
        switch (operation) {
          case 'update':
            // Update document_saves table
            await pool.query(
              `INSERT INTO document_saves (panel_id, content, version, updated_at)
               VALUES ($1, $2::text, $3, NOW())
               ON CONFLICT (panel_id) 
               DO UPDATE SET 
                 content = $2::text,
                 version = document_saves.version + 1,
                 updated_at = NOW()`,
              [panelId, JSON.stringify(data.content || ''), data.version || 1]
            )
            results.push({ ...op, status: 'success' })
            break
            
          case 'create':
            // Create new entry
            await pool.query(
              `INSERT INTO document_saves (panel_id, content, version, updated_at)
               VALUES ($1, $2::text, $3, NOW())`,
              [panelId, JSON.stringify(data.content || ''), data.version || 1]
            )
            results.push({ ...op, status: 'success' })
            break
            
          case 'delete':
            // Delete entry
            await pool.query(
              `DELETE FROM document_saves WHERE panel_id = $1`,
              [panelId]
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