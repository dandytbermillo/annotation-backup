"use strict";
/**
 * Orchestrator Agent - Main coordinator for Context-OS
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
exports.Orchestrator = void 0;
const types_1 = require("../core/types");
const validator_1 = require("../core/validator");
const scaffolder_1 = require("../core/scaffolder");
const plan_filler_1 = require("./plan-filler");
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
class Orchestrator extends types_1.Agent {
    rl;
    scaffolder;
    constructor(context) {
        super(context);
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        this.scaffolder = new scaffolder_1.Scaffolder();
    }
    /**
     * Main execution flow
     */
    async execute() {
        try {
            console.log(chalk_1.default.bold('\n🤖 Context-OS Orchestrator\n'));
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
            return {
                success: true,
                message: 'Feature workspace created successfully',
                data: {
                    path: scaffoldResult.data.path,
                    filesCreated: scaffoldResult.data.filesCreated
                }
            };
        }
        catch (error) {
            return {
                success: false,
                message: 'Orchestrator failed',
                errors: [error instanceof Error ? error.message : String(error)]
            };
        }
        finally {
            this.cleanup();
        }
    }
    /**
     * Validates the feature plan
     */
    validate() {
        if (this.context.skipValidation) {
            this.log('warn', 'Skipping validation (dangerous!)');
            return {
                isValid: true,
                errors: [],
                warnings: [],
                missingFields: []
            };
        }
        return validator_1.Validator.validatePlan(this.context.plan);
    }
    /**
     * Proposes a feature slug
     */
    proposeSlug() {
        if (this.context.plan.slug) {
            const validation = validator_1.Validator.validateSlug(this.context.plan.slug);
            if (validation.isValid) {
                return this.context.plan.slug;
            }
            this.log('warn', 'Provided slug is invalid, generating new one');
        }
        return validator_1.Validator.generateSlug(this.context.plan.title);
    }
    /**
     * Handles validation failures
     */
    async handleValidationFailure(validation) {
        this.log('error', 'Plan validation failed:');
        validation.errors.forEach(error => {
            console.log(chalk_1.default.red(`  ✗ ${error.field}: ${error.message}`));
        });
        if (validation.missingFields.length > 0) {
            const fix = await this.askUser('Would you like to fix these issues interactively? (yes/no): ');
            if (fix.toLowerCase() === 'yes') {
                // Call PlanFillerAgent
                const filler = new plan_filler_1.PlanFillerAgent(this.context);
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
    async getConfirmation() {
        const targetDir = path.join('docs/proposal', this.context.plan.slug);
        console.log(chalk_1.default.bold('\n📋 Action Summary:'));
        console.log(`  • Feature: ${this.context.plan.title}`);
        console.log(`  • Location: ${targetDir}/`);
        console.log(`  • Status: ${this.context.plan.status}`);
        console.log('\nThis will create:');
        console.log('  • Complete directory structure');
        console.log('  • Implementation plan');
        console.log('  • Report templates');
        console.log('  • Fix documentation structure');
        const answer = await this.askUser('\nProceed with creation? (yes/no): ');
        return answer.toLowerCase() === 'yes';
    }
    /**
     * Scaffolds the feature structure
     */
    async scaffold() {
        try {
            const targetDir = path.join('docs/proposal', this.context.plan.slug);
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
        }
        catch (error) {
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
    askUser(question) {
        return new Promise(resolve => {
            this.rl.question(question, resolve);
        });
    }
    /**
     * Logging helper
     */
    log(level, message) {
        if (!this.context.verbose && level === 'info')
            return;
        const prefix = {
            info: chalk_1.default.blue('→'),
            warn: chalk_1.default.yellow('⚠'),
            error: chalk_1.default.red('✗'),
            success: chalk_1.default.green('✓')
        };
        console.log(`${prefix[level]} ${message}`);
    }
    /**
     * Cleanup resources
     */
    cleanup() {
        this.rl.close();
    }
    /**
     * Checks if we can proceed with an operation
     */
    checkStopConditions() {
        const stops = [];
        // Check if trying to modify completed feature
        if (this.context.plan.status === types_1.Status.COMPLETE) {
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
exports.Orchestrator = Orchestrator;
//# sourceMappingURL=orchestrator.js.map