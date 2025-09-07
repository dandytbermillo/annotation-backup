#!/usr/bin/env node

/**
 * JSON CLI Wrapper for /fix command
 * Handles post-implementation fixes
 */

const fs = require('fs');
const path = require('path');
const FixWorkflowManager = require('../fix-workflow');

/**
 * Input Schema:
 * {
 *   "feature": "Feature slug",
 *   "issue": "Issue description",
 *   "severity": "CRITICAL|HIGH|MEDIUM|LOW",
 *   "metrics": {
 *     "performanceDegradation": 0-100,
 *     "usersAffected": 0-100
 *   },
 *   "environment": "prod|staging|dev",
 *   "dryRun": true/false,
 *   "autoConfirm": true/false
 * }
 */

async function fix(input) {
  const manager = new FixWorkflowManager();
  
  // For JSON mode, make it non-interactive
  if (input.autoConfirm !== false) {
    // Close the real readline if it exists
    if (manager.rl) {
      manager.rl.close();
    }
    
    // Create mock readline interface
    manager.rl = {
      question: (question, callback) => {
        if (process.env.DEBUG) {
          console.error(`[AUTO] ${question}`);
        }
        
        let answer = '';
        
        if (question.includes('Continue anyway')) {
          answer = 'yes'; // Continue even if not COMPLETE
        } else if (question.includes('Detailed description')) {
          answer = input.issue || 'Issue needs investigation';
        } else if (question.includes('Environment')) {
          answer = input.environment || 'dev';
        } else if (question.includes('performance/impact metrics')) {
          answer = input.metrics ? 'yes' : 'no';
        } else if (question.includes('Performance degradation')) {
          answer = String(input.metrics?.performanceDegradation || 0);
        } else if (question.includes('Users affected')) {
          answer = String(input.metrics?.usersAffected || 0);
        } else if (question.includes('Proceed with fix creation')) {
          answer = input.dryRun ? 'no' : 'yes';
        }
        
        callback(answer);
      },
      close: () => {},
      closed: false
    };
  }
  
  const result = {
    feature: input.feature,
    issue: input.issue,
    classification: null,
    fixPath: null,
    created: false,
    dryRun: input.dryRun || false
  };
  
  try {
    // Check if feature exists
    const featurePath = path.join('docs/proposal', input.feature);
    if (!fs.existsSync(featurePath)) {
      throw new Error(`Feature not found: ${input.feature}`);
    }
    
    // Create the issue object
    const issue = {
      title: input.issue,
      description: input.issue,
      environment: input.environment || 'dev',
      metrics: input.metrics || {}
    };
    
    // Classify the issue
    const classification = manager.classifier.classify(issue);
    
    // Check if severity override was provided but not used
    if (input.severity && input.severity !== classification.severity) {
      console.error(`[NOTICE] Severity override '${input.severity}' provided but not applied.`);
      console.error(`[NOTICE] Auto-classified as '${classification.severity}' based on metrics.`);
      console.error(`[NOTICE] Manual severity override is PLANNED for future release.`);
    }
    
    result.classification = {
      severity: classification.severity,
      type: classification.type,
      icon: classification.icon,
      sla: classification.sla,
      workflow: classification.workflow,
      recommendations: classification.recommendations
    };
    
    // If not dry-run, create the fix
    if (!input.dryRun) {
      const fixResult = manager.classifier.routeIssue(issue, featurePath);
      result.fixPath = fixResult.path;
      result.created = true;
      
      // Update the index
      await manager.updateFixIndex(featurePath, fixResult, issue);
    }
    
    return result;
    
  } catch (error) {
    throw new Error(`Fix creation failed: ${error.message}`);
  } finally {
    if (manager.rl && !manager.rl.closed) {
      manager.rl.close();
    }
  }
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
    
    // Validate required fields
    if (!input.feature) {
      throw new Error('Missing required field: feature');
    }
    if (!input.issue) {
      throw new Error('Missing required field: issue');
    }
    
    // Execute the fix
    const result = await fix(input);
    
    // Output JSON
    console.log(JSON.stringify({
      ok: true,
      command: 'fix',
      result: result
    }));
    
    process.exit(0);
    
  } catch (error) {
    console.error(`[fix-cli] Error: ${error.message}`);
    
    console.log(JSON.stringify({
      ok: false,
      command: 'fix',
      error: error.message,
      stack: process.env.DEBUG ? error.stack : undefined
    }));
    
    process.exit(1);
  }
})();