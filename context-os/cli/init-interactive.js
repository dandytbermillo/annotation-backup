#!/usr/bin/env node
// context-os/cli/init-interactive.js

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const { v4: uuidv4 } = require('uuid');
const { renderInitial } = require('../templates/render-initial');
const { invokeClaudeInit } = require('../bridge/claude-adapter');

// Parse arguments
const args = process.argv.slice(2);
const featureSlug = args.find(arg => !arg.startsWith('--')) || null;

const flags = {
  resume: args.includes('--resume'),
  apply: args.includes('--apply'),
  dryRun: args.includes('--dry-run'),
  migrate: args.includes('--migrate'),
  batchMode: args.includes('--batch-mode'),
  help: args.includes('--help')
};

// In batch mode, skip prompts and use defaults
if (flags.batchMode) {
  console.log('🤖 Batch mode: Using defaults, no prompts');
  if (!flags.apply) flags.apply = true;
}

async function main() {
  if (flags.help || !featureSlug) {
    showHelp();
    process.exit(0);
  }
  
  try {
    console.log(chalk.blue(`\n📝 Interactive INITIAL.md Creation`));
    console.log(chalk.gray(`Feature: ${featureSlug}`));
    console.log(chalk.gray('─'.repeat(60)));
    
    // Set up paths
    const dir = path.join('docs', 'proposal', featureSlug);
    const initialPath = path.join(dir, 'INITIAL.md');
    const tmpPath = path.join('.tmp', 'initial', `${featureSlug}.json`);
    
    // Check for existing file
    const existingContent = await maybeLoad(initialPath);
    if (existingContent && !flags.migrate) {
      if (!flags.batchMode) {
        console.log(chalk.yellow(`⚠️ INITIAL.md already exists for ${featureSlug}`));
        console.log(`Use --migrate to upgrade format or choose a different feature`);
      }
      return;
    }
    
    // Resume or start new session
    const sessionId = uuidv4();
    const startTime = Date.now();
    
    let spec = null;
    if (flags.resume) {
      spec = await maybeLoad(tmpPath);
      if (spec) {
        console.log(chalk.green('✓ Resuming from saved session'));
      }
    }
    
    // Initialize spec with defaults if not resuming
    if (!spec) {
      spec = {
        schemaVersion: '1.0.0',
        featureSlug,
        sessionId,
        createdAt: new Date().toISOString(),
        createdBy: 'context-os-init'
      };
    }
    
    // Invoke Claude for interactive collection (or use mock in batch mode)
    if (flags.batchMode) {
      // Use minimal defaults for batch mode
      spec = {
        ...spec,
        title: `Feature: ${featureSlug.replace(/_/g, ' ')}`,
        problem: 'This feature addresses a gap in the current system. Users need this functionality. Implementation will improve the overall experience.',
        goals: [
          'Implement core functionality',
          'Ensure backward compatibility',
          'Maintain performance standards'
        ],
        acceptanceCriteria: [
          'Feature works as specified',
          'All tests pass',
          'Documentation is complete'
        ],
        stakeholders: ['Development Team', 'Product Team'],
        severity: 'medium'
      };
    } else {
      // Use Claude adapter for interactive collection
      console.log(chalk.yellow('\n🤖 Invoking Claude for interactive collection...'));
      
      try {
        // Call Claude adapter
        const claudeResponse = await invokeClaudeInit(featureSlug, { sessionId, spec });
        
        if (claudeResponse.status === 'ready') {
          spec = claudeResponse.spec;
          console.log(chalk.green('✓ Claude collection complete'));
          console.log(chalk.gray(`  Turns: ${claudeResponse.turns}`));
          console.log(chalk.gray(`  Retry count: ${claudeResponse.jsonRetryCount}`));
        } else {
          console.log(chalk.yellow('⚠️ Claude collection incomplete, using partial data'));
          spec = { ...spec, ...claudeResponse.spec };
        }
      } catch (error) {
        // Fallback to manual skeleton when Claude is unavailable
        console.log(chalk.yellow('\n⚠️ Claude unavailable, switching to template wizard...'));
        console.log(chalk.blue('Please provide the following information:\n'));
        
        // Simple fallback prompts using readline
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const askQuestion = (question) => new Promise(resolve => {
          readline.question(chalk.cyan(question), resolve);
        });
        
        // Collect required fields manually
        spec.title = await askQuestion('Title (5-80 chars): ') || `${featureSlug.replace(/_/g, ' ')} Feature`;
        spec.problem = await askQuestion('Problem (3-6 sentences): ') || 'This feature addresses a gap in the system.';
        
        console.log(chalk.cyan('\nGoals (enter 3-7, one per line, empty line to finish):'));
        spec.goals = [];
        for (let i = 0; i < 7; i++) {
          const goal = await askQuestion(`  ${i+1}. `);
          if (!goal) break;
          spec.goals.push(goal);
        }
        if (spec.goals.length < 3) {
          spec.goals = ['Implement core functionality', 'Ensure quality', 'Maintain performance'];
        }
        
        console.log(chalk.cyan('\nAcceptance Criteria (enter 3-7, empty line to finish):'));
        spec.acceptanceCriteria = [];
        for (let i = 0; i < 7; i++) {
          const criteria = await askQuestion(`  ${i+1}. `);
          if (!criteria) break;
          spec.acceptanceCriteria.push(criteria);
        }
        if (spec.acceptanceCriteria.length < 3) {
          spec.acceptanceCriteria = ['Feature works as specified', 'Tests pass', 'Documentation complete'];
        }
        
        spec.stakeholders = (await askQuestion('\nStakeholders (comma-separated): ')).split(',').map(s => s.trim());
        if (spec.stakeholders.length < 2) {
          spec.stakeholders = ['Development Team', 'Product Team'];
        }
        
        spec.severity = await askQuestion('\nSeverity (low/medium/high/critical) [medium]: ') || 'medium';
        
        readline.close();
        console.log(chalk.green('\n✓ Manual collection complete'));
      }
    }
    
    // Ensure tmp directory exists
    await fs.mkdir(path.dirname(tmpPath), { recursive: true });
    
    // Save progress
    await fs.writeFile(tmpPath, JSON.stringify(spec, null, 2), 'utf8');
    
    // Render template using Handlebars
    const md = await renderInitial(spec);
    
    // Preview
    if (!flags.batchMode) {
      console.log(chalk.blue('📄 Preview:'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(md.split('\n').slice(0, 20).join('\n'));
      console.log(chalk.gray('... (truncated)'));
      console.log(chalk.gray('─'.repeat(60)));
    }
    
    // Handle dry-run
    if (flags.dryRun) {
      console.log(chalk.yellow('\n✓ Dry-run complete (no files written)'));
      return;
    }
    
    // Apply decision
    if (!flags.apply && !flags.batchMode) {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        readline.question('Apply this INITIAL.md? (y/n): ', resolve);
      });
      readline.close();
      
      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.yellow('Cancelled'));
        return;
      }
    }
    
    // Create directory and write file
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(initialPath, md, 'utf8');
    
    console.log(chalk.green(`\n✓ INITIAL.md created: ${initialPath}`));
    
    // Clean up tmp file
    await fs.unlink(tmpPath).catch(() => {});
    
    // Calculate metrics
    const durationMs = Date.now() - startTime;
    
    // Emit telemetry (simplified)
    const telemetry = {
      sessionId,
      turns: 1, // Would be tracked from Claude interaction
      jsonRetryCount: 0,
      durationMs,
      schemaVersion: '1.0.0',
      outcome: 'success',
      feature: featureSlug,
      timestamp: new Date().toISOString()
    };
    
    // Log telemetry to JSONL file
    const telemetryPath = 'logs/init-telemetry.jsonl';
    await fs.mkdir('logs', { recursive: true });
    await fs.appendFile(telemetryPath, JSON.stringify(telemetry) + '\n', 'utf8');
    
    // Next steps
    if (!flags.batchMode) {
      console.log(chalk.blue('\n📚 Next steps:'));
      console.log(`  1. Review: ${initialPath}`);
      console.log(`  2. Create plan: /context-execute ${featureSlug}`);
      console.log(`  3. Validate: /context-validate ${featureSlug}`);
    }
    
  } catch (error) {
    console.error(chalk.red('✗ Error:'), error.message);
    if (process.env.DEBUG) {
      console.error(chalk.gray(error.stack));
    }
    console.error(chalk.gray('\nUse --resume to continue from saved state'));
    process.exit(1);
  }
}

async function maybeLoad(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    if (filePath.endsWith('.json')) {
      return JSON.parse(content);
    }
    return content;
  } catch {
    return null;
  }
}

function showHelp() {
  console.log(`
Context-OS Interactive INITIAL.md Creator

Usage:
  node init-interactive.js <feature_slug> [options]

Options:
  --resume        Continue from saved session
  --dry-run       Preview without writing files
  --apply         Skip confirmation prompt
  --migrate       Upgrade existing INITIAL.md format
  --batch-mode    CI mode (no prompts, use defaults)
  --help          Show this help

Examples:
  node init-interactive.js dark_mode
  node init-interactive.js auth_system --dry-run
  node init-interactive.js search_feature --resume
  `);
}

// Run
main().catch(e => {
  console.error(e);
  process.exit(1);
});