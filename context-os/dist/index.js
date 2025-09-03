#!/usr/bin/env node
"use strict";
/**
 * Context-OS - Main entry point
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
const commander_1 = require("commander");
const orchestrator_1 = require("./agents/orchestrator");
const verifier_1 = require("./agents/verifier");
const validator_1 = require("./core/validator");
const types_1 = require("./core/types");
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const program = new commander_1.Command();
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
    .action(async (description, options) => {
    try {
        console.log(chalk_1.default.bold('🚀 Context-OS Feature Creator\n'));
        // Load or create plan
        const plan = await loadPlan(description, options.draft, options.slug);
        // Create context
        const context = {
            plan,
            basePath: 'docs/proposal',
            verbose: options.verbose || false,
            skipValidation: options.skipValidation || false
        };
        // Run orchestrator
        const orchestrator = new orchestrator_1.Orchestrator(context);
        const result = await orchestrator.execute();
        if (result.success) {
            console.log(chalk_1.default.green('\n✅ Success!'));
            console.log(`Feature created at: ${result.data.path}`);
            console.log(`Files created: ${result.data.filesCreated}`);
            // Show next steps
            console.log(chalk_1.default.bold('\n📋 Next Steps:'));
            console.log(`1. cd ${result.data.path}`);
            console.log('2. Review implementation.md');
            console.log('3. Update status to IN_PROGRESS when starting');
            console.log('4. Run validate-doc-structure.sh to verify compliance');
        }
        else {
            console.error(chalk_1.default.red('\n❌ Failed:'), result.message);
            if (result.errors) {
                result.errors.forEach(err => console.error(chalk_1.default.red(`  - ${err}`)));
            }
            process.exit(1);
        }
    }
    catch (error) {
        console.error(chalk_1.default.red('Error:'), error);
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
    .action(async (featurePath, options) => {
    try {
        console.log(chalk_1.default.bold('🔍 Validating Feature Structure\n'));
        const fullPath = path.resolve(featurePath);
        // Check if path exists
        if (!await fs.pathExists(fullPath)) {
            console.error(chalk_1.default.red(`Path not found: ${fullPath}`));
            process.exit(1);
        }
        // Validate structure
        const result = validator_1.Validator.validateStructure(fullPath);
        if (result.isValid) {
            console.log(chalk_1.default.green('✅ Structure is compliant!'));
        }
        else {
            console.log(chalk_1.default.red('❌ Structure has errors:'));
            result.errors.forEach(err => {
                console.log(chalk_1.default.red(`  ✗ ${err.message}`));
            });
        }
        if (result.warnings.length > 0 && options.verbose) {
            console.log(chalk_1.default.yellow('\n⚠ Warnings:'));
            result.warnings.forEach(warn => {
                console.log(chalk_1.default.yellow(`  - ${warn}`));
            });
        }
        process.exit(result.isValid ? 0 : 1);
    }
    catch (error) {
        console.error(chalk_1.default.red('Error:'), error);
        process.exit(1);
    }
});
/**
 * Status command - check feature status
 */
