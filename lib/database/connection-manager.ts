import { Pool, PoolConfig } from 'pg'
import { ConnectionConfig } from './types'

export class ConnectionManager {
  private static instances = new Map<string, ConnectionManager>()
  private remotePool?: Pool
  private localPool?: Pool
  private config: ConnectionConfig

  private constructor(config: ConnectionConfig) {
    this.config = config
    this.initializePools()
  }

  static getInstance(key: string, config: ConnectionConfig): ConnectionManager {
    if (!this.instances.has(key)) {
      this.instances.set(key, new ConnectionManager(config))
    }
    return this.instances.get(key)!
  }

  private initializePools() {
    // Initialize remote pool
    if (this.config.remote) {
      this.remotePool = new Pool({
        ...this.config.remote,
        connectionTimeoutMillis: this.config.timeout || 2000,
        idleTimeoutMillis: 30000,
        max: 10,
      })

      this.remotePool.on('error', (err) => {
        console.error('Remote pool error:', err)
      })
    }

    // Initialize local pool (if provided)
    if (this.config.local) {
      this.localPool = new Pool({
        ...this.config.local,
        connectionTimeoutMillis: this.config.timeout || 2000,
        idleTimeoutMillis: 30000,
        max: 10,
      })

      this.localPool.on('error', (err) => {
        console.error('Local pool error:', err)
      })
    }
  }

  async checkHealth(pool: Pool, timeout: number = 2000): Promise<boolean> {
    try {
      const client = await Promise.race([
        pool.connect(),
        new Promise<null>((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), timeout)
        )
      ])

      if (!client) return false

      try {
        await client.query('SELECT 1')
        return true
      } finally {
        client.release()
      }
    } catch (error) {
      return false
    }
  }

  async getHealthyPool(): Promise<{ pool: Pool, isRemote: boolean }> {
    // Try remote first
    if (this.remotePool) {
      const isHealthy = await this.checkHealth(this.remotePool, this.config.timeout)
      if (isHealthy) {
        return { pool: this.remotePool, isRemote: true }
      }
    }

    // Fallback to local
    if (this.localPool) {
      const isHealthy = await this.checkHealth(this.localPool, this.config.timeout)
      if (isHealthy) {
        return { pool: this.localPool, isRemote: false }
      }
    }

    throw new Error('No healthy database connection available')
  }

  getRemotePool(): Pool | undefined {
    return this.remotePool
  }

  getLocalPool(): Pool | undefined {
    return this.localPool
  }

  async close(): Promise<void> {
    const promises: Promise<void>[] = []
    
    if (this.remotePool) {
      promises.push(this.remotePool.end())
    }
    
    if (this.localPool) {
      promises.push(this.localPool.end())
    }

    await Promise.all(promises)
  }

  // Reconnection with exponential backoff
  async reconnectWithBackoff(isRemote: boolean = true): Promise<boolean> {
    const pool = isRemote ? this.remotePool : this.localPool
    if (!pool) return false

    let delay = 1000 // Start with 1 second
    const maxDelay = 30000 // Max 30 seconds
    const maxAttempts = 5

    for (let i = 0; i < maxAttempts; i++) {
      const isHealthy = await this.checkHealth(pool)
      if (isHealthy) {
        console.log(`Reconnected to ${isRemote ? 'remote' : 'local'} database`)
        return true
      }

      console.log(`Reconnection attempt ${i + 1} failed, waiting ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, maxDelay)
    }

    return false
  }
}