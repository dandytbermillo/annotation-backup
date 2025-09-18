/**
 * PostgresOfflineAdapter - PostgreSQL adapter for Option A (offline, single-user mode)
 * 
 * Implements the PlainCrudAdapter interface for non-Yjs storage.
 * Extends PostgresAdapter base class for connection management.
 * 
 * @module lib/adapters/postgres-offline-adapter
 */

import { Pool, PoolClient } from 'pg'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'
import { PostgresAdapter } from './postgres-adapter'
import { WorkspaceStore } from '@/lib/workspace/workspace-store'
import type { 
  PlainCrudAdapter, 
  Note, 
  Branch, 
  Panel,
  ProseMirrorJSON, 
  HtmlString, 
  QueueOp 
} from '../providers/plain-offline-provider'

/**
 * PostgresOfflineAdapter - Implements PlainCrudAdapter for PostgreSQL persistence
 * 
 * This adapter provides CRUD operations for the plain offline mode,
 * storing content as JSON/HTML instead of Yjs binary format.
 */
export abstract class PostgresOfflineAdapter extends PostgresAdapter implements PlainCrudAdapter {

  private async withWorkspace<T>(fn: (ctx: { client: PoolClient; workspaceId: string }) => Promise<T>): Promise<T> {
    const pool = this.getPool()
    return WorkspaceStore.withWorkspace(pool, fn)
  }

  // UUID namespace for deterministic ID mapping (must match API)
  private readonly ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a'
  
  /**
   * Coerce entity ID to UUID format for consistency with API
   */
  private coerceEntityId(id: string): string {
    return validateUuid(id) ? id : uuidv5(id, this.ID_NAMESPACE)
  }
  
  /**
   * Normalize panel ID to UUID format
   */
  private normalizePanelId(noteId: string, panelId: string): string {
    if (validateUuid(panelId)) return panelId
    return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
  }
  
  /**
   * Note operations
   */
  async createNote(input: Partial<Note>): Promise<Note> {
    const pool = this.getPool()
    const { title = 'Untitled', metadata = {} } = input
    
    const result = await pool.query<Note>(
      `INSERT INTO notes (title, metadata, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())
       RETURNING id, title, metadata, created_at, updated_at`,
      [title, JSON.stringify(metadata)]
    )
    
    return result.rows[0]
  }

  async updateNote(id: string, patch: Partial<Note> & { version: number }): Promise<Note> {
    const pool = this.getPool()
    const { title, metadata, version } = patch
    
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
    
    updates.push('updated_at = NOW()')
    
    const result = await pool.query<Note>(
      `UPDATE notes 
       SET ${updates.join(', ')}
       WHERE id = $1
       RETURNING id, title, metadata, created_at, updated_at`,
      values
    )
    
    if (result.rows.length === 0) {
      throw new Error(`Note ${id} not found`)
    }
    
    return result.rows[0]
  }

  async getNote(id: string): Promise<Note | null> {
    const result = await pool.query<Note>(
      `SELECT id, title, metadata, created_at, updated_at
       FROM notes WHERE id = $1`,
      [id]
    )
    
    return result.rows[0] || null
  }