program
    .command('status [feature]')
    .description('Check feature status')
    .action(async (feature) => {
    try {
        console.log(chalk_1.default.bold('📊 Feature Status\n'));
        const basePath = 'docs/proposal';
        if (feature) {
            // Check specific feature
            const featurePath = path.join(basePath, feature);
            const planPath = path.join(featurePath, 'implementation.md');
            if (!await fs.pathExists(planPath)) {
                console.error(chalk_1.default.red(`Feature not found: ${feature}`));
                process.exit(1);
            }
            const content = await fs.readFile(planPath, 'utf8');
            const statusMatch = content.match(/\*\*Status\*\*:\s*([^\n]+)/);
            if (statusMatch) {
                console.log(`${feature}: ${statusMatch[1]}`);
            }
            else {
                console.log(`${feature}: Status unknown`);
            }
        }
        else {
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
    }
    catch (error) {
        console.error(chalk_1.default.red('Error:'), error);
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
    .action(async (feature, options) => {
    try {
        console.log(chalk_1.default.bold('🧪 Running Verification\n'));
        // Load feature plan
        const planPath = path.join('docs/proposal', feature, 'implementation.md');
        if (!await fs.pathExists(planPath)) {
            console.error(chalk_1.default.red(`Feature not found: ${feature}`));
            process.exit(1);
        }
        const planContent = await fs.readFile(planPath, 'utf8');
        const plan = parsePlanFromMarkdown(planContent);
        // Create context
        const context = {
            plan,
            basePath: path.join('docs/proposal', feature),
            verbose: true
        };
        // Run verifier
        const verifier = new verifier_1.VerifierAgent(context);
        const result = await verifier.execute(options.command);
        if (result.success) {
            console.log(chalk_1.default.green('\n✅ Verification complete'));
            console.log(`Results saved to: ${result.data.artifactPath}`);
        }
        else {
            console.error(chalk_1.default.red('\n❌ Verification failed:'), result.message);
            process.exit(1);
        }
    }
    catch (error) {
        console.error(chalk_1.default.red('Error:'), error);
        process.exit(1);
    }
});
// Helper functions
/**
 * Loads or creates a feature plan
 */
async function loadPlan(description, draftPath, slug) {
    // If draft path provided, try to load it
    if (draftPath && await fs.pathExists(draftPath)) {
        console.log(chalk_1.default.blue(`Loading draft from: ${draftPath}`));
        const content = await fs.readFile(draftPath, 'utf8');
        return parsePlanFromMarkdown(content);
    }
    // Create minimal plan
    const date = new Date().toISOString().split('T')[0];
    const generatedSlug = slug || validator_1.Validator.generateSlug(description);
    return {
        title: description,
        slug: generatedSlug,
        date,
        status: types_1.Status.PLANNED,
        objective: '[TO BE FILLED]',
        acceptanceCriteria: [],
        implementationTasks: []
    };
}
/**
 * Parses a plan from markdown content
 */
function parsePlanFromMarkdown(content) {
    const lines = content.split('\n');
    const plan = {
        acceptanceCriteria: [],
        implementationTasks: []
    };
    let currentSection = '';
    for (const line of lines) {
        // Parse metadata
        if (line.startsWith('# ')) {
            plan.title = line.substring(2).trim();
        }
        else if (line.includes('**Feature Slug**:')) {
            plan.slug = line.split(':')[1].trim();
        }
        else if (line.includes('**Date**:')) {
            plan.date = line.split(':')[1].trim();
        }
        else if (line.includes('**Status**:')) {
            const statusText = line.split(':')[1].trim();
            // Extract status from emoji + text format
            const statusMatch = statusText.match(/(PLANNED|IN_PROGRESS|TESTING|COMPLETE|BLOCKED|ROLLBACK)/);
            if (statusMatch) {
                plan.status = statusMatch[1];
            }
        }
        else if (line.includes('**Author**:')) {
            plan.author = line.split(':')[1].trim();
        }
        // Track sections
        if (line.startsWith('## ')) {
            currentSection = line.substring(3).trim().toLowerCase();
        }
        // Parse content based on section
        if (currentSection === 'objective' && !line.startsWith('#') && line.trim()) {
            if (!plan.objective)
                plan.objective = '';
            plan.objective += line.trim() + ' ';
        }
        else if (currentSection === 'acceptance criteria' && line.startsWith('- ')) {
            plan.acceptanceCriteria.push(line.substring(2).replace(/^\[.\]\s*/, '').trim());
        }
        else if (currentSection === 'implementation tasks' && line.startsWith('- ')) {
            plan.implementationTasks.push(line.substring(2).replace(/^\[.\]\s*/, '').trim());
        }
    }
    // Clean up objective
    if (plan.objective) {
        plan.objective = plan.objective.trim();
    }
    // Set defaults
    if (!plan.status)
        plan.status = types_1.Status.PLANNED;
    if (!plan.title)
        plan.title = 'Untitled Feature';
    if (!plan.objective)
        plan.objective = '';
    return plan;
}
// Parse arguments
program.parse(process.argv);
// Show help if no command provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
//# sourceMappingURL=index.js.map