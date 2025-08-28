import { PostgresAdapter } from '../../lib/adapters/postgres-adapter'
import { Pool, PoolClient, QueryResult } from 'pg'
import * as Y from 'yjs'

// Mock pg module
jest.mock('pg')

// Type helpers for mocks
type MockPool = jest.Mocked<Pick<Pool, 'query' | 'connect' | 'end'>>
type MockPoolClient = jest.Mocked<Pick<PoolClient, 'query' | 'release'>>

// Helper to create a mock QueryResult
const createMockQueryResult = (rows: any[] = []): QueryResult => ({
  rows,
  rowCount: rows.length,
  command: '',
  oid: 0,
  fields: []
})

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
  let mockPool: MockPool
  let mockClient: MockPoolClient

  beforeEach(() => {
    // Create mock client
    mockClient = {
      query: jest.fn<Promise<QueryResult>, [string, any[]?]>(),
      release: jest.fn<void, []>(),
    }

    // Create mock pool
    mockPool = {
      query: jest.fn<Promise<QueryResult>, [string, any[]?]>(),
      connect: jest.fn<Promise<PoolClient>, []>().mockResolvedValue(mockClient as unknown as PoolClient),
      end: jest.fn<Promise<void>, []>(),
    }

    adapter = new TestablePostgresAdapter(mockPool as unknown as Pool)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('persist', () => {
    test('stores binary data as BYTEA', async () => {
      const update = new Uint8Array([1, 2, 3, 4, 5])
      const docName = 'test-doc'

      mockPool.query.mockResolvedValue(createMockQueryResult())

      await adapter.persist(docName, update)

      expect(mockPool.query).toHaveBeenCalledWith(
        'INSERT INTO yjs_updates (doc_name, update, timestamp) VALUES ($1, $2, NOW())',
        [docName, Buffer.from(update)]
      )
    })

    test('handles empty updates', async () => {
      const update = new Uint8Array([])
      
      mockPool.query.mockResolvedValue(createMockQueryResult())

      await adapter.persist('test-doc', update)

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['test-doc', Buffer.from(update)]
      )
    })
  })

  describe('load', () => {
    test('returns null for non-existent doc', async () => {
      mockPool.query.mockResolvedValue(createMockQueryResult())

      const result = await adapter.load('missing-doc')
      
      expect(result).toBeNull()
    })

    test('returns snapshot if available', async () => {
      const snapshotData = new Uint8Array([10, 20, 30])
      mockPool.query
        .mockResolvedValueOnce(createMockQueryResult([{ snapshot: Buffer.from(snapshotData) }]))

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
        .mockResolvedValueOnce(createMockQueryResult()) // no snapshot
        // Updates available
        .mockResolvedValueOnce(createMockQueryResult([
          { update: Buffer.from(update1) },
          { update: Buffer.from(update2) }
        ]))

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
      mockPool.query.mockResolvedValue(createMockQueryResult())

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

      mockPool.query.mockResolvedValue(createMockQueryResult([
        { update: Buffer.from(update1) },
        { update: Buffer.from(update2) }
      ]))

      const updates = await adapter.getAllUpdates('test-doc')

      expect(updates).toHaveLength(2)
      expect(updates[0]).toEqual(update1)
      expect(updates[1]).toEqual(update2)
    })
  })

  describe('compact', () => {
    test('creates snapshot from merged updates', async () => {
      const update1 = new Uint8Array([1, 2, 3])
      const update2 = new Uint8Array([4, 5, 6])

      // Mock getting updates
      mockPool.query.mockResolvedValueOnce(createMockQueryResult([
        { update: Buffer.from(update1) },
        { update: Buffer.from(update2) }
      ]))

      // Mock transaction queries
      mockClient.query
        .mockResolvedValueOnce(createMockQueryResult()) // BEGIN
        .mockResolvedValueOnce(createMockQueryResult()) // DELETE
        .mockResolvedValueOnce(createMockQueryResult()) // INSERT
        .mockResolvedValueOnce(createMockQueryResult()) // COMMIT

      await adapter.compact('test-doc')

      expect(mockPool.connect).toHaveBeenCalled()
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith(
        'DELETE FROM snapshots WHERE doc_name = $1',
        ['test-doc']
      )
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO snapshots'),
        expect.arrayContaining(['test-doc', expect.any(Buffer)])
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
    })

    test('rolls back on error', async () => {
      const error = new Error('Database error')
      
      // Mock getting updates
      mockPool.query.mockResolvedValueOnce(createMockQueryResult([
        { update: Buffer.from([1, 2, 3]) }
      ]))

      // Mock transaction failure
      mockClient.query
        .mockResolvedValueOnce(createMockQueryResult()) // BEGIN
        .mockRejectedValueOnce(error) // DELETE fails

      await expect(adapter.compact('test-doc')).rejects.toThrow('Database error')

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalled()
    })
  })

  describe('destroy', () => {
    test('deletes all document data', async () => {
      mockClient.query.mockResolvedValue(createMockQueryResult())

      await adapter.destroy('test-doc')

      expect(mockPool.connect).toHaveBeenCalled()
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith(
        'DELETE FROM yjs_updates WHERE doc_name = $1',
        ['test-doc']
      )
      expect(mockClient.query).toHaveBeenCalledWith(
        'DELETE FROM snapshots WHERE doc_name = $1',
        ['test-doc']
      )
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
    })

    test('rolls back on error', async () => {
      const error = new Error('Delete failed')
      
      mockClient.query
        .mockResolvedValueOnce(createMockQueryResult()) // BEGIN
        .mockRejectedValueOnce(error) // First DELETE fails

      await expect(adapter.destroy('test-doc')).rejects.toThrow('Delete failed')

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalled()
    })
  })
})