  /**
   * Branch operations
   */
  async createBranch(input: Partial<Branch>): Promise<Branch> {
    const pool = this.getPool()
    const { 
      noteId = '', 
      parentId = '', 
      type = 'note', 
      originalText = '', 
      metadata = {}, 
      anchors 
    } = input
    
    const result = await pool.query<Branch>(
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
    
    return result.rows[0]
  }

  async updateBranch(id: string, patch: Partial<Branch> & { version: number }): Promise<Branch> {
    const pool = this.getPool()
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
    updates.push(`version = $${paramIndex}`)
    values.push(version)
    paramIndex++
    
    updates.push('updated_at = NOW()')
    
    const result = await pool.query<Branch>(
      `UPDATE branches 
       SET ${updates.join(', ')}
       WHERE id = $1
       RETURNING id, note_id as "noteId", parent_id as "parentId", 
                 type, original_text as "originalText", metadata, anchors, 
                 created_at as "createdAt", updated_at as "updatedAt"`,
      values
    )
    
    if (result.rows.length === 0) {
      throw new Error(`Branch ${id} not found`)
    }
    
    return result.rows[0]
  }

  async listBranches(noteId: string): Promise<Branch[]> {
    const pool = this.getPool()
    
    const result = await pool.query<Branch>(
      `SELECT id, note_id as "noteId", parent_id as "parentId", 
              type, original_text as "originalText", metadata, anchors, 
              created_at as "createdAt", updated_at as "updatedAt"
       FROM branches 
       WHERE note_id = $1
       ORDER BY created_at ASC`,
      [noteId]
    )
    
    return result.rows
  }

  /**
   * Document operations - stores ProseMirror JSON or HTML
   */
  async saveDocument(
    noteId: string, 
    panelId: string, 
    content: ProseMirrorJSON | HtmlString, 
    version: number,
    baseVersion: number
  ): Promise<void> {
    const pool = this.getPool()

    const noteKey = this.coerceEntityId(noteId)
    const normalizedPanelId = this.normalizePanelId(noteKey, panelId)

    const contentJson = typeof content === 'string'
      ? { html: content }
      : content

    await this.withWorkspace(async ({ client, workspaceId }) => {
      const latest = await client.query(
        `SELECT content, version
           FROM document_saves
          WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
          ORDER BY version DESC
          LIMIT 1`,
        [noteKey, normalizedPanelId, workspaceId]
      )

      const latestVersion: number = latest.rows[0]?.version ?? 0

      if (latest.rows[0] && JSON.stringify(latest.rows[0].content) === JSON.stringify(contentJson)) {
        console.log(`[PostgresOfflineAdapter] Skipping save (no change) for note=${noteId}, panel=${panelId}`)
        return
      }

      if (latestVersion > baseVersion) {
        throw new Error(`stale document save: baseVersion ${baseVersion} behind latest ${latestVersion}`)
      }

      if (version <= latestVersion) {
        throw new Error(`non-incrementing version ${version} (latest ${latestVersion})`)
      }

      if (version !== baseVersion + 1) {
        console.warn(`[PostgresOfflineAdapter] Non-sequential version detected: baseVersion=${baseVersion}, version=${version}`)
      }

      await client.query(
        `INSERT INTO document_saves 
         (note_id, panel_id, content, version, workspace_id, created_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, NOW())`,
        [noteKey, normalizedPanelId, JSON.stringify(contentJson), version, workspaceId]
      )
    })

    console.log(`[PostgresOfflineAdapter] Saved document for note=${noteId}, panel=${panelId}, version=${version}`)
  }
  async loadDocument(
    noteId: string, 
    panelId: string
  ): Promise<{ content: ProseMirrorJSON | HtmlString; version: number } | null> {
    const pool = this.getPool()
    
    // Coerce IDs to UUID format for consistency with API
    const noteKey = this.coerceEntityId(noteId)
    const normalizedPanelId = this.normalizePanelId(noteKey, panelId)
    
    const workspaceId = await WorkspaceStore.getDefaultWorkspaceId(pool)

    // Get the latest version for this note-panel combination
    const result = await pool.query(
      `SELECT content, version 
       FROM document_saves 
       WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
       ORDER BY version DESC
       LIMIT 1`,
      [noteKey, normalizedPanelId, workspaceId]
    )
    
    if (result.rows.length === 0) {
      console.log(`[PostgresOfflineAdapter] No document found for note=${noteId}, panel=${panelId}`)
      return null
    }
    
    const { content, version } = result.rows[0]
    
    // Check if content is HTML string format
    if (content.html && typeof content.html === 'string') {
      return { content: content.html, version }
    }
    
    // Otherwise return as ProseMirror JSON
    return { content, version }
  }

  /**
   * Offline queue operations
   */
  async enqueueOffline(op: QueueOp): Promise<void> {
    const pool = this.getPool()
    
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
    
    console.log(`[PostgresOfflineAdapter] Enqueued offline operation: ${op.operation} ${op.entityType} ${op.entityId}`)
  }

  async flushQueue(): Promise<{ processed: number; failed: number }> {
    const pool = this.getPool()
    const workspaceId = await WorkspaceStore.getDefaultWorkspaceId(pool)
    const client = await pool.connect()
    
    let processed = 0
    let failed = 0
    
    try {
      await client.query('BEGIN')
      await client.query('SELECT set_config($1, $2, false)', [
        'app.current_workspace_id',
        workspaceId,
      ])
      
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
          await this.processQueueOperation(client, row, workspaceId)
          
          // Mark as processed
          await client.query(
            `UPDATE offline_queue 
             SET status = 'processing', updated_at = NOW()
             WHERE id = $1`,
            [row.id]
          )
          
          processed++
        } catch (error) {
          console.error(`[PostgresOfflineAdapter] Failed to process queue item ${row.id}:`, error)
          
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
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    
    console.log(`[PostgresOfflineAdapter] Queue flush complete: processed=${processed}, failed=${failed}`)
    return { processed, failed }
  }

  /**
   * Process a single queue operation
   */
  private async processQueueOperation(client: any, row: any, workspaceId: string): Promise<void> {
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
          const rawNoteId = data?.noteId ?? data?.note_id ?? entity_id
          const rawPanelId = data?.panelId ?? data?.panel_id
          if (!rawNoteId || !rawPanelId) {
            throw new Error('document_saves requires noteId and panelId in data')
          }

          const noteId = this.coerceEntityId(rawNoteId)
          const panelId = this.normalizePanelId(noteId, rawPanelId)
          const rawContent = data?.content ?? {}
          const contentJson = typeof rawContent === 'string' ? { html: rawContent } : rawContent
          const contentString = JSON.stringify(contentJson)
          const baseVersion = typeof data?.baseVersion === 'number' && Number.isInteger(data.baseVersion) ? data.baseVersion : null
          const version = typeof data?.version === 'number' && Number.isInteger(data.version) ? data.version : null

          if (baseVersion === null || version === null) {
            throw new Error('baseVersion and version must be numbers')
          }

          const latest = await client.query(
            `SELECT content, version
               FROM document_saves
              WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
              ORDER BY version DESC
              LIMIT 1`,
            [noteId, panelId, workspaceId]
          )

          const latestRow = latest.rows[0]
          const latestVersion: number = latestRow?.version ?? 0

          if (
            latestRow &&
            JSON.stringify(latestRow.content) === contentString &&
            version === latestVersion
          ) {
            break
          }

          if (latestVersion > baseVersion) {
            throw new Error(`stale document save: baseVersion ${baseVersion} behind latest ${latestVersion}`)
          }

          if (version <= latestVersion) {
            throw new Error(`non-incrementing version ${version} (latest ${latestVersion})`)
          }

          if (version !== baseVersion + 1) {
            console.warn(`[PostgresOfflineAdapter] Non-sequential version detected: baseVersion=${baseVersion}, version=${version}`)
          }

          await client.query(
            `INSERT INTO document_saves 
             (note_id, panel_id, content, version, workspace_id, created_at)
             VALUES ($1, $2, $3::jsonb, $4, $5, NOW())`,
            [noteId, panelId, contentString, version, workspaceId]
          )
        }
        // Add other update operations as needed
        break
        
      case 'delete':
        if (table_name === 'document_saves') {
          const rawNoteId = data?.noteId ?? data?.note_id ?? entity_id
          const rawPanelId = data?.panelId ?? data?.panel_id
          if (!rawNoteId || !rawPanelId) {
            throw new Error('document_saves delete requires noteId and panelId')
          }

          const noteId = this.coerceEntityId(rawNoteId)
          const panelId = this.normalizePanelId(noteId, rawPanelId)

          await client.query(
            `DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3`,
            [noteId, panelId, workspaceId]
          )
        }
        // Handle other delete operations as needed
        break
    }
  }
}