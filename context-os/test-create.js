#!/usr/bin/env node

/**
 * Test script for Context-OS - runs in non-interactive mode
 */

const FeatureOrchestrator = require('./create-feature');
const fs = require('fs');

async function testCreate() {
  console.log('🧪 Testing Context-OS Feature Creation\n');
  
  const orchestrator = new FeatureOrchestrator();
  
  // Mock the user input
  orchestrator.askUser = async (question) => {
    console.log(question);
    
    if (question.includes('Your choice')) {
      console.log('  → Selecting option 1');
      return '1';
    }
    if (question.includes('Proceed with scaffolding')) {
      console.log('  → Confirming: yes');
      return 'yes';
    }
    
    return '';
  };
  
  try {
    // Clean up any existing feature first
    const targetDir = '../docs/proposal/center_note_window_on_click';
    if (fs.existsSync(targetDir)) {
      console.log('⚠️  Cleaning up existing feature...');
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    
    await orchestrator.createFeature(
      'Center Note Window on Click',
      'drafts/center-note-window.md'
    );
    
    console.log('\n✅ Test completed successfully!');
    
    // Verify the structure was created
    const verifyDir = '../docs/proposal/center_note_window_on_click';
    if (fs.existsSync(verifyDir)) {
      console.log('\n📁 Created structure:');
      const dirs = [
        verifyDir,
        `${verifyDir}/implementation.md`,
        `${verifyDir}/reports`,
        `${verifyDir}/implementation-details`,
        `${verifyDir}/post-implementation-fixes/README.md`,
        `${verifyDir}/patches`
      ];
      
      dirs.forEach(dir => {
        const exists = fs.existsSync(dir);
        console.log(`  ${exists ? '✓' : '✗'} ${dir}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testCreate();