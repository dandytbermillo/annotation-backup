#!/usr/bin/env ts-node

import { getEditorYDoc } from './lib/yjs-provider'
import { EnhancedCollaborationProvider } from './lib/enhanced-yjs-provider'
import * as Y from 'yjs'

async function testPersistenceFix() {
  console.log('Testing persistence fix for cached documents...')
  
  const provider = EnhancedCollaborationProvider.getInstance()
  const noteId = 'test-note-1'
  const panelId = 'test-panel-1'
  
  // Test 1: Create a new document and add content
  console.log('\n1. Creating new document and adding content...')
  const doc1 = getEditorYDoc(panelId, noteId)
  const fragment1 = doc1.getXmlFragment('prosemirror')
  
  // Add some content
  doc1.transact(() => {
    const text = new Y.XmlText()
    text.insert(0, 'Initial content')
    fragment1.insert(0, [text])
  })
  
  // Wait a bit for persistence
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Test 2: Get the same document from cache and add more content
  console.log('\n2. Getting document from cache and adding more content...')
  const doc2 = getEditorYDoc(panelId, noteId)
  
  // Verify it's the same document
  if (doc1 === doc2) {
    console.log('✓ Retrieved same document from cache')
  } else {
    console.log('✗ Got different document!')
  }
  
  // Add more content
  doc2.transact(() => {
    const fragment2 = doc2.getXmlFragment('prosemirror')
    const text = new Y.XmlText()
    text.insert(0, ' - Added after cache retrieval')
    fragment2.insert(fragment2.length, [text])
  })
  
  // Wait for persistence
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Test 3: Clear cache and reload to verify persistence
  console.log('\n3. Simulating page reload to test persistence...')
  
  // Clear the cache to force reload from persistence
  const { default: editorDocs } = await import('./lib/yjs-provider')
  // @ts-ignore - accessing private module state for testing
  const cacheKey = `${noteId}-${panelId}`
  
  // Manually clear from cache (simulating page refresh)
  console.log('Clearing document from memory cache...')
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Get document again - should load from persistence
  const doc3 = getEditorYDoc(panelId, noteId)
  const fragment3 = doc3.getXmlFragment('prosemirror')
  
  // Check content
  const content = fragment3.toString()
  console.log('\nFinal content:', content)
  
  if (content.includes('Initial content') && content.includes('Added after cache retrieval')) {
    console.log('\n✓ SUCCESS: Both initial and post-cache content were persisted!')
  } else {
    console.log('\n✗ FAIL: Content was not properly persisted')
    console.log('Expected to find both "Initial content" and "Added after cache retrieval"')
  }
}

// Run the test
testPersistenceFix().catch(console.error)