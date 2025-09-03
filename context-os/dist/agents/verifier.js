"use strict";
/**
 * VerifierAgent - Handles test execution and artifact collection
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
exports.VerifierAgent = void 0;
const types_1 = require("../core/types");
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class VerifierAgent extends types_1.Agent {
    allowedCommands = [
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
    async execute(command) {
        try {
            console.log(chalk_1.default.bold('🧪 Verification Agent\n'));
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
            console.log(chalk_1.default.blue(`Running: ${testCommand}`));
            // Execute command
            const result = await this.runCommand(testCommand);
            // Save artifacts
            const artifactPath = await this.saveArtifacts(result);
            // Update status based on result
            if (result.exitCode === 0) {
                console.log(chalk_1.default.green('✓ Tests passed'));
                return {
                    success: true,
                    message: 'Verification successful',
                    data: {
                        result,
                        artifactPath
                    }
                };
            }
            else {
                console.log(chalk_1.default.red('✗ Tests failed'));
                return {
                    success: false,
                    message: 'Verification failed',
                    data: {
                        result,
                        artifactPath
                    }
                };
            }
        }
        catch (error) {
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
    validate() {
        const errors = [];
        // Check if artifacts directory exists
        const artifactsPath = path.join(this.context.basePath, 'implementation-details', 'artifacts');
        if (!fs.existsSync(artifactsPath)) {
            errors.push({
                field: 'structure',
                message: 'Artifacts directory not found',
                severity: 'error'
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
    isCommandSafe(command) {
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
    async detectTestCommand() {
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
    async runCommand(command) {
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
        }
        catch (error) {
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
    async saveArtifacts(result) {
        const artifactsPath = path.join(this.context.basePath, 'implementation-details', 'artifacts');
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
    async updateArtifactsIndex(filename, result) {
        const indexPath = path.join(this.context.basePath, 'implementation-details', 'artifacts', 'INDEX.md');
        // Read existing content
        let content = await fs.readFile(indexPath, 'utf8');
        // Find the table
        const tableStart = content.indexOf('| File | Description | Date Added |');
        if (tableStart === -1)
            return;
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
    async runChecks() {
        const checks = [
            { name: 'Structure', fn: () => this.checkStructure() },
            { name: 'Dependencies', fn: () => this.checkDependencies() },
            { name: 'Linting', fn: () => this.checkLinting() },
            { name: 'Type checking', fn: () => this.checkTypes() }
        ];
        const results = [];
        for (const check of checks) {
            console.log(chalk_1.default.blue(`Running ${check.name}...`));
            try {
                const result = await check.fn();
                results.push({ name: check.name, ...result });
                if (result.success) {
                    console.log(chalk_1.default.green(`  ✓ ${check.name} passed`));
                }
                else {
                    console.log(chalk_1.default.red(`  ✗ ${check.name} failed`));
                }
            }
            catch (error) {
                console.log(chalk_1.default.red(`  ✗ ${check.name} error`));
                results.push({
                    name: check.name,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        const allPassed = results.every(r => r.success);
        return {
            success: allPassed,
            message: allPassed ? 'All checks passed' : 'Some checks failed',
            data: results
        };
    }
    async checkStructure() {
        const validation = this.validate();
        return {
            success: validation.isValid,
            errors: validation.errors.map(e => e.message)
        };
    }
    async checkDependencies() {
        try {
            await execAsync('npm ls --depth=0');
            return { success: true };
        }
        catch {
            return { success: false, message: 'Dependency issues detected' };
        }
    }
    async checkLinting() {
        try {
            await execAsync('npm run lint');
            return { success: true };
        }
        catch {
            return { success: false, message: 'Linting errors found' };
        }
    }
    async checkTypes() {
        try {
            await execAsync('npm run type-check');
            return { success: true };
        }
        catch {
            return { success: false, message: 'Type errors found' };
        }
    }
}
exports.VerifierAgent = VerifierAgent;
//# sourceMappingURL=verifier.js.map