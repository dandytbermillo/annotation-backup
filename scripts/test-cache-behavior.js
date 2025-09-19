#!/usr/bin/env node

// Test script to verify cache behavior in plain-offline-provider
// This simulates what happens when a user edits and then navigates

const TEST_NOTE_ID = 'test-note-' + Date.now();
const PANEL_ID = 'main';

console.log('=== Testing Plain Offline Provider Cache Behavior ===');
console.log('Test Note ID:', TEST_NOTE_ID);
console.log('');

async function simulateBrowserSession() {
  console.log('1. Simulating initial page load and edit');
  console.log('==========================================');
  
  // First "page load" - provider instance 1
  const session1 = {
    cache: new Map(),
    async loadDocument(noteId, panelId) {
      const key = `${noteId}:${panelId}`;
      if (this.cache.has(key)) {
        console.log(`  [CACHE HIT] Returning cached content for ${key}`);
        return this.cache.get(key);
      }
      console.log(`  [CACHE MISS] Fetching from database for ${key}`);
      // Simulate DB fetch
      const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original content' }] }] };
      this.cache.set(key, content);
      return content;
    },
    async saveDocument(noteId, panelId, content) {
      const key = `${noteId}:${panelId}`;
      console.log(`  [SAVE] Updating cache and saving to DB for ${key}`);
      this.cache.set(key, content);
      // Simulate async DB save
      setTimeout(() => {
        console.log(`  [DB] Save completed for ${key}`);
      }, 100);
    }
  };
  
  // Load document
  const content1 = await session1.loadDocument(TEST_NOTE_ID, PANEL_ID);
  console.log('  Initial content loaded:', JSON.stringify(content1).substring(0, 50) + '...');
  
  // Edit and save
  const editedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited content!' }] }] };
  await session1.saveDocument(TEST_NOTE_ID, PANEL_ID, editedContent);
  
  console.log('');
  console.log('2. Navigating to another note and back (same session)');
  console.log('======================================================');
  
  // Navigate away and back in same session
  await session1.loadDocument('other-note', PANEL_ID);
  const contentAfterNav = await session1.loadDocument(TEST_NOTE_ID, PANEL_ID);
  console.log('  Content after navigation:', JSON.stringify(contentAfterNav).substring(0, 50) + '...');
  
  console.log('');
  console.log('3. First page reload (new provider instance)');
  console.log('============================================');
  
  // Simulate page reload - new provider instance
  const session2 = {
    cache: new Map(), // Empty cache!
    async loadDocument(noteId, panelId) {
      const key = `${noteId}:${panelId}`;
      if (this.cache.has(key)) {
        console.log(`  [CACHE HIT] Returning cached content for ${key}`);
        return this.cache.get(key);
      }
      console.log(`  [CACHE MISS] Fetching from database for ${key}`);
      // Simulate DB fetch - might get old content if save is pending
      const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original content' }] }] };
      this.cache.set(key, content);
      return content;
    }
  };
  
  const contentAfterReload1 = await session2.loadDocument(TEST_NOTE_ID, PANEL_ID);
  console.log('  Content after first reload:', JSON.stringify(contentAfterReload1).substring(0, 50) + '...');
  
  console.log('');
  console.log('4. Second page reload (after save completed)');
  console.log('===========================================');
  
  // Wait for save to complete
  await new Promise(resolve => setTimeout(resolve, 150));
  
  const session3 = {
    cache: new Map(),
    async loadDocument(noteId, panelId) {
      const key = `${noteId}:${panelId}`;
      if (this.cache.has(key)) {
        console.log(`  [CACHE HIT] Returning cached content for ${key}`);
        return this.cache.get(key);
      }
      console.log(`  [CACHE MISS] Fetching from database for ${key}`);
      // Now DB has the edited content
      const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited content!' }] }] };
      this.cache.set(key, content);
      return content;
    }
  };
  
  const contentAfterReload2 = await session3.loadDocument(TEST_NOTE_ID, PANEL_ID);
  console.log('  Content after second reload:', JSON.stringify(contentAfterReload2).substring(0, 50) + '...');
  
  console.log('');
  console.log('=== ANALYSIS ===');
  console.log('Same session navigation: Shows edited content (from cache)');
  console.log('First reload: Shows original content (cache empty, DB save pending)');
  console.log('Second reload: Shows edited content (DB save completed)');
}

simulateBrowserSession().catch(console.error);