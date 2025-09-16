#!/usr/bin/env node

/**
 * Complete verification of the unified components implementation
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying COMPLETE Camera Integration Implementation...\n');

const checks = [
  {
    name: 'Phase 1.1: NO RAF accumulation in canvas-panel',
    file: 'components/canvas/canvas-panel.tsx',
    pattern: /rafId.*requestAnimationFrame/,
    shouldExist: false,
    found: false
  },
  {
    name: 'Phase 1.1: NO RAF accumulation in component-panel',  
    file: 'components/canvas/component-panel.tsx',
    pattern: /rafId.*requestAnimationFrame/,
    shouldExist: false,
    found: false
  },
  {
    name: 'Phase 1.1: Simplified drag state (no currentTransform)',
    file: 'components/canvas/canvas-panel.tsx',
    pattern: /currentTransform|targetTransform/,
    shouldExist: false,
    found: false
  },
  {
    name: 'Phase 1.2: Z-Index tokens defined',
    file: 'lib/constants/z-index.ts',
    pattern: /CANVAS_NODE_BASE.*CANVAS_NODE_ACTIVE/s,
    shouldExist: true,
    found: false
  },
  {
    name: 'Phase 1.2: Panels use unified z-index',
    file: 'components/canvas/canvas-panel.tsx',
    pattern: /Z_INDEX\.CANVAS_NODE/,
    shouldExist: true,
    found: false
  },
  {
    name: 'Phase 1.3: TipTap setPerformanceMode exists',
    file: 'components/canvas/tiptap-editor-plain.tsx',
    pattern: /setPerformanceMode.*\(enabled.*boolean\)/s,
    shouldExist: true,
    found: false
  },
  {
    name: 'Phase 2: Camera POC exists',
    file: 'components/canvas/camera-test.tsx',
    pattern: /panCameraBy.*zoom/s,
    shouldExist: true,
    found: false
  },
  {
    name: 'Phase 3: Camera hook exists',
    file: 'lib/hooks/use-canvas-camera.ts',
    pattern: /useCanvasCamera.*panCameraBy/s,
    shouldExist: true,
    found: false
  },
  {
    name: 'Phase 3: Feature flag check',
    file: 'lib/hooks/use-canvas-camera.ts',
    pattern: /NEXT_PUBLIC_CANVAS_CAMERA/,
    shouldExist: true,
    found: false
  },
  {
    name: 'Phase 3: Canvas panels use camera',
    file: 'components/canvas/canvas-panel.tsx',
    pattern: /if.*isCameraEnabled.*panCameraBy/s,
    shouldExist: true,
    found: false
  }
];

// Check each file
checks.forEach(check => {
  const filePath = path.join(__dirname, '..', '..', '..', '..', check.file);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    check.found = check.pattern.test(content);
    
    const passed = check.shouldExist ? check.found : !check.found;
    console.log(`${passed ? '✅' : '❌'} ${check.name}`);
    
    if (!passed) {
      if (check.shouldExist) {
        console.log(`   ⚠️  Expected pattern not found in ${check.file}`);
      } else {
        console.log(`   ⚠️  Pattern should NOT exist but was found in ${check.file}`);
      }
    }
  } catch (err) {
    console.log(`❌ ${check.name}`);
    console.log(`   Error reading: ${check.file}`);
  }
});

// Summary
console.log('\n📊 Implementation Summary:');
const passed = checks.filter(c => {
  const expected = c.shouldExist ? c.found : !c.found;
  return expected;
}).length;
const total = checks.length;

console.log(`${passed}/${total} checks passed`);

// Phase breakdown
console.log('\n📈 Phase Breakdown:');
const phase1 = checks.slice(0, 6).filter(c => {
  const expected = c.shouldExist ? c.found : !c.found;
  return expected;
}).length;
const phase2 = checks.slice(6, 7).filter(c => c.found).length;
const phase3 = checks.slice(7).filter(c => c.found).length;

console.log(`  Phase 1 (Quick Wins): ${phase1}/6 ✅`);
console.log(`  Phase 2 (Camera POC): ${phase2}/1 ✅`);  
console.log(`  Phase 3 (Integration): ${phase3}/3 ✅`);

if (passed === total) {
  console.log('\n✅ COMPLETE IMPLEMENTATION VERIFIED!');
  console.log('\nThe unified canvas nodes implementation is NOW fully complete:');
  console.log('- RAF accumulation REMOVED ✅');
  console.log('- Drag logic SIMPLIFIED ✅');
  console.log('- Z-index UNIFIED ✅');
  console.log('- TipTap performance mode ADDED ✅');
  console.log('- Camera system INTEGRATED ✅');
  console.log('- Feature flag PROTECTION ✅');
} else {
  console.log('\n⚠️  Implementation is INCOMPLETE');
  console.log('\nRemaining work:');
  checks.forEach(c => {
    const expected = c.shouldExist ? c.found : !c.found;
    if (!expected) {
      console.log(`  - ${c.name}`);
    }
  });
}

process.exit(passed === total ? 0 : 1);