/**
 * PlanFillerAgent - Assists in completing missing fields in implementation plans
 */

import { Agent, AgentContext, AgentResult, ValidationResult } from '../core/types';
import { Validator } from '../core/validator';
import * as readline from 'readline';
import chalk from 'chalk';

export class PlanFillerAgent extends Agent {
  private rl: readline.Interface;
  
  constructor(context: AgentContext) {
    super(context);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  
  /**
   * Fills missing fields in the plan interactively
   */
  async execute(): Promise<AgentResult> {
    try {
      console.log(chalk.bold('\n📝 Plan Completion Assistant\n'));
      console.log('I\'ll help you fill in the missing information.\n');
      
      const validation = this.validate();
      
      if (validation.isValid) {
        return {
          success: true,
          message: 'Plan is already complete'
        };
      }
      
      // Fill missing fields
      for (const field of validation.missingFields) {
        await this.fillField(field);
      }
      
      // Re-validate
      const finalValidation = this.validate();
      
      if (finalValidation.isValid) {
        console.log(chalk.green('\n✓ Plan completed successfully!'));
        return {
          success: true,
          message: 'Plan completed',
          data: this.context.plan
        };
      } else {
        return {
          success: false,
          message: 'Some fields still need attention',
          errors: finalValidation.errors.map(e => e.message)
        };
      }
      
    } catch (error) {
      return {
        success: false,
        message: 'Failed to complete plan',
        errors: [error instanceof Error ? error.message : String(error)]
      };
    } finally {
      this.cleanup();
    }
  }
  
  /**
   * Validates the current plan
   */
  validate(): ValidationResult {
    return Validator.validatePlan(this.context.plan);
  }
  
  /**
   * Fills a specific field
   */
  private async fillField(field: string): Promise<void> {
    console.log(chalk.blue(`\n${this.getFieldPrompt(field)}`));
    
    switch (field) {
      case 'title':
        this.context.plan.title = await this.askSingleLine('Title: ');
        break;
        
      case 'objective':
        console.log('What is the main goal of this feature? (1-2 sentences)');
        this.context.plan.objective = await this.askMultiLine();
        break;
        
      case 'acceptanceCriteria':
        console.log('Enter acceptance criteria (measurable success conditions)');
        console.log('One per line, empty line to finish:');
        this.context.plan.acceptanceCriteria = await this.askList();
        break;
        
      case 'implementationTasks':
        console.log('Enter implementation tasks (specific actions to take)');
        console.log('One per line, empty line to finish:');
        this.context.plan.implementationTasks = await this.askList();
        break;
        
      case 'author':
        this.context.plan.author = await this.askSingleLine('Author name: ');
        break;
        
      case 'status':
        this.context.plan.status = await this.askStatus();
        break;
        
      default:
        console.log(chalk.yellow(`Skipping unknown field: ${field}`));
    }
  }
  
  /**
   * Gets prompt text for a field
   */
  private getFieldPrompt(field: string): string {
    const prompts: Record<string, string> = {
      'title': '📌 Feature Title',
      'objective': '🎯 Objective',
      'acceptanceCriteria': '✅ Acceptance Criteria',
      'implementationTasks': '📋 Implementation Tasks',
      'author': '👤 Author',
      'status': '📊 Status'
    };
    
    return prompts[field] || field;
  }
  
  /**
   * Asks for a single line input
   */
  private askSingleLine(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  }
  
  /**
   * Asks for multi-line input
   */
  private async askMultiLine(): Promise<string> {
    const lines: string[] = [];
    console.log('(Press Enter twice to finish)');
    
    let emptyCount = 0;
    while (emptyCount < 2) {
      const line = await this.askSingleLine('> ');
      if (line === '') {
        emptyCount++;
      } else {
        emptyCount = 0;
        lines.push(line);
      }
    }
    
    return lines.join(' ');
  }
  
  /**
   * Asks for a list of items
   */
  private async askList(): Promise<string[]> {
    const items: string[] = [];
    let count = 1;
    
    while (true) {
      const item = await this.askSingleLine(`  ${count}. `);
      if (item === '') {
        if (items.length === 0) {
          console.log(chalk.yellow('At least one item is required'));
          continue;
        }
        break;
      }
      items.push(item);
      count++;
    }
    
    return items;
  }
  
  /**
   * Asks for status selection
   */
  private async askStatus(): Promise<any> {
    const statuses = [
      '1. 📝 PLANNED - Not started',
      '2. 🚧 IN_PROGRESS - Active development',
      '3. 🧪 TESTING - Running tests',
      '4. ✅ COMPLETE - Implementation done',
      '5. ❌ BLOCKED - Needs help'
    ];
    
    console.log('\nSelect status:');
    statuses.forEach(s => console.log(`  ${s}`));
    
    while (true) {
      const choice = await this.askSingleLine('Choice (1-5): ');
      const num = parseInt(choice);
      
      if (num >= 1 && num <= 5) {
        const statusMap = ['PLANNED', 'IN_PROGRESS', 'TESTING', 'COMPLETE', 'BLOCKED'];
        return statusMap[num - 1];
      }
      
      console.log(chalk.red('Please enter a number between 1 and 5'));
    }
  }
  
  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.rl.close();
  }
  
  /**
   * Provides suggestions for common fields
   */
  getSuggestions(field: string): string[] {
    const suggestions: Record<string, string[]> = {
      'acceptanceCriteria': [
        'Feature works as expected in production',
        'All tests pass',
        'Performance meets requirements',
        'Documentation is complete',
        'No security vulnerabilities'
      ],
      'implementationTasks': [
        'Design the architecture',
        'Implement core functionality',
        'Write unit tests',
        'Write integration tests',
        'Update documentation',
        'Review and refactor'
      ],
      'successMetrics': [
        'Response time < 200ms',
        'Error rate < 0.1%',
        'User satisfaction > 4.5/5',
        'Code coverage > 80%',
        'Zero critical bugs'
      ]
    };
    
    return suggestions[field] || [];
  }
}