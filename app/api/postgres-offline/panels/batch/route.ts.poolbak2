import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

// Ensure Node.js runtime (pg requires Node)
export const runtime = 'nodejs'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// Idempotency tracking (in production, use Redis or database)
type ProcessedEntry = { timestamp: number; result: any }
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000 // 24 hours
const IDEMPOTENCY_SWEEP_INTERVAL = 60 * 60 * 1000 // 1 hour

function getProcessedStore(): { map: Map<string, ProcessedEntry>; lastSweep: number } {
  const g = globalThis as any
  if (!g.__batchPanelsStore) {
    g.__batchPanelsStore = { map: new Map<string, ProcessedEntry>(), lastSweep: 0 }
  }
  return g.__batchPanelsStore
}

function cleanupProcessedKeys(): void {
  const store = getProcessedStore()
  const now = Date.now()
  if (now - store.lastSweep < IDEMPOTENCY_SWEEP_INTERVAL) return
  for (const [key, value] of store.map.entries()) {
    if (now - value.timestamp > IDEMPOTENCY_TTL) store.map.delete(key)
  }
  store.lastSweep = now
}

export async function POST(request: NextRequest) {
  const client = await pool.connect()
  
  try {
    // Lazy cleanup of idempotency cache; no background timers
    cleanupProcessedKeys()
    const store = getProcessedStore()
    
    const { operations } = await request.json()
    
    if (!Array.isArray(operations) || operations.length === 0) {
      return NextResponse.json(
        { error: 'Invalid operations array' },
        { status: 400 }
      )
    }
    
    console.log(`[Batch API - Panels] Processing ${operations.length} create operations`)
    
    const results = []
    
    await client.query('BEGIN')
    
    for (const op of operations) {
      // Check idempotency
      if (op.idempotencyKey && store.map.has(op.idempotencyKey)) {
        const cached = store.map.get(op.idempotencyKey)
        results.push({ ...cached?.result, cached: true })
        continue
      }
      
      try {
        const { id, noteId, position, dimensions, state } = op
        
        if (!id || !noteId) {
          results.push({ 
            error: 'Missing required fields (id, noteId)', 
            operation: op 
          })
          continue
        }
        
        const result = await client.query(
          `INSERT INTO panels 
           (id, note_id, position, dimensions, state, last_accessed)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, NOW())
           ON CONFLICT (id) DO UPDATE SET
             position = EXCLUDED.position,
             dimensions = EXCLUDED.dimensions,
             state = EXCLUDED.state,
             last_accessed = NOW()
           RETURNING id`,
          [
            id,
            noteId,
            JSON.stringify(position || { x: 0, y: 0 }),
            JSON.stringify(dimensions || { width: 400, height: 300 }),
            state || 'active'
          ]
        )
        
        const operationResult = { 
          success: true, 
          id: result.rows[0]?.id 
        }
        
        results.push(operationResult)
        
        // Store for idempotency
        if (op.idempotencyKey) {
          store.map.set(op.idempotencyKey, {
            timestamp: Date.now(),
            result: operationResult
          })
        }
      } catch (error) {
        console.error('[Batch API - Panels] Operation failed:', error)
        results.push({ 
          error: 'Operation failed', 
          message: error instanceof Error ? error.message : 'Unknown error',
          operation: op 
        })
      }
    }
    
    await client.query('COMMIT')
    
    console.log(`[Batch API - Panels] Successfully processed batch`)
    
    return NextResponse.json({ 
      success: true, 
      results,
      processed: results.filter(r => r.success).length,
      failed: results.filter(r => r.error).length
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Batch API - Panels] Batch operation failed:', error)
    return NextResponse.json(
      { 
        error: 'Batch operation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}

export async function PUT(request: NextRequest) {
  const client = await pool.connect()
  
  try {
    // Lazy cleanup of idempotency cache; no background timers
    cleanupProcessedKeys()
    const store = getProcessedStore()
    
    const { operations } = await request.json()
    
    if (!Array.isArray(operations) || operations.length === 0) {
      return NextResponse.json(
        { error: 'Invalid operations array' },
        { status: 400 }
      )
    }
    
    console.log(`[Batch API - Panels] Processing ${operations.length} update operations`)
    
    const results = []
    
    await client.query('BEGIN')
    
    for (const op of operations) {
      // Check idempotency
      if (op.idempotencyKey && store.map.has(op.idempotencyKey)) {
        const cached = store.map.get(op.idempotencyKey)
        results.push({ ...cached?.result, cached: true })
        continue
      }
      
      try {
        // Extract data from operation
        const data = op.data || op
        const entityId = op.id || data.id
        
        if (!entityId) {
          results.push({ 
            error: 'Missing panel ID', 
            operation: op 
          })
          continue
        }
        
        // Build dynamic update query based on provided fields
        const updateFields = []
        const values = []
        let valueIndex = 2 // Start at 2 since $1 is the ID
        
        if (data.position !== undefined) {
          updateFields.push(`position = $${valueIndex++}::jsonb`)
          values.push(JSON.stringify(data.position))
        }
        
        if (data.dimensions !== undefined) {
          updateFields.push(`dimensions = $${valueIndex++}::jsonb`)
          values.push(JSON.stringify(data.dimensions))
        }
        
        if (data.state !== undefined) {
          updateFields.push(`state = $${valueIndex++}`)
          values.push(data.state)
        }
        
        // Always update last_accessed
        updateFields.push('last_accessed = NOW()')
        
        if (updateFields.length === 1) {
          // Only last_accessed, still update it
          const result = await client.query(
            `UPDATE panels 
             SET last_accessed = NOW()
             WHERE id = $1
             RETURNING id`,
            [entityId]
          )
          
          if (result.rows.length === 0) {
            results.push({ 
              error: 'Panel not found', 
              id: entityId 
            })
          } else {
            results.push({ 
              success: true, 
              id: result.rows[0].id 
            })
          }
        } else {
          const result = await client.query(
            `UPDATE panels 
             SET ${updateFields.join(', ')}
             WHERE id = $1
             RETURNING id`,
            [entityId, ...values]
          )
          
          if (result.rows.length === 0) {
            results.push({ 
              error: 'Panel not found', 
              id: entityId 
            })
          } else {
            const operationResult = { 
              success: true, 
              id: result.rows[0].id 
            }
            
            results.push(operationResult)
            
            // Store for idempotency
            if (op.idempotencyKey) {
              store.map.set(op.idempotencyKey, {
                timestamp: Date.now(),
                result: operationResult
              })
            }
          }
        }
      } catch (error) {
        console.error('[Batch API - Panels] Operation failed:', error)
        results.push({ 
          error: 'Operation failed', 
          message: error instanceof Error ? error.message : 'Unknown error',
          operation: op 
        })
      }
    }
    
    await client.query('COMMIT')
    
    console.log(`[Batch API - Panels] Successfully processed batch`)
    
    return NextResponse.json({ 
      success: true, 
      results,
      processed: results.filter(r => r.success).length,
      failed: results.filter(r => r.error).length
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Batch API - Panels] Batch operation failed:', error)
    return NextResponse.json(
      { 
        error: 'Batch operation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}

export async function DELETE(request: NextRequest) {
  const client = await pool.connect()
  
  try {
    const { ids } = await request.json()
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: 'Invalid ids array' },
        { status: 400 }
      )
    }
    
    console.log(`[Batch API - Panels] Processing ${ids.length} delete operations`)
    
    await client.query('BEGIN')
    
    // Delete all panels in batch
    const result = await client.query(
      'DELETE FROM panels WHERE id = ANY($1::text[]) RETURNING id',
      [ids]
    )
    
    await client.query('COMMIT')
    
    console.log(`[Batch API - Panels] Successfully deleted ${result.rows.length} panels`)
    
    return NextResponse.json({ 
      success: true, 
      deleted: result.rows.length,
      ids: result.rows.map(r => r.id)
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Batch API - Panels] Batch delete failed:', error)
    return NextResponse.json(
      { 
        error: 'Batch delete failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}