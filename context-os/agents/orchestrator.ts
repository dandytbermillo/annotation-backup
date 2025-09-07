/**
 * Orchestrator Agent - Main coordinator for Context-OS
 */

import { Agent, AgentContext, AgentResult, Status, ValidationResult } from '../core/types';
import { Validator } from '../core/validator';
import { Scaffolder } from '../core/scaffolder';
import { PlanFillerAgent } from './plan-filler';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';

export class Orchestrator extends Agent {
  private rl: readline.Interface;
  private scaffolder: Scaffolder;
  private jsonOutput: boolean = false;
  
  constructor(context: AgentContext) {
    super(context);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.scaffolder = new Scaffolder();
  }
  
  /**
   * Main execution flow
   */
  async execute(options?: { json?: boolean }): Promise<AgentResult> {
    this.jsonOutput = options?.json || false;
    try {
      if (!this.jsonOutput) {
        console.log(chalk.bold('\n🤖 Context-OS Orchestrator\n'));
      }
      
      // Step A: Parse & Propose
      const slug = this.proposeSlug();
      this.log('info', `Proposed feature slug: ${slug}`);
      
      // Update plan with slug
      this.context.plan.slug = slug;
      
      // Step B: Validate Plan
      const validation = this.validate();
      if (!validation.isValid) {
        return await this.handleValidationFailure(validation);
      }
      
      // Step C: Confirmation Gate
      const confirmed = await this.getConfirmation();
      if (!confirmed) {
        return {
          success: false,
          message: 'Feature creation cancelled by user'
        };
      }
      
      // Step D: Scaffold & Move
      const scaffoldResult = await this.scaffold();
      if (!scaffoldResult.success) {
        return scaffoldResult;
      }
      
      // Step E: Success
      const result = {
        success: true,
        message: 'Feature workspace created successfully',
        data: {
          path: scaffoldResult.data.path,
          filesCreated: scaffoldResult.data.filesCreated
        }
      };
      
      if (this.jsonOutput) {
        console.log(JSON.stringify({
          ok: true,
          command: 'orchestrate',
          result
        }));
      }
      
      return result;
      
    } catch (error) {
      return {
        success: false,
        message: 'Orchestrator failed',
        errors: [error instanceof Error ? error.message : String(error)]
      };
    } finally {
      this.cleanup();
    }
  }
  
  /**
   * Validates the feature plan
   */
  validate(): ValidationResult {
    if (this.context.skipValidation) {
      this.log('warn', 'Skipping validation (dangerous!)');
      return {
        isValid: true,
        errors: [],
        warnings: [],
        missingFields: []
      };
    }
    
    return Validator.validatePlan(this.context.plan);
  }
  
  /**
   * Proposes a feature slug
   */
  private proposeSlug(): string {
    if (this.context.plan.slug) {
      const validation = Validator.validateSlug(this.context.plan.slug);
      if (validation.isValid) {
        return this.context.plan.slug;
      }
      this.log('warn', 'Provided slug is invalid, generating new one');
    }
    
    return Validator.generateSlug(this.context.plan.title);
  }
  
  /**
   * Handles validation failures
   */
  private async handleValidationFailure(validation: ValidationResult): Promise<AgentResult> {
    if (!this.jsonOutput) {
      this.log('error', 'Plan validation failed:');
      validation.errors.forEach(error => {
        console.log(chalk.red(`  ✗ ${error.field}: ${error.message}`));
      });
    }
    
    if (validation.missingFields.length > 0) {
      const fix = await this.askUser('Would you like to fix these issues interactively? (yes/no): ');
      if (fix.toLowerCase() === 'yes') {
        // Call PlanFillerAgent
        const filler = new PlanFillerAgent(this.context);
        const fillResult = await filler.execute();
        
        if (fillResult.success) {
          // Re-validate
          const revalidation = this.validate();
          if (revalidation.isValid) {
            // Continue with execution
            return this.execute();
          }
        }
        
        return fillResult;
      }
    }
    
    return {
      success: false,
      message: 'Cannot proceed without a valid plan',
      errors: validation.errors.map(e => e.message)
    };
  }
  
  /**
   * Gets user confirmation
   */
  private async getConfirmation(): Promise<boolean> {
    const targetDir = path.join('docs/proposal', this.context.plan.slug!);
    
    if (!this.jsonOutput) {
      console.log(chalk.bold('\n📋 Action Summary:'));
      console.log(`  • Feature: ${this.context.plan.title}`);
      console.log(`  • Location: ${targetDir}/`);
      console.log(`  • Status: ${this.context.plan.status}`);
      console.log('\nThis will create:');
      console.log('  • Complete directory structure');
      console.log('  • Implementation plan');
      console.log('  • Report templates');
      console.log('  • Fix documentation structure');
    }
    
    const answer = await this.askUser('\nProceed with creation? (yes/no): ');
    return answer.toLowerCase() === 'yes';
  }
  
  /**
   * Scaffolds the feature structure
   */
  private async scaffold(): Promise<AgentResult> {
    try {
      const targetDir = path.join('docs/proposal', this.context.plan.slug!);
      
      // Check if feature already exists
      if (await fs.pathExists(targetDir)) {
        const overwrite = await this.askUser('Feature already exists. Overwrite? (yes/no): ');
        if (overwrite.toLowerCase() !== 'yes') {
          return {
            success: false,
            message: 'Feature already exists'
          };
        }
        await fs.remove(targetDir);
      }
      
      // Create structure
      this.log('info', 'Creating directory structure...');
      const structure = await this.scaffolder.createStructure(this.context.plan);
      
      this.log('info', 'Writing files...');
      const filesCreated = await this.scaffolder.writeFiles(structure);
      
      this.log('success', `Feature workspace created at: ${targetDir}`);
      
      return {
        success: true,
        message: 'Structure created successfully',
        data: {
          path: targetDir,
          filesCreated
        }
      };
      
    } catch (error) {
      return {
        success: false,
        message: 'Failed to scaffold structure',
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
  
  /**
   * Helper to ask user questions
   */
  private askUser(question: string): Promise<string> {
    return new Promise(resolve => {
      this.rl.question(question, resolve);
    });
  }
  
  /**
   * Logging helper
   */
  private log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    if (!this.context.verbose && level === 'info') return;
    if (this.jsonOutput) return; // Skip all logs in JSON mode
    
    const prefix = {
      info: chalk.blue('→'),
      warn: chalk.yellow('⚠'),
      error: chalk.red('✗'),
      success: chalk.green('✓')
    };
    
    console.log(`${prefix[level]} ${message}`);
  }
  
  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.rl.close();
  }
  
  /**
   * Checks if we can proceed with an operation
   */
  checkStopConditions(): string[] {
    const stops: string[] = [];
    
    // Check if trying to modify completed feature
    if (this.context.plan.status === Status.COMPLETE) {
      stops.push('Cannot modify implementation-details after COMPLETE status');
    }
    
    // Check for security concerns
    if (this.context.plan.slug?.includes('..')) {
      stops.push('Path traversal detected in slug');
    }
    
    // Check for missing critical information
    if (!this.context.plan.objective || this.context.plan.objective.length < 10) {
      stops.push('Objective is missing or too short');
    }
    
    return stops;
  }
}