#!/usr/bin/env node

/**
 * Test script for annotation features
 * Tests all critical functionality including:
 * - Document saving/loading
 * - Annotation creation and persistence
 * - Tooltip functionality
 * - Boundary behavior
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

async function testEndpoint(name, url, options = {}) {
  try {
    console.log(`\nTesting ${name}...`);
    const response = await fetch(`${BASE_URL}${url}`, options);
    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ ${name}: Success`);
      return { success: true, data };
    } else {
      console.log(`❌ ${name}: Failed with status ${response.status}`);
      console.log('Response:', data);
      return { success: false, error: data };
    }
  } catch (error) {
    console.log(`❌ ${name}: Error - ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🧪 Starting Annotation Feature Tests');
  console.log('====================================');
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  // Test 1: Health check
  const health = await testEndpoint('Health Check', '/api/health');
  results.tests.push({ name: 'Health Check', ...health });
  if (health.success) results.passed++; else results.failed++;
  
  // Test 2: Create a test note
  const noteData = {
    title: 'Test Note for Annotations',
    content: 'This is a test note with some content that we will annotate.',
    metadata: { test: true, timestamp: new Date().toISOString() }
  };
  
  const createNote = await testEndpoint('Create Note', '/api/postgres-offline/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(noteData)
  });
  
  results.tests.push({ name: 'Create Note', ...createNote });
  if (createNote.success) {
    results.passed++;
    const noteId = createNote.data.id;
    console.log(`  Note ID: ${noteId}`);
    
    // Test 3: Create a panel for the note
    const panelData = {
      note_id: noteId,
      position: { x: 100, y: 100 },
      dimensions: { width: 600, height: 400 },
      state: 'active'
    };
    
    const createPanel = await testEndpoint('Create Panel', '/api/postgres-offline/panels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(panelData)
    });
    
    results.tests.push({ name: 'Create Panel', ...createPanel });
    if (createPanel.success) {
      results.passed++;
      const panelId = createPanel.data.id;
      console.log(`  Panel ID: ${panelId}`);
      
      // Test 4: Save document with annotations
      const documentData = {
        content: `
          <p>This is a test document with <span class="annotation" data-id="ann1" data-branch-content="This is the annotation content that should appear in the tooltip">annotated text</span> that demonstrates our annotation system.</p>
          <p>Here's another paragraph with <span class="annotation" data-id="ann2" data-branch-content="This is a very long annotation content that should trigger scrollbar in the tooltip when displayed. ${Array(50).fill('Lorem ipsum dolor sit amet. ').join('')}">long annotation</span> content.</p>
        `,
        version: 1,
        baseVersion: 0,
        metadata: {
          annotations: [
            {
              id: 'ann1',
              type: 'note',
              content: 'This is the annotation content that should appear in the tooltip',
              position: { start: 30, end: 44 }
            },
            {
              id: 'ann2',
              type: 'note',
              content: `This is a very long annotation content that should trigger scrollbar in the tooltip when displayed. ${Array(50).fill('Lorem ipsum dolor sit amet. ').join('')}`,
              position: { start: 120, end: 135 }
            }
          ]
        }
      };
      
      const saveDocument = await testEndpoint(
        'Save Document',
        `/api/postgres-offline/documents/${noteId}/${panelId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(documentData)
        }
      );
      
      results.tests.push({ name: 'Save Document', ...saveDocument });
      if (saveDocument.success) {
        results.passed++;
        
        // Test 5: Load document
        const loadDocument = await testEndpoint(
          'Load Document',
          `/api/postgres-offline/documents/${noteId}/${panelId}`
        );
        
        results.tests.push({ name: 'Load Document', ...loadDocument });
        if (loadDocument.success) {
          results.passed++;
          
          // Verify annotations are preserved
          const content = loadDocument.data.content;
          const hasAnn1 = content.includes('data-id="ann1"');
          const hasAnn2 = content.includes('data-id="ann2"');
          
          if (hasAnn1 && hasAnn2) {
            console.log('  ✅ Annotations preserved in loaded document');
            results.passed++;
          } else {
            console.log('  ❌ Annotations not preserved');
            results.failed++;
          }
        } else {
          results.failed++;
        }
      } else {
        results.failed++;
      }
    } else {
      results.failed++;
    }
  } else {
    results.failed++;
  }
  
  // Test 6: Test batch operations
  console.log('\n📦 Testing Batch Operations...');
  
  const batchData = {
    operations: [
      {
        noteId: 'test-note-1',
        panelId: 'test-panel-1',
        content: '<p>Batch document 1</p>'
      },
      {
        noteId: 'test-note-2',
        panelId: 'test-panel-2',
        content: '<p>Batch document 2</p>'
      }
    ]
  };
  
  const batchSave = await testEndpoint('Batch Save Documents', '/api/postgres-offline/documents/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batchData)
  });
  
  results.tests.push({ name: 'Batch Save', ...batchSave });
  if (batchSave.success) results.passed++; else results.failed++;
  
  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary');
  console.log('='.repeat(50));
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
  
  // Print failed tests
  if (results.failed > 0) {
    console.log('\n❌ Failed Tests:');
    results.tests
      .filter(t => !t.success)
      .forEach(t => console.log(`  - ${t.name}: ${t.error}`));
  }
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});