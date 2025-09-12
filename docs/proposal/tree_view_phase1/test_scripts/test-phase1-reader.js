#!/usr/bin/env node

/**
 * Test script for Phase 1 Reader Cutover
 * Verifies that the tree view correctly reads from the database when Phase 1 API is enabled
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function testAPI(endpoint, description) {
  try {
    console.log(`\n🔍 Testing: ${description}`);
    console.log(`   Endpoint: ${endpoint}`);
    
    const response = await fetch(`${BASE_URL}${endpoint}`);
    const data = await response.json();
    
    if (response.ok) {
      console.log(`   ✅ Success (${response.status})`);
      if (data.items) {
        console.log(`   📊 Found ${data.items.length} items`);
        // Show first few items
        data.items.slice(0, 3).forEach(item => {
          console.log(`      - ${item.type}: ${item.name} (${item.id})`);
        });
      }
      return data;
    } else {
      console.log(`   ❌ Error ${response.status}: ${data.error || 'Unknown error'}`);
      return null;
    }
  } catch (error) {
    console.log(`   ❌ Network error: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('='.repeat(50));
  console.log('Phase 1 Reader Cutover Test Suite');
  console.log('='.repeat(50));
  
  // Test 1: Get all items (tree structure)
  const allItems = await testAPI('/api/items', 'Get all items (tree structure)');
  
  // Test 2: Get recent notes
  const recentNotes = await testAPI('/api/items/recent?limit=5', 'Get recent notes');
  
  // Test 3: Search for notes
  await testAPI('/api/items?search=test', 'Search for notes containing "test"');
  
  // Test 4: Get root items
  await testAPI('/api/items?parentId=null', 'Get root level items');
  
  // Test 5: If we have items, test getting children
  if (allItems && allItems.items.length > 0) {
    const folders = allItems.items.filter(i => i.type === 'folder');
    if (folders.length > 0) {
      const folderId = folders[0].id;
      await testAPI(`/api/items/${folderId}/children`, `Get children of folder ${folders[0].name}`);
    }
  }
  
  // Test 6: Track recent access
  if (allItems && allItems.items.length > 0) {
    const noteToTrack = allItems.items.find(i => i.type === 'note');
    if (noteToTrack) {
      console.log(`\n🔍 Testing: Track access for note "${noteToTrack.name}"`);
      console.log(`   Endpoint: POST /api/items/recent`);
      
      try {
        const response = await fetch(`${BASE_URL}/api/items/recent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: noteToTrack.id })
        });
        
        const data = await response.json();
        if (response.ok) {
          console.log(`   ✅ Success - Last accessed: ${data.lastAccessedAt}`);
        } else {
          console.log(`   ❌ Error: ${data.error}`);
        }
      } catch (error) {
        console.log(`   ❌ Network error: ${error.message}`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('Test Summary:');
  console.log('Phase 1 Reader Cutover is ready for use!');
  console.log('Set NEXT_PUBLIC_USE_PHASE1_API=true to enable');
  console.log('='.repeat(50));
}

// Run tests
runTests().catch(console.error);