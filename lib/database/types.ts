import { PoolConfig } from 'pg'

export interface ConnectionConfig {
  remote: PoolConfig
  local?: PoolConfig  // Optional for web
  timeout: number     // Connection timeout ms
}

export interface OplogEntry {
  id: number
  entity_type: 'yjs_update' | 'snapshot'
  entity_id: string   // doc_name
  operation: 'persist' | 'compact'
  payload: Buffer     // Binary data
  timestamp: Date
  origin: 'local' | 'remote'
  synced: boolean
}