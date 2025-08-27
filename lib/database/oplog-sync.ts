import { Pool } from 'pg'
import * as Y from 'yjs'

// OplogEntry type duplicated here to avoid circular dependency
interface OplogEntry {
  id: number
  entity_type: 'yjs_update' | 'snapshot'
  entity_id: string
  operation: 'persist' | 'compact'
  payload: Buffer
  timestamp: Date
  origin: 'local' | 'remote'
  synced: boolean
}

export class OplogSync {
  private remotePool: Pool
  private localPool: Pool
  private syncInterval?: NodeJS.Timeout
  private isSyncing = false
  private syncIntervalMs = 30000 // 30 seconds

  constructor(remotePool: Pool, localPool: Pool) {
    this.remotePool = remotePool
    this.localPool = localPool
  }

  start(intervalMs: number = 30000): void {
    this.syncIntervalMs = intervalMs
    
    if (this.syncInterval) {
      return // Already running
    }

    // Initial sync
    this.syncPending().catch(console.error)

    // Schedule periodic syncs
    this.syncInterval = setInterval(() => {
      if (!this.isSyncing) {
        this.syncPending().catch(console.error)
      }
    }, this.syncIntervalMs)
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = undefined
    }
  }

  async syncPending(): Promise<void> {
    if (this.isSyncing) return
    
    this.isSyncing = true
    try {
      // Get pending entries from local
      const pending = await this.localPool.query<OplogEntry>(
        'SELECT * FROM oplog WHERE origin = $1 AND synced = $2 ORDER BY timestamp LIMIT 100',
        ['local', false]
      )

      for (const entry of pending.rows) {
        try {
          // Apply to remote
          await this.applyEntry(entry)
          
          // Mark as synced
          await this.localPool.query(
            'UPDATE oplog SET synced = true WHERE id = $1',
            [entry.id]
          )
        } catch (error) {
          // Log but continue with next entry
          console.error(`Sync failed for entry ${entry.id}:`, error)
          
          // If it's a connection error, stop trying
          if (this.isConnectionError(error)) {
            break
          }
        }
      }

      // Clean up old synced entries
      await this.cleanupSyncedEntries()
    } finally {
      this.isSyncing = false
    }
  }

  private async applyEntry(entry: OplogEntry): Promise<void> {
    const client = await this.remotePool.connect()
    
    try {
      await client.query('BEGIN')

      if (entry.entity_type === 'yjs_update') {
        // Apply YJS update
        await client.query(
          'INSERT INTO yjs_updates (doc_name, update, timestamp) VALUES ($1, $2, $3)',
          [entry.entity_id, entry.payload, entry.timestamp]
        )
      } else if (entry.entity_type === 'snapshot' && entry.operation === 'compact') {
        // Apply snapshot
        const noteId = '00000000-0000-0000-0000-000000000000' // Dummy note_id
        await client.query(
          'INSERT INTO snapshots (note_id, doc_name, state, checksum, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (doc_name) DO UPDATE SET state = EXCLUDED.state, created_at = EXCLUDED.created_at',
          [noteId, entry.entity_id, entry.payload, 'checksum', entry.timestamp]
        )
        
        // Clear old updates up to this point
        await client.query(
          'DELETE FROM yjs_updates WHERE doc_name = $1 AND timestamp <= $2',
          [entry.entity_id, entry.timestamp]
        )
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async cleanupSyncedEntries(): Promise<void> {
    try {
      // Keep last 1000 synced entries for history
      await this.localPool.query(`
        DELETE FROM oplog 
        WHERE synced = true 
        AND id < (
          SELECT MIN(id) 
          FROM (
            SELECT id FROM oplog 
            WHERE synced = true 
            ORDER BY id DESC 
            LIMIT 1000
          ) AS recent
        )
      `)
    } catch (error) {
      console.error('Failed to cleanup synced entries:', error)
    }
  }

  private isConnectionError(error: any): boolean {
    return error.code === 'ECONNREFUSED' || 
           error.code === 'ETIMEDOUT' ||
           error.code === 'ENOTFOUND'
  }

  async getSyncStatus(): Promise<{
    pendingCount: number
    lastSyncTime?: Date
    oldestPending?: Date
  }> {
    const pendingResult = await this.localPool.query(
      'SELECT COUNT(*) as count FROM oplog WHERE origin = $1 AND synced = $2',
      ['local', false]
    )

    const oldestResult = await this.localPool.query(
      'SELECT MIN(timestamp) as oldest FROM oplog WHERE origin = $1 AND synced = $2',
      ['local', false]
    )

    const lastSyncResult = await this.localPool.query(
      'SELECT MAX(timestamp) as last_sync FROM oplog WHERE origin = $1 AND synced = $2',
      ['local', true]
    )

    return {
      pendingCount: parseInt(pendingResult.rows[0].count),
      lastSyncTime: lastSyncResult.rows[0].last_sync,
      oldestPending: oldestResult.rows[0].oldest
    }
  }

  // Handle conflict resolution for concurrent updates
  async resolveConflicts(docName: string): Promise<void> {
    const client = await this.remotePool.connect()
    
    try {
      // Get all updates from both databases
      const [remoteUpdates, localUpdates] = await Promise.all([
        client.query(
          'SELECT update, timestamp FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp',
          [docName]
        ),
        this.localPool.query(
          'SELECT payload as update, timestamp FROM oplog WHERE entity_id = $1 AND entity_type = $2 ORDER BY timestamp',
          [docName, 'yjs_update']
        )
      ])

      // Merge all updates using YJS
      const doc = new Y.Doc()
      const allUpdates = [
        ...remoteUpdates.rows.map(r => ({ update: r.update, timestamp: r.timestamp })),
        ...localUpdates.rows.map(r => ({ update: r.update, timestamp: r.timestamp }))
      ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

      allUpdates.forEach(({ update }) => {
        Y.applyUpdate(doc, new Uint8Array(update))
      })

      // Save merged state as new snapshot
      const mergedState = Y.encodeStateAsUpdate(doc)
      await client.query(
        'INSERT INTO snapshots (doc_name, snapshot, created_at) VALUES ($1, $2, NOW())',
        [docName, Buffer.from(mergedState)]
      )
    } finally {
      client.release()
    }
  }
}