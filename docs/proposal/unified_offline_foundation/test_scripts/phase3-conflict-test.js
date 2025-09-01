#!/usr/bin/env node

/**
 * Phase 3 Conflict Resolution Test Script
 * 
 * Tests conflict detection, resolution actions, and API metadata
 */

// Use built-in fetch in Node 18+ or fall back to node-fetch
const fetch = globalThis.fetch || (() => {
  try {
    return require('node-fetch');
  } catch {
    console.error('Error: fetch is not available. Please use Node 18+ or install node-fetch');
    process.exit(1);
  }
})();
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Test documents
const baseDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Original text.' }] }
  ]
};

const userDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'User edited text.' }] }
  ]
};

const serverDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Server edited text.' }] }
  ]
};

function calculateHash(doc) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(doc))
    .digest('hex');
}

async function testVersionAPI() {
  console.log('\n📝 Testing Version API Endpoints...');
  
  try {
    // Test GET /api/versions
    const getRes = await fetch(`${BASE_URL}/api/versions/test-note/test-panel`);
    if (getRes.ok) {
      const data = await getRes.json();
      console.log('✅ GET /api/versions - Success');
      if (data.current?.hash) {
        console.log(`  Hash: ${data.current.hash.substring(0, 16)}...`);
      }
    } else {
      console.log(`❌ GET /api/versions - Failed: ${getRes.status}`);
    }

    // Test POST /api/versions/compare
    const compareRes = await fetch(`${BASE_URL}/api/versions/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteId: 'test-note',
        panelId: 'test-panel',
        version1: 0,
        version2: 1
      })
    });

    if (compareRes.ok) {
      const data = await compareRes.json();
      console.log('✅ POST /api/versions/compare - Success');
      
      if (data.comparison?.version1?.hash && data.comparison?.version2?.hash) {
        console.log('  ✅ Hashes included in response');
      }
      
      if (data.version1Content && data.version2Content) {
        console.log('  ✅ Content included in response');
      }
    } else {
      console.log(`❌ POST /api/versions/compare - Failed: ${compareRes.status}`);
    }
  } catch (error) {
    console.error('❌ API test error:', error.message);
  }
}

async function createConflict() {
  console.log('\n⚔️ Creating 409 Conflict...');
  
  try {
    const noteId = `conflict-${Date.now()}`;
    const panelId = 'panel-1';
    
    // Save initial version
    const save1 = await fetch(`${BASE_URL}/api/versions/${noteId}/${panelId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        content: baseDoc,
        version: 1
      })
    });
    
    if (!save1.ok) {
      throw new Error('Failed to save initial version');
    }
    console.log('✅ Initial version saved');

    // Save server version
    const save2 = await fetch(`${BASE_URL}/api/versions/${noteId}/${panelId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        content: serverDoc,
        version: 2
      })
    });
    
    if (!save2.ok) {
      throw new Error('Failed to save server version');
    }
    console.log('✅ Server version saved');

    // Try to save with outdated base (should trigger 409)
    const conflictRes = await fetch(`${BASE_URL}/api/versions/${noteId}/${panelId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        content: userDoc,
        base_version: 1,
        base_hash: calculateHash(baseDoc)
      })
    });

    if (conflictRes.status === 409) {
      const data = await conflictRes.json();
      console.log('✅ 409 Conflict triggered successfully!');
      console.log(`  Type: ${data.conflict_type}`);
      console.log(`  Current version: ${data.current_version}`);
      console.log(`  Current hash: ${data.current_hash?.substring(0, 16)}...`);
      return { success: true, noteId, panelId, data };
    } else {
      console.log(`❌ Expected 409 but got ${conflictRes.status}`);
      return { success: false };
    }
  } catch (error) {
    console.error('❌ Failed to create conflict:', error.message);
    return { success: false };
  }
}

async function testForceResolution(noteId, panelId) {
  console.log('\n💪 Testing Force Resolution...');
  
  try {
    const forceRes = await fetch(`${BASE_URL}/api/versions/${noteId}/${panelId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        content: userDoc,
        force: true,
        version: 3
      })
    });

    if (forceRes.ok) {
      const data = await forceRes.json();
      console.log('✅ Force save succeeded');
      console.log(`  New version: ${data.version}`);
      return true;
    } else {
      console.log(`❌ Force save failed: ${forceRes.status}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Force resolution error:', error.message);
    return false;
  }
}

async function testTelemetryTracking() {
  console.log('\n📊 Testing Telemetry Tracking...');
  
  try {
    const telemetryRes = await fetch(`${BASE_URL}/api/telemetry`);
    if (telemetryRes.ok) {
      const data = await telemetryRes.json();
      console.log('✅ Telemetry endpoint accessible');
      
      if (data.conflict) {
        console.log(`  Conflicts tracked: ${data.conflict.occurrences || 0}`);
      }
    } else {
      console.log(`❌ Telemetry check failed: ${telemetryRes.status}`);
    }
  } catch (error) {
    console.error('❌ Telemetry error:', error.message);
  }
}

async function runAllTests() {
  console.log('🚀 Phase 3 Conflict Resolution Tests');
  console.log('====================================');
  
  // Check if server is running
  try {
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    if (!healthRes.ok) {
      console.error('❌ Server not responding. Is it running?');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Cannot connect to server:', error.message);
    process.exit(1);
  }

  // Run tests
  await testVersionAPI();
  
  const conflictResult = await createConflict();
  
  if (conflictResult.success) {
    await testForceResolution(conflictResult.noteId, conflictResult.panelId);
  }
  
  await testTelemetryTracking();
  
  console.log('\n✅ Phase 3 tests complete!');
  console.log('\nNext steps:');
  console.log('1. Enable feature flag: offline.conflictUI');
  console.log('2. Visit http://localhost:3000/phase3-test');
  console.log('3. Test the conflict resolution dialog');
}

// Run tests
runAllTests().catch(console.error);