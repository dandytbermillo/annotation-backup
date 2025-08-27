import { Pool } from 'pg'
import { PostgresAdapter } from '../adapters/postgres-adapter'
import { MemoryAdapter } from '../adapters/memory-adapter'
import { PersistenceProvider } from '../enhanced-yjs-provider'

// Server-side only PostgreSQL adapter for use in API routes
export class ServerPostgresAdapter extends PostgresAdapter {
  private pool: Pool
  private isConnected: boolean = false
  private fallbackAdapter: MemoryAdapter | null = null
  
  constructor() {
    super()
    
    // Configure based on environment
    const connectionString = process.env.DATABASE_URL || 
                           'postgres://postgres:postgres@localhost:5432/annotation_system'
    
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })
    
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err)
      this.isConnected = false
    })
    
    // Test connection on startup
    this.testConnection()
  }
  
  private async testConnection(): Promise<void> {
    try {
      await this.pool.query('SELECT 1')
      this.isConnected = true
      console.log('PostgreSQL connected successfully')
    } catch (error) {
      console.warn('PostgreSQL connection failed, using in-memory fallback:', error.message)
      this.isConnected = false
      this.fallbackAdapter = new MemoryAdapter()
    }
  }
  
  protected getPool(): Pool {
    return this.pool
  }
  
  // Override all methods to use fallback when not connected
  async persist(docName: string, update: Uint8Array): Promise<void> {
    if (this.fallbackAdapter && !this.isConnected) {
      return this.fallbackAdapter.persist(docName, update)
    }
    return super.persist(docName, update)
  }

  async load(docName: string): Promise<Uint8Array | null> {
    if (this.fallbackAdapter && !this.isConnected) {
      return this.fallbackAdapter.load(docName)
    }
    return super.load(docName)
  }

  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    if (this.fallbackAdapter && !this.isConnected) {
      return this.fallbackAdapter.getAllUpdates(docName)
    }
    return super.getAllUpdates(docName)
  }

  async clearUpdates(docName: string): Promise<void> {
    if (this.fallbackAdapter && !this.isConnected) {
      return this.fallbackAdapter.clearUpdates(docName)
    }
    return super.clearUpdates(docName)
  }

  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    if (this.fallbackAdapter && !this.isConnected) {
      return this.fallbackAdapter.saveSnapshot(docName, snapshot)
    }
    return super.saveSnapshot(docName, snapshot)
  }

  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    if (this.fallbackAdapter && !this.isConnected) {
      return this.fallbackAdapter.loadSnapshot(docName)
    }
    return super.loadSnapshot(docName)
  }

  async compact(docName: string): Promise<void> {
    if (this.fallbackAdapter && !this.isConnected) {
      return this.fallbackAdapter.compact(docName)
    }
    return super.compact(docName)
  }
  
  async close(): Promise<void> {
    await this.pool.end()
  }
}

// Singleton instance for API routes
let instance: ServerPostgresAdapter | null = null

export function getServerPostgresAdapter(): ServerPostgresAdapter {
  if (!instance) {
    instance = new ServerPostgresAdapter()
  }
  return instance
}