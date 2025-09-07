/**
 * VerifierAgent - Handles test execution and artifact collection
 */

import { Agent, AgentResult, TestResult, ValidationResult } from '../core/types';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';

const execAsync = promisify(exec);

export class VerifierAgent extends Agent {
  private jsonOutput: boolean = false;
  
  private readonly allowedCommands = [
    'npm test',
    'npm run test',
    'npm run lint',
    'npm run type-check',
    'jest',
    'mocha',
    'pytest',
    'go test',
    'cargo test'
  ];
  
  /**
   * Executes verification tests
   */
  async execute(command?: string, options?: { json?: boolean }): Promise<AgentResult> {
    this.jsonOutput = options?.json || false;
    try {
      if (!this.jsonOutput) {
        console.log(chalk.bold('🧪 Verification Agent\n'));
      }
      
      // Validate command if provided
      if (command && !this.isCommandSafe(command)) {
        return {
          success: false,
          message: 'Command not allowed for safety reasons',
          errors: [`Command '${command}' is not in the allowed list`]
        };
      }
      
      // Determine command to run
      const testCommand = command || await this.detectTestCommand();
      
      if (!testCommand) {
        return {
          success: false,
          message: 'No test command found',
          errors: ['Could not detect test command. Please specify with --command']
        };
      }
      
      if (!this.jsonOutput) {
        console.log(chalk.blue(`Running: ${testCommand}`));
      }
      
      // Execute command
      const result = await this.runCommand(testCommand);
      
      // Save artifacts
      const artifactPath = await this.saveArtifacts(result);
      
      // Update status based on result
      const success = result.exitCode === 0;
      const response = {
        success,
        message: success ? 'Verification successful' : 'Verification failed',
        data: {
          result,
          artifactPath
        }
      };
      
      if (this.jsonOutput) {
        console.log(JSON.stringify({
          ok: success,
          command: 'verify',
          result: response
        }));
      } else {
        if (success) {
          console.log(chalk.green('✓ Tests passed'));
        } else {
          console.log(chalk.red('✗ Tests failed'));
        }
      }
      
      return response;
      
    } catch (error) {
      return {
        success: false,
        message: 'Verification error',
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
  
  /**
   * Validates the agent can run
   */
  validate(): ValidationResult {
    const errors = [];
    
    // Check if artifacts directory exists
    const artifactsPath = path.join(this.context.basePath, 'implementation-details', 'artifacts');
    if (!fs.existsSync(artifactsPath)) {
      errors.push({
        field: 'structure',
        message: 'Artifacts directory not found',
        severity: 'error' as const
      });
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings: [],
      missingFields: []
    };
  }
  
  /**
   * Checks if a command is safe to run
   */
  private isCommandSafe(command: string): boolean {
    // Check against whitelist
    if (this.allowedCommands.some(allowed => command.startsWith(allowed))) {
      return true;
    }
    
    // Check for dangerous patterns
    const dangerous = [
      'rm ',
      'del ',
      'format',
      'sudo',
      '&&',
      '||',
      ';',
      '|',
      '>',
      '<',
      '`',
      '$('
    ];
    
    return !dangerous.some(pattern => command.includes(pattern));
  }
  
  /**
   * Detects the test command to use
   */
  private async detectTestCommand(): Promise<string | null> {
    // Check package.json for test script
    const packagePath = path.join(process.cwd(), 'package.json');
    
    if (await fs.pathExists(packagePath)) {
      const packageJson = await fs.readJson(packagePath);
      
      if (packageJson.scripts?.test) {
        return 'npm test';
      }
      
      if (packageJson.scripts?.['test:all']) {
        return 'npm run test:all';
      }
    }
    
    // Check for test framework files
    if (await fs.pathExists('jest.config.js')) {
      return 'jest';
    }
    
    if (await fs.pathExists('.mocharc.json')) {
      return 'mocha';
    }
    
    if (await fs.pathExists('pytest.ini')) {
      return 'pytest';
    }
    
    if (await fs.pathExists('go.mod')) {
      return 'go test ./...';
    }
    
    if (await fs.pathExists('Cargo.toml')) {
      return 'cargo test';
    }
    
    return null;
  }
  
  /**
   * Runs a command and captures output
   */
  private async runCommand(command: string): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        env: process.env,
        timeout: 300000 // 5 minutes
      });
      
      return {
        command,
        output: stdout + (stderr ? `\n\nSTDERR:\n${stderr}` : ''),
        exitCode: 0,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      
    } catch (error: any) {
      return {
        command,
        output: error.stdout + '\n\nERROR:\n' + error.stderr,
        exitCode: error.code || 1,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Saves test artifacts
   */
  private async saveArtifacts(result: TestResult): Promise<string> {
    const artifactsPath = path.join(
      this.context.basePath,
      'implementation-details',
      'artifacts'
    );
    
    // Ensure directory exists
    await fs.ensureDir(artifactsPath);
    
    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `test-results-${timestamp}.txt`;
    const filepath = path.join(artifactsPath, filename);
    
    // Format content
    const content = [
      '# Test Execution Results',
      '',
      `**Date**: ${result.timestamp}`,
      `**Command**: ${result.command}`,
      `**Duration**: ${result.duration}ms`,
      `**Exit Code**: ${result.exitCode}`,
      '',
      '## Output',
      '',
      '```',
      result.output,
      '```',
      '',
      '## Summary',
      '',
      result.exitCode === 0 ? '✅ Tests passed' : '❌ Tests failed'
    ].join('\n');
    
    // Write file
    await fs.writeFile(filepath, content, 'utf8');
    
    // Update index
    await this.updateArtifactsIndex(filename, result);
    
    return filepath;
  }
  
  /**
   * Updates the artifacts index
   */
  private async updateArtifactsIndex(filename: string, result: TestResult): Promise<void> {
    const indexPath = path.join(
      this.context.basePath,
      'implementation-details',
      'artifacts',
      'INDEX.md'
    );
    
    // Read existing content
    let content = await fs.readFile(indexPath, 'utf8');
    
    // Find the table
    const tableStart = content.indexOf('| File | Description | Date Added |');
    if (tableStart === -1) return;
    
    const tableEnd = content.indexOf('\n\n', tableStart);
    const beforeTable = content.substring(0, tableStart);
    const afterTable = tableEnd === -1 ? '' : content.substring(tableEnd);
    
    // Add new row
    const status = result.exitCode === 0 ? 'Passed' : 'Failed';
    const newRow = `| ${filename} | Test Results - ${status} | ${result.timestamp.split('T')[0]} |`;
    
    // Rebuild content
    const newContent = [
      beforeTable.trim(),
      '| File | Description | Date Added |',
      '|------|-------------|------------|',
      newRow,
      afterTable.trim()
    ].join('\n');
    
    // Write updated index
    await fs.writeFile(indexPath, newContent, 'utf8');
  }
  
  /**
   * Runs specific verification checks
   */
  async runChecks(): Promise<AgentResult> {
    const checks = [
      { name: 'Structure', fn: () => this.checkStructure() },
      { name: 'Dependencies', fn: () => this.checkDependencies() },
      { name: 'Linting', fn: () => this.checkLinting() },
      { name: 'Type checking', fn: () => this.checkTypes() }
    ];
    
    const results: any[] = [];
    
    for (const check of checks) {
      if (!this.jsonOutput) {
        console.log(chalk.blue(`Running ${check.name}...`));
      }
      
      try {
        const result = await check.fn();
        results.push({ name: check.name, ...result });
        
        if (!this.jsonOutput) {
          if (result.success) {
            console.log(chalk.green(`  ✓ ${check.name} passed`));
          } else {
            console.log(chalk.red(`  ✗ ${check.name} failed`));
          }
        }
      } catch (error) {
        if (!this.jsonOutput) {
          console.log(chalk.red(`  ✗ ${check.name} error`));
        }
        results.push({ 
          name: check.name, 
          success: false, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    const allPassed = results.every(r => r.success);
    
    const response = {
      success: allPassed,
      message: allPassed ? 'All checks passed' : 'Some checks failed',
      data: results
    };
    
    if (this.jsonOutput) {
      console.log(JSON.stringify({
        ok: allPassed,
        command: 'checks',
        result: response
      }));
    }
    
    return response;
  }
  
  private async checkStructure(): Promise<any> {
    const validation = this.validate();
    return {
      success: validation.isValid,
      errors: validation.errors.map(e => e.message)
    };
  }
  
  private async checkDependencies(): Promise<any> {
    try {
      await execAsync('npm ls --depth=0');
      return { success: true };
    } catch {
      return { success: false, message: 'Dependency issues detected' };
    }
  }
  
  private async checkLinting(): Promise<any> {
    try {
      await execAsync('npm run lint');
      return { success: true };
    } catch {
      return { success: false, message: 'Linting errors found' };
    }
  }
  
  private async checkTypes(): Promise<any> {
    try {
      await execAsync('npm run type-check');
      return { success: true };
    } catch {
      return { success: false, message: 'Type errors found' };
    }
  }
}