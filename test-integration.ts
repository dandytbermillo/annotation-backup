import { ElectronPostgresAdapter } from './lib/adapters/electron-postgres-adapter'
import { ConnectionConfig } from './lib/database/types'
import * as Y from 'yjs'

const config: ConnectionConfig = {
  remote: {
    connectionString: process.env.DATABASE_URL_REMOTE || 
                    'postgres://postgres:postgres@localhost:5432/annotation_system'
  },
  local: {
    connectionString: process.env.DATABASE_URL_LOCAL || 
                    'postgres://postgres:postgres@localhost:5432/annotation_local'
  },
  timeout: parseInt(process.env.PG_CONN_TIMEOUT_MS || '2000', 10)
}

async function test() {
  console.log('🧪 Starting PostgreSQL integration tests...\n')
  
  const adapter = new ElectronPostgresAdapter(config)
  
  try {
    // Test 1: Basic persist/load
    console.log('Test 1: Basic persist/load')
    const testUpdate = new Uint8Array([1, 2, 3, 4, 5])
    const docName = `test-doc-${Date.now()}`
    
    await adapter.persist(docName, testUpdate)
    console.log('  ✓ Persisted update')
    
    const loaded = await adapter.load(docName)
    if (!loaded || loaded.length !== testUpdate.length) {
      throw new Error('Round trip failed: loaded data differs')
    }
    console.log('  ✓ Loaded update matches\n')

    // Test 2: Multiple updates and merge
    console.log('Test 2: Multiple updates merge')
    const doc1 = new Y.Doc()
    const text1 = doc1.getText('content')
    text1.insert(0, 'Hello ')
    const update1 = Y.encodeStateAsUpdate(doc1)
    
    const doc2 = new Y.Doc()
    Y.applyUpdate(doc2, update1)
    const text2 = doc2.getText('content')
    text2.insert(6, 'World!')
    const update2 = Y.encodeStateAsUpdate(doc2, update1)
    
    const mergeDocName = `merge-test-${Date.now()}`
    await adapter.persist(mergeDocName, update1)
    await adapter.persist(mergeDocName, update2)
    console.log('  ✓ Persisted multiple updates')
    
    const merged = await adapter.load(mergeDocName)
    if (!merged) throw new Error('Failed to load merged document')
    
    const resultDoc = new Y.Doc()
    Y.applyUpdate(resultDoc, merged)
    const resultText = resultDoc.getText('content').toString()
    
    if (resultText !== 'Hello World!') {
      throw new Error(`Merge failed: expected "Hello World!", got "${resultText}"`)
    }
    console.log('  ✓ Updates merged correctly\n')

    // Test 3: Snapshot and compact
    console.log('Test 3: Snapshot and compact')
    const snapshotDoc = `snapshot-test-${Date.now()}`
    
    // Create some updates
    for (let i = 0; i < 5; i++) {
      const doc = new Y.Doc()
      const text = doc.getText('content')
      text.insert(0, `Update ${i}\n`)
      await adapter.persist(snapshotDoc, Y.encodeStateAsUpdate(doc))
    }
    console.log('  ✓ Created multiple updates')
    
    // Get all updates before compaction
    const updatesBefore = await adapter.getAllUpdates(snapshotDoc)
    console.log(`  ✓ Found ${updatesBefore.length} updates before compaction`)
    
    // Compact
    await adapter.compact(snapshotDoc)
    console.log('  ✓ Compacted successfully')
    
    // Verify snapshot exists
    const snapshot = await adapter.loadSnapshot(snapshotDoc)
    if (!snapshot) throw new Error('No snapshot after compaction')
    console.log('  ✓ Snapshot created\n')

    // Test 4: Connection status
    console.log('Test 4: Connection status')
    const status = await adapter.getConnectionStatus()
    console.log(`  ✓ Mode: ${status.mode}`)
    console.log(`  ✓ Remote healthy: ${status.remoteHealthy}`)
    console.log(`  ✓ Local healthy: ${status.localHealthy}\n`)

    // Test 5: Clear updates
    console.log('Test 5: Clear updates')
    const clearDoc = `clear-test-${Date.now()}`
    await adapter.persist(clearDoc, new Uint8Array([1, 2, 3]))
    
    const beforeClear = await adapter.getAllUpdates(clearDoc)
    if (beforeClear.length === 0) throw new Error('No updates before clear')
    console.log(`  ✓ ${beforeClear.length} updates before clear`)
    
    await adapter.clearUpdates(clearDoc)
    const afterClear = await adapter.getAllUpdates(clearDoc)
    if (afterClear.length !== 0) throw new Error('Updates remain after clear')
    console.log('  ✓ Updates cleared successfully\n')

    // Cleanup
    await adapter.close()
    
    console.log('✅ All integration tests passed!')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Integration test failed:', error)
    await adapter.close()
    process.exit(1)
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error)
  process.exit(1)
})

test()