#!/usr/bin/env node
// Script to diagnose the persistence issue
// Run with: npx tsx diagnose-persistence.ts

import * as Y from 'yjs';

// Simulate the exact flow that happens in the app
async function simulatePersistenceFlow() {
  console.log('\n=== Simulating App Persistence Flow ===\n');
  
  // Mock persistence adapter
  const mockPersistence = {
    data: new Map<string, Uint8Array[]>(),
    
    async persist(docName: string, update: Uint8Array) {
      const updates = this.data.get(docName) || [];
      updates.push(update);
      this.data.set(docName, updates);
      console.log(`[PERSIST] Saved update for ${docName}, total: ${updates.length}`);
    },
    
    async load(docName: string) {
      const updates = this.data.get(docName);
      if (!updates || updates.length === 0) {
        console.log(`[LOAD] No data for ${docName}`);
        return null;
      }
      // Merge all updates
      const doc = new Y.Doc();
      updates.forEach(u => Y.applyUpdate(doc, u));
      const merged = Y.encodeStateAsUpdate(doc);
      console.log(`[LOAD] Loaded ${updates.length} updates for ${docName}, merged: ${merged.length} bytes`);
      return merged;
    }
  };
  
  // Step 1: Initial session - create doc and add content
  console.log('STEP 1: Initial Session');
  console.log('----------------------');
  
  const doc1 = new Y.Doc();
  const loadState1 = { initialLoadComplete: false, updateCount: 0 };
  
  // Set up update handler
  doc1.on('update', async (update: Uint8Array, origin: any) => {
    console.log(`[UPDATE] initialLoadComplete: ${loadState1.initialLoadComplete}, origin: ${origin}`);
    if (!loadState1.initialLoadComplete || origin === 'persistence') {
      console.log(`[UPDATE] Skipping update`);
      return;
    }
    await mockPersistence.persist('test-doc', update);
    loadState1.updateCount++;
  });
  
  // Load existing data (none on first run)
  const data1 = await mockPersistence.load('test-doc');
  if (data1) {
    Y.applyUpdate(doc1, data1, 'persistence');
  }
  loadState1.initialLoadComplete = true;
  console.log('[INIT] Initial load complete');
  
  // Make some edits
  const text1 = doc1.getText('content');
  text1.insert(0, 'Hello World');
  console.log(`[EDIT] Added text: "${text1.toString()}"`);
  
  await new Promise(resolve => setTimeout(resolve, 100)); // Wait for async persist
  
  // Step 2: Reload - simulate getting cached doc
  console.log('\n\nSTEP 2: Reload Session (Cached Doc)');
  console.log('-----------------------------------');
  
  // Simulate getting the same doc from cache
  const doc2 = doc1; // In the app, this would be from editorDocs.get()
  const loadState2 = { initialLoadComplete: false, updateCount: 0 };
  
  // Problem: The old update handler is still attached!
  // Let's see how many handlers are attached
  console.log(`[CHECK] Doc has ${Object.keys(doc2._observers?.update || {}).length} update observers`);
  
  // App tries to set up a new handler
  const newHandler = async (update: Uint8Array, origin: any) => {
    console.log(`[NEW UPDATE] initialLoadComplete: ${loadState2.initialLoadComplete}, origin: ${origin}`);
    if (!loadState2.initialLoadComplete || origin === 'persistence') {
      console.log(`[NEW UPDATE] Skipping update`);
      return;
    }
    await mockPersistence.persist('test-doc', update);
    loadState2.updateCount++;
  };
  
  // This is what happens in setupPersistenceHandler when doc is cached
  console.log('[SETUP] Adding new update handler to cached doc');
  doc2.on('update', newHandler);
  
  // Load data
  const data2 = await mockPersistence.load('test-doc');
  if (data2) {
    console.log('[LOAD] Applying loaded data to cached doc');
    Y.applyUpdate(doc2, data2, 'persistence');
  }
  loadState2.initialLoadComplete = true;
  console.log('[INIT] Second load complete');
  
  // Check handler count again
  console.log(`[CHECK] Doc now has ${Object.keys(doc2._observers?.update || {}).length} update observers`);
  
  // Make new edits
  console.log('\n[EDIT] Making new edits after reload...');
  text1.insert(text1.length, ' - Edit after reload');
  console.log(`[EDIT] Text is now: "${text1.toString()}"`);
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Check results
  console.log('\n\nRESULTS:');
  console.log('--------');
  console.log(`First session persisted: ${loadState1.updateCount} updates`);
  console.log(`Second session persisted: ${loadState2.updateCount} updates`);
  console.log(`Total updates in storage: ${mockPersistence.data.get('test-doc')?.length || 0}`);
  
  // Step 3: Fresh reload - new doc instance
  console.log('\n\nSTEP 3: Fresh Reload (New Doc)');
  console.log('------------------------------');
  
  const doc3 = new Y.Doc();
  const loadState3 = { initialLoadComplete: false, updateCount: 0 };
  
  doc3.on('update', async (update: Uint8Array, origin: any) => {
    console.log(`[FRESH UPDATE] initialLoadComplete: ${loadState3.initialLoadComplete}, origin: ${origin}`);
    if (!loadState3.initialLoadComplete || origin === 'persistence') {
      console.log(`[FRESH UPDATE] Skipping update`);
      return;
    }
    await mockPersistence.persist('test-doc', update);
    loadState3.updateCount++;
  });
  
  const data3 = await mockPersistence.load('test-doc');
  if (data3) {
    Y.applyUpdate(doc3, data3, 'persistence');
  }
  loadState3.initialLoadComplete = true;
  
  const text3 = doc3.getText('content');
  console.log(`[CHECK] Fresh doc content: "${text3.toString()}"`);
  
  text3.insert(text3.length, ' - Fresh doc edit');
  console.log(`[EDIT] Fresh doc text: "${text3.toString()}"`);
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log(`\nFresh doc persisted: ${loadState3.updateCount} updates`);
  console.log(`Total updates now: ${mockPersistence.data.get('test-doc')?.length || 0}`);
}

// Run the simulation
simulatePersistenceFlow().catch(console.error);