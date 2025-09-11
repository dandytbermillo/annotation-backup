// Test script to verify main panel content persistence
const BASE_URL = 'http://localhost:3000';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testMainPanelPersistence() {
  console.log('=== Testing Main Panel Content Persistence ===\n');
  
  const noteId1 = 'test-note-' + Date.now();
  const noteId2 = 'test-note-' + (Date.now() + 1);
  
  const mainContent = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'Main panel content that should persist'
      }]
    }]
  };
  
  const branchContent = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'Branch panel content'
      }]
    }]
  };
  
  try {
    // Step 1: Create two notes
    console.log('1. Creating test notes...');
    await fetch(`${BASE_URL}/api/postgres-offline/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: noteId1, title: 'Test Note 1' })
    });
    
    await fetch(`${BASE_URL}/api/postgres-offline/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: noteId2, title: 'Test Note 2' })
    });
    
    console.log('   ✓ Notes created');
    
    // Step 2: Save content to Note 1 (main and branch panels)
    console.log('\n2. Saving content to Note 1...');
    
    // Save main panel content
    await fetch(`${BASE_URL}/api/postgres-offline/documents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          noteId: noteId1,
          panelId: 'main',
          content: mainContent
        }]
      })
    });
    
    // Save branch panel content
    await fetch(`${BASE_URL}/api/postgres-offline/documents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          noteId: noteId1,
          panelId: 'branch-1',
          content: branchContent
        }]
      })
    });
    
    console.log('   ✓ Content saved to both panels');
    
    // Step 3: Load Note 1 content (first load)
    console.log('\n3. Loading Note 1 (first time)...');
    
    const load1Main = await fetch(`${BASE_URL}/api/postgres-offline/documents/${noteId1}/main`);
    const load1MainData = await load1Main.json();
    
    const load1Branch = await fetch(`${BASE_URL}/api/postgres-offline/documents/${noteId1}/branch-1`);
    const load1BranchData = await load1Branch.json();
    
    console.log('   Main panel:', load1MainData.content ? '✓ Has content' : '✗ Empty');
    console.log('   Branch panel:', load1BranchData.content ? '✓ Has content' : '✗ Empty');
    
    // Step 4: Simulate switching to Note 2
    console.log('\n4. Simulating switch to Note 2...');
    await sleep(100);
    
    // Step 5: Load Note 1 again (second load - this was failing)
    console.log('\n5. Loading Note 1 (second time - critical test)...');
    
    const load2Main = await fetch(`${BASE_URL}/api/postgres-offline/documents/${noteId1}/main`);
    const load2MainData = await load2Main.json();
    
    const load2Branch = await fetch(`${BASE_URL}/api/postgres-offline/documents/${noteId1}/branch-1`);
    const load2BranchData = await load2Branch.json();
    
    console.log('   Main panel response:', load2MainData);
    console.log('   Branch panel response:', load2BranchData);
    
    const mainHasContent = load2MainData.content !== undefined && load2MainData.content !== null;
    const branchHasContent = load2BranchData.content !== undefined && load2BranchData.content !== null;
    
    console.log('   Main panel:', mainHasContent ? '✓ Has content' : '✗ Empty!');
    console.log('   Branch panel:', branchHasContent ? '✓ Has content' : '✗ Empty!');
    
    const mainPersisted = mainHasContent;
    const branchPersisted = branchHasContent;
    
    // Step 6: Multiple rapid reloads
    console.log('\n6. Testing 5 rapid reloads...');
    let allSuccess = true;
    
    for (let i = 1; i <= 5; i++) {
      const mainRes = await fetch(`${BASE_URL}/api/postgres-offline/documents/${noteId1}/main`);
      const mainData = await mainRes.json();
      
      if (!mainData.content) {
        console.log(`   ✗ Reload ${i}: Main panel content lost!`);
        console.log(`      Response:`, mainData);
        allSuccess = false;
      }
    }
    
    if (allSuccess) {
      console.log('   ✓ All rapid reloads successful');
    }
    
    // Summary
    console.log('\n=== Test Results ===');
    if (mainPersisted && branchPersisted && allSuccess) {
      console.log('✅ ALL TESTS PASSED - Content persists correctly!');
    } else {
      console.log('❌ TESTS FAILED - Content loss detected');
      if (!mainPersisted) console.log('   - Main panel lost content on second load');
      if (!branchPersisted) console.log('   - Branch panel lost content on second load');
      if (!allSuccess) console.log('   - Content lost during rapid reloads');
    }
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
}

testMainPanelPersistence();