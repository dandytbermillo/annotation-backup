import { Pool, PoolClient, QueryResult } from 'pg'

// Mock types for PostgreSQL testing
export interface MockPool extends jest.Mocked<Pick<Pool, 'query' | 'connect' | 'end'>> {
  query: jest.Mock<Promise<QueryResult<any>>, [string, any[]?]>
  connect: jest.Mock<Promise<PoolClient>>
  end: jest.Mock<Promise<void>>
}

export interface MockPoolClient extends jest.Mocked<Pick<PoolClient, 'query' | 'release'>> {
  query: jest.Mock<Promise<QueryResult<any>>, [string, any[]?]>
  release: jest.Mock<void>
}

export interface MockConnectionManager {
  getRemotePool: jest.Mock<Pool>
  getLocalPool: jest.Mock<Pool>
  ensurePoolsReady: jest.Mock<Promise<void>>
  getStatus: jest.Mock<{ remote: boolean; local: boolean }>
  closeAll: jest.Mock<Promise<void>>
}