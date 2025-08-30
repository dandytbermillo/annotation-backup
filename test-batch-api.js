#!/usr/bin/env node

// Test script to verify batch API coalescing and deduplication

async function testBatchAPI() {
  const baseUrl = 'http://localhost:3000/api/postgres-offline/documents/batch';
  
  console.log('Testing Batch API Coalescing...\n');
  
  // Test 1: Multiple operations for same panel - should coalesce to 1 row
  console.log('Test 1: Coalescing multiple ops for same panel');
  const test1Ops = [
    { noteId: 'test-note-1', panelId: 'panel-1', content: { html: 'First edit' }},
    { noteId: 'test-note-1', panelId: 'panel-1', content: { html: 'Second edit' }},
    { noteId: 'test-note-1', panelId: 'panel-1', content: { html: 'Third edit' }},
    { noteId: 'test-note-1', panelId: 'panel-1', content: { html: 'Final edit' }}
  ];
  
  const res1 = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations: test1Ops })
  });
  
  const result1 = await res1.json();
  console.log('Result: Processed:', result1.processed, 'Skipped:', result1.skipped);
  console.log('Expected: 1 processed (only final content saved)\n');
  
  // Test 2: Duplicate content - should skip
  console.log('Test 2: Duplicate content detection');
  const test2Ops = [
    { noteId: 'test-note-1', panelId: 'panel-1', content: { html: 'Final edit' }} // Same as last
  ];
  
  const res2 = await fetch(baseUrl, {
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations: test2Ops })
  });
  
  const result2 = await res2.json();
  console.log('Result: Processed:', result2.processed, 'Skipped:', result2.skipped);
  console.log('Expected: 0 processed, 1 skipped (content unchanged)\n');
  
  // Test 3: Different panels - should create separate rows
  console.log('Test 3: Different panels - no coalescing');
  const test3Ops = [
    { noteId: 'test-note-2', panelId: 'panel-a', content: { html: 'Panel A content' }},
    { noteId: 'test-note-2', panelId: 'panel-b', content: { html: 'Panel B content' }},
    { noteId: 'test-note-2', panelId: 'panel-c', content: { html: 'Panel C content' }}
  ];
  
  const res3 = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations: test3Ops })
  });
  
  const result3 = await res3.json();
  console.log('Result: Processed:', result3.processed, 'Skipped:', result3.skipped);
  console.log('Expected: 3 processed (different panels)\n');
  
  // Test 4: Idempotency key
  console.log('Test 4: Idempotency key handling');
  const idempotencyKey = 'test-key-' + Date.now();
  const test4Ops = [
    { 
      noteId: 'test-note-3', 
      panelId: 'panel-x', 
      content: { html: 'Idempotent content' },
      idempotencyKey
    }
  ];
  
  // First request
  const res4a = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations: test4Ops })
  });
  const result4a = await res4a.json();
  
  // Duplicate request with same idempotency key
  const res4b = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations: test4Ops })
  });
  const result4b = await res4b.json();
  
  console.log('First request - Processed:', result4a.processed);
  console.log('Duplicate request - Cached results:', result4b.results[0]?.cached || false);
  console.log('Expected: First processes, second returns cached\n');
  
  console.log('✅ Batch API tests complete!');
}

// Run if started directly
if (require.main === module) {
  testBatchAPI().catch(console.error);
}