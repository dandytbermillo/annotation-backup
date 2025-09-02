import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'

// Ensure Node.js runtime (pg requires Node)
export const runtime = 'nodejs'

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

// Deterministic mapping for non-UUID IDs (slugs) → UUID
const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a' // keep stable across services
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))

// Idempotency tracking (in production, use Redis or database)
type ProcessedEntry = { timestamp: number; result: any }
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000 // 24 hours
const IDEMPOTENCY_SWEEP_INTERVAL = 60 * 60 * 1000 // 1 hour

function getProcessedStore(): { map: Map<string, ProcessedEntry>; lastSweep: number } {
  const g = globalThis as any
  if (!g.__batchDocumentsStore) {
    g.__batchDocumentsStore = { map: new Map<string, ProcessedEntry>(), lastSweep: 0 }
  }
  return g.__batchDocumentsStore
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

// Normalize panelId helper (same as in regular documents route)
const normalizePanelId = (noteId: string, panelId: string): string => {
  const isUuid = /^(?:[0-9a-fA-F]{8}-){3}[0-9a-fA-F]{12}$/
  if (isUuid.test(panelId)) return panelId
  return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
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
    
    console.log(`[Batch API - Documents] Processing ${operations.length} create operations`)
    
    const results: any[] = []
    
    await client.query('BEGIN')
    
    // Coalesce by (noteId, panelId) — keep the LAST content in this batch
    const byPanel = new Map<string, { noteId: string; panelId: string; contentJson: any; idempotencyKey?: string }>()
    
    for (const op of operations) {
      // Check idempotency
      if (op.idempotencyKey && store.map.has(op.idempotencyKey)) {
        const cached = store.map.get(op.idempotencyKey)
        results.push({ ...cached?.result, cached: true })
        continue
      }
      
      try {
        // Validate required fields (server will compute version)
        const { noteId, panelId, content } = op
        
        if (!noteId || !panelId || !content) {
          results.push({ 
            error: 'Missing required fields', 
            operation: op 
          })
          continue
        }
        
        const normalizedPanelId = normalizePanelId(noteId, panelId)
        
        const contentJson = typeof content === 'string' ? { html: content } : content
        byPanel.set(`${noteId}:${normalizedPanelId}`, { noteId, panelId: normalizedPanelId, contentJson, idempotencyKey: op.idempotencyKey })
      } catch (error) {
        console.error('[Batch API - Documents] Operation failed:', error)
        results.push({ 
          error: 'Operation failed', 
          message: error instanceof Error ? error.message : 'Unknown error',
          operation: op 
        })
      }
    }
    
    // Persist one row per (noteId, panelId) with server-computed version
    for (const { noteId, panelId, contentJson, idempotencyKey } of byPanel.values()) {
      // Coerce slugs to UUIDs
      const noteKey = coerceEntityId(noteId)
      const panelKey = coerceEntityId(panelId)
      
      // Ensure the note exists (auto-create if missing)
      await client.query(
        `INSERT INTO notes (id, title, metadata, created_at, updated_at)
         VALUES ($1::uuid, 'Untitled', '{}'::jsonb, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [noteKey]
      )
      
      // Skip if content equals latest (content-based coalescing)
      const latest = await client.query(
        `SELECT content, version FROM document_saves
         WHERE note_id = $1 AND panel_id = $2
         ORDER BY version DESC LIMIT 1`,
        [noteKey, panelKey]
      )
      if (latest.rows[0] && JSON.stringify(latest.rows[0].content) === JSON.stringify(contentJson)) {
        results.push({ success: true, skipped: true, noteId, panelId, reason: 'no-change' })
        continue
      }

      // Compute next version and insert with retry-on-conflict (concurrent batches)
      let inserted = false
      for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
        const nextVersionRow = await client.query(
          `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
           FROM document_saves
           WHERE note_id = $1 AND panel_id = $2`,
          [noteKey, panelKey]
        )
        const nextVersion = nextVersionRow.rows[0].next_version
        try {
          const ins = await client.query(
            `INSERT INTO document_saves 
             (note_id, panel_id, content, version, created_at)
             VALUES ($1, $2, $3::jsonb, $4, NOW())
             RETURNING id`,
            [noteKey, panelKey, JSON.stringify(contentJson), nextVersion]
          )
          const operationResult = { success: true, id: ins.rows[0]?.id, noteId, panelId, version: nextVersion }
          results.push(operationResult)
          if (idempotencyKey) {
            store.map.set(idempotencyKey, { timestamp: Date.now(), result: operationResult })
          }
          inserted = true
        } catch (e: any) {
          // Unique violation — concurrent insert used same version; retry
          if (e && e.code === '23505') continue
          throw e
        }
      }
      if (!inserted) {
        results.push({ success: false, error: 'version_conflict', noteId, panelId })
      }
    }
    
    await client.query('COMMIT')
    console.log(`[Batch API - Documents] Successfully processed ${byPanel.size} grouped operations`)
    return NextResponse.json({
      success: true,
      results,
      processed: results.filter(r => r.success && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      failed: results.filter(r => r.error).length
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Batch API - Documents] Batch operation failed:', error)
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
    
    console.log(`[Batch API - Documents] Processing ${operations.length} update operations`)
    
    const results: any[] = []
    
    await client.query('BEGIN')
    
    // Coalesce by (noteId, panelId) — keep the LAST content in this batch
    const byPanel = new Map<string, { noteId: string; panelId: string; contentJson: any; idempotencyKey?: string }>()
    
    for (const op of operations) {
      // Check idempotency
      if (op.idempotencyKey && store.map.has(op.idempotencyKey)) {
        const cached = store.map.get(op.idempotencyKey)
        results.push({ ...cached?.result, cached: true })
        continue
      }
      
      try {
        // Extract data; server computes version
        const data = op.data || op
        const { noteId, panelId, content } = data
        
        if (!noteId || !panelId || !content) {
          results.push({ 
            error: 'Missing required fields', 
            operation: op 
          })
          continue
        }
        
        const normalizedPanelId = normalizePanelId(noteId, panelId)
        
        const contentJson = typeof content === 'string' ? { html: content } : content
        byPanel.set(`${noteId}:${normalizedPanelId}`, { noteId, panelId: normalizedPanelId, contentJson, idempotencyKey: op.idempotencyKey })
      } catch (error) {
        console.error('[Batch API - Documents] Operation failed:', error)
        results.push({ 
          error: 'Operation failed', 
          message: error instanceof Error ? error.message : 'Unknown error',
          operation: op 
        })
      }
    }
    
    // Persist one row per (noteId, panelId) with server-computed version
    for (const { noteId, panelId, contentJson, idempotencyKey } of byPanel.values()) {
      // Coerce slugs to UUIDs
      const noteKey = coerceEntityId(noteId)
      const panelKey = coerceEntityId(panelId)
      
      // Ensure the note exists (auto-create if missing)
      await client.query(
        `INSERT INTO notes (id, title, metadata, created_at, updated_at)
         VALUES ($1::uuid, 'Untitled', '{}'::jsonb, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [noteKey]
      )
      
      const latest = await client.query(
        `SELECT content, version FROM document_saves
         WHERE note_id = $1 AND panel_id = $2
         ORDER BY version DESC LIMIT 1`,
        [noteKey, panelKey]
      )
      if (latest.rows[0] && JSON.stringify(latest.rows[0].content) === JSON.stringify(contentJson)) {
        results.push({ success: true, skipped: true, noteId, panelId, reason: 'no-change' })
        continue
      }

      let inserted = false
      for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
        const nextVersionRow = await client.query(
          `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
           FROM document_saves WHERE note_id = $1 AND panel_id = $2`,
          [noteKey, panelKey]
        )
        const nextVersion = nextVersionRow.rows[0].next_version
        try {
          const ins = await client.query(
            `INSERT INTO document_saves 
             (note_id, panel_id, content, version, created_at)
             VALUES ($1, $2, $3::jsonb, $4, NOW())
             RETURNING id`,
            [noteKey, panelKey, JSON.stringify(contentJson), nextVersion]
          )
          const operationResult = { success: true, id: ins.rows[0]?.id, noteId, panelId, version: nextVersion }
          results.push(operationResult)
          if (idempotencyKey) {
            store.map.set(idempotencyKey, { timestamp: Date.now(), result: operationResult })
          }
          inserted = true
        } catch (e: any) {
          if (e && e.code === '23505') continue
          throw e
        }
      }
      if (!inserted) {
        results.push({ success: false, error: 'version_conflict', noteId, panelId })
      }
    }
    
    await client.query('COMMIT')
    console.log(`[Batch API - Documents] Successfully processed ${byPanel.size} grouped operations`)
    return NextResponse.json({
      success: true,
      results,
      processed: results.filter(r => r.success && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      failed: results.filter(r => r.error).length
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Batch API - Documents] Batch operation failed:', error)
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
    
    console.log(`[Batch API - Documents] Processing ${ids.length} delete operations`)
    
    await client.query('BEGIN')
    
    // Parse entity IDs to extract noteId and panelId
    const deletions = ids.map(id => {
      const [noteId, panelId] = id.split(':')
      return { noteId, panelId }
    })
    
    // Delete all documents in batch
    for (const { noteId, panelId } of deletions) {
      if (noteId && panelId) {
        // Coerce slugs to UUIDs
        const noteKey = coerceEntityId(noteId)
        const panelKey = coerceEntityId(panelId)
        
        await client.query(
          'DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2',
          [noteKey, panelKey]
        )
      }
    }
    
    await client.query('COMMIT')
    
    console.log(`[Batch API - Documents] Successfully deleted ${ids.length} documents`)
    
    return NextResponse.json({ 
      success: true, 
      deleted: ids.length 
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[Batch API - Documents] Batch delete failed:', error)
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