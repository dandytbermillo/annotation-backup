#!/usr/bin/env node

/**
 * Context-OS - Main entry point
 */

import { Command } from 'commander';
import { Orchestrator } from './agents/orchestrator';
import { VerifierAgent } from './agents/verifier';
import { Validator } from './core/validator';
import { FeaturePlan, Status, AgentContext } from './core/types';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';

const program = new Command();

program
  .name('context-os')
  .description('Intelligent documentation orchestrator for feature development')
  .version('1.0.0');

/**
 * Create command - scaffolds a new feature
 */
program
  .command('create <description>')
  .description('Create a new feature structure')
  .option('-d, --draft <path>', 'Path to draft implementation.md')
  .option('-s, --slug <name>', 'Explicit feature slug')
  .option('--skip-validation', 'Skip validation (dangerous!)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (description: string, options: any) => {
    try {
      console.log(chalk.bold('🚀 Context-OS Feature Creator\n'));
      
      // Load or create plan
      const plan = await loadPlan(description, options.draft, options.slug);
      
      // Create context
      const context: AgentContext = {
        plan,
        basePath: 'docs/proposal',
        verbose: options.verbose || false,
        skipValidation: options.skipValidation || false
      };
      
      // Run orchestrator
      const orchestrator = new Orchestrator(context);
      const result = await orchestrator.execute();
      
      if (result.success) {
        console.log(chalk.green('\n✅ Success!'));
        console.log(`Feature created at: ${result.data.path}`);
        console.log(`Files created: ${result.data.filesCreated}`);
        
        // Show next steps
        console.log(chalk.bold('\n📋 Next Steps:'));
        console.log(`1. cd ${result.data.path}`);
        console.log('2. Review implementation.md');
        console.log('3. Update status to IN_PROGRESS when starting');
        console.log('4. Run validate-doc-structure.sh to verify compliance');
      } else {
        console.error(chalk.red('\n❌ Failed:'), result.message);
        if (result.errors) {
          result.errors.forEach(err => console.error(chalk.red(`  - ${err}`)));
        }
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

/**
 * Validate command - validates a feature structure
 */
program
  .command('validate <path>')
  .description('Validate feature structure compliance')
  .option('-v, --verbose', 'Show all warnings')
  .action(async (featurePath: string, options: any) => {
    try {
      console.log(chalk.bold('🔍 Validating Feature Structure\n'));
      
      const fullPath = path.resolve(featurePath);
      
      // Check if path exists
      if (!await fs.pathExists(fullPath)) {
        console.error(chalk.red(`Path not found: ${fullPath}`));
        process.exit(1);
      }
      
      // Validate structure
      const result = Validator.validateStructure(fullPath);
      
      if (result.isValid) {
        console.log(chalk.green('✅ Structure is compliant!'));
      } else {
        console.log(chalk.red('❌ Structure has errors:'));
        result.errors.forEach(err => {
          console.log(chalk.red(`  ✗ ${err.message}`));
        });
      }
      
      if (result.warnings.length > 0 && options.verbose) {
        console.log(chalk.yellow('\n⚠ Warnings:'));
        result.warnings.forEach(warn => {
          console.log(chalk.yellow(`  - ${warn}`));
        });
      }
      
      process.exit(result.isValid ? 0 : 1);
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

/**
 * Status command - check feature status
 */
program
  .command('status [feature]')
  .description('Check feature status')
  .action(async (feature?: string) => {
    try {
      console.log(chalk.bold('📊 Feature Status\n'));
      
      const basePath = 'docs/proposal';
      
      if (feature) {
        // Check specific feature
        const featurePath = path.join(basePath, feature);
        const planPath = path.join(featurePath, 'implementation.md');
        
        if (!await fs.pathExists(planPath)) {
          console.error(chalk.red(`Feature not found: ${feature}`));
          process.exit(1);
        }
        
        const content = await fs.readFile(planPath, 'utf8');
        const statusMatch = content.match(/\*\*Status\*\*:\s*([^\n]+)/);
        
        if (statusMatch) {
          console.log(`${feature}: ${statusMatch[1]}`);
        } else {
          console.log(`${feature}: Status unknown`);
        }
      } else {
        // List all features and their status
        const features = await fs.readdir(basePath);
        
        for (const dir of features) {
          const planPath = path.join(basePath, dir, 'implementation.md');
          
          if (await fs.pathExists(planPath)) {
            const content = await fs.readFile(planPath, 'utf8');
            const statusMatch = content.match(/\*\*Status\*\*:\s*([^\n]+)/);
            const status = statusMatch ? statusMatch[1] : 'Unknown';
            
            console.log(`${dir.padEnd(30)} ${status}`);
          }
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

/**
 * Verify command - run verification tests
 */
program
  .command('verify <feature>')
  .description('Run feature verification tests')
  .option('-c, --command <cmd>', 'Test command to run')
  .action(async (feature: string, options: any) => {
    try {
      console.log(chalk.bold('🧪 Running Verification\n'));
      
      // Load feature plan
      const planPath = path.join('docs/proposal', feature, 'implementation.md');
      
      if (!await fs.pathExists(planPath)) {
        console.error(chalk.red(`Feature not found: ${feature}`));
        process.exit(1);
      }
      
      const planContent = await fs.readFile(planPath, 'utf8');
      const plan: FeaturePlan = parsePlanFromMarkdown(planContent);
      
      // Create context
      const context: AgentContext = {
        plan,
        basePath: path.join('docs/proposal', feature),
        verbose: true
      };
      
      // Run verifier
      const verifier = new VerifierAgent(context);
      const result = await verifier.execute(options.command);
      
      if (result.success) {
        console.log(chalk.green('\n✅ Verification complete'));
        console.log(`Results saved to: ${result.data.artifactPath}`);
      } else {
        console.error(chalk.red('\n❌ Verification failed:'), result.message);
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error);
      process.exit(1);
    }
  });

// Helper functions

/**
 * Loads or creates a feature plan
 */
async function loadPlan(description: string, draftPath?: string, slug?: string): Promise<FeaturePlan> {
  // If draft path provided, try to load it
  if (draftPath && await fs.pathExists(draftPath)) {
    console.log(chalk.blue(`Loading draft from: ${draftPath}`));
    const content = await fs.readFile(draftPath, 'utf8');
    return parsePlanFromMarkdown(content);
  }
  
  // Create minimal plan
  const date = new Date().toISOString().split('T')[0];
  const generatedSlug = slug || Validator.generateSlug(description);
  
  return {
    title: description,
    slug: generatedSlug,
    date,
    status: Status.PLANNED,
    objective: '[TO BE FILLED]',
    acceptanceCriteria: [],
    implementationTasks: []
  };
}

/**
 * Parses a plan from markdown content
 */
function parsePlanFromMarkdown(content: string): FeaturePlan {
  const lines = content.split('\n');
  const plan: Partial<FeaturePlan> = {
    acceptanceCriteria: [],
    implementationTasks: []
  };
  
  let currentSection = '';
  
  for (const line of lines) {
    // Parse metadata
    if (line.startsWith('# ')) {
      plan.title = line.substring(2).trim();
    } else if (line.includes('**Feature Slug**:')) {
      plan.slug = line.split(':')[1].trim();
    } else if (line.includes('**Date**:')) {
      plan.date = line.split(':')[1].trim();
    } else if (line.includes('**Status**:')) {
      const statusText = line.split(':')[1].trim();
      // Extract status from emoji + text format
      const statusMatch = statusText.match(/(PLANNED|IN_PROGRESS|TESTING|COMPLETE|BLOCKED|ROLLBACK)/);
      if (statusMatch) {
        plan.status = statusMatch[1] as Status;
      }
    } else if (line.includes('**Author**:')) {
      plan.author = line.split(':')[1].trim();
    }
    
    // Track sections
    if (line.startsWith('## ')) {
      currentSection = line.substring(3).trim().toLowerCase();
    }
    
    // Parse content based on section
    if (currentSection === 'objective' && !line.startsWith('#') && line.trim()) {
      if (!plan.objective) plan.objective = '';
      plan.objective += line.trim() + ' ';
    } else if (currentSection === 'acceptance criteria' && line.startsWith('- ')) {
      plan.acceptanceCriteria!.push(line.substring(2).replace(/^\[.\]\s*/, '').trim());
    } else if (currentSection === 'implementation tasks' && line.startsWith('- ')) {
      plan.implementationTasks!.push(line.substring(2).replace(/^\[.\]\s*/, '').trim());
    }
  }
  
  // Clean up objective
  if (plan.objective) {
    plan.objective = plan.objective.trim();
  }
  
  // Set defaults
  if (!plan.status) plan.status = Status.PLANNED;
  if (!plan.title) plan.title = 'Untitled Feature';
  if (!plan.objective) plan.objective = '';
  
  return plan as FeaturePlan;
}

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}