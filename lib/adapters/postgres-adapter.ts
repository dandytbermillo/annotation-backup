import * as Y from 'yjs'
import { Pool, PoolClient } from 'pg'
import { PersistenceProvider } from '../enhanced-yjs-provider'

export abstract class PostgresAdapter implements PersistenceProvider {
  protected abstract getPool(): Pool

  protected toBuffer(data: Uint8Array): Buffer {
    return Buffer.from(data)
  }

  protected fromBuffer(buffer: Buffer): Uint8Array {
    return new Uint8Array(buffer)
  }

  async persist(docName: string, update: Uint8Array): Promise<void> {
    const pool = this.getPool()
    const buffer = this.toBuffer(update)

    await pool.query(
      'INSERT INTO yjs_updates (doc_name, update, timestamp) VALUES ($1, $2, NOW())',
      [docName, buffer]
    )
  }

  async load(docName: string): Promise<Uint8Array | null> {
    // Try snapshot first
    const snapshot = await this.loadSnapshot(docName)
    if (snapshot) return snapshot

    // Fall back to merging updates
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) return null

    // Let YJS handle merging
    const doc = new Y.Doc()
    updates.forEach(update => Y.applyUpdate(doc, update))
    return Y.encodeStateAsUpdate(doc)
  }

  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    const pool = this.getPool()
    const result = await pool.query(
      'SELECT update FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp',
      [docName]
    )

    return result.rows.map(row => this.fromBuffer(row.update))
  }

  async clearUpdates(docName: string): Promise<void> {
    const pool = this.getPool()
    await pool.query(
      'DELETE FROM yjs_updates WHERE doc_name = $1',
      [docName]
    )
  }

  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    const pool = this.getPool()
    const buffer = this.toBuffer(snapshot)
    
    // Generate a dummy note_id for now (snapshots table requires it)
    const noteId = '00000000-0000-0000-0000-000000000000'

    await pool.query(
      'INSERT INTO snapshots (note_id, doc_name, state, checksum, created_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (doc_name) DO UPDATE SET state = EXCLUDED.state, created_at = EXCLUDED.created_at',
      [noteId, docName, buffer, 'checksum']
    )
  }

  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    const pool = this.getPool()
    const result = await pool.query(
      'SELECT state FROM snapshots WHERE doc_name = $1',
      [docName]
    )

    if (result.rows.length === 0) return null
    return this.fromBuffer(result.rows[0].state)
  }

  async compact(docName: string): Promise<void> {
    const pool = this.getPool()
    const client = await pool.connect()
    
    try {
      await client.query('BEGIN')

      // Load all updates
      const updates = await this.getAllUpdates(docName)
      if (updates.length === 0) {
        await client.query('ROLLBACK')
        return
      }

      // Merge updates into a single state
      const doc = new Y.Doc()
      updates.forEach(update => Y.applyUpdate(doc, update))
      const mergedState = Y.encodeStateAsUpdate(doc)

      // Save as snapshot
      await this.saveSnapshot(docName, mergedState)

      // Clear old updates
      await this.clearUpdates(docName)

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}