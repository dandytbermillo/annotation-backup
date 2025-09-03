"use strict";
/**
 * PlanFillerAgent - Assists in completing missing fields in implementation plans
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanFillerAgent = void 0;
const types_1 = require("../core/types");
const validator_1 = require("../core/validator");
const readline = __importStar(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
class PlanFillerAgent extends types_1.Agent {
    rl;
    constructor(context) {
        super(context);
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }
    /**
     * Fills missing fields in the plan interactively
     */
    async execute() {
        try {
            console.log(chalk_1.default.bold('\n📝 Plan Completion Assistant\n'));
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
                console.log(chalk_1.default.green('\n✓ Plan completed successfully!'));
                return {
                    success: true,
                    message: 'Plan completed',
                    data: this.context.plan
                };
            }
            else {
                return {
                    success: false,
                    message: 'Some fields still need attention',
                    errors: finalValidation.errors.map(e => e.message)
                };
            }
        }
        catch (error) {
            return {
                success: false,
                message: 'Failed to complete plan',
                errors: [error instanceof Error ? error.message : String(error)]
            };
        }
        finally {
            this.cleanup();
        }
    }
    /**
     * Validates the current plan
     */
    validate() {
        return validator_1.Validator.validatePlan(this.context.plan);
    }
    /**
     * Fills a specific field
     */
    async fillField(field) {
        console.log(chalk_1.default.blue(`\n${this.getFieldPrompt(field)}`));
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
                console.log(chalk_1.default.yellow(`Skipping unknown field: ${field}`));
        }
    }
    /**
     * Gets prompt text for a field
     */
    getFieldPrompt(field) {
        const prompts = {
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
    askSingleLine(prompt) {
        return new Promise((resolve) => {
            this.rl.question(prompt, (answer) => {
                resolve(answer.trim());
            });
        });
    }
    /**
     * Asks for multi-line input
     */
    async askMultiLine() {
        const lines = [];
        console.log('(Press Enter twice to finish)');
        let emptyCount = 0;
        while (emptyCount < 2) {
            const line = await this.askSingleLine('> ');
            if (line === '') {
                emptyCount++;
            }
            else {
                emptyCount = 0;
                lines.push(line);
            }
        }
        return lines.join(' ');
    }
    /**
     * Asks for a list of items
     */
    async askList() {
        const items = [];
        let count = 1;
        while (true) {
            const item = await this.askSingleLine(`  ${count}. `);
            if (item === '') {
                if (items.length === 0) {
                    console.log(chalk_1.default.yellow('At least one item is required'));
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
    async askStatus() {
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
            console.log(chalk_1.default.red('Please enter a number between 1 and 5'));
        }
    }
    /**
     * Cleanup resources
     */
    cleanup() {
        this.rl.close();
    }
    /**
     * Provides suggestions for common fields
     */
    getSuggestions(field) {
        const suggestions = {
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
exports.PlanFillerAgent = PlanFillerAgent;
//# sourceMappingURL=plan-filler.js.map