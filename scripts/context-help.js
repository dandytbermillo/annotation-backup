#!/usr/bin/env node

/**
 * Context-OS Help Display
 * Shows all available Context-OS commands and their usage
 */

const fs = require('fs');
const path = require('path');

function displayHelp() {
  const commands = [
    {
      command: '/features',
      npm: 'npm run context:features',
      description: 'Show status of all Context-OS features',
      usage: '/features [feature_slug]',
      options: [
        'No args - Show all features',
        'feature_slug - Show specific feature details',
        '--refresh - Force refresh with confirmation'
      ]
    },
    {
      command: '/execute',
      npm: 'npm run context:execute',
      description: 'Create a new feature with compliant structure',
      usage: '/execute "Feature Name" [--plan path] [--slug name]',
      options: [
        '--plan <path> - Use existing draft plan',
        '--slug <name> - Pre-select feature slug',
        '--confirm false - Skip confirmation'
      ]
    },
    {
      command: '/fix',
      npm: 'npm run context:fix',
      description: 'Create fix document for post-implementation issues',
      usage: '/fix --feature <slug> --issue "Description" [--dry-run|--apply]',
      options: [
        '--dry-run - Preview without creating files',
        '--apply - Create actual fix documents',
        '--env <prod|staging|dev> - Specify environment'
      ]
    },
    {
      command: '/validate',
      npm: 'npm run doc:validate',
      description: 'Validate feature documentation structure',
      usage: '/validate [feature_slug] [--strict]',
      options: [
        'No args - Validate all features',
        'feature_slug - Validate specific feature',
        '--strict - Apply strict validation rules'
      ]
    },
    {
      command: '/generate-prp',
      npm: null,
      description: 'Generate a Project Requirements Plan',
      usage: '/generate-prp <initial_file>',
      options: [
        'Creates comprehensive PRP from initial requirements'
      ]
    },
    {
      command: '/execute-prp',
      npm: null,
      description: 'Execute a PRP to implement features',
      usage: '/execute-prp <prp_file>',
      options: [
        'Implements features according to PRP specifications'
      ]
    }
  ];

  const npmScripts = [
    {
      script: 'context:features',
      description: 'Show features in table format'
    },
    {
      script: 'context:features:detailed',
      description: 'Show features with full details'
    },
    {
      script: 'context:features:summary',
      description: 'Show features summary only'
    },
    {
      script: 'context:scan',
      description: 'Scan and save features to JSON'
    },
    {
      script: 'context:classify',
      description: 'Run issue classifier'
    },
    {
      script: 'context:status',
      description: 'Run status enforcer'
    },
    {
      script: 'doc:validate',
      description: 'Validate documentation structure'
    },
    {
      script: 'doc:validate:strict',
      description: 'Strict validation with all rules'
    }
  ];

  // Header
  console.log('');
  console.log('🤖 Context-OS Help');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Context-OS is a documentation-compliant feature orchestration system');
  console.log('that follows the Documentation Process Guide v1.4.5');
  console.log('');

  // Slash Commands
  console.log('📝 Slash Commands (use in Claude Code)');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('');

  for (const cmd of commands) {
    console.log(`  ${cmd.command.padEnd(15)} - ${cmd.description}`);
    console.log(`  ${''.padEnd(15)}   Usage: ${cmd.usage}`);
    if (cmd.npm) {
      console.log(`  ${''.padEnd(15)}   NPM: ${cmd.npm}`);
    }
    if (cmd.options && cmd.options.length > 0) {
      console.log(`  ${''.padEnd(15)}   Options:`);
      for (const opt of cmd.options) {
        console.log(`  ${''.padEnd(15)}     • ${opt}`);
      }
    }
    console.log('');
  }

  // NPM Scripts
  console.log('🚀 NPM Scripts (use in terminal)');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('');

  for (const script of npmScripts) {
    console.log(`  npm run ${script.script.padEnd(25)} - ${script.description}`);
  }

  console.log('');

  // Quick Start
  console.log('⚡ Quick Start');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('');
  console.log('  1. View all features:        npm run context:features');
  console.log('  2. Create new feature:        /execute "Feature Name"');
  console.log('  3. Fix an issue:             /fix --feature <slug> --issue "Bug"');
  console.log('  4. Validate structure:        npm run doc:validate');
  console.log('');

  // Documentation Process Guide Rules
  console.log('📋 Documentation Process Guide Rules');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('');
  console.log('  Rule 1: Workspace Structure   - docs/proposal/<feature>/');
  console.log('  Rule 2: Status Values          - PLANNED, IN PROGRESS, COMPLETE, BLOCKED');
  console.log('  Rule 3: Directory Structure    - implementation.md, reports/, test_*/, etc.');
  console.log('  Rule 4: Post-Implementation    - Fixes in post-implementation-fixes/');
  console.log('  Rule 5: Status Enforcement     - COMPLETE features are read-only');
  console.log('  Rule 6: Process Documentation  - Meta-docs in docs/documentation_process_guide/');
  console.log('  Rule 7: Implementation Stages   - Track with status values');
  console.log('  Rule 8: Patches Directory       - Store .patch files with README.md');
  console.log('');

  // File Locations
  console.log('📁 Important Locations');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('');
  console.log('  Features:        docs/proposal/');
  console.log('  Context-OS:      context-os/');
  console.log('  Scripts:         scripts/');
  console.log('  Commands:        .claude/commands/');
  console.log('  Process Guide:   docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md');
  console.log('  CLAUDE.md:       CLAUDE.md (project root)');
  console.log('');

  // Cache Note
  console.log('⚠️  Note on Slash Commands');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('');
  console.log('  Claude Code may cache slash command definitions. If a command shows');
  console.log('  old output, use the npm script version instead:');
  console.log('');
  console.log('    Cached: /features');
  console.log('    Fresh:  npm run context:features');
  console.log('');

  // Footer
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('For more details, see: docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md');
  console.log('');
}

// Run help display
displayHelp();