import { Pool } from 'pg'
import { PostgresAdapter } from './postgres-adapter'
import { ConnectionManager } from '../database/connection-manager'
import { ConnectionConfig } from '../database/types'
import { OplogSync } from '../database/oplog-sync'

export class ElectronPostgresAdapter extends PostgresAdapter {
  private connectionManager: ConnectionManager
  private currentMode: 'remote' | 'local' = 'remote'
  private syncEngine?: OplogSync
  private reconnectTimer?: NodeJS.Timeout
  private config: ConnectionConfig
  private allowOfflineWrites: boolean

  constructor(config: ConnectionConfig) {
    super()
    this.config = config
    this.connectionManager = ConnectionManager.getInstance('electron', config)
    this.allowOfflineWrites = process.env.ALLOW_OFFLINE_WRITES !== 'false'
    
    if (config.local) {
      this.syncEngine = new OplogSync(
        this.connectionManager.getRemotePool()!,
        this.connectionManager.getLocalPool()!
      )
    }
  }

  protected getPool(): Pool {
    // Return the appropriate pool based on current mode
    if (this.currentMode === 'remote') {
      const remotePool = this.connectionManager.getRemotePool()
      if (remotePool) return remotePool
    }
    
    const localPool = this.connectionManager.getLocalPool()
    if (localPool) return localPool
    
    throw new Error('No database connection available')
  }

  async persist(docName: string, update: Uint8Array): Promise<void> {
    try {
      if (this.currentMode === 'remote') {
        // Try remote with timeout
        await this.withTimeout(
          super.persist(docName, update),
          this.config.timeout
        )
        
        // Success - ensure sync engine is running
        if (this.syncEngine) {
          this.syncEngine.start()
        }
      } else {
        // Local mode - use oplog
        await this.persistLocally(docName, update)
      }
    } catch (error) {
      if (this.isNetworkError(error) && this.connectionManager.getLocalPool() && this.allowOfflineWrites) {
        // Switch to local mode
        this.currentMode = 'local'
        await this.persistLocally(docName, update)
        
        // Schedule reconnection attempt
        this.scheduleReconnect()
      } else {
        throw error
      }
    }
  }

  private async persistLocally(docName: string, update: Uint8Array): Promise<void> {
    const localPool = this.connectionManager.getLocalPool()
    if (!localPool) throw new Error('Local database not available')

    const client = await localPool.connect()
    try {
      await client.query('BEGIN')
      
      // Store update
      await client.query(
        'INSERT INTO yjs_updates (doc_name, update, timestamp) VALUES ($1, $2, NOW())',
        [docName, Buffer.from(update)]
      )
      
      // Add to oplog for later sync
      await client.query(
        'INSERT INTO oplog (entity_type, entity_id, operation, payload, origin, synced) VALUES ($1, $2, $3, $4, $5, $6)',
        ['yjs_update', docName, 'persist', Buffer.from(update), 'local', false]
      )
      
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Operation timeout')), timeout)
      )
    ])
  }

  private isNetworkError(error: any): boolean {
    const networkErrorCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH']
    return (
      error.code && networkErrorCodes.includes(error.code) ||
      error.message?.includes('timeout') ||
      error.message?.includes('connect')
    )
  }

  private scheduleReconnect(): void {
    // Clear existing timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    // Schedule reconnection attempt
    this.reconnectTimer = setTimeout(async () => {
      const isReconnected = await this.connectionManager.reconnectWithBackoff(true)
      
      if (isReconnected) {
        this.currentMode = 'remote'
        // Start sync engine to push local changes
        if (this.syncEngine) {
          await this.syncEngine.syncPending()
        }
      } else {
        // Schedule another attempt
        this.scheduleReconnect()
      }
    }, 5000) // Initial delay 5 seconds
  }

  async getConnectionStatus(): Promise<{
    mode: 'remote' | 'local'
    remoteHealthy: boolean
    localHealthy: boolean
  }> {
    const { pool: healthyPool, isRemote } = await this.connectionManager.getHealthyPool()
    
    return {
      mode: this.currentMode,
      remoteHealthy: isRemote,
      localHealthy: !isRemote && !!healthyPool
    }
  }

  async forceMode(mode: 'remote' | 'local'): Promise<void> {
    this.currentMode = mode
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    
    if (this.syncEngine) {
      this.syncEngine.stop()
    }
    
    await this.connectionManager.close()
  }

  // Override compact to handle both databases
  async compact(docName: string): Promise<void> {
    await super.compact(docName)
    
    // If in local mode, also add compaction to oplog
    if (this.currentMode === 'local' && this.connectionManager.getLocalPool()) {
      const localPool = this.connectionManager.getLocalPool()!
      
      // Load current snapshot
      const snapshot = await this.loadSnapshot(docName)
      if (snapshot) {
        await localPool.query(
          'INSERT INTO oplog (entity_type, entity_id, operation, payload, origin, synced) VALUES ($1, $2, $3, $4, $5, $6)',
          ['snapshot', docName, 'compact', Buffer.from(snapshot), 'local', false]
        )
      }
    }
  }
}