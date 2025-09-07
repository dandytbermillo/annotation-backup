#!/usr/bin/env node

/**
 * Scaffolder CLI - Command-line interface for scaffolder.ts
 * Provides JSON output mode and structure-only option
 */

const { Scaffolder } = require('../dist/core/scaffolder');
const fs = require('fs');
const path = require('path');

class ScaffolderCLI {
  constructor() {
    this.scaffolder = new Scaffolder();
  }
  
  async run() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    // Check for flags
    const jsonIndex = args.indexOf('--json');
    const jsonOutput = jsonIndex > -1;
    if (jsonOutput) {
      args.splice(jsonIndex, 1);
    }
    
    const structureOnlyIndex = args.indexOf('--structure-only');
    const structureOnly = structureOnlyIndex > -1;
    if (structureOnly) {
      args.splice(structureOnlyIndex, 1);
    }
    
    switch (command) {
      case 'create':
        await this.createFeature(args[1], jsonOutput, structureOnly);
        break;
        
      case 'validate':
        await this.validatePlan(args[1], jsonOutput);
        break;
        
      default:
        if (jsonOutput) {
          console.log(JSON.stringify({
            ok: false,
            error: 'Invalid command. Use: create or validate'
          }));
        } else {
          console.log('Usage: scaffolder-cli <command> [options]');
          console.log('Commands:');
          console.log('  create <plan-file>    Create feature structure from plan');
          console.log('  validate <plan-file>  Validate a plan file');
          console.log('');
          console.log('Options:');
          console.log('  --json            Output in JSON format');
          console.log('  --structure-only  Create directories only, no files');
        }
    }
  }
  
  async createFeature(planFile, jsonOutput, structureOnly) {
    try {
      // Read plan file
      if (!planFile) {
        throw new Error('Plan file required');
      }
      
      const planPath = path.resolve(planFile);
      if (!fs.existsSync(planPath)) {
        throw new Error(`Plan file not found: ${planPath}`);
      }
      
      const planContent = fs.readFileSync(planPath, 'utf8');
      const plan = this.parsePlan(planContent);
      
      // Create structure
      const structure = await this.scaffolder.createStructure(plan);
      
      let filesCreated = 0;
      if (!structureOnly) {
        // Write files
        filesCreated = await this.scaffolder.writeFiles(structure);
      }
      
      const result = {
        success: true,
        message: structureOnly ? 'Structure created (files skipped)' : 'Feature created successfully',
        data: {
          path: structure.basePath,
          directories: structure.directories.length,
          files: structureOnly ? 0 : filesCreated
        }
      };
      
      if (jsonOutput) {
        console.log(JSON.stringify({
          ok: true,
          command: 'create',
          result
        }));
      } else {
        console.log('✅ ' + result.message);
        console.log(`  Path: ${result.data.path}`);
        console.log(`  Directories: ${result.data.directories}`);
        console.log(`  Files: ${result.data.files}`);
      }
      
    } catch (error) {
      if (jsonOutput) {
        console.log(JSON.stringify({
          ok: false,
          error: error.message
        }));
      } else {
        console.error('❌ Error:', error.message);
      }
      process.exit(1);
    }
  }
  
  async validatePlan(planFile, jsonOutput) {
    try {
      if (!planFile) {
        throw new Error('Plan file required');
      }
      
      const planPath = path.resolve(planFile);
      if (!fs.existsSync(planPath)) {
        throw new Error(`Plan file not found: ${planPath}`);
      }
      
      const planContent = fs.readFileSync(planPath, 'utf8');
      const plan = this.parsePlan(planContent);
      
      // Basic validation
      const errors = [];
      if (!plan.title) errors.push('Missing title');
      if (!plan.slug) errors.push('Missing slug');
      if (!plan.objective) errors.push('Missing objective');
      if (!plan.acceptanceCriteria || plan.acceptanceCriteria.length === 0) {
        errors.push('Missing acceptance criteria');
      }
      
      const result = {
        valid: errors.length === 0,
        errors
      };
      
      if (jsonOutput) {
        console.log(JSON.stringify({
          ok: result.valid,
          command: 'validate',
          result
        }));
      } else {
        if (result.valid) {
          console.log('✅ Plan is valid');
        } else {
          console.log('❌ Plan validation failed:');
          result.errors.forEach(err => console.log(`  - ${err}`));
        }
      }
      
    } catch (error) {
      if (jsonOutput) {
        console.log(JSON.stringify({
          ok: false,
          error: error.message
        }));
      } else {
        console.error('❌ Error:', error.message);
      }
      process.exit(1);
    }
  }
  
  parsePlan(content) {
    // Parse markdown plan to extract fields
    const plan = {
      title: '',
      slug: '',
      status: 'PLANNED',
      objective: '',
      acceptanceCriteria: [],
      implementationTasks: [],
      date: new Date().toISOString().split('T')[0]
    };
    
    // Extract title
    const titleMatch = content.match(/^#\s+(.+)/m);
    if (titleMatch) {
      plan.title = titleMatch[1];
    }
    
    // Extract slug
    const slugMatch = content.match(/\*\*Feature Slug\*\*:\s*(\S+)/i);
    if (slugMatch) {
      plan.slug = slugMatch[1];
    } else if (plan.title) {
      // Generate slug from title
      plan.slug = plan.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }
    
    // Extract status
    const statusMatch = content.match(/\*\*Status\*\*:\s*(\w+)/i);
    if (statusMatch) {
      plan.status = statusMatch[1];
    }
    
    // Extract objective
    const objectiveMatch = content.match(/##\s+Objective\s*\n+([^#]+)/i);
    if (objectiveMatch) {
      plan.objective = objectiveMatch[1].trim();
    }
    
    // Extract acceptance criteria
    const criteriaMatch = content.match(/##\s+Acceptance Criteria\s*\n+([^#]+)/i);
    if (criteriaMatch) {
      const lines = criteriaMatch[1].trim().split('\n');
      plan.acceptanceCriteria = lines
        .filter(line => line.match(/^[-*]\s+\[.\]\s+(.+)/))
        .map(line => line.replace(/^[-*]\s+\[.\]\s+/, ''));
    }
    
    // Extract implementation tasks
    const tasksMatch = content.match(/##\s+(?:Implementation )?Tasks\s*\n+([^#]+)/i);
    if (tasksMatch) {
      const lines = tasksMatch[1].trim().split('\n');
      plan.implementationTasks = lines
        .filter(line => line.match(/^[-*]\s+\[.\]\s+(.+)/) || line.match(/^\d+\.\s+(.+)/))
        .map(line => line.replace(/^[-*]\s+\[.\]\s+/, '').replace(/^\d+\.\s+/, ''));
    }
    
    return plan;
  }
}

// Run CLI
if (require.main === module) {
  const cli = new ScaffolderCLI();
  cli.run().catch(console.error);
}

module.exports = ScaffolderCLI;