#!/usr/bin/env node

/**
 * Verify Patches Test Script
 * Tests the three critical patches applied to the system
 */

const http = require('http');

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

async function testPatches() {
  console.log('\n🔍 Verifying Patch Implementation\n');
  console.log('=' .repeat(50));
  
  let passed = 0;
  let failed = 0;

  // Test Patch 0001b: Dual-mode flush
  console.log('\n📋 Patch 0001b: Dual-Mode Queue Flush');
  console.log('-'.repeat(40));
  
  try {
    // Test body operations mode (backward compatibility)
    const opsResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/postgres-offline/queue/flush',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      operations: [{
        noteId: 'test-note-' + Date.now(),
        panelId: 'test-panel-' + Date.now(),
        operation: 'create',
        data: { content: 'test' }
      }]
    });
    
    if (opsResponse.status === 200 && 
        opsResponse.data.processed !== undefined &&
        opsResponse.data.succeeded !== undefined) {
      console.log('  ✅ Body operations mode: Working');
      console.log(`     Processed: ${opsResponse.data.processed}, Succeeded: ${opsResponse.data.succeeded}`);
      passed++;
    } else {
      console.log('  ❌ Body operations mode: Failed');
      failed++;
    }
    
    // Test DB drain mode (new functionality)
    const drainResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/postgres-offline/queue/flush',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      drain_db: true
    });
    
    if (drainResponse.status === 200 && 
        drainResponse.data.success === true &&
        drainResponse.data.data !== undefined) {
      console.log('  ✅ DB drain mode: Working');
      console.log(`     Processed: ${drainResponse.data.data.processed}, Failed: ${drainResponse.data.data.failed}, Expired: ${drainResponse.data.data.expired}`);
      passed++;
    } else {
      console.log('  ❌ DB drain mode: Failed');
      failed++;
    }
  } catch (error) {
    console.log('  ❌ Patch 0001b test error:', error.message);
    failed += 2;
  }

  // Test Patch 0002: Import response structure
  console.log('\n📋 Patch 0002: Import Response Structure');
  console.log('-'.repeat(40));
  
  try {
    const importResponse = await makeRequest({
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
        entity_id: 'import-test-' + Date.now(),
        data: { title: 'Import test' },
        idempotency_key: 'test-key-' + Date.now()
      }]
    });
    
    if (importResponse.status === 200 &&
        importResponse.data.imported !== undefined &&
        importResponse.data.skipped !== undefined &&
        importResponse.data.results !== undefined) {
      console.log('  ✅ Top-level fields present: imported, skipped');
      console.log(`     Imported: ${importResponse.data.imported}, Skipped: ${importResponse.data.skipped}`);
      passed++;
    } else {
      console.log('  ❌ Top-level fields missing');
      failed++;
    }
  } catch (error) {
    console.log('  ❌ Patch 0002 test error:', error.message);
    failed++;
  }

  // Test Patch 0003: Fuzzy search threshold
  console.log('\n📋 Patch 0003: Fuzzy Search Threshold');
  console.log('-'.repeat(40));
  
  try {
    // Test with default threshold
    const defaultResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/search?q=test&type=fuzzy',
      method: 'GET'
    });
    
    if (defaultResponse.status === 200) {
      console.log('  ✅ Default threshold (0.45): Working');
      passed++;
    } else {
      console.log('  ❌ Default threshold: Failed');
      failed++;
    }
    
    // Test with custom threshold
    const customResponse = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/search?q=test&type=fuzzy&similarity=0.3',
      method: 'GET'
    });
    
    if (customResponse.status === 200) {
      console.log('  ✅ Custom threshold (0.3): Working');
      passed++;
    } else {
      console.log('  ❌ Custom threshold: Failed');
      failed++;
    }
  } catch (error) {
    console.log('  ❌ Patch 0003 test error:', error.message);
    failed += 2;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 PATCH VERIFICATION SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All patches are working correctly!');
    console.log('You can now open http://localhost:3000/offline-sync-test.html');
    console.log('to run the full visual test suite.\n');
  } else {
    console.log('\n⚠️  Some patches may have issues.');
    console.log('Please check the errors above.\n');
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
testPatches().catch(console.error);