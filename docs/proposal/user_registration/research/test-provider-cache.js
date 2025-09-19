/**
 * Test script to verify the provider cache behavior on reload
 * Run with: node test-provider-cache.js
 */

const { PlainOfflineProvider } = require('../../../../lib/providers/plain-offline-provider');

// Mock adapter to track API calls
class TestAdapter {
  constructor() {
    this.loadCount = 0;
    this.saveCount = 0;
    this.storedDocuments = new Map();
  }

  async loadDocument(noteId, panelId) {
    this.loadCount++;
    const key = `${noteId}:${panelId}`;
    console.log(`[Adapter] loadDocument called (count: ${this.loadCount}) for ${key}`);
    
    const doc = this.storedDocuments.get(key);
    if (doc) {
      console.log(`[Adapter] Returning stored document version ${doc.version}`);
      return doc;
    }
    
    console.log(`[Adapter] No document found`);
    return null;
  }

  async saveDocument(noteId, panelId, content, version, baseVersion) {
    this.saveCount++;
    const key = `${noteId}:${panelId}`;
    console.log(`[Adapter] saveDocument called (count: ${this.saveCount}) for ${key}, version ${version}`);
    
    this.storedDocuments.set(key, { content, version });
  }

  async createNote(input) { return { ...input, id: 'test-note-id' }; }
  async updateNote(id, patch) { return { id, ...patch }; }
  async getNote(id) { return null; }
  async createBranch(input) { return { ...input, id: 'test-branch-id' }; }
  async updateBranch(id, patch) { return { id, ...patch }; }
  async listBranches(noteId) { return []; }
  async enqueueOffline(op) { }
  async flushQueue() { return { processed: 0, failed: 0 }; }
}

async function runTest() {
  console.log('\n=== Testing Provider Cache Behavior ===\n');

  // Simulate first page load
  console.log('--- FIRST PAGE LOAD ---');
  const adapter1 = new TestAdapter();
  const provider1 = new PlainOfflineProvider(adapter1);
  
  const noteId = 'test-note';
  const panelId = 'test-panel';
  const content1 = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original content' }] }] };
  
  // Load document (should hit adapter)
  console.log('\n1. Loading document (empty cache)...');
  const loaded1 = await provider1.loadDocument(noteId, panelId);
  console.log(`   Result: ${loaded1 ? 'null (no document)' : 'null'}`);
  console.log(`   Adapter load count: ${adapter1.loadCount}`);
  
  // Save document
  console.log('\n2. Saving document...');
  await provider1.saveDocument(noteId, panelId, content1);
  console.log(`   Adapter save count: ${adapter1.saveCount}`);
  
  // Load again (should use cache)
  console.log('\n3. Loading document again (should use cache)...');
  const loaded2 = await provider1.loadDocument(noteId, panelId);
  console.log(`   Result: ${JSON.stringify(loaded2?.content || loaded2)}`);
  console.log(`   Adapter load count: ${adapter1.loadCount} (should still be 1 if using cache)`);
  
  // Update content
  const content2 = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated content' }] }] };
  console.log('\n4. Updating document...');
  await provider1.saveDocument(noteId, panelId, content2);
  
  // Load again (should still use cache)
  console.log('\n5. Loading after update (should return cached updated content)...');
  const loaded3 = await provider1.loadDocument(noteId, panelId);
  console.log(`   Result: ${JSON.stringify(loaded3?.content || loaded3)}`);
  console.log(`   Adapter load count: ${adapter1.loadCount} (should still be 1)`);
  
  // Simulate page reload - NEW provider instance
  console.log('\n--- SIMULATING PAGE RELOAD (new provider instance) ---');
  const adapter2 = new TestAdapter();
  // Copy stored documents to simulate persistent database
  adapter2.storedDocuments = new Map(adapter1.storedDocuments);
  
  const provider2 = new PlainOfflineProvider(adapter2);
  
  console.log('\n6. Loading document with NEW provider (empty cache)...');
  const loaded4 = await provider2.loadDocument(noteId, panelId);
  console.log(`   Result: ${JSON.stringify(loaded4?.content || loaded4)}`);
  console.log(`   Adapter load count: ${adapter2.loadCount} (should be 1 - had to fetch from adapter)`);
  
  console.log('\n7. Loading again with new provider (should use cache now)...');
  const loaded5 = await provider2.loadDocument(noteId, panelId);
  console.log(`   Result: ${JSON.stringify(loaded5?.content || loaded5)}`);
  console.log(`   Adapter load count: ${adapter2.loadCount} (should still be 1 if using cache)`);
  
  console.log('\n=== TEST SUMMARY ===');
  console.log('The cache is NOT persistent across page reloads.');
  console.log('Each new provider instance starts with an empty cache.');
  console.log('After reload, the first loadDocument MUST fetch from the adapter/database.');
}

runTest().catch(console.error);