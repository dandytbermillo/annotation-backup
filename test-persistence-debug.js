// Test script to debug persistence issue
// Run with: node test-persistence-debug.js

const Y = require('yjs');

// Create a simple test to see if update handlers work correctly
function testUpdateHandler() {
  console.log('\n=== Testing Y.Doc Update Handler ===\n');
  
  const doc = new Y.Doc();
  let updateCount = 0;
  
  // Test 1: Basic update handler
  console.log('1. Adding update handler...');
  doc.on('update', (update, origin) => {
    updateCount++;
    console.log(`   Update ${updateCount} received, origin: ${origin}, size: ${update.length} bytes`);
  });
  
  // Test 2: Initial update
  console.log('\n2. Making initial update...');
  const text = doc.getText('test');
  text.insert(0, 'Hello World');
  
  // Test 3: Update with origin
  console.log('\n3. Making update with origin "persistence"...');
  const update = Y.encodeStateAsUpdate(doc);
  Y.applyUpdate(doc, update, 'persistence');
  
  // Test 4: Regular update
  console.log('\n4. Making regular update...');
  text.insert(11, '!');
  
  console.log(`\nTotal updates received: ${updateCount}`);
  console.log('Text content:', text.toString());
}

// Test closure behavior
function testClosureBehavior() {
  console.log('\n\n=== Testing Closure Behavior ===\n');
  
  const doc = new Y.Doc();
  let loadComplete = false;
  const loadState = { complete: false };
  
  // Handler using regular variable
  doc.on('update', () => {
    console.log(`Handler 1 - loadComplete: ${loadComplete}`);
  });
  
  // Handler using object property
  doc.on('update', () => {
    console.log(`Handler 2 - loadState.complete: ${loadState.complete}`);
  });
  
  console.log('1. Before setting flags to true:');
  doc.getText('test').insert(0, 'test');
  
  // Change values
  loadComplete = true;
  loadState.complete = true;
  
  console.log('\n2. After setting flags to true:');
  doc.getText('test').insert(4, '2');
}

// Test async behavior
async function testAsyncBehavior() {
  console.log('\n\n=== Testing Async Load Behavior ===\n');
  
  const doc = new Y.Doc();
  const loadState = { 
    initialLoadComplete: false,
    updateCount: 0
  };
  
  // Set up handler
  doc.on('update', (update, origin) => {
    console.log(`Update received - initialLoadComplete: ${loadState.initialLoadComplete}, origin: ${origin}`);
    if (!loadState.initialLoadComplete || origin === 'persistence') {
      console.log('  -> Skipping update');
      return;
    }
    loadState.updateCount++;
    console.log(`  -> Would persist update ${loadState.updateCount}`);
  });
  
  // Simulate initial load
  console.log('1. Simulating initial load (with origin="persistence")...');
  const initialData = new Uint8Array([1, 2, 3]); // Mock data
  Y.applyUpdate(doc, initialData, 'persistence');
  
  // Simulate async load completion
  console.log('\n2. Simulating async load completion...');
  await new Promise(resolve => setTimeout(resolve, 100));
  loadState.initialLoadComplete = true;
  console.log('   Initial load complete flag set to true');
  
  // Make new updates
  console.log('\n3. Making new updates after load...');
  doc.getText('content').insert(0, 'New content');
  
  console.log('\n4. Making another update...');
  doc.getText('content').insert(11, ' more');
  
  console.log(`\nTotal persisted updates: ${loadState.updateCount}`);
}

// Run all tests
async function runTests() {
  testUpdateHandler();
  testClosureBehavior();
  await testAsyncBehavior();
}

runTests().catch(console.error);