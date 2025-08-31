#!/usr/bin/env node

/**
 * Run HTML Test Page Tests Programmatically
 * Simulates clicking the "Run All Tests" button on the HTML page
 */

const http = require('http');

// Helper to make HTTP requests
function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runHtmlTests() {
  console.log('\n🧪 Running HTML Test Suite Programmatically\n');
  console.log('=' .repeat(60));
  
  const tests = [
    {
      name: 'Queue Flush (Body Operations)',
      async run() {
        const res = await makeRequest({
          hostname: 'localhost',
          port: 3000,
          path: '/api/postgres-offline/queue/flush',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, {
          operations: [{
            noteId: 'test-' + Date.now(),
            panelId: 'panel-' + Date.now(),
            operation: 'create',
            data: { content: { type: 'doc', content: [] } }
          }]
        });
        return res.status === 200 && res.data.processed >= 0;
      }
    },
    {
      name: 'Queue Flush (DB Drain Mode)',
      async run() {
        const res = await makeRequest({
          hostname: 'localhost',
          port: 3000,
          path: '/api/postgres-offline/queue/flush',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, { drain_db: true });
        return res.status === 200 && res.data.success === true;
      }
    },
    {
      name: 'Import with Top-Level Fields',
      async run() {
        const res = await makeRequest({
          hostname: 'localhost',
          port: 3000,
          path: '/api/offline-queue/import',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, {
          version: 2,
          operations: []
        });
        return res.status === 200 && 
               res.data.imported !== undefined && 
               res.data.skipped !== undefined;
      }
    },
    {
      name: 'Import Duplicates Detection',
      async run() {
        const key = 'dup-test-' + Date.now();
        // First import
        await makeRequest({
          hostname: 'localhost',
          port: 3000,
          path: '/api/offline-queue/import',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, {
          version: 2,
          operations: [{
            type: 'create',
            table_name: 'notes',
            entity_id: 'test-id',
            data: { title: 'Test' },
            idempotency_key: key
          }]
        });
        
        // Second import (should skip)
        const res = await makeRequest({
          hostname: 'localhost',
          port: 3000,
          path: '/api/offline-queue/import',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, {
          version: 2,
          operations: [{
            type: 'create',
            table_name: 'notes',
            entity_id: 'test-id',
            data: { title: 'Test' },
            idempotency_key: key
          }]
        });
        
        return res.status === 200 && res.data.skipped === 1;
      }
    },
    {
      name: 'Fuzzy Search with Default Threshold',
      async run() {
        const res = await makeRequest({
          hostname: 'localhost',
          port: 3000,
          path: '/api/search?q=annotation&type=fuzzy',
          method: 'GET'
        });
        return res.status === 200 && res.data.type === 'fuzzy';
      }
    },
    {
      name: 'Fuzzy Search with Custom Threshold',
      async run() {
        const res = await makeRequest({
          hostname: 'localhost',
          port: 3000,
          path: '/api/search?q=annotatoin&type=fuzzy&similarity=0.2',
          method: 'GET'
        });
        return res.status === 200 && res.data.type === 'fuzzy';
      }
    },
    {
      name: 'Export Queue Package',
      async run() {
        const res = await makeRequest({
          hostname: 'localhost',
          port: 3000,
          path: '/api/offline-queue/export',
          method: 'GET'
        });
        return res.status === 200 && 
               res.data.version === 2 &&
               res.data.metadata !== undefined;
      }
    },
    {
      name: 'Dead Letter Queue',
      async run() {
        const res = await makeRequest({
          hostname: 'localhost',
          port: 3000,
          path: '/api/offline-queue/dead-letter',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, { ids: [] });
        // Should return 400 for empty array
        return res.status === 400;
      }
    }
  ];

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const test of tests) {
    try {
      const success = await test.run();
      if (success) {
        console.log(`✅ ${test.name}`);
        passed++;
        results.push({ name: test.name, status: 'passed' });
      } else {
        console.log(`❌ ${test.name}`);
        failed++;
        results.push({ name: test.name, status: 'failed' });
      }
    } catch (error) {
      console.log(`❌ ${test.name}: ${error.message}`);
      failed++;
      results.push({ name: test.name, status: 'error', error: error.message });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${passed}/${tests.length}`);
  console.log(`❌ Failed: ${failed}/${tests.length}`);
  console.log(`📈 Success Rate: ${Math.round((passed / tests.length) * 100)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All HTML test suite tests are passing!');
    console.log('\n✨ The implementation is successful and working correctly.');
    console.log('\n📌 Next: Open http://localhost:3000/offline-sync-test.html');
    console.log('   to see the visual test results in your browser.\n');
  } else {
    console.log('\n⚠️  Some tests failed. Details above.');
    console.log('Check the HTML page for more detailed error messages.\n');
  }
  
  return { passed, failed, results };
}

// Run the tests
runHtmlTests().catch(console.error);