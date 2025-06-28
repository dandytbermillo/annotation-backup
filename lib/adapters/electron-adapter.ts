import * as Y from 'yjs'
import { PersistenceProvider } from '../enhanced-yjs-provider'

// Mock implementation for browser compatibility
// In a real Electron app, you would import actual better-sqlite3
interface Database {
  prepare(sql: string): Statement
  exec(sql: string): void
  close(): void
}

interface Statement {
  run(...params: any[]): void
  get(...params: any[]): any
  all(...params: any[]): any[]
}

export class ElectronPersistenceAdapter implements PersistenceProvider {
  private db: Database | null = null
  private dbPath: string
  
  constructor(dbName: string) {
    this.dbPath = dbName
    this.initDatabase()
  }
  
  private initDatabase(): void {
    // In Electron, this would use better-sqlite3
    // For now, we'll use localStorage as a fallback
    if (typeof window !== 'undefined' && !(window as any).electronAPI) {
      console.warn('ElectronPersistenceAdapter: Running in browser mode, using localStorage')
      return
    }
    
    // Mock database initialization
    this.db = {
      prepare: (sql: string) => ({
        run: (...params: any[]) => {
          // Store in localStorage for mock
          const key = `electron-db-${params[0]}`
          localStorage.setItem(key, JSON.stringify(params))
        },
        get: (...params: any[]) => {
          const key = `electron-db-${params[0]}`
          const data = localStorage.getItem(key)
          return data ? JSON.parse(data) : null
        },
        all: (...params: any[]) => {
          // Return all items matching pattern
          const results = []
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key?.startsWith(`electron-db-${params[0]}`)) {
              const data = localStorage.getItem(key)
              if (data) results.push(JSON.parse(data))
            }
          }
          return results
        }
      }),
      exec: (sql: string) => {
        console.log('Executing SQL:', sql)
      },
      close: () => {
        console.log('Database closed')
      }
    }
    
    // Create tables
    this.createTables()
  }
  
  private createTables(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS yjs_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_name TEXT NOT NULL,
        update_data BLOB NOT NULL,
        timestamp INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_doc_timestamp ON yjs_updates (doc_name, timestamp);
      
      CREATE TABLE IF NOT EXISTS yjs_snapshots (
        doc_name TEXT PRIMARY KEY,
        snapshot_data BLOB NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `
    
    if (this.db) {
      this.db.exec(sql)
    }
  }
  
  async persist(docName: string, update: Uint8Array): Promise<void> {
    if (!this.db) {
      // Fallback to localStorage
      const key = `yjs-update-${docName}-${Date.now()}`
      localStorage.setItem(key, JSON.stringify(Array.from(update)))
      return
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO yjs_updates (doc_name, update_data, timestamp)
      VALUES (?, ?, ?)
    `)
    
    stmt.run(docName, Buffer.from(update), Date.now())
  }
  
  async load(docName: string): Promise<Uint8Array | null> {
    // Try snapshot first
    const snapshot = await this.loadSnapshot(docName)
    if (snapshot) return snapshot
    
    // Load all updates
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) return null
    
    // Merge updates
    const doc = new Y.Doc()
    updates.forEach(update => Y.applyUpdate(doc, update))
    
    return Y.encodeStateAsUpdate(doc)
  }
  
  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    if (!this.db) {
      // Fallback to localStorage
      const updates: Uint8Array[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(`yjs-update-${docName}-`)) {
          const data = localStorage.getItem(key)
          if (data) {
            updates.push(new Uint8Array(JSON.parse(data)))
          }
        }
      }
      return updates
    }
    
    const stmt = this.db.prepare(`
      SELECT update_data FROM yjs_updates 
      WHERE doc_name = ? 
      ORDER BY timestamp ASC
    `)
    
    const rows = stmt.all(docName) as { update_data: Buffer }[]
    return rows.map(row => new Uint8Array(row.update_data))
  }
  
  async clearUpdates(docName: string): Promise<void> {
    if (!this.db) {
      // Fallback to localStorage
      const keysToDelete = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(`yjs-update-${docName}-`)) {
          keysToDelete.push(key)
        }
      }
      keysToDelete.forEach(key => localStorage.removeItem(key))
      return
    }
    
    const stmt = this.db.prepare(`
      DELETE FROM yjs_updates WHERE doc_name = ?
    `)
    stmt.run(docName)
  }
  
  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    if (!this.db) {
      // Fallback to localStorage
      localStorage.setItem(`yjs-snapshot-${docName}`, JSON.stringify(Array.from(snapshot)))
      // Clear old updates
      await this.clearUpdates(docName)
      return
    }
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO yjs_snapshots (doc_name, snapshot_data, timestamp)
      VALUES (?, ?, ?)
    `)
    
    stmt.run(docName, Buffer.from(snapshot), Date.now())
    
    // Clear old updates
    await this.clearUpdates(docName)
  }
  
  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    if (!this.db) {
      // Fallback to localStorage
      const data = localStorage.getItem(`yjs-snapshot-${docName}`)
      if (data) {
        return new Uint8Array(JSON.parse(data))
      }
      return null
    }
    
    const stmt = this.db.prepare(`
      SELECT snapshot_data FROM yjs_snapshots WHERE doc_name = ?
    `)
    
    const row = stmt.get(docName) as { snapshot_data: Buffer } | undefined
    return row ? new Uint8Array(row.snapshot_data) : null
  }
  
  async compact(docName: string): Promise<void> {
    // Load all updates
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) return
    
    // Merge into single update
    const doc = new Y.Doc()
    updates.forEach(update => Y.applyUpdate(doc, update))
    
    // Save as snapshot
    const snapshot = Y.encodeStateAsUpdate(doc)
    await this.saveSnapshot(docName, snapshot)
  }
  
  close(): void {
    if (this.db) {
      this.db.close()
    }
  }
} 