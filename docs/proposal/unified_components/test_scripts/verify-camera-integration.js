#!/usr/bin/env node

/**
 * Script to verify camera integration is complete
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying Camera Integration Implementation...\n');

const checks = [
  {
    name: 'Z-Index tokens defined',
    file: 'lib/constants/z-index.ts',
    pattern: /CANVAS_NODE_BASE.*CANVAS_NODE_ACTIVE/s,
    found: false
  },
  {
    name: 'Camera hook exists',
    file: 'lib/hooks/use-canvas-camera.ts',
    pattern: /panCameraBy.*dxScreen.*zoom/s,
    found: false
  },
  {
    name: 'Component panel uses camera',
    file: 'components/canvas/component-panel.tsx',
    pattern: /if.*isCameraEnabled.*panCameraBy/s,
    found: false
  },
  {
    name: 'Canvas panel uses camera',  
    file: 'components/canvas/canvas-panel.tsx',
    pattern: /if.*isCameraEnabled.*panCameraBy/s,
    found: false
  },
  {
    name: 'Feature flag check',
    file: 'lib/hooks/use-canvas-camera.ts',
    pattern: /NEXT_PUBLIC_CANVAS_CAMERA/,
    found: false
  },
  {
    name: 'Canvas applies transform',
    file: 'components/annotation-canvas-modern.tsx',
    pattern: /transform.*translateX.*translateY.*scale/,
    found: false
  },
  {
    name: 'SET_CANVAS_STATE reducer',
    file: 'components/canvas/canvas-context.tsx',
    pattern: /case.*SET_CANVAS_STATE/,
    found: false
  },
  {
    name: 'Legacy code preserved',
    file: 'components/canvas/component-panel.tsx',
    pattern: /else.*Legacy.*forEach.*panel/s,
    found: false
  }
];

// Check each file
checks.forEach(check => {
  const filePath = path.join(__dirname, '..', '..', '..', '..', check.file);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    check.found = check.pattern.test(content);
    console.log(`${check.found ? '✅' : '❌'} ${check.name}`);
    if (check.found) {
      console.log(`   Found in: ${check.file}`);
    }
  } catch (err) {
    console.log(`❌ ${check.name}`);
    console.log(`   Error reading: ${check.file}`);
  }
});

// Summary
console.log('\n📊 Summary:');
const passed = checks.filter(c => c.found).length;
const total = checks.length;
console.log(`${passed}/${total} checks passed`);

if (passed === total) {
  console.log('\n✅ Camera integration is FULLY IMPLEMENTED!');
  console.log('\nTo test:');
  console.log('1. Run: npm run dev (camera mode is on by default)');
  console.log('2. Drag a panel to the edge - camera should pan');
  console.log('3. To compare with legacy behavior, run with NEXT_PUBLIC_CANVAS_CAMERA=0');
} else {
  console.log('\n⚠️  Camera integration is PARTIALLY implemented');
  console.log('\nMissing components:');
  checks.filter(c => !c.found).forEach(c => {
    console.log(`  - ${c.name}`);
  });
}

process.exit(passed === total ? 0 : 1);
