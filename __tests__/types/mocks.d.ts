// Type declarations for test mocks
import { Pool, PoolClient, QueryResult } from 'pg'
import { ConnectionManager } from '../../lib/database/connection-manager'
import { OplogSync } from '../../lib/database/oplog-sync'

export type MockedPool = jest.Mocked<{
  query: jest.Mock<Promise<QueryResult>, [string, any[]?]>
  connect: jest.Mock<Promise<PoolClient>>
  end: jest.Mock<Promise<void>>
}>

export type MockedConnectionManager = jest.Mocked<{
  getRemotePool: jest.Mock<Pool>
  getLocalPool: jest.Mock<Pool>
  getHealthyPool: jest.Mock<Promise<Pool>>
  checkHealth: jest.Mock<Promise<{ remote: boolean; local: boolean }>>
  reconnectWithBackoff: jest.Mock<Promise<boolean>>
  close: jest.Mock<Promise<void>>
}>

export type MockedOplogSync = jest.Mocked<{
  start: jest.Mock<Promise<void>>
  stop: jest.Mock<void>
  syncToRemote: jest.Mock<Promise<void>>
  syncToLocal: jest.Mock<Promise<void>>
  processPendingOperations: jest.Mock<Promise<number>>
}>