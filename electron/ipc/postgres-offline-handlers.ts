const { ipcMain } = require('electron')
const { Pool } = require('pg')
const { v5: uuidv5 } = require('uuid')

// Normalize panelId: accept human-readable IDs (e.g., "main") by mapping to a
// deterministic UUID per note using UUID v5 in the DNS namespace.
const normalizePanelId = (noteId: string, panelId: string): string => {
  const isUuid = /^(?:[0-9a-fA-F]{8}-){3}[0-9a-fA-F]{12}$/
  if (isUuid.test(panelId)) return panelId
  return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
}

// Get database URL based on environment
const getDatabaseUrl = () => {
  // Try remote first, fallback to local
  return process.env.DATABASE_URL_REMOTE || 
         process.env.DATABASE_URL_LOCAL || 
         process.env.DATABASE_URL ||
         'postgres://postgres:postgres@localhost:5432/annotation_dev'
}

// Create connection pool
let pool: any = null

const getPool = () => {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl()
    })
  }
  return pool
}

// IPC handlers for plain mode operations
const handlers = {
  'postgres-offline:createNote': async (event: any, input: any) => {
    const pool = getPool()
    try {
      const { title = 'Untitled', metadata = {} } = input
      const result = await pool.query(
        `INSERT INTO notes (title, metadata, created_at, updated_at)
         VALUES ($1, $2::jsonb, NOW(), NOW())
         RETURNING id, title, metadata, created_at, updated_at`,
        [title, JSON.stringify(metadata)]
      )
      return { success: true, data: result.rows[0] }
    } catch (error: any) {
      console.error('[postgres-offline:createNote] Error:', error)
      return { success: false, error: error.message }
    }
  },
  
  'postgres-offline:updateNote': async (event: any, id: string, patch: any) => {
    const pool = getPool()
    try {
      const { title, metadata } = patch
      
      // Build dynamic update query
      const updates: string[] = []
      const values: any[] = [id]
      let paramIndex = 2
      
      if (title !== undefined) {
        updates.push(`title = $${paramIndex}`)
        values.push(title)
        paramIndex++
      }
      
      if (metadata !== undefined) {
        updates.push(`metadata = $${paramIndex}::jsonb`)
        values.push(JSON.stringify(metadata))
        paramIndex++
      }
      
      if (updates.length === 0) {
        return { success: false, error: 'No fields to update' }
      }
      
      updates.push('updated_at = NOW()')
      
      const result = await pool.query(
        `UPDATE notes 
         SET ${updates.join(', ')}
         WHERE id = $1
         RETURNING id, title, metadata, created_at, updated_at`,
        values
      )
      
      if (result.rows.length === 0) {
        return { success: false, error: 'Note not found' }
      }
      
      return { success: true, data: result.rows[0] }
    } catch (error: any) {
      console.error('[postgres-offline:updateNote] Error:', error)
      return { success: false, error: error.message }
    }
  },
  
  'postgres-offline:getNote': async (event: any, id: string) => {
    const pool = getPool()
    try {
      const result = await pool.query(
        `SELECT id, title, metadata, created_at, updated_at
         FROM notes WHERE id = $1`,
        [id]
      )
      
      if (result.rows.length === 0) {
        return { success: true, data: null }
      }
      
      return { success: true, data: result.rows[0] }
    } catch (error: any) {
      console.error('[postgres-offline:getNote] Error:', error)
      return { success: false, error: error.message }
    }
  },
  
  'postgres-offline:createBranch': async (event: any, input: any) => {
    const pool = getPool()
    try {
      const { 
        noteId = '', 
        parentId = '', 
        type = 'note', 
        originalText = '', 
        metadata = {}, 
        anchors 
      } = input
      
      const result = await pool.query(
        `INSERT INTO branches 
         (note_id, parent_id, type, original_text, metadata, anchors, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), NOW())
         RETURNING id, note_id as "noteId", parent_id as "parentId", 
                   type, original_text as "originalText", metadata, anchors, 
                   created_at as "createdAt", updated_at as "updatedAt"`,
        [
          noteId, 
          parentId, 
          type, 
          originalText, 
          JSON.stringify(metadata), 
          anchors ? JSON.stringify(anchors) : null
        ]
      )
      
      return { success: true, data: result.rows[0] }
    } catch (error: any) {
      console.error('[postgres-offline:createBranch] Error:', error)
      return { success: false, error: error.message }
    }
  },
  
  'postgres-offline:updateBranch': async (event: any, id: string, patch: any) => {
    const pool = getPool()
    try {
      const { type, originalText, metadata, anchors, version } = patch
      
      // Build dynamic update query
      const updates: string[] = []
      const values: any[] = [id]
      let paramIndex = 2
      
      if (type !== undefined) {
        updates.push(`type = $${paramIndex}`)
        values.push(type)
        paramIndex++
      }
      
      if (originalText !== undefined) {
        updates.push(`original_text = $${paramIndex}`)
        values.push(originalText)
        paramIndex++
      }
      
      if (metadata !== undefined) {
        updates.push(`metadata = $${paramIndex}::jsonb`)
        values.push(JSON.stringify(metadata))
        paramIndex++
      }
      
      if (anchors !== undefined) {
        updates.push(`anchors = $${paramIndex}::jsonb`)
        values.push(JSON.stringify(anchors))
        paramIndex++
      }
      
      // Always update version and timestamp
      if (version !== undefined) {
        updates.push(`version = $${paramIndex}`)
        values.push(version)
        paramIndex++
      }
      
      updates.push('updated_at = NOW()')
      
      const result = await pool.query(
        `UPDATE branches 
         SET ${updates.join(', ')}
         WHERE id = $1
         RETURNING id, note_id as "noteId", parent_id as "parentId", 
                   type, original_text as "originalText", metadata, anchors, 
                   created_at as "createdAt", updated_at as "updatedAt"`,
        values
      )
      
      if (result.rows.length === 0) {
        return { success: false, error: 'Branch not found' }
      }
      
      return { success: true, data: result.rows[0] }
    } catch (error: any) {
      console.error('[postgres-offline:updateBranch] Error:', error)
      return { success: false, error: error.message }
    }
  },
  
  'postgres-offline:listBranches': async (event: any, noteId: string) => {
    const pool = getPool()
    try {
      const result = await pool.query(
        `SELECT id, note_id as "noteId", parent_id as "parentId", 
                type, original_text as "originalText", metadata, anchors, 
                created_at as "createdAt", updated_at as "updatedAt"
         FROM branches 
         WHERE note_id = $1
         ORDER BY created_at ASC`,
        [noteId]
      )
      
      return { success: true, data: result.rows }
    } catch (error: any) {
      console.error('[postgres-offline:listBranches] Error:', error)
      return { success: false, error: error.message }
    }
  },
  
  'postgres-offline:saveDocument': async (event: any, noteId: string, panelId: string, content: any, version: number) => {
    const pool = getPool()
    try {
      // Store content as JSONB
      const contentJson = typeof content === 'string' 
        ? { html: content } 
        : content
      
      const normalizedPanelId = normalizePanelId(noteId, panelId)
      
      await pool.query(
        `INSERT INTO document_saves 
         (note_id, panel_id, content, version, created_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (note_id, panel_id, version)
         DO UPDATE SET content = EXCLUDED.content, created_at = NOW()`,
        [noteId, normalizedPanelId, JSON.stringify(contentJson), version]
      )
      
      console.log(`[postgres-offline:saveDocument] Saved document for note=${noteId}, panel=${panelId}, version=${version}`)
      return { success: true }
    } catch (error: any) {
      console.error('[postgres-offline:saveDocument] Error:', error)
      return { success: false, error: error.message }
    }
  },
  
  'postgres-offline:loadDocument': async (event: any, noteId: string, panelId: string) => {
    const pool = getPool()
    try {
      const normalizedPanelId = normalizePanelId(noteId, panelId)
      
      // Get the latest version for this note-panel combination
      const result = await pool.query(
        `SELECT content, version 
         FROM document_saves 
         WHERE note_id = $1 AND panel_id = $2
         ORDER BY version DESC
         LIMIT 1`,
        [noteId, normalizedPanelId]
      )
      
      if (result.rows.length === 0) {
        console.log(`[postgres-offline:loadDocument] No document found for note=${noteId}, panel=${panelId}`)
        return { success: true, data: null }
      }
      
      const { content, version } = result.rows[0]
      
      // Check if content is HTML string format
      if (content.html && typeof content.html === 'string') {
        return { success: true, data: { content: content.html, version } }
      }
      
      // Otherwise return as ProseMirror JSON
      return { success: true, data: { content, version } }
    } catch (error: any) {
      console.error('[postgres-offline:loadDocument] Error:', error)
      return { success: false, error: error.message }
    }
  },
  
  'postgres-offline:enqueueOffline': async (event: any, op: any) => {
    const pool = getPool()
    try {
      // Map to offline_queue table structure
      const tableNameMap: Record<string, string> = {
        note: 'notes',
        branch: 'branches',
        panel: 'panels',
        document: 'document_saves'
      }
      
      const tableName = tableNameMap[op.entityType] || op.entityType
      
      await pool.query(
        `INSERT INTO offline_queue 
         (type, table_name, entity_id, data, status, created_at)
         VALUES ($1, $2, $3, $4::jsonb, 'pending', NOW())`,
        [op.operation, tableName, op.entityId, JSON.stringify(op.payload)]
      )
      
      console.log(`[postgres-offline:enqueueOffline] Enqueued offline operation: ${op.operation} ${op.entityType} ${op.entityId}`)
      return { success: true }
    } catch (error: any) {
      console.error('[postgres-offline:enqueueOffline] Error:', error)
      return { success: false, error: error.message }
    }
  },
  
  'postgres-offline:flushQueue': async (event: any) => {
    const pool = getPool()
    const client = await pool.connect()
    
    let processed = 0
    let failed = 0
    
    try {
      await client.query('BEGIN')
      
      // Get all pending operations
      const result = await client.query(
        `SELECT id, type, table_name, entity_id, data
         FROM offline_queue
         WHERE status = 'pending'
         ORDER BY created_at ASC
         FOR UPDATE`
      )
      
      for (const row of result.rows) {
        try {
          // Process each operation
          await processQueueOperation(client, row)
          
          // Mark as processed
          await client.query(
            `UPDATE offline_queue 
             SET status = 'processing', updated_at = NOW()
             WHERE id = $1`,
            [row.id]
          )
          
          processed++
        } catch (error: any) {
          console.error(`[postgres-offline:flushQueue] Failed to process queue item ${row.id}:`, error)
          
          // Mark as failed
          await client.query(
            `UPDATE offline_queue 
             SET status = 'failed', 
                 error_message = $2,
                 retry_count = retry_count + 1,
                 updated_at = NOW()
             WHERE id = $1`,
            [row.id, String(error)]
          )
          
          failed++
        }
      }
      
      // Delete successfully processed items
      await client.query(
        `DELETE FROM offline_queue WHERE status = 'processing'`
      )
      
      await client.query('COMMIT')
    } catch (error: any) {
      await client.query('ROLLBACK')
      console.error('[postgres-offline:flushQueue] Transaction error:', error)
      throw error
    } finally {
      client.release()
    }
    
    console.log(`[postgres-offline:flushQueue] Queue flush complete: processed=${processed}, failed=${failed}`)
    return { success: true, data: { processed, failed } }
  }
}

