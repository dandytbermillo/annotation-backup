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
    await orchestrator.createFeature(
      'Center Note Window on Click',
      'drafts/center-note-window.md'
    );
    
    console.log('\n✅ Test completed successfully!');
    
    // Verify the structure was created
    const targetDir = 'docs/proposal/center_note_window_on_click';
    if (fs.existsSync(targetDir)) {
      console.log('\n📁 Created structure:');
      const dirs = [
        targetDir,
        `${targetDir}/implementation.md`,
        `${targetDir}/reports`,
        `${targetDir}/implementation-details`,
        `${targetDir}/post-implementation-fixes/README.md`,
        `${targetDir}/patches`
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