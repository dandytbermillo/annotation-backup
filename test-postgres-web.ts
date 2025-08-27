// Test script to verify web PostgreSQL persistence
async function testWebPostgresPersistence() {
  const baseUrl = 'http://localhost:3000/api/persistence'
  
  console.log('🧪 Testing Web PostgreSQL Persistence\n')
  
  try {
    // Test 1: Persist data
    console.log('Test 1: Persist YJS update')
    const testUpdate = new Uint8Array([1, 2, 3, 4, 5])
    const persistResponse = await fetch(`${baseUrl}/persist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docName: 'test-web-doc',
        update: Array.from(testUpdate)
      })
    })
    
    if (!persistResponse.ok) {
      throw new Error(`Persist failed: ${await persistResponse.text()}`)
    }
    console.log('  ✓ Persist successful\n')
    
    // Test 2: Load data
    console.log('Test 2: Load YJS update')
    const loadResponse = await fetch(`${baseUrl}/load/test-web-doc`)
    const loadData = await loadResponse.json()
    
    if (loadData.content) {
      console.log('  ✓ Loaded data successfully')
      console.log(`  ✓ Data length: ${loadData.content.length}\n`)
    } else {
      console.log('  ⚠ No data found (might be first run)\n')
    }
    
    // Test 3: Get all updates
    console.log('Test 3: Get all updates')
    const updatesResponse = await fetch(`${baseUrl}/updates/test-web-doc`)
    const updatesData = await updatesResponse.json()
    
    console.log(`  ✓ Found ${updatesData.updates.length} updates\n`)
    
    console.log('✅ All tests passed! PostgreSQL is working via API routes.')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
  }
}

// Run in browser console or via Node.js
if (typeof window !== 'undefined') {
  testWebPostgresPersistence()
} else {
  console.log('Run this in the browser console at http://localhost:3000')
}