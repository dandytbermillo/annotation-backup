import { ElectronPostgresAdapter } from '../../lib/adapters/electron-postgres-adapter'
import { ConnectionManager } from '../../lib/database/connection-manager'
import { OplogSync } from '../../lib/database/oplog-sync'
import { Pool } from 'pg'

// Mock dependencies
jest.mock('../../lib/database/connection-manager')
jest.mock('../../lib/database/oplog-sync')
jest.mock('pg')

describe('ElectronPostgresAdapter', () => {
  let adapter: ElectronPostgresAdapter
  let mockConnectionManager: jest.Mocked<ConnectionManager>
  let mockOplogSync: jest.Mocked<OplogSync>
  let mockRemotePool: jest.Mocked<Pool>
  let mockLocalPool: jest.Mocked<Pool>

  const config = {
    remote: { connectionString: 'postgres://remote' },
    local: { connectionString: 'postgres://local' },
    timeout: 2000
  }

  beforeEach(() => {
    // Setup mock pools
    mockRemotePool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
    } as any

    mockLocalPool = {
      query: jest.fn(),
      connect: jest.fn(),
      end: jest.fn(),
    } as any

    // Setup mock connection manager
    mockConnectionManager = {
      getRemotePool: jest.fn().mockReturnValue(mockRemotePool),
      getLocalPool: jest.fn().mockReturnValue(mockLocalPool),
      getHealthyPool: jest.fn(),
      checkHealth: jest.fn(),
      reconnectWithBackoff: jest.fn(),
      close: jest.fn(),
    } as any

    // Setup mock oplog sync
    mockOplogSync = {
      start: jest.fn(),
      stop: jest.fn(),
      syncPending: jest.fn(),
    } as any

    // Mock getInstance to return our mock
    ;(ConnectionManager.getInstance as jest.Mock).mockReturnValue(mockConnectionManager)
    ;(OplogSync as jest.Mock).mockImplementation(() => mockOplogSync)

    adapter = new ElectronPostgresAdapter(config)
  })

  afterEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  describe('persist with failover', () => {
    test('uses remote pool when available', async () => {
      const update = new Uint8Array([1, 2, 3])
      mockRemotePool.query.mockResolvedValue({ rows: [] } as any)

      await adapter.persist('test-doc', update)

      expect(mockRemotePool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO yjs_updates'),
        ['test-doc', Buffer.from(update)]
      )
      expect(mockOplogSync.start).toHaveBeenCalled()
    })

    test('falls back to local on network error', async () => {
      const update = new Uint8Array([1, 2, 3])
      const networkError = new Error('Connection timeout')
      ;(networkError as any).code = 'ETIMEDOUT'

      const mockClient = {
        query: jest.fn().mockResolvedValue({}),
        release: jest.fn(),
      }
      mockLocalPool.connect.mockResolvedValue(mockClient as any)

      // First call fails with network error
      mockRemotePool.query.mockRejectedValueOnce(networkError)

      await adapter.persist('test-doc', update)

      // Should write to local pool with oplog entry
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO yjs_updates'),
        expect.any(Array)
      )
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO oplog'),
        expect.any(Array)
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    test('schedules reconnection after failover', async () => {
      jest.useFakeTimers()
      
      const update = new Uint8Array([1, 2, 3])
      const networkError = new Error('Connection refused')
      ;(networkError as any).code = 'ECONNREFUSED'

      const mockClient = {
        query: jest.fn().mockResolvedValue({}),
        release: jest.fn(),
      }
      mockLocalPool.connect.mockResolvedValue(mockClient as any)
      mockRemotePool.query.mockRejectedValueOnce(networkError)
      
      await adapter.persist('test-doc', update)

      // Fast-forward to trigger reconnection
      jest.advanceTimersByTime(5000)

      expect(mockConnectionManager.reconnectWithBackoff).toHaveBeenCalledWith(true)
    })

    test('throws error when no pools available', async () => {
      mockConnectionManager.getRemotePool.mockReturnValue(undefined)
      mockConnectionManager.getLocalPool.mockReturnValue(undefined)

      const adapter = new ElectronPostgresAdapter(config)

      await expect(adapter.persist('test-doc', new Uint8Array([1, 2, 3])))
        .rejects.toThrow('No database connection available')
    })
  })

  describe('connection status', () => {
    test('reports connection status correctly', async () => {
      mockConnectionManager.getHealthyPool.mockResolvedValue({
        pool: mockRemotePool,
        isRemote: true
      })

      const status = await adapter.getConnectionStatus()

      expect(status).toEqual({
        mode: 'remote',
        remoteHealthy: true,
        localHealthy: false
      })
    })

    test('can force connection mode', async () => {
      await adapter.forceMode('local')

      // Verify mode change by attempting persist
      const mockClient = {
        query: jest.fn().mockResolvedValue({}),
        release: jest.fn(),
      }
      mockLocalPool.connect.mockResolvedValue(mockClient as any)

      await adapter.persist('test-doc', new Uint8Array([1]))

      // Should use local pool even if remote is available
      expect(mockLocalPool.connect).toHaveBeenCalled()
      expect(mockRemotePool.query).not.toHaveBeenCalled()
    })
  })

  describe('compact with oplog', () => {
    test('adds compaction to oplog when in local mode', async () => {
      await adapter.forceMode('local')

      const mockClient = {
        query: jest.fn().mockResolvedValue({}),
        release: jest.fn(),
      }
      mockLocalPool.connect.mockResolvedValue(mockClient as any)
      
      // Mock snapshot data
      const snapshot = new Uint8Array([10, 20, 30])
      mockLocalPool.query
        .mockResolvedValueOnce({ rows: [] }) // getAllUpdates
        .mockResolvedValueOnce({ rows: [{ snapshot: Buffer.from(snapshot) }] }) // loadSnapshot

      await adapter.compact('test-doc')

      // Should add compaction to oplog
      expect(mockLocalPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO oplog'),
        expect.arrayContaining([
          'snapshot',
          'test-doc',
          'compact',
          Buffer.from(snapshot),
          'local',
          false
        ])
      )
    })
  })

  describe('cleanup', () => {
    test('properly cleans up resources', async () => {
      jest.useFakeTimers()
      
      // Trigger a reconnect timer
      const networkError = new Error('timeout')
      ;(networkError as any).code = 'ETIMEDOUT'
      mockRemotePool.query.mockRejectedValueOnce(networkError)
      
      const mockClient = {
        query: jest.fn().mockResolvedValue({}),
        release: jest.fn(),
      }
      mockLocalPool.connect.mockResolvedValue(mockClient as any)
      
      await adapter.persist('test-doc', new Uint8Array([1]))

      await adapter.close()

      expect(mockOplogSync.stop).toHaveBeenCalled()
      expect(mockConnectionManager.close).toHaveBeenCalled()

      // Verify timer was cleared by advancing time
      jest.advanceTimersByTime(10000)
      expect(mockConnectionManager.reconnectWithBackoff).not.toHaveBeenCalled()
    })
  })
})