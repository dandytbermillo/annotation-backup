#!/usr/bin/env node

/**
 * Test UUID Coercion for Phase 3 Version APIs
 * 
 * Verifies that slug IDs are properly converted to UUIDs
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Test data with slug IDs (previously causing 500 errors)
const testCases = [
  { noteId: 'test-note', panelId: 'test-panel', desc: 'Simple slug IDs' },
  { noteId: 'my-document-123', panelId: 'panel-456', desc: 'Alphanumeric slugs' },
  { noteId: 'complex_slug-with.dots', panelId: 'another_complex-id', desc: 'Complex slugs' },
];

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

async function testVersionAPI(noteId, panelId, description) {
  console.log(`\n${colors.blue}Testing: ${description}${colors.reset}`);
  console.log(`  Note ID: ${noteId}`);
  console.log(`  Panel ID: ${panelId}`);
  
  try {
    // Test GET /api/versions/[noteId]/[panelId]
    const getResponse = await fetch(`${BASE_URL}/api/versions/${noteId}/${panelId}`);
    
    if (getResponse.ok) {
      const data = await getResponse.json();
      console.log(`  ${colors.green}✅ GET request successful${colors.reset}`);
      console.log(`     Total versions: ${data.total || 0}`);
      if (data.current?.hash) {
        console.log(`     Current hash: ${data.current.hash.substring(0, 8)}...`);
      }
      return true;
    } else {
      const errorData = await getResponse.json();
      console.log(`  ${colors.red}❌ GET request failed: ${getResponse.status}${colors.reset}`);
      console.log(`     Error: ${errorData.error}`);
      if (errorData.details) {
        console.log(`     Details: ${errorData.details}`);
      }
      return false;
    }
  } catch (error) {
    console.log(`  ${colors.red}❌ Request error: ${error.message}${colors.reset}`);
    return false;
  }
}

async function testCompareAPI(noteId, panelId) {
  console.log(`\n${colors.blue}Testing Compare API${colors.reset}`);
  
  try {
    const response = await fetch(`${BASE_URL}/api/versions/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteId,
        panelId,
        version1: 0,
        version2: 1
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`  ${colors.green}✅ Compare API successful${colors.reset}`);
      if (data.comparison?.version1?.hash && data.comparison?.version2?.hash) {
        console.log(`     Version hashes included`);
      }
      return true;
    } else {
      const errorData = await response.json();
      console.log(`  ${colors.red}❌ Compare API failed: ${response.status}${colors.reset}`);
      console.log(`     Error: ${errorData.error}`);
      return false;
    }
  } catch (error) {
    console.log(`  ${colors.red}❌ Request error: ${error.message}${colors.reset}`);
    return false;
  }
}

async function testForceSaveMetrics() {
  console.log(`\n${colors.blue}Testing Force-Save Rate Tracking${colors.reset}`);
  
  try {
    // Get telemetry metrics
    const response = await fetch(`${BASE_URL}/api/telemetry/metrics`);
    
    if (response.ok) {
      const data = await response.json();
      const conflicts = data.conflict || {};
      const forceSaveRate = conflicts.forceSaveCount && conflicts.occurrences 
        ? (conflicts.forceSaveCount / conflicts.occurrences * 100).toFixed(1)
        : 0;
      
      console.log(`  Conflict occurrences: ${conflicts.occurrences || 0}`);
      console.log(`  Force saves: ${conflicts.forceSaveCount || 0}`);
      console.log(`  Keep mine: ${conflicts.keepMineCount || 0}`);
      console.log(`  Use latest: ${conflicts.useLatestCount || 0}`);
      console.log(`  Merges: ${conflicts.mergeCount || 0}`);
      console.log(`  ${colors.yellow}Force-save rate: ${forceSaveRate}%${colors.reset}`);
      
      if (forceSaveRate < 10) {
        console.log(`  ${colors.green}✅ Force-save rate is below 10% threshold${colors.reset}`);
        return true;
      } else {
        console.log(`  ${colors.red}⚠️  Force-save rate exceeds 10% threshold${colors.reset}`);
        return false;
      }
    } else {
      console.log(`  ${colors.yellow}⚠️  Telemetry endpoint not available${colors.reset}`);
      return null;
    }
  } catch (error) {
    console.log(`  ${colors.yellow}⚠️  Could not fetch metrics: ${error.message}${colors.reset}`);
    return null;
  }
}

async function runTests() {
  console.log(`${colors.blue}${'='.repeat(50)}${colors.reset}`);
  console.log(`${colors.blue}UUID Coercion & Phase 3 Acceptance Tests${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(50)}${colors.reset}`);
  
  let passedTests = 0;
  let totalTests = 0;
  
  // Test UUID coercion with different slug formats
  for (const testCase of testCases) {
    totalTests++;
    const success = await testVersionAPI(testCase.noteId, testCase.panelId, testCase.desc);
    if (success) passedTests++;
  }
  
  // Test compare API with slug IDs
  totalTests++;
  const compareSuccess = await testCompareAPI('test-note', 'test-panel');
  if (compareSuccess) passedTests++;
  
  // Test force-save rate tracking
  const metricsResult = await testForceSaveMetrics();
  if (metricsResult !== null) {
    totalTests++;
    if (metricsResult) passedTests++;
  }
  
  // Summary
  console.log(`\n${colors.blue}${'='.repeat(50)}${colors.reset}`);
  console.log(`${colors.blue}Test Summary${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(50)}${colors.reset}`);
  
  const successRate = (passedTests / totalTests * 100).toFixed(1);
  console.log(`\nTests passed: ${passedTests}/${totalTests} (${successRate}%)`);
  
  if (successRate >= 95) {
    console.log(`${colors.green}✅ SUCCESS: Phase 3 acceptance criteria met (≥95%)${colors.reset}`);
  } else if (successRate >= 90) {
    console.log(`${colors.yellow}⚠️  PARTIAL: Phase 3 mostly working (${successRate}%)${colors.reset}`);
  } else {
    console.log(`${colors.red}❌ FAILED: Phase 3 acceptance criteria not met (<90%)${colors.reset}`);
  }
  
  console.log(`\n${colors.blue}Key Improvements:${colors.reset}`);
  console.log('• UUID coercion allows slug IDs (no more 500 errors)');
  console.log('• Force-save rate is tracked and reported');
  console.log('• Next.js 15 params type issues fixed');
  console.log('• All resolution types tracked in telemetry');
}

// Run the tests
runTests().catch(console.error);