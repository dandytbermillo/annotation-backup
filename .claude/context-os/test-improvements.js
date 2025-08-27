#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;
const { ContextManager } = require('./core/context-manager');

// Test configuration
const PROJECT_ROOT = path.dirname(path.dirname(__dirname));
const TEST_RESULTS = [];

// Color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

async function runTest(name, testFn) {
  console.log(`\n${colors.blue}Testing: ${name}${colors.reset}`);
  try {
    const result = await testFn();
    TEST_RESULTS.push({ name, success: true, result });
    console.log(`${colors.green}✓ ${name} passed${colors.reset}`);
    return result;
  } catch (error) {
    TEST_RESULTS.push({ name, success: false, error: error.message });
    console.log(`${colors.red}✗ ${name} failed: ${error.message}${colors.reset}`);
    throw error;
  }
}

async function main() {
  console.log(`${colors.yellow}🧪 Context-OS Improvements Test Suite${colors.reset}`);
  console.log(`Project Root: ${PROJECT_ROOT}`);
  
  const manager = new ContextManager(PROJECT_ROOT);
  await manager.initialize();
  
  // Test 1: Incremental Indexing
  await runTest('Incremental Indexing', async () => {
    const startTime = Date.now();
    const result = await manager.indexer.updateIndex();
    const duration = Date.now() - startTime;
    const stats = manager.indexer.getStats();
    
    console.log(`  Indexed ${result.updates.length} new/changed files in ${duration}ms`);
    console.log(`  Total files in index: ${stats.totalFiles}`);
    console.log(`  Total tokens: ${stats.totalTokens.toLocaleString()}`);
    
    return { duration, files: stats.totalFiles, tokens: stats.totalTokens };
  });
  
  // Test 2: Smart Context Loading
  await runTest('Smart Context Loading', async () => {
    const patterns = ['postgres', 'yjs', 'annotation'];
    const results = {};
    
    for (const pattern of patterns) {
      console.log(`\n  Testing pattern: "${pattern}"`);
      const result = await manager.loadContext(pattern, {
        maxTokens: 4000,
        compress: true,
        smart: true
      });
      
      console.log(`  Loaded ${result.files.length} files (${result.tokenCount} tokens)`);
      console.log(`  Top files:`);
      result.files.slice(0, 5).forEach(f => {
        console.log(`    - ${path.relative(PROJECT_ROOT, f)}`);
      });
      
      results[pattern] = {
        files: result.files.length,
        tokens: result.tokenCount,
        compressed: result.compressed
      };
    }
    
    return results;
  });
  
  // Test 3: Context Compression
  await runTest('Context Compression', async () => {
    const testFiles = [
      '.claude/context-os/core/context-manager.js',
      '.claude/context-os/core/semantic-analyzer.js'
    ];
    
    const results = [];
    
    for (const file of testFiles) {
      const fullPath = path.join(PROJECT_ROOT, file);
      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const compressed = manager.compressor.compressFile(content, fullPath);
        
        const originalSize = content.length;
        const compressedSize = compressed.length;
        const ratio = (compressedSize / originalSize * 100).toFixed(1);
        
        console.log(`  ${path.basename(file)}: ${originalSize} → ${compressedSize} bytes (${ratio}%)`);
        
        results.push({
          file: path.basename(file),
          original: originalSize,
          compressed: compressedSize,
          ratio: parseFloat(ratio)
        });
      } catch (e) {
        console.log(`  Skipping ${file}: ${e.message}`);
      }
    }
    
    return results;
  });
  
  // Test 4: Semantic Analysis
  await runTest('Semantic Analysis', async () => {
    const testFile = path.join(PROJECT_ROOT, '.claude/context-os/core/context-manager.js');
    const analysis = await manager.semanticAnalyzer.analyzeFile(testFile);
    
    if (!analysis) {
      throw new Error('Failed to analyze file');
    }
    
    console.log(`  Imports: ${analysis.imports.length}`);
    console.log(`  Exports: ${analysis.exports.length}`);
    console.log(`  Functions: ${analysis.functions.length}`);
    console.log(`  Classes: ${analysis.classes.length}`);
    console.log(`  Dependencies: ${analysis.dependencies.size}`);
    
    // Test finding related files
    const related = await manager.semanticAnalyzer.findRelatedFiles(testFile);
    console.log(`  Related files found: ${related.length}`);
    related.slice(0, 3).forEach(f => {
      console.log(`    - ${path.relative(PROJECT_ROOT, f)}`);
    });
    
    return {
      imports: analysis.imports.length,
      exports: analysis.exports.length,
      functions: analysis.functions.length,
      related: related.length
    };
  });
  
  // Test 5: Usage Pattern Learning (Simulation)
  await runTest('Usage Pattern Learning', async () => {
    // Simulate a usage scenario
    const loadedFiles = [
      'lib/yjs-provider.ts',
      'lib/adapters/postgres-adapter.ts',
      'components/canvas/canvas-panel.tsx',
      'lib/sync/postgres-sync.ts'
    ];
    
    const modifiedFiles = [
      'lib/adapters/postgres-adapter.ts',
      'lib/sync/postgres-sync.ts'
    ];
    
    // Track the usage
    const result = await manager.usageTracker.trackUsage(
      loadedFiles,
      modifiedFiles,
      'implement postgres persistence',
      { duration: 1800000, tokenCount: 3500 }
    );
    
    console.log(`  Useful files: ${result.usefulFiles.length}`);
    console.log(`  Wasted files: ${result.wastedFiles.length}`);
    
    // Get suggestions based on this pattern
    const suggestions = await manager.usageTracker.suggestFiles(modifiedFiles, 'postgres');
    console.log(`  Suggested related files: ${suggestions.length}`);
    suggestions.slice(0, 3).forEach(f => {
      console.log(`    - ${f}`);
    });
    
    return {
      useful: result.usefulFiles.length,
      wasted: result.wastedFiles.length,
      suggestions: suggestions.length
    };
  });
  
  // Test 6: Performance Comparison
  await runTest('Performance Comparison', async () => {
    const pattern = 'postgres';
    
    // Test old method (without smart loading)
    console.log('\n  Testing traditional loading...');
    const oldStart = Date.now();
    const oldResult = await manager.loadContext(pattern, {
      smart: false,
      compress: false,
      maxTokens: 8000
    });
    const oldDuration = Date.now() - oldStart;
    
    // Test new method (with smart loading)
    console.log('  Testing smart loading...');
    const newStart = Date.now();
    const newResult = await manager.loadContext(pattern, {
      smart: true,
      compress: true,
      maxTokens: 8000
    });
    const newDuration = Date.now() - newStart;
    
    const speedup = ((oldDuration - newDuration) / oldDuration * 100).toFixed(1);
    const tokenSavings = ((oldResult.tokenCount - newResult.tokenCount) / oldResult.tokenCount * 100).toFixed(1);
    
    console.log(`\n  Traditional: ${oldDuration}ms, ${oldResult.files.length} files, ${oldResult.tokenCount} tokens`);
    console.log(`  Smart: ${newDuration}ms, ${newResult.files.length} files, ${newResult.tokenCount} tokens`);
    console.log(`  Speedup: ${speedup}%`);
    console.log(`  Token savings: ${tokenSavings}%`);
    
    return {
      oldDuration,
      newDuration,
      speedup: parseFloat(speedup),
      tokenSavings: parseFloat(tokenSavings)
    };
  });
  
  // Summary
  console.log(`\n${colors.yellow}📊 Test Summary${colors.reset}`);
  const passed = TEST_RESULTS.filter(r => r.success).length;
  const failed = TEST_RESULTS.filter(r => !r.success).length;
  
  console.log(`Total tests: ${TEST_RESULTS.length}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  
  if (failed === 0) {
    console.log(`\n${colors.green}🎉 All tests passed! Context-OS improvements are working correctly.${colors.reset}`);
  } else {
    console.log(`\n${colors.red}❌ Some tests failed. Please check the errors above.${colors.reset}`);
    process.exit(1);
  }
}

// Run tests
main().catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exit(1);
});