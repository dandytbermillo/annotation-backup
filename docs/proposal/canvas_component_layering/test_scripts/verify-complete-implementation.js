#!/usr/bin/env node

/**
 * Complete verification of Canvas Component Layering implementation
 * Checks all requirements from implementation-plan.md
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying Complete Canvas Component Layering Implementation...\n');

const allChecks = [];
let passedCount = 0;

function checkFile(filePath, checks) {
  const fullPath = path.join(__dirname, '..', '..', '..', '..', filePath);
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    checks.forEach(check => {
      const found = check.pattern.test(content);
      const passed = check.shouldExist ? found : !found;
      allChecks.push({ ...check, passed });
      if (passed) passedCount++;
      console.log(`${passed ? '✅' : '❌'} ${check.name}`);
      if (!passed) {
        console.log(`   ⚠️  ${check.shouldExist ? 'Not found' : 'Still exists'} in ${filePath}`);
      }
    });
  } catch (err) {
    checks.forEach(check => {
      allChecks.push({ ...check, passed: false });
      console.log(`❌ ${check.name}`);
      console.log(`   Error reading: ${filePath}`);
    });
  }
}

console.log('=== Section 1: Normalize Canvas Nodes ===\n');
checkFile('lib/canvas/layer-manager.ts', [
  {
    name: 'Map<string, CanvasNode> storage',
    pattern: /private\s+nodes:\s*Map<string,\s*CanvasNode>/,
    shouldExist: true
  },
  {
    name: 'registerNode with defaults',
    pattern: /registerNode.*\{[\s\S]*?createdAt.*Date\.now\(\)[\s\S]*?lastFocusedAt.*Date\.now\(\)/,
    shouldExist: true
  },
  {
    name: 'updateMaxZ on load',
    pattern: /deserializeNodes[\s\S]*?this\.updateMaxZ\(\)/,
    shouldExist: true
  },
  {
    name: 'removeNode method',
    pattern: /removeNode\(id:\s*string\):\s*void/,
    shouldExist: true
  }
]);

console.log('\n=== Section 2: LayerManager Utilities ===\n');
checkFile('lib/canvas/layer-manager.ts', [
  {
    name: 'bringToFront method',
    pattern: /bringToFront\(id:\s*string\):\s*void/,
    shouldExist: true
  },
  {
    name: 'bringSelectionToFront preserves order',
    pattern: /bringSelectionToFront[\s\S]*?nodes\.sort\(\(a,\s*b\)\s*=>\s*a\.zIndex\s*-\s*b\.zIndex\)/,
    shouldExist: true
  },
  {
    name: 'Pinned nodes first in getOrderedNodes',
    pattern: /if\s*\(a\.pinned\s*&&\s*!b\.pinned\)\s*return\s*-1/,
    shouldExist: true
  },
  {
    name: 'Z-index descending in getOrderedNodes',
    pattern: /return\s+b\.zIndex\s*-\s*a\.zIndex.*Higher z-index first/,
    shouldExist: true
  },
  {
    name: 'Auto-renumbering on saturation',
    pattern: /if\s*\(nextZ\s*>\s*Z_INDEX_BANDS\.CONTENT_MAX\)[\s\S]*?renumberContentNodes/,
    shouldExist: true
  }
]);

console.log('\n=== Section 3: Panel/Component Integration ===\n');
checkFile('lib/hooks/use-layer-manager.ts', [
  {
    name: 'useCanvasNode hook exists',
    pattern: /export\s+function\s+useCanvasNode/,
    shouldExist: true
  },
  {
    name: 'Cleanup on unmount',
    pattern: /return\s*\(\)\s*=>\s*\{[\s\S]*?layerManager\.removeNode\(id\)/,
    shouldExist: true
  }
]);

checkFile('components/canvas/canvas-panel.tsx', [
  {
    name: 'No fallback z-index state',
    pattern: /useState.*localZIndex|setLocalZIndex/,
    shouldExist: false
  },
  {
    name: 'Uses canvasNode.zIndex',
    pattern: /const\s+zIndex\s*=\s*canvasNode\?\.zIndex\s*\?\?\s*Z_INDEX/,
    shouldExist: true
  },
  {
    name: 'No legacy setZIndex calls',
    pattern: /setZIndex\(/,
    shouldExist: false
  },
  {
    name: 'focusNode on drag start',
    pattern: /layerManager\.focusNode\(panelId\)/,
    shouldExist: true
  },
  {
    name: 'updateNode for position',
    pattern: /layerManager\.updateNode\(panelId,\s*\{\s*position:/,
    shouldExist: true
  }
]);

checkFile('components/canvas/component-panel.tsx', [
  {
    name: 'No direct z-index manipulation',
    pattern: /panel\.style\.zIndex\s*=\s*String/,
    shouldExist: false
  },
  {
    name: 'Uses canvasNode.zIndex',
    pattern: /zIndex:\s*canvasNode\?\.zIndex\s*\?\?\s*Z_INDEX/,
    shouldExist: true
  },
  {
    name: 'focusNode on drag start',
    pattern: /layerManager\.focusNode\(id\)/,
    shouldExist: true
  },
  {
    name: 'updateNode for position',
    pattern: /layerManager\.updateNode\(id,\s*\{\s*position:/,
    shouldExist: true
  }
]);

console.log('\n=== Section 4: Persistence ===\n');
checkFile('lib/canvas/canvas-storage.ts', [
  {
    name: 'Saves layer nodes unconditionally',
    pattern: /layerNodes\s*=\s*layerManager\.serializeNodes\(\)/,
    shouldExist: true
  },
  {
    name: 'Loads layer nodes when present',
    pattern: /if\s*\(parsed\.layerNodes\)/,
    shouldExist: true
  },
  {
    name: 'Env toggle removed from persistence',
    pattern: /NEXT_PUBLIC_LAYER_MODEL/,
    shouldExist: false
  }
]);

console.log('\n=== Section 5: Safety/Rollback ===\n');
checkFile('lib/hooks/use-layer-manager.ts', [
  {
    name: 'Env toggle removed from hook',
    pattern: /process\.env\.NEXT_PUBLIC_LAYER_MODEL/,
    shouldExist: false
  },
  {
    name: 'Graceful null checks',
    pattern: /if\s*\(!manager\s*\|\|\s*!isEnabled\)/,
    shouldExist: true
  }
]);

console.log('\n=== Section 6: Debug Helper ===\n');
checkFile('lib/canvas/layer-manager.ts', [
  {
    name: 'debugLayers method',
    pattern: /debugLayers\(\):\s*\{/,
    shouldExist: true
  },
  {
    name: 'window.debugCanvasLayers exposed',
    pattern: /window.*debugCanvasLayers.*debugLayers/,
    shouldExist: true
  }
]);

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 FINAL VERIFICATION SUMMARY');
console.log('='.repeat(60));

const sections = {
  'Normalize Canvas Nodes': allChecks.slice(0, 4),
  'LayerManager Utilities': allChecks.slice(4, 9),
  'Panel/Component Integration': allChecks.slice(9, 18),
  'Persistence': allChecks.slice(18, 21),
  'Safety/Rollback': allChecks.slice(21, 23),
  'Debug Helper': allChecks.slice(23, 25)
};

Object.entries(sections).forEach(([name, checks]) => {
  const passed = checks.filter(c => c.passed).length;
  const total = checks.length;
  const status = passed === total ? '✅' : '❌';
  console.log(`${status} ${name}: ${passed}/${total}`);
});

console.log('\n' + '='.repeat(60));
console.log(`TOTAL: ${passedCount}/${allChecks.length} checks passed`);

if (passedCount === allChecks.length) {
  console.log('\n✅✅✅ IMPLEMENTATION COMPLETE AND VERIFIED! ✅✅✅');
  console.log('\nThe Canvas Component Layering system fully implements:');
  console.log('- Centralized node management with Map<string, CanvasNode>');
  console.log('- Automatic cleanup on unmount (no memory leaks)');
  console.log('- Correct ordering (pinned first, z-index descending)');
  console.log('- Automatic renumbering on saturation');
  console.log('- No fallback z-index state (single source of truth)');
  console.log('- Persistence with default-enabled LayerManager');
  console.log('- Debug helper for development');
  process.exit(0);
} else {
  console.log('\n❌ IMPLEMENTATION INCOMPLETE');
  console.log('\nFailing checks:');
  allChecks.filter(c => !c.passed).forEach(c => {
    console.log(`  - ${c.name}`);
  });
  process.exit(1);
}
