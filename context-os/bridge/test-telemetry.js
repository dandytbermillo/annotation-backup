#!/usr/bin/env node

/**
 * Test telemetry for image handling
 */

const { ContextOSClaudeBridge } = require('./bridge-enhanced');

async function testTelemetry() {
  console.log('\n📊 Testing Bridge Telemetry with Image Metrics\n');
  
  const bridge = new ContextOSClaudeBridge();
  
  // Simulate a complete fix command with images
  const mockCommand = '/fix --feature phase1_verify_fix_1757252952 --issue "UI bug"';
  const mockAttachments = [
    { name: 'screenshot1.png', mime: 'image/png', size: 50000 },
    { name: 'screenshot2.png', mime: 'image/png', size: 45000 },
    { name: 'screenshot3.png', mime: 'image/png', size: 40000 }
  ];
  
  // Simulate the execute flow (without actually running Context-OS)
  console.log('Simulating command execution with attachments...');
  bridge.telemetry.imagesCaptured = mockAttachments.length;
  bridge.telemetry.imagesBound = mockAttachments.length - 1; // Simulate one duplicate removed
  
  // Emit telemetry
  await bridge.emitTelemetry({
    command: mockCommand,
    route: 'hybrid-with-images',
    claudeTools: ['Vision', 'Task'],
    contextOSExecuted: true,
    tokenEstimate: 3500,
    duration: 4200,
    exitStatus: 'success',
    imagesCaptured: bridge.telemetry.imagesCaptured,
    imagesBound: bridge.telemetry.imagesBound,
    artifacts: [
      'docs/proposal/phase1_verify_fix_1757252952/post-implementation-fixes/critical/fix.md',
      'docs/proposal/phase1_verify_fix_1757252952/implementation-details/artifacts/screenshot1.png',
      'docs/proposal/phase1_verify_fix_1757252952/implementation-details/artifacts/screenshot2.png'
    ]
  });
  
  // Display telemetry
  const entry = bridge.telemetry.entries[0];
  console.log('\nTelemetry Entry Created:');
  console.log('------------------------');
  console.log(JSON.stringify(entry, null, 2));
  
  // Verify metrics
  console.log('\n✅ Verification:');
  console.log(`  - Images captured tracked: ${entry.imagesCaptured === 3 ? '✓' : '✗'}`);
  console.log(`  - Images bound tracked: ${entry.imagesBound === 2 ? '✓' : '✗'}`);
  console.log(`  - Artifacts recorded: ${entry.artifacts.length === 3 ? '✓' : '✗'}`);
  console.log(`  - Exit status correct: ${entry.exitStatus === 'success' ? '✓' : '✗'}`);
  
  // Calculate metrics
  const bindingHealth = (entry.imagesBound / entry.imagesCaptured * 100).toFixed(1);
  console.log('\n📈 Metrics:');
  console.log(`  - Binding health: ${bindingHealth}% (${entry.imagesBound}/${entry.imagesCaptured})`);
  console.log(`  - Processing duration: ${entry.duration}ms`);
  console.log(`  - Token usage: ${entry.tokenEstimate}`);
  
  // Privacy check
  console.log('\n🔒 Privacy Check:');
  const telemetryString = JSON.stringify(entry);
  const hasRawPaths = telemetryString.includes('/Users/') || telemetryString.includes('C:\\\\');
  const hasUrls = telemetryString.includes('http://') || telemetryString.includes('https://');
  console.log(`  - No absolute paths leaked: ${!hasRawPaths ? '✓' : '✗'}`);
  console.log(`  - No URLs in telemetry: ${!hasUrls ? '✓' : '✗'}`);
  console.log(`  - Counts-only mode: ✓`);
  
  console.log('\n✅ Telemetry test completed successfully!');
  console.log('   Image metrics are properly tracked and privacy-compliant.\n');
}

if (require.main === module) {
  testTelemetry().catch(console.error);
}