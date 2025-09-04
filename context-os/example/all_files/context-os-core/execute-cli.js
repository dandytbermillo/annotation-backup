#!/usr/bin/env node

/**
 * JSON CLI Wrapper for /execute command
 * Handles feature creation and scaffolding
 */

const fs = require('fs');
const path = require('path');
const FeatureOrchestrator = require('../create-feature');

/**
 * Input Schema:
 * {
 *   "feature": "Feature name/description",
 *   "plan": "Path to plan or description",
 *   "slug": "Optional pre-selected slug",
 *   "autoConfirm": true/false
 * }
 * 
 * Output Schema:
 * {
 *   "ok": true/false,
 *   "result": { ... },
 *   "error": "Error message if failed"
 * }
 */

async function execute(input) {
  const orchestrator = new FeatureOrchestrator();
  
  // For JSON mode, make it non-interactive by default
  if (input.autoConfirm !== false) {
    // Close the real readline immediately
    if (orchestrator.rl) {
      orchestrator.rl.close();
    }
    
    // Create mock readline interface
    orchestrator.rl = {
      question: (question, callback) => {
        // Log questions to stderr for debugging only if DEBUG is set
        if (process.env.DEBUG) {
          console.error(`[AUTO] ${question}`);
        }
        
        let answer = '';
        
        if (question.includes('Your choice')) {
          // Use provided slug or default to first option
          answer = input.slug ? '4' : '1'; // 4 = custom, 1 = first suggestion
        } else if (question.includes('Enter custom slug')) {
          answer = input.slug || 'feature';
        } else if (question.includes('Proceed with scaffolding')) {
          answer = 'yes';
        } else if (question.toLowerCase().includes('would you like to fix')) {
          answer = 'no'; // Skip interactive fixing in JSON mode
        } else {
          answer = 'no'; // Default to 'no' for any other prompts
        }
        
        // Call callback with answer
        callback(answer);
      },
      close: () => {},
      closed: false
    };
  }
  
  const result = {
    feature: input.feature || 'New Feature',
    planPath: input.plan || null,
    created: [],
    validation: null,
    status: 'PLANNED'
  };
  
  try {
    // Capture console output
    const originalLog = console.log;
    const logs = [];
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog.apply(console, args);
    };
    
    // Create the feature
    const featureResult = await orchestrator.createFeature(
      input.feature || 'New Feature',
      input.plan
    );
    
    // Restore console.log
    console.log = originalLog;
    
    // Parse logs for created files
    result.created = logs
      .filter(log => log.includes('Created:'))
      .map(log => log.replace(/.*Created:\s*/, '').trim());
    
    // Check for validation results
    const validationLog = logs.find(log => log.includes('validation'));
    if (validationLog) {
      if (validationLog.includes('passed')) {
        result.validation = { passed: true, errors: 0, warnings: 0 };
      } else {
        const errors = validationLog.match(/(\d+)\s+errors?/);
        result.validation = {
          passed: false,
          errors: errors ? parseInt(errors[1]) : 0,
          warnings: 0
        };
      }
    }
    
    // Extract the slug that was selected
    const slugLog = logs.find(log => log.includes('Selected feature slug:'));
    if (slugLog) {
      result.slug = slugLog.split(':')[1].trim();
      result.path = `../docs/proposal/${result.slug}`;
    }
    
    return result;
    
  } catch (error) {
    throw new Error(`Feature creation failed: ${error.message}`);
  } finally {
    // Ensure readline is closed
    if (orchestrator.rl && !orchestrator.rl.closed) {
      orchestrator.rl.close();
    }
  }
}

// Main CLI execution
(async () => {
  try {
    // Read input from stdin or file
    const arg = process.argv[2];
    let input = {};
    
    if (arg && arg !== '-') {
      // Read from file
      input = JSON.parse(fs.readFileSync(arg, 'utf8'));
    } else if (!process.stdin.isTTY) {
      // Read from stdin
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw) {
        input = JSON.parse(raw);
      }
    }
    
    // Execute the command
    const result = await execute(input);
    
    // Check if feature was actually created
    const success = result.created && result.created.length > 0;
    
    // Output JSON to stdout
    console.log(JSON.stringify({
      ok: success,
      command: 'execute',
      result: result,
      error: success ? undefined : 'Feature creation failed - no files created'
    }));
    
    process.exit(success ? 0 : 1);
    
  } catch (error) {
    // Error to stderr
    console.error(`[execute-cli] Error: ${error.message}`);
    
    // Error JSON to stdout
    console.log(JSON.stringify({
      ok: false,
      command: 'execute',
      error: error.message,
      stack: process.env.DEBUG ? error.stack : undefined
    }));
    
    process.exit(1);
  }
})();