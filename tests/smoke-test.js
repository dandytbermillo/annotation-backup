#!/usr/bin/env node
/**
 * 10-minute smoke test for Context-OS Browser MVP
 */

const http = require('http');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const COMPANION_URL = 'http://127.0.0.1:4000';
const TEST_SLUG = 'smoke_test_feature';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function request(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 4000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000',
        ...headers
      }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, body: json });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function runTests() {
  log('🚀 Starting Context-OS Browser MVP Smoke Test', 'blue');
  log('=' . repeat(50));
  
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    errors: []
  };
  
  async function test(name, fn) {
    results.total++;
    process.stdout.write(`  ${name}... `);
    
    try {
      await fn();
      results.passed++;
      log('✓', 'green');
    } catch (error) {
      results.failed++;
      log('✗', 'red');
      results.errors.push({ name, error: error.message });
    }
  }
  
  // 1. Health check
  await test('Companion health check', async () => {
    const res = await request('GET', '/api/health');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (res.body.status !== 'ok') throw new Error('Not ok');
  });
  
  // 2. Get CSRF token
  let csrfToken;
  await test('Get CSRF token', async () => {
    const res = await request('GET', '/api/csrf');
    if (!res.body.token) throw new Error('No token');
    csrfToken = res.body.token;
  });
  
  // 3. Get draft
  let etag;
  await test('Get or create draft', async () => {
    const res = await request('GET', `/api/draft/${TEST_SLUG}`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.etag) throw new Error('No etag');
    etag = res.body.etag;
  });
  
  // 4. Save & validate
  await test('Save draft with autosave', async () => {
    const content = `---
meta_version: 1
feature_slug: ${TEST_SLUG}
status: draft
---

# INITIAL

**Title**: Smoke Test Feature

## Problem

This is a test problem statement for the smoke test.
It verifies that the system is working correctly.
Multiple sentences are included to meet requirements.

## Goals

- Verify save functionality
- Test validation
- Check LLM integration

## Acceptance Criteria

- Draft saves correctly
- Validation passes
- ETag updates properly
`;
    
    const res = await request('POST', '/api/draft/save', 
      { slug: TEST_SLUG, content, etag },
      { 'x-csrf-token': csrfToken }
    );
    
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.saved) throw new Error('Not saved');
    etag = res.body.etag; // Update etag
  });
  
  // 5. Validate
  await test('Validate draft structure', async () => {
    const res = await request('POST', '/api/validate',
      { slug: TEST_SLUG, etag },
      { 'x-csrf-token': csrfToken }
    );
    
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    // Should have some missing fields (stakeholders)
    if (!Array.isArray(res.body.missing_fields)) {
      throw new Error('No missing_fields array');
    }
  });
  
  // 6. LLM Verify (mock mode)
  await test('LLM Verify (report card)', async () => {
    const validationResult = { 
      ok: false, 
      missing_fields: ['stakeholders'] 
    };
    
    const res = await request('POST', '/api/llm/verify',
      { slug: TEST_SLUG, etag, validationResult },
      { 'x-csrf-token': csrfToken }
    );
    
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    if (!res.body.header_meta) throw new Error('No header_meta');
    if (!res.body.suggestions) throw new Error('No suggestions');
    if (!res.body.prp_gate) throw new Error('No prp_gate');
  });
  
  // 7. Test ETag conflict
  await test('ETag conflict detection', async () => {
    const oldEtag = 'v123-old';
    const res = await request('POST', '/api/draft/save',
      { slug: TEST_SLUG, content: 'test', etag: oldEtag },
      { 'x-csrf-token': csrfToken }
    );
    
    if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`);
    if (res.body.code !== 'STALE_ETAG') throw new Error('Wrong error code');
  });
  
  // 8. Test CSRF protection
  await test('CSRF protection works', async () => {
    const res = await request('POST', '/api/draft/save',
      { slug: TEST_SLUG, content: 'test', etag },
      {} // No CSRF token
    );
    
    if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
    if (res.body.code !== 'CSRF_REQUIRED') throw new Error('Wrong error code');
  });
  
  // 9. Test path normalization
  await test('Path normalization', async () => {
    const res = await request('GET', '/api/draft/../../../etc/passwd');
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    // Should normalize the path
    if (res.body.slug.includes('..')) throw new Error('Path not normalized');
  });
  
  // 10. Test promote (but don't actually promote in smoke test)
  await test('Promote endpoint exists', async () => {
    // Just check that the endpoint responds correctly
    const res = await request('POST', '/api/draft/promote',
      { slug: 'nonexistent', etag: 'fake' },
      { 'x-csrf-token': csrfToken }
    );
    
    // Should fail with stale etag or file not found
    if (res.status === 200) throw new Error('Should not succeed with fake data');
  });
  
  // Results
  log('\n' + '=' . repeat(50));
  log(`Results: ${results.passed}/${results.total} passed`, 
      results.failed === 0 ? 'green' : 'yellow');
  
  if (results.errors.length > 0) {
    log('\nErrors:', 'red');
    results.errors.forEach(e => {
      log(`  ${e.name}: ${e.error}`, 'red');
    });
  }
  
  // Clean up test files
  try {
    await fs.unlink(`.tmp/initial/${TEST_SLUG}.draft.md`);
  } catch {}
  
  return results.failed === 0 ? 0 : 1;
}

// Check if companion is running
async function checkCompanion() {
  try {
    await request('GET', '/api/health');
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Check if companion is running
  const isRunning = await checkCompanion();
  
  if (!isRunning) {
    log('⚠️  Companion not running. Starting it...', 'yellow');
    
    // Start companion in background
    const companion = exec('node context-os/companion/server-v2.js');
    
    // Wait for it to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Run tests
    const exitCode = await runTests();
    
    // Stop companion
    companion.kill();
    
    process.exit(exitCode);
  } else {
    // Companion already running
    const exitCode = await runTests();
    process.exit(exitCode);
  }
}

// Run
main().catch(error => {
  log(`Fatal error: ${error.message}`, 'red');
  process.exit(1);
});