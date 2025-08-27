// Type validation script to ensure our PostgreSQL implementation is correct
import { Pool } from 'pg'
import { PostgresAdapter } from '../adapters/postgres-adapter'
import { ElectronPostgresAdapter } from '../adapters/electron-postgres-adapter'
import { PersistenceProvider } from '../enhanced-yjs-provider'
import { ConnectionConfig } from './types'

// Test that PostgresAdapter implements PersistenceProvider
const testImplementation = () => {
  // This ensures our adapters implement the interface correctly
  const adapter1: PersistenceProvider = {} as PostgresAdapter
  const adapter2: PersistenceProvider = {} as ElectronPostgresAdapter

  // Test method signatures
  const testMethods = async (adapter: PersistenceProvider) => {
    await adapter.persist('doc', new Uint8Array())
    const loaded: Uint8Array | null = await adapter.load('doc')
    const updates: Uint8Array[] = await adapter.getAllUpdates('doc')
    await adapter.clearUpdates('doc')
    await adapter.saveSnapshot('doc', new Uint8Array())
    const snapshot: Uint8Array | null = await adapter.loadSnapshot('doc')
    await adapter.compact('doc')
  }

  console.log('✓ Type validation passed - all adapters implement PersistenceProvider correctly')
}

export { testImplementation }