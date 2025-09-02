import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// Deterministic mapping for non-UUID IDs (slugs) → UUID
const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a' // keep stable across services
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))

// Idempotency tracking (in production, use Redis or database)
const processedKeys = new Map<string, { timestamp: number; result: any }>()
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000 // 24 hours

// Clean up old idempotency keys periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of processedKeys.entries()) {
    if (now - value.timestamp > IDEMPOTENCY_TTL) {
      processedKeys.delete(key)
    }
  }
}, 60 * 60 * 1000) // Every hour

export async function POST(request: NextRequest) {
  const client = await pool.connect()
  
  try {
    const { operations } = await request.json()
    
    if (!Array.isArray(operations) || operations.length === 0) {
      return NextResponse.json(
        { error: 'Invalid operations array' },
        { status: 400 }
      )
    }
    
    console.log(`[Batch API - Branches] Processing ${operations.length} create operations`)
    
    const results = []
    
    await client.query('BEGIN')
    
    for (const op of operations) {
      // Check idempotency
      if (op.idempotencyKey && processedKeys.has(op.idempotencyKey)) {
        const cached = processedKeys.get(op.idempotencyKey)
        results.push({ ...cached?.result, cached: true })
        continue
      }
      
      try {
        const { id, noteId, parentId, type, originalText, metadata, anchors, createdAt, updatedAt } = op
        
        if (!id || !noteId) {
          results.push({ 
            error: 'Missing required fields (id, noteId)', 
            operation: op 
          })
          continue
        }
        
        // Coerce noteId to UUID if it's a slug
        const noteKey = coerceEntityId(noteId)
        
        // Validate branch ID - if not a valid UUID, generate a new one
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
        const branchId = (id && uuidRegex.test(String(id).trim())) ? String(id).trim() : uuidv5(`branch:${id || Date.now()}`, ID_NAMESPACE)
        
        // Ensure the note exists (auto-create if missing)
        await client.query(
          `INSERT INTO notes (id, title, metadata, created_at, updated_at)
           VALUES ($1::uuid, 'Untitled', '{}'::jsonb, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [noteKey]
        )
        
        const result = await client.query(
          `INSERT INTO branches 
           (id, note_id, parent_id, type, original_text, metadata, anchors, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             parent_id = EXCLUDED.parent_id,
             type = EXCLUDED.type,
             original_text = EXCLUDED.original_text,
             metadata = EXCLUDED.metadata,
             anchors = EXCLUDED.anchors,
             updated_at = NOW()
           RETURNING id`,
          [
            branchId,
            noteKey,
            parentId || null,
            type || 'note',
            originalText || '',
            JSON.stringify(metadata || {}),
            JSON.stringify(anchors || null),
            createdAt || new Date(),
            updatedAt || new Date()
          ]
        )
        
        const operationResult = { 
          success: true, 
          id: result.rows[0]?.id 
        }
        
        results.push(operationResult)
        
        // Store for idempotency
        if (op.idempotencyKey) {
          processedKeys.set(op.idempotencyKey, {
            timestamp: Date.now(),
            result: operationResult
          })
        }
      } catch (error) {
        console.error('[Batch API - Branches] Operation failed:', error)
        results.push({ 
          error: 'Operation failed', 
          message: error instanceof Error ? error.message : 'Unknown error',
          operation: op 
        })
      }
    }
    
    await client.query('COMMIT')
    
    console.log(`[Batch API - Branches] Successfully processed batch`)
    
    return NextResponse.json({ 
      success: true, 
      results,
      processed: results.filter(r => r.success).length,
      failed: results.filter(r => r.error).length
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Batch API - Branches] Batch operation failed:', error)
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
    const { operations } = await request.json()
    
    if (!Array.isArray(operations) || operations.length === 0) {
      return NextResponse.json(
        { error: 'Invalid operations array' },
        { status: 400 }
      )
    }
    
    console.log(`[Batch API - Branches] Processing ${operations.length} update operations`)
    
    const results = []
    
    await client.query('BEGIN')
    
    for (const op of operations) {
      // Check idempotency
      if (op.idempotencyKey && processedKeys.has(op.idempotencyKey)) {
        const cached = processedKeys.get(op.idempotencyKey)
        results.push({ ...cached?.result, cached: true })
        continue
      }
      
      try {
        // Extract data from operation
        const data = op.data || op
        const entityId = op.id || data.id
        
        if (!entityId) {
          results.push({ 
            error: 'Missing branch ID', 
            operation: op 
          })
          continue
        }
        
        // Build dynamic update query based on provided fields
        const updateFields = []
        const values = []
        let valueIndex = 2 // Start at 2 since $1 is the ID
        
        if (data.parentId !== undefined) {
          updateFields.push(`parent_id = $${valueIndex++}`)
          values.push(data.parentId)
        }
        
        if (data.type !== undefined) {
          updateFields.push(`type = $${valueIndex++}`)
          values.push(data.type)
        }
        
        if (data.originalText !== undefined) {
          updateFields.push(`original_text = $${valueIndex++}`)
          values.push(data.originalText)
        }
        
        if (data.metadata !== undefined) {
          updateFields.push(`metadata = $${valueIndex++}::jsonb`)
          values.push(JSON.stringify(data.metadata))
        }
        
        if (data.anchors !== undefined) {
          updateFields.push(`anchors = $${valueIndex++}::jsonb`)
          values.push(JSON.stringify(data.anchors))
        }
        
        // Always update the updated_at timestamp
        updateFields.push('updated_at = NOW()')
        
        if (updateFields.length === 1) {
          // Only updated_at, skip this operation
          results.push({ 
            success: true, 
            id: entityId,
            skipped: true,
            reason: 'No fields to update'
          })
          continue
        }
        
        const result = await client.query(
          `UPDATE branches 
           SET ${updateFields.join(', ')}
           WHERE id = $1
           RETURNING id`,
          [entityId, ...values]
        )
        
        if (result.rows.length === 0) {
          results.push({ 
            error: 'Branch not found', 
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
            processedKeys.set(op.idempotencyKey, {
              timestamp: Date.now(),
              result: operationResult
            })
          }
        }
      } catch (error) {
        console.error('[Batch API - Branches] Operation failed:', error)
        results.push({ 
          error: 'Operation failed', 
          message: error instanceof Error ? error.message : 'Unknown error',
          operation: op 
        })
      }
    }
    
    await client.query('COMMIT')
    
    console.log(`[Batch API - Branches] Successfully processed batch`)
    
    return NextResponse.json({ 
      success: true, 
      results,
      processed: results.filter(r => r.success).length,
      failed: results.filter(r => r.error).length
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Batch API - Branches] Batch operation failed:', error)
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
    
    console.log(`[Batch API - Branches] Processing ${ids.length} delete operations`)
    
    await client.query('BEGIN')
    
    // Delete all branches in batch
    const result = await client.query(
      'DELETE FROM branches WHERE id = ANY($1::text[]) RETURNING id',
      [ids]
    )
    
    await client.query('COMMIT')
    
    console.log(`[Batch API - Branches] Successfully deleted ${result.rows.length} branches`)
    
    return NextResponse.json({ 
      success: true, 
      deleted: result.rows.length,
      ids: result.rows.map(r => r.id)
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Batch API - Branches] Batch delete failed:', error)
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