/**
 * Process a single queue operation
 */
async function processQueueOperation(client: any, row: any) {
  const { type, table_name, entity_id, data } = row
  
  switch (type) {
    case 'create':
      if (table_name === 'branches') {
        await client.query(
          `INSERT INTO branches 
           (id, note_id, parent_id, type, original_text, metadata, anchors, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            entity_id,
            data.noteId,
            data.parentId,
            data.type,
            data.originalText,
            JSON.stringify(data.metadata || {}),
            data.anchors ? JSON.stringify(data.anchors) : null,
            data.createdAt,
            data.updatedAt
          ]
        )
      }
      // Add other create operations as needed
      break
      
    case 'update':
      if (table_name === 'document_saves') {
        const normalizedPanelId = normalizePanelId(data.noteId, data.panelId)
        await client.query(
          `INSERT INTO document_saves 
           (note_id, panel_id, content, version, created_at)
           VALUES ($1, $2, $3::jsonb, $4, NOW())
           ON CONFLICT (note_id, panel_id, version)
           DO UPDATE SET content = EXCLUDED.content`,
          [data.noteId, normalizedPanelId, JSON.stringify(data.content), data.version]
        )
      }
      // Add other update operations as needed
      break
      
    case 'delete':
      // Handle delete operations
      await client.query(
        `DELETE FROM ${table_name} WHERE id = $1`,
        [entity_id]
      )
      break
  }
}

/**
 * Register all IPC handlers
 */
function registerPostgresOfflineHandlers() {
  Object.entries(handlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, handler)
  })
  console.log('[postgres-offline] Registered all IPC handlers')
}

module.exports = { registerPostgresOfflineHandlers }