#!/usr/bin/env node

/**
 * JSON CLI Wrapper for validation
 * Runs the validation script and returns structured results
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Input Schema:
 * {
 *   "feature": "Feature slug or path",
 *   "strict": true/false,
 *   "all": true/false
 * }
 */

function validate(input) {
  const scriptPath = path.join(__dirname, '../../scripts/validate-doc-structure.sh');
  
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Validation script not found');
  }
  
  const result = {
    features: [],
    totalErrors: 0,
    totalWarnings: 0,
    passed: false
  };
  
  try {
    // Build command
    let command = scriptPath;
    if (input.strict) {
      command += ' --strict';
    }
    if (input.feature) {
      const featurePath = input.feature.startsWith('/')
        ? input.feature
        : path.join(__dirname, '../..', 'docs/proposal', input.feature);
      command += ` ${featurePath}`;
    }
    
    // Run validation
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    // Parse output
    const lines = output.split('\n');
    let currentFeature = null;
    
    for (const line of lines) {
      // Feature being checked
      if (line.includes('Checking:')) {
        const match = line.match(/Checking:\s+(\S+)/);
        if (match) {
          currentFeature = {
            name: match[1],
            errors: [],
            warnings: [],
            passed: []
          };
          result.features.push(currentFeature);
        }
      }
      
      // Errors
      if (line.includes('✗') && currentFeature) {
        const errorText = line.replace(/.*✗\s*/, '').trim();
        currentFeature.errors.push(errorText);
      }
      
      // Warnings
      if (line.includes('⚠') && currentFeature) {
        const warningText = line.replace(/.*⚠\s*/, '').trim();
        currentFeature.warnings.push(warningText);
      }
      
      // Passed checks
      if (line.includes('✓') && currentFeature) {
        const passedText = line.replace(/.*✓\s*/, '').trim();
        currentFeature.passed.push(passedText);
      }
      
      // Summary
      if (line.includes('Errors:')) {
        const match = line.match(/Errors:\s*(\d+)/);
        if (match) result.totalErrors = parseInt(match[1]);
      }
      if (line.includes('Warnings:')) {
        const match = line.match(/Warnings:\s*(\d+)/);
        if (match) result.totalWarnings = parseInt(match[1]);
      }
    }
    
    result.passed = result.totalErrors === 0;
    
    // In strict mode, warnings also fail
    if (input.strict && result.totalWarnings > 0) {
      result.passed = false;
    }
    
  } catch (error) {
    // Validation script returns non-zero on errors
    const output = error.stdout || error.message;
    
    // Still try to parse the output
    const errorMatch = output.match(/Errors:\s*(\d+)/);
    const warningMatch = output.match(/Warnings:\s*(\d+)/);
    
    result.totalErrors = errorMatch ? parseInt(errorMatch[1]) : 1;
    result.totalWarnings = warningMatch ? parseInt(warningMatch[1]) : 0;
    result.passed = false;
    
    // Extract error details
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('✗')) {
        if (!result.features[0]) {
          result.features.push({
            name: input.feature || 'unknown',
            errors: [],
            warnings: [],
            passed: []
          });
        }
        const errorText = line.replace(/.*✗\s*/, '').trim();
        result.features[0].errors.push(errorText);
      }
    }
  }
  
  return result;
}

// Main CLI execution
(async () => {
  try {
    // Read input
    const arg = process.argv[2];
    let input = {};
    
    if (arg && arg !== '-') {
      input = JSON.parse(fs.readFileSync(arg, 'utf8'));
    } else if (!process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw) {
        input = JSON.parse(raw);
      }
    }
    
    // Execute validation
    const result = validate(input);
    
    // Output JSON
    console.log(JSON.stringify({
      ok: true,
      command: 'validate',
      result: result
    }));
    
    process.exit(result.passed ? 0 : 1);
    
  } catch (error) {
    console.error(`[validate-cli] Error: ${error.message}`);
    
    console.log(JSON.stringify({
      ok: false,
      command: 'validate',
      error: error.message,
      stack: process.env.DEBUG ? error.stack : undefined
    }));
    
    process.exit(1);
  }
})();