import * as Y from 'yjs'
import { PersistenceProvider } from '../enhanced-yjs-provider'

/**
 * In-memory persistence adapter for development
 * Stores YJS updates in memory only - data is lost on restart
 */
export class MemoryAdapter implements PersistenceProvider {
  private updates: Map<string, Uint8Array[]> = new Map()
  private snapshots: Map<string, Uint8Array> = new Map()

  async persist(docName: string, update: Uint8Array): Promise<void> {
    if (!this.updates.has(docName)) {
      this.updates.set(docName, [])
    }
    this.updates.get(docName)!.push(update)
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
    return this.updates.get(docName) || []
  }

  async clearUpdates(docName: string): Promise<void> {
    this.updates.delete(docName)
  }

  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    this.snapshots.set(docName, snapshot)
  }

  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    return this.snapshots.get(docName) || null
  }

  async compact(docName: string): Promise<void> {
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) return

    // Merge updates into a single state
    const doc = new Y.Doc()
    updates.forEach(update => Y.applyUpdate(doc, update))
    const mergedState = Y.encodeStateAsUpdate(doc)

    // Save as snapshot
    await this.saveSnapshot(docName, mergedState)

    // Clear old updates
    await this.clearUpdates(docName)
  }
}