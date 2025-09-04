/**
 * Context-OS Adapter
 * Wraps existing Context-OS CLI tools for the bridge
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Execute Context-OS agents based on route
 */
async function execContextOS(route) {
  const { command, args } = route;
  
  try {
    switch (command) {
      case '/execute':
        return await executeFeature(args);
        
      case '/validate':
        return await validateStructure(args);
        
      case '/fix':
        return await createFix(args, route.dryRun);
        
      case '/status':
        return await checkStatus(args);
        
      default:
        throw new Error(`Unknown Context-OS command: ${command}`);
    }
  } catch (error) {
    return {
      status: 'error',
      error: error.message,
      logs: [error.stack]
    };
  }
}

/**
 * Execute feature creation
 */
async function executeFeature(args) {
  const feature = args[0];
  const planPath = args[1];
  
  const input = {
    feature,
    plan: planPath,
    autoConfirm: true
  };
  
  try {
    const result = execSync(
      `echo '${JSON.stringify(input)}' | node ${getCliPath('execute-cli.js')}`,
      { encoding: 'utf8', cwd: getContextOSRoot() }
    );
    
    const output = JSON.parse(result);
    
    if (output.ok) {
      return {
        status: 'ok',
        changes: output.result.created || [],
        reportPath: output.result.path ? `${output.result.path}/reports/` : null,
        logs: [`Created feature: ${output.result.slug}`]
      };
    } else {
      return {
        status: 'error',
        error: output.error,
        logs: [output.error]
      };
    }
  } catch (error) {
    // Try to parse any JSON in the error output
    const errorOutput = error.stdout || error.message;
    try {
      const parsed = JSON.parse(errorOutput);
      return {
        status: 'error',
        error: parsed.error || 'Execution failed',
        logs: [errorOutput]
      };
    } catch {
      return {
        status: 'error',
        error: error.message,
        logs: [errorOutput]
      };
    }
  }
}

/**
 * Validate documentation structure
 */
async function validateStructure(args) {
  const feature = args[0];
  const strict = args.includes('--strict');
  
  const input = {
    feature,
    strict
  };
  
  try {
    const result = execSync(
      `echo '${JSON.stringify(input)}' | node ${getCliPath('validate-cli.js')}`,
      { encoding: 'utf8', cwd: getContextOSRoot() }
    );
    
    const output = JSON.parse(result);
    
    if (output.ok) {
      const validation = output.result;
      return {
        status: validation.passed ? 'ok' : 'error',
        changes: [],
        logs: [
          `Errors: ${validation.totalErrors}`,
          `Warnings: ${validation.totalWarnings}`,
          ...validation.features.flatMap(f => f.errors)
        ]
      };
    } else {
      return {
        status: 'error',
        error: output.error,
        logs: [output.error]
      };
    }
  } catch (error) {
    // Validation returns non-zero exit on failure but still has results
    try {
      const output = JSON.parse(error.stdout);
      if (output.result) {
        return {
          status: 'error',
          changes: [],
          logs: [
            `Validation failed: ${output.result.totalErrors} errors`,
            ...output.result.features.flatMap(f => f.errors || [])
          ]
        };
      }
    } catch {
      return {
        status: 'error',
        error: error.message,
        logs: [error.message]
      };
    }
  }
}

/**
 * Create a fix document
 */
async function createFix(args, dryRun = false) {
  const feature = args[0];
  const issue = args[1] || 'Issue needs investigation';
  
  const input = {
    feature,
    issue,
    dryRun,
    autoConfirm: true
  };
  
  try {
    const result = execSync(
      `echo '${JSON.stringify(input)}' | node ${getCliPath('fix-cli.js')}`,
      { encoding: 'utf8', cwd: getContextOSRoot() }
    );
    
    const output = JSON.parse(result);
    
    if (output.ok) {
      const fix = output.result;
      
      // Generate patch if not dry-run
      let patchPath = null;
      if (!dryRun && fix.fixPath) {
        patchPath = await generatePatchForFix(fix.fixPath);
      }
      
      return {
        status: 'ok',
        changes: dryRun ? [] : [fix.fixPath],
        reportPath: fix.fixPath,
        patchPath,
        logs: [
          `Fix classified as: ${fix.classification?.severity}`,
          `Created at: ${fix.fixPath || 'DRY RUN'}`
        ]
      };
    } else {
      return {
        status: 'error',
        error: output.error,
        logs: [output.error]
      };
    }
  } catch (error) {
    return {
      status: 'error',
      error: error.message,
      logs: [error.stdout || error.message]
    };
  }
}

/**
 * Check feature status
 */
async function checkStatus(args) {
  const feature = args[0];
  
  try {
    const command = feature
      ? `node ${getContextOSPath('status-enforcer.js')} check ../docs/proposal/${feature}`
      : `node ${getContextOSPath('status-enforcer.js')} list`;
    
    const result = execSync(command, { 
      encoding: 'utf8',
      cwd: getContextOSRoot()
    });
    
    return {
      status: 'ok',
      changes: [],
      logs: result.split('\n').filter(line => line.trim())
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message,
      logs: [error.stdout || error.message]
    };
  }
}

/**
 * Generate a patch file for changes
 */
async function generatePatchForFix(fixPath) {
  try {
    // Get the diff using git
    const diff = execSync(`git diff HEAD -- ${fixPath}`, {
      encoding: 'utf8',
      cwd: process.cwd()
    });
    
    if (!diff) {
      return null;
    }
    
    // Save patch
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const patchPath = `patches/fix-${timestamp}.patch`;
    
    if (!fs.existsSync('patches')) {
      fs.mkdirSync('patches');
    }
    
    fs.writeFileSync(patchPath, diff);
    return patchPath;
    
  } catch (error) {
    console.warn('Could not generate patch:', error.message);
    return null;
  }
}

/**
 * Get Context-OS root directory
 */
function getContextOSRoot() {
  return path.join(__dirname, '..');
}

/**
 * Get CLI tool path
 */
function getCliPath(filename) {
  return path.join(getContextOSRoot(), 'cli', filename);
}

/**
 * Get Context-OS agent path
 */
function getContextOSPath(filename) {
  return path.join(getContextOSRoot(), filename);
}

/**
 * Batch execute multiple Context-OS operations
 */
async function batchExecute(operations) {
  const results = [];
  
  for (const op of operations) {
    const route = {
      command: op.command,
      args: op.args || [],
      dryRun: op.dryRun
    };
    
    const result = await execContextOS(route);
    results.push({
      operation: op,
      result
    });
  }
  
  return results;
}

module.exports = {
  execContextOS,
  batchExecute
};