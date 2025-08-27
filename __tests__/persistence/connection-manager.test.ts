import { ConnectionManager } from '../../lib/database/connection-manager'
import { Pool } from 'pg'

// Mock pg module
jest.mock('pg')

describe('ConnectionManager', () => {
  let manager: ConnectionManager

  const config = {
    remote: {
      connectionString: 'postgres://remote',
      max: 10
    },
    local: {
      connectionString: 'postgres://local',
      max: 5
    },
    timeout: 2000
  }

  beforeEach(() => {
    // Clear singleton instances
    ConnectionManager['instances'].clear()
    
    // Mock Pool constructor
    ;(Pool as jest.Mock).mockImplementation((config) => ({
      connect: jest.fn(),
      query: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
      ...config
    }))
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('singleton behavior', () => {
    test('returns same instance for same key', () => {
      const instance1 = ConnectionManager.getInstance('test', config)
      const instance2 = ConnectionManager.getInstance('test', config)

      expect(instance1).toBe(instance2)
    })

    test('returns different instances for different keys', () => {
      const instance1 = ConnectionManager.getInstance('test1', config)
      const instance2 = ConnectionManager.getInstance('test2', config)

      expect(instance1).not.toBe(instance2)
    })
  })

  describe('pool initialization', () => {
    test('creates pools with correct configuration', () => {
      manager = ConnectionManager.getInstance('test', config)

      expect(Pool).toHaveBeenCalledTimes(2)
      
      // Check remote pool config
      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        connectionString: 'postgres://remote',
        connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 30000,
        max: 10
      }))

      // Check local pool config
      expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
        connectionString: 'postgres://local',
        connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 30000,
        max: 10
      }))
    })

    test('sets up error handlers for pools', () => {
      manager = ConnectionManager.getInstance('test', config)
      
      const remotePool = manager.getRemotePool()
      const localPool = manager.getLocalPool()

      expect(remotePool?.on).toHaveBeenCalledWith('error', expect.any(Function))
      expect(localPool?.on).toHaveBeenCalledWith('error', expect.any(Function))
    })
  })

  describe('health checks', () => {
    test('returns true for healthy connection', async () => {
      manager = ConnectionManager.getInstance('test', config)
      const pool = manager.getRemotePool()!

      const mockClient = {
        query: jest.fn().mockResolvedValue({}),
        release: jest.fn()
      }
      ;(pool.connect as jest.Mock).mockResolvedValue(mockClient)

      const isHealthy = await manager.checkHealth(pool, 1000)

      expect(isHealthy).toBe(true)
      expect(mockClient.query).toHaveBeenCalledWith('SELECT 1')
      expect(mockClient.release).toHaveBeenCalled()
    })

    test('returns false on connection timeout', async () => {
      manager = ConnectionManager.getInstance('test', config)
      const pool = manager.getRemotePool()!

      // Simulate slow connection
      ;(pool.connect as jest.Mock).mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 3000))
      )

      const isHealthy = await manager.checkHealth(pool, 100)

      expect(isHealthy).toBe(false)
    })

    test('returns false on query error', async () => {
      manager = ConnectionManager.getInstance('test', config)
      const pool = manager.getRemotePool()!

      const mockClient = {
        query: jest.fn().mockRejectedValue(new Error('Query failed')),
        release: jest.fn()
      }
      ;(pool.connect as jest.Mock).mockResolvedValue(mockClient)

      const isHealthy = await manager.checkHealth(pool)

      expect(isHealthy).toBe(false)
      expect(mockClient.release).toHaveBeenCalled()
    })
  })

  describe('getHealthyPool', () => {
    test('returns remote pool when healthy', async () => {
      manager = ConnectionManager.getInstance('test', config)
      
      jest.spyOn(manager, 'checkHealth').mockImplementation(async (pool) => {
        return pool === manager.getRemotePool()
      })

      const result = await manager.getHealthyPool()

      expect(result.isRemote).toBe(true)
      expect(result.pool).toBe(manager.getRemotePool())
    })

    test('falls back to local when remote unhealthy', async () => {
      manager = ConnectionManager.getInstance('test', config)
      
      jest.spyOn(manager, 'checkHealth').mockImplementation(async (pool) => {
        return pool === manager.getLocalPool()
      })

      const result = await manager.getHealthyPool()

      expect(result.isRemote).toBe(false)
      expect(result.pool).toBe(manager.getLocalPool())
    })

    test('throws when no healthy pools available', async () => {
      manager = ConnectionManager.getInstance('test', config)
      
      jest.spyOn(manager, 'checkHealth').mockResolvedValue(false)

      await expect(manager.getHealthyPool()).rejects.toThrow('No healthy database connection available')
    })
  })

  describe('reconnection with backoff', () => {
    test('reconnects successfully on first attempt', async () => {
      manager = ConnectionManager.getInstance('test', config)
      
      jest.spyOn(manager, 'checkHealth')
        .mockResolvedValueOnce(false) // Initial check fails
        .mockResolvedValueOnce(true)  // Reconnect succeeds

      const result = await manager.reconnectWithBackoff(true)

      expect(result).toBe(true)
      expect(manager.checkHealth).toHaveBeenCalledTimes(1)
    })

    test('retries with exponential backoff', async () => {
      jest.useFakeTimers()
      
      manager = ConnectionManager.getInstance('test', config)
      
      jest.spyOn(manager, 'checkHealth').mockResolvedValue(false)

      const reconnectPromise = manager.reconnectWithBackoff(true)

      // First attempt (immediate)
      await jest.runOnlyPendingTimersAsync()
      expect(manager.checkHealth).toHaveBeenCalledTimes(1)

      // Second attempt (1s delay)
      await jest.advanceTimersByTimeAsync(1000)
      expect(manager.checkHealth).toHaveBeenCalledTimes(2)

      // Third attempt (2s delay)
      await jest.advanceTimersByTimeAsync(2000)
      expect(manager.checkHealth).toHaveBeenCalledTimes(3)

      // Fourth attempt (4s delay)
      await jest.advanceTimersByTimeAsync(4000)
      expect(manager.checkHealth).toHaveBeenCalledTimes(4)

      // Fifth attempt (8s delay)
      await jest.advanceTimersByTimeAsync(8000)
      expect(manager.checkHealth).toHaveBeenCalledTimes(5)

      const result = await reconnectPromise
      expect(result).toBe(false)

      jest.useRealTimers()
    })
  })

  describe('cleanup', () => {
    test('closes all pools', async () => {
      manager = ConnectionManager.getInstance('test', config)
      
      const remotePool = manager.getRemotePool()!
      const localPool = manager.getLocalPool()!

      await manager.close()

      expect(remotePool.end).toHaveBeenCalled()
      expect(localPool.end).toHaveBeenCalled()
    })

    test('handles partial pool configuration', async () => {
      const configWithoutLocal = {
        remote: config.remote,
        timeout: 2000
      }

      manager = ConnectionManager.getInstance('test-no-local', configWithoutLocal)
      
      const remotePool = manager.getRemotePool()!
      
      await manager.close()

      expect(remotePool.end).toHaveBeenCalled()
      expect(manager.getLocalPool()).toBeUndefined()
    })
  })
})