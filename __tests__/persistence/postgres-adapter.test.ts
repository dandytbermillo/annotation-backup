import { PostgresAdapter } from '../../lib/adapters/postgres-adapter'
import { Pool, PoolClient } from 'pg'
import * as Y from 'yjs'

// Mock pg module
jest.mock('pg')

// Create a testable concrete implementation
class TestablePostgresAdapter extends PostgresAdapter {
  constructor(private pool: Pool) {
    super()
  }

  protected getPool(): Pool {
    return this.pool
  }
}

describe('PostgresAdapter', () => {
  let adapter: TestablePostgresAdapter
  let mockPool: jest.Mocked<Pool>
  let mockClient: jest.Mocked<PoolClient>

  beforeEach(() => {
    // Create mock client
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    } as any

    // Create mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(mockClient),
      end: jest.fn(),
    } as any

    adapter = new TestablePostgresAdapter(mockPool)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('persist', () => {
    test('stores binary data as BYTEA', async () => {
      const update = new Uint8Array([1, 2, 3, 4, 5])
      const docName = 'test-doc'

      await adapter.persist(docName, update)

      expect(mockPool.query).toHaveBeenCalledWith(
        'INSERT INTO yjs_updates (doc_name, update, timestamp) VALUES ($1, $2, NOW())',
        [docName, Buffer.from(update)]
      )
    })

    test('handles empty updates', async () => {
      const update = new Uint8Array([])
      
      await adapter.persist('test-doc', update)

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['test-doc', Buffer.from(update)]
      )
    })
  })

  describe('load', () => {
    test('returns null for non-existent doc', async () => {
      mockPool.query.mockResolvedValue({ rows: [] } as any)

      const result = await adapter.load('missing-doc')
      
      expect(result).toBeNull()
    })

    test('returns snapshot if available', async () => {
      const snapshotData = new Uint8Array([10, 20, 30])
      mockPool.query
        .mockResolvedValueOnce({ 
          rows: [{ snapshot: Buffer.from(snapshotData) }] 
        } as any)

      const result = await adapter.load('test-doc')

      expect(result).toEqual(snapshotData)
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT snapshot FROM snapshots WHERE doc_name = $1',
        ['test-doc']
      )
    })

    test('merges updates when no snapshot exists', async () => {
      const update1 = new Uint8Array([1, 2, 3])
      const update2 = new Uint8Array([4, 5, 6])

      // No snapshot
      mockPool.query
        .mockResolvedValueOnce({ rows: [] } as any)
        // Updates available
        .mockResolvedValueOnce({ 
          rows: [
            { update: Buffer.from(update1) },
            { update: Buffer.from(update2) }
          ] 
        } as any)

      const doc = new Y.Doc()
      const text = doc.getText('test')
      text.insert(0, 'hello')
      const expectedUpdate = Y.encodeStateAsUpdate(doc)

      const result = await adapter.load('test-doc')

      expect(result).not.toBeNull()
      expect(result).toBeInstanceOf(Uint8Array)
    })
  })

  describe('getAllUpdates', () => {
    test('returns empty array when no updates exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] } as any)

      const updates = await adapter.getAllUpdates('test-doc')

      expect(updates).toEqual([])
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT update FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp',
        ['test-doc']
      )
    })

    test('converts buffer data to Uint8Array', async () => {
      const update1 = new Uint8Array([1, 2, 3])
      const update2 = new Uint8Array([4, 5, 6])

      mockPool.query.mockResolvedValue({
        rows: [
          { update: Buffer.from(update1) },
          { update: Buffer.from(update2) }
        ]
      } as any)

      const updates = await adapter.getAllUpdates('test-doc')

      expect(updates).toHaveLength(2)
      expect(updates[0]).toEqual(update1)
      expect(updates[1]).toEqual(update2)
    })
  })

  describe('compact', () => {
    test('merges updates and saves as snapshot', async () => {
      const update1 = new Uint8Array([1, 2, 3])
      const update2 = new Uint8Array([4, 5, 6])

      // Mock getAllUpdates
      jest.spyOn(adapter, 'getAllUpdates').mockResolvedValue([update1, update2])
      jest.spyOn(adapter, 'saveSnapshot').mockResolvedValue(undefined)
      jest.spyOn(adapter, 'clearUpdates').mockResolvedValue(undefined)

      await adapter.compact('test-doc')

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(adapter.saveSnapshot).toHaveBeenCalled()
      expect(adapter.clearUpdates).toHaveBeenCalled()
    })

    test('rolls back on error', async () => {
      jest.spyOn(adapter, 'getAllUpdates').mockRejectedValue(new Error('DB error'))

      await expect(adapter.compact('test-doc')).rejects.toThrow('DB error')

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT')
    })

    test('handles empty updates gracefully', async () => {
      jest.spyOn(adapter, 'getAllUpdates').mockResolvedValue([])

      await adapter.compact('test-doc')

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalled()
    })
  })

  describe('saveSnapshot', () => {
    test('upserts snapshot data', async () => {
      const snapshot = new Uint8Array([10, 20, 30, 40, 50])

      await adapter.saveSnapshot('test-doc', snapshot)

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO snapshots'),
        ['test-doc', Buffer.from(snapshot)]
      )
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (doc_name) DO UPDATE'),
        expect.any(Array)
      )
    })
  })

  describe('binary conversion', () => {
    test('preserves data integrity through conversions', () => {
      const originalData = new Uint8Array([0, 255, 128, 64, 32, 16, 8, 4, 2, 1])
      const buffer = adapter['toBuffer'](originalData)
      const converted = adapter['fromBuffer'](buffer)

      expect(converted).toEqual(originalData)
      expect(converted.length).toBe(originalData.length)
      
      for (let i = 0; i < originalData.length; i++) {
        expect(converted[i]).toBe(originalData[i])
      }
    })
  })
})