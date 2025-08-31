#!/usr/bin/env node

/**
 * API Smoke Test Script
 * Quick validation of all offline sync API endpoints
 */

const http = require('http');
const crypto = require('crypto');

// Configuration
const API_BASE = 'http://localhost:3000/api';
const TEST_TIMEOUT = 5000;

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  reset: '\x1b[0m'
};

// Test utilities
const log = (message, color = 'reset') => {
  console.log(`${colors[color]}${message}${colors.reset}`);
};

const makeRequest = (path, options = {}) => {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${path}`);
    
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      timeout: TEST_TIMEOUT
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
};

// Test cases
const tests = [
  {
    name: 'Search API - Basic Query',
    async test() {
      const res = await makeRequest('/search?q=test&limit=10');
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      if (!res.data.query) throw new Error('Missing query in response');
      if (typeof res.data.results !== 'object') throw new Error('Results should be an object by type');
      if (typeof res.data.totalCount !== 'number') throw new Error('totalCount missing');
      return `Total results ${res.data.totalCount}`;
    }
  },

  {
    name: 'Search API - Empty Query',
    async test() {
      const res = await makeRequest('/search?q=');
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      return 'Correctly rejected empty query';
    }
  },

  {
    name: 'Search API - Fuzzy Search',
    async test() {
      const res = await makeRequest('/search?q=tset&fuzzy=true');
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      if (!res.data.fuzzy) throw new Error('Fuzzy flag not set');
      return 'Fuzzy search enabled';
    }
  },

  {
    name: 'Version History API - List Versions',
    async test() {
      const noteId = 'test-note-001';
      const panelId = 'test-panel-001';
      const res = await makeRequest(`/versions/${noteId}/${panelId}`);
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      if (!Array.isArray(res.data.versions)) throw new Error('Versions not an array');
      return `Retrieved ${res.data.versions.length} versions`;
    }
  },

  {
    name: 'Version Compare API',
    async test() {
      const res = await makeRequest('/versions/compare', {
        method: 'POST',
        body: {
          noteId: 'test-note-001',
          panelId: 'test-panel-001',
          version1: 1,
          version2: 2
        }
      });
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      if (!res.data.comparison) throw new Error('Missing comparison data');
      return 'Version comparison successful';
    }
  },

  {
    name: 'Version Compare API - Invalid Versions',
    async test() {
      const res = await makeRequest('/versions/compare', {
        method: 'POST',
        body: {
          noteId: 'test-note-001',
          panelId: 'test-panel-001',
          version1: -1,
          version2: 'invalid'
        }
      });
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      return 'Correctly rejected invalid versions';
    }
  },

  {
    name: 'Queue Export API - Pending Only',
    async test() {
      const res = await makeRequest('/offline-queue/export?status=pending');
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      if (!res.data.version) throw new Error('Missing version');
      if (!Array.isArray(res.data.operations)) throw new Error('Operations not an array');
      if (!res.data.checksum) throw new Error('Missing checksum');
      return `Exported ${res.data.operations.length} operations`;
    }
  },

  {
    name: 'Queue Export API - All Statuses',
    async test() {
      const res = await makeRequest('/offline-queue/export');
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      if (!res.data.exported_at) throw new Error('Missing export timestamp');
      return `Total ${res.data.total_count} operations`;
    }
  },

  {
    name: 'Queue Import API - Validation Only',
    async test() {
      const testOp = {
        type: 'create',
        table_name: 'test_table',
        entity_id: crypto.randomUUID(),
        data: { test: true },
        idempotency_key: crypto.randomUUID(),
        origin_device_id: 'test-script',
        schema_version: 1
      };

      const res = await makeRequest('/offline-queue/import', {
        method: 'POST',
        body: {
          version: 2,
          operations: [testOp],
          validate_only: true
        }
      });
      
      if (res.status !== 200) throw new Error(`Status ${res.status}`);
      if (!res.data.valid) throw new Error('Validation failed');
      return 'Validation passed';
    }
  },

  {
    name: 'Queue Import API - Invalid Schema',
    async test() {
      const res = await makeRequest('/offline-queue/import', {
        method: 'POST',
        body: {
          version: 999,
          operations: [{ invalid: 'operation' }]
        }
      });
      
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      return 'Correctly rejected invalid schema';
    }
  },

  {
    name: 'Queue Import API - Checksum Validation',
    async test() {
      const operations = [{
        type: 'update',
        table_name: 'notes',
        entity_id: 'test-123',
        data: { content: 'test' },
        idempotency_key: 'test-key'
      }];
      
      const res = await makeRequest('/offline-queue/import', {
        method: 'POST',
        body: {
          version: 2,
          operations: operations,
          checksum: 'invalid-checksum',
          validate_only: true
        }
      });
      
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
      if (!res.data.error.includes('checksum')) throw new Error('No checksum error');
      return 'Checksum validation working';
    }
  }
];

// Test runner
async function runTests() {
  log('\n=====================================', 'blue');
  log('    Offline Sync API Smoke Tests    ', 'blue');
  log('=====================================\n', 'blue');
  
  let passed = 0;
  let failed = 0;
  const results = [];
  
  for (const test of tests) {
    process.stdout.write(`Testing ${test.name}... `);
    const startTime = Date.now();
    
    try {
      const result = await test.test();
      const duration = Date.now() - startTime;
      log(`✓ PASS (${duration}ms)`, 'green');
      if (result) {
        log(`  └─ ${result}`, 'blue');
      }
      passed++;
      results.push({ name: test.name, status: 'PASS', duration, message: result });
    } catch (error) {
      const duration = Date.now() - startTime;
      log(`✗ FAIL (${duration}ms)`, 'red');
      log(`  └─ ${error.message}`, 'red');
      failed++;
      results.push({ name: test.name, status: 'FAIL', duration, error: error.message });
    }
  }
  
  // Summary
  log('\n=====================================', 'blue');
  log('            Test Summary             ', 'blue');
  log('=====================================', 'blue');
  log(`Total: ${tests.length} | Passed: ${passed} | Failed: ${failed}`, 'yellow');
  
  // Performance summary
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  log(`Average response time: ${avgDuration.toFixed(2)}ms`, 'yellow');
  
  // Detailed results table
  if (failed > 0) {
    log('\nFailed Tests:', 'red');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      log(`  • ${r.name}: ${r.error}`, 'red');
    });
  }
  
  // Exit code
  process.exit(failed > 0 ? 1 : 0);
}

// Check if server is running
async function checkServer() {
  try {
    await makeRequest('/health');
    return true;
  } catch (error) {
    log('Error: Development server is not running', 'red');
    log('Please start the server with: npm run dev', 'yellow');
    return false;
  }
}

// Main execution
(async () => {
  // Check prerequisites
  log('Checking prerequisites...', 'yellow');
  
  const serverRunning = await checkServer();
  if (!serverRunning) {
    process.exit(1);
  }
  
  log('Server is running ✓\n', 'green');
  
  // Run tests
  await runTests();
})().catch(error => {
  log(`\nUnexpected error: ${error.message}`, 'red');
  process.exit(1);
});