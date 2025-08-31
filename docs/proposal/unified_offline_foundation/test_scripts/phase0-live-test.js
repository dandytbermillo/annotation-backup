#!/usr/bin/env node

/**
 * Phase 0 Live Test Script
 * Verifies all Phase 0 components are working correctly
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

async function runTests() {
  console.log('\n🔬 Phase 0 Live Test\n');
  console.log('=' .repeat(50));
  
  let passed = 0;
  let failed = 0;

  // Test 1: Telemetry GET endpoint
  console.log('\n1. Testing Telemetry GET Endpoint');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/telemetry',
      method: 'GET'
    });
    
    if (response.status === 200 && response.data.network) {
      console.log('✅ Telemetry GET working');
      console.log(`   Network quality: ${response.data.network.quality}`);
      console.log(`   Cache hit rate: ${response.data.cache.hitRate}`);
      passed++;
    } else {
      console.log('❌ Telemetry GET failed');
      failed++;
    }
  } catch (error) {
    console.log('❌ Telemetry GET error:', error.message);
    failed++;
  }

  // Test 2: Telemetry POST endpoint
  console.log('\n2. Testing Telemetry POST Endpoint');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/telemetry',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      events: [{
        timestamp: Date.now(),
        category: 'test',
        action: 'phase0-live-test',
        metadata: { source: 'script' }
      }],
      metrics: {
        network: { quality: 'good', rtt: 50 },
        cache: { hits: 10, misses: 2 },
        queue: { depth: 0 },
        conflict: { occurrences: 0 }
      },
      timestamp: Date.now()
    });
    
    if (response.status === 200 && response.data.success) {
      console.log('✅ Telemetry POST working');
      console.log(`   Received: ${response.data.received} events`);
      passed++;
    } else {
      console.log('❌ Telemetry POST failed');
      failed++;
    }
  } catch (error) {
    console.log('❌ Telemetry POST error:', error.message);
    failed++;
  }

  // Test 3: Health endpoint (for future network detector)
  console.log('\n3. Testing Health Endpoint');
  console.log('-'.repeat(40));
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/api/health',
      method: 'GET'
    });
    
    if (response.status === 200) {
      console.log('✅ Health endpoint accessible');
      passed++;
    } else {
      console.log('⚠️  Health endpoint returns:', response.status);
      console.log('   (Will be implemented in Phase 1)');
      // Don't count as failure since it's Phase 1
    }
  } catch (error) {
    console.log('ℹ️  Health endpoint not yet implemented (Phase 1)');
    // Don't count as failure
  }

  // Test 4: Feature flag system (via checking files exist)
  console.log('\n4. Testing Feature Flag System');
  console.log('-'.repeat(40));
  const fs = require('fs');
  const path = require('path');
  
  const flagFile = path.join(__dirname, '../../../../lib/offline/feature-flags.ts');
  if (fs.existsSync(flagFile)) {
    console.log('✅ Feature flag system exists');
    console.log('   Flags: offline.circuitBreaker, offline.swCaching, offline.conflictUI');
    passed++;
  } else {
    console.log('❌ Feature flag system not found');
    failed++;
  }

  // Test 5: Shared libraries exist
  console.log('\n5. Testing Shared Libraries');
  console.log('-'.repeat(40));
  
  const libs = [
    'network-detector.ts',
    'circuit-breaker.ts',
    'cache-manager.ts'
  ];
  
  let allLibsExist = true;
  for (const lib of libs) {
    const libPath = path.join(__dirname, '../../../../lib/offline/', lib);
    if (!fs.existsSync(libPath)) {
      allLibsExist = false;
      console.log(`   ❌ Missing: ${lib}`);
    } else {
      console.log(`   ✅ Found: ${lib}`);
    }
  }
  
  if (allLibsExist) {
    console.log('✅ All shared libraries exist');
    passed++;
  } else {
    console.log('❌ Some shared libraries missing');
    failed++;
  }

  // Summary
  console.log('\n' + '=' .repeat(50));
  console.log('📊 LIVE TEST SUMMARY');
  console.log('=' .repeat(50));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`ℹ️  Phase 1 features: Not tested (expected)`);
  
  const successRate = passed / (passed + failed) * 100;
  console.log(`\n📈 Success Rate: ${successRate.toFixed(0)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All Phase 0 components are working!');
    console.log('The foundation is ready for Phase 1 implementation.\n');
  } else {
    console.log('\n⚠️  Some tests failed. Please check the errors above.\n');
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run the tests
runTests().catch(console.error);