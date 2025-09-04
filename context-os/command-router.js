#!/usr/bin/env node

/**
 * Context-OS Command Router v2.0
 * Now routes through Bridge for hybrid Claude-Context-OS execution
 * 
 * Usage:
 * /execute "Feature name" --plan "Description"
 * /fix --feature "slug" --issue "Description" --severity HIGH
 * /validate --feature "slug" --strict
 */

const { ContextOSClaudeBridge } = require('./bridge/bridge-enhanced');
const fs = require('fs');
const path = require('path');

class CommandRouter {
  constructor() {
    // Initialize the bridge
    this.bridge = new ContextOSClaudeBridge({
      budget: {
        maxTokensPerCall: 4000,
        maxToolsPerCall: 3,
        maxParallelCalls: 2,
        maxRetries: 2,
        timeoutMs: 30000
      },
      telemetryPath: 'context-os/telemetry'
    });
    
    this.commands = {
      execute: this.handleExecute.bind(this),
      fix: this.handleFix.bind(this),
      validate: this.handleValidate.bind(this),
      status: this.handleStatus.bind(this),
      analyze: this.handleAnalyze.bind(this),  // NEW: Claude-only command
      help: this.handleHelp.bind(this)
    };
  }
  
  /**
   * Parse command line arguments into structured format
   */
  parseCommand(args) {
    if (args.length === 0) {
      return { command: 'help', options: {} };
    }
    
    // First arg should be the command (without slash)
    const command = args[0].replace(/^\//, '').toLowerCase();
    
    const options = {};
    let currentKey = null;
    
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      
      if (arg.startsWith('--')) {
        currentKey = arg.slice(2);
        options[currentKey] = true; // Default to boolean flag
      } else if (currentKey) {
        // If current key exists, this is its value
        options[currentKey] = arg;
        currentKey = null;
      } else {
        // Positional argument - first one is the main parameter
        if (!options._main) {
          options._main = arg;
        }
      }
    }
    
    return { command, options };
  }
  
  /**
   * Handle /execute command (Context-OS only through bridge)
   */
  async handleExecute(options) {
    const feature = options._main || options.feature || 'New Feature';
    const plan = options.plan || null;
    
    // Construct command for bridge
    const command = `/execute "${feature}"${plan ? ` --plan ${plan}` : ''}`;
    
    console.log('🚀 Executing feature creation through bridge...\n');
    console.log(`Feature: ${feature}`);
    if (plan) {
      console.log(`Plan: ${plan}`);
    }
    console.log('');
    
    try {
      // Execute through bridge (Context-OS only)
      const result = await this.bridge.execute(command);
      
      if (result.status === 'ok') {
        this.renderExecuteSuccess(result);
      } else {
        this.renderError(result.summary || result.error);
      }
      
      return result;
      
    } catch (error) {
      this.renderError(error.message);
      return { status: 'error', error: error.message };
    }
  }
  
  /**
   * Handle /analyze command (Claude-only through bridge)
   */
  async handleAnalyze(options) {
    const feature = options._main || options.feature;
    
    if (!feature) {
      this.renderError('Missing feature to analyze');
      return { status: 'error', error: 'Missing feature parameter' };
    }
    
    const command = `/analyze "${feature}"`;
    
    console.log('🔍 Analyzing feature through Claude...\n');
    console.log(`Feature: ${feature}`);
    console.log('Mode: Claude-only (using mock adapter)\n');
    
    try {
      // Execute through bridge (Claude only)
      const result = await this.bridge.execute(command);
      
      if (result.status === 'ok') {
        this.renderAnalysisResults(result);
      } else {
        this.renderError(result.summary || result.error);
      }
      
      return result;
      
    } catch (error) {
      this.renderError(error.message);
      return { status: 'error', error: error.message };
    }
  }
  
  /**
   * Handle /fix command (Hybrid: Claude + Context-OS through bridge)
   */
  async handleFix(options) {
    const feature = options.feature || options._main;
    const issue = options.issue || options.description || 'Issue needs investigation';
    
    if (!feature) {
      this.renderError('Missing required parameter: --feature <slug>');
      return { status: 'error', error: 'Missing feature parameter' };
    }
    
    // SAFETY: Default to dry-run unless --apply is specified
    const isDryRun = !options.apply;
    
    // Construct command for bridge
    let command = `/fix --feature "${feature}" --issue "${issue}"`;
    if (options.severity) command += ` --severity ${options.severity}`;
    if (options.perf) command += ` --perf ${options.perf}`;
    if (options.users) command += ` --users ${options.users}`;
    if (isDryRun) command += ' --dry-run';
    
    console.log('🔧 Creating fix through bridge (Hybrid: Claude + Context-OS)...\n');
    console.log(`Feature: ${feature}`);
    console.log(`Issue: ${issue}`);
    console.log(`Mode: ${isDryRun ? '🔒 DRY RUN (use --apply to write)' : '✅ APPLY MODE'}`);
    console.log('');
    
    try {
      // Execute through bridge (Hybrid)
      const result = await this.bridge.execute(command);
      
      if (result.status === 'ok' || result.status === 'degraded') {
        this.renderFixSuccess(result, isDryRun);
        
        // Show patch for review if in dry-run
        if (isDryRun && result.artifacts?.patch) {
          console.log('\n📄 Review patch before applying:');
          console.log(`  Patch file: ${result.artifacts.patch}`);
          console.log('  To apply: Add --apply flag');
        }
      } else {
        this.renderError(result.summary || result.error);
      }
      
      return result;
      
    } catch (error) {
      this.renderError(error.message);
      return { status: 'error', error: error.message };
    }
  }
  
  /**
   * Handle /validate command
   */
  async handleValidate(options) {
    const input = {
      feature: options.feature || options._main || null,
      strict: options.strict || false,
      all: options.all || false
    };
    
    console.log('📋 Running validation...\n');
    if (input.feature) {
      console.log(`Feature: ${input.feature}`);
    } else {
      console.log('Scope: All features');
    }
    if (input.strict) {
      console.log('Mode: STRICT (warnings = errors)');
    }
    console.log('');
    
    try {
      const result = execSync(
        `echo '${JSON.stringify(input)}' | npm run context:validate --silent`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] }
      );
      
      const output = JSON.parse(result);
      
      if (output.ok) {
        this.renderValidationResults(output.result);
      } else {
        this.renderError(output.error);
      }
      
      return output;
      
    } catch (error) {
      // Validation returns non-zero on failure, but still has results
      try {
        const output = JSON.parse(error.stdout);
        if (output.result) {
          this.renderValidationResults(output.result);
        }
        return output;
      } catch {
        this.renderError(error.message);
        return { ok: false, error: error.message };
      }
    }
  }
  
  /**
   * Handle /status command
   */
  async handleStatus(options) {
    const feature = options.feature || options._main;
    
    console.log('📊 Feature Status\n');
    
    try {
      let command = 'npm run context:status --silent -- list';
      if (feature) {
        command = `npm run context:status --silent -- check ../docs/proposal/${feature}`;
      }
      
      const result = execSync(command, { encoding: 'utf8' });
      console.log(result);
      
      return { ok: true, result };
      
    } catch (error) {
      this.renderError(error.message);
      return { ok: false, error: error.message };
    }
  }
  
  /**
   * Handle /help command
   */
  handleHelp() {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    Context-OS Commands                        ║
╚═══════════════════════════════════════════════════════════════╝

📝 /execute - Create and scaffold a new feature
   Usage: /execute "Feature name" [options]
   Options:
     --plan <path>    Path to draft plan
     --slug <slug>    Pre-select feature slug
   
   Example: /execute "Add dark mode" --plan context-os/drafts/dark-mode.md

🔧 /fix - Create a post-implementation fix
   Usage: /fix --feature <slug> --issue "Description" [options]
   Options:
     --severity CRITICAL|HIGH|MEDIUM|LOW
     --perf <0-100>   Performance degradation %
     --users <0-100>  Users affected %
     --env <env>      Environment (prod/staging/dev)
     --dry-run        Preview without creating
   
   Example: /fix --feature dark_mode --issue "Toggle not saving" --severity HIGH

✅ /validate - Check documentation compliance
   Usage: /validate [feature] [options]
   Options:
     --strict         Treat warnings as errors
     --all            Validate all features
   
   Example: /validate dark_mode --strict

📊 /status - Check feature status
   Usage: /status [feature]
   
   Example: /status dark_mode

═══════════════════════════════════════════════════════════════
Pro tips:
• Draft plans go in: context-os/drafts/
• Features created in: docs/proposal/<slug>/
• Use /validate after changes to ensure compliance
• Run /fix for any post-implementation issues
    `);
    
    return { ok: true, command: 'help' };
  }
  
  // Render methods for nice output
  
  renderAnalysisResults(result) {
    console.log('✅ Analysis Complete\n');
    
    if (result.findings && result.findings.length > 0) {
      console.log('📊 Findings:');
      result.findings.forEach((finding, i) => {
        console.log(`  ${i + 1}. ${finding}`);
      });
    }
    
    if (result.recommendations && result.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      result.recommendations.forEach(rec => {
        console.log(`  • ${rec}`);
      });
    }
    
    if (result.confidence) {
      console.log(`\n📈 Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    }
    
    if (result.metadata) {
      console.log('\n📊 Metrics:');
      console.log(`  Tokens used: ${result.metadata.tokensUsed || 'N/A'}`);
      console.log(`  Duration: ${result.metadata.duration || 'N/A'}ms`);
    }
  }
  
  renderExecuteSuccess(result) {
    console.log('✅ Feature workspace created successfully!\n');
    
    if (result.slug) {
      console.log(`📁 Location: docs/proposal/${result.slug}/`);
    }
    
    if (result.created && result.created.length > 0) {
      console.log('\n📄 Created files:');
      result.created.slice(0, 5).forEach(file => {
        console.log(`  • ${file}`);
      });
      if (result.created.length > 5) {
        console.log(`  ... and ${result.created.length - 5} more`);
      }
    }
    
    if (result.validation) {
      console.log('\n📋 Validation:');
      if (result.validation.passed) {
        console.log('  ✅ Structure validation passed');
      } else {
        console.log(`  ⚠️  ${result.validation.errors} errors, ${result.validation.warnings} warnings`);
      }
    }
    
    console.log('\n🚀 Next steps:');
    console.log(`  1. cd docs/proposal/${result.slug}`);
    console.log('  2. Review implementation.md');
    console.log('  3. Update status to IN PROGRESS when starting');
  }
  
  renderFixSuccess(result) {
    if (result.dryRun) {
      console.log('🔍 Dry Run Results\n');
    } else {
      console.log('✅ Fix created successfully!\n');
    }
    
    if (result.classification) {
      const c = result.classification;
      console.log('📊 Classification:');
      console.log(`  Severity: ${c.icon} ${c.severity}`);
      console.log(`  Type: ${c.type}`);
      console.log(`  SLA: ${c.sla}`);
      console.log(`  Workflow: ${c.workflow}`);
      
      if (c.recommendations && c.recommendations.length > 0) {
        console.log('\n💡 Recommendations:');
        c.recommendations.forEach(r => console.log(`  ${r}`));
      }
    }
    
    if (result.fixPath) {
      console.log(`\n📄 Fix document: ${result.fixPath}`);
    }
    
    if (!result.dryRun && result.created) {
      console.log('\n🚀 Next steps:');
      console.log('  1. Edit the fix document with details');
      console.log('  2. Update status checkboxes as you progress');
      console.log('  3. Run /validate to ensure compliance');
    }
  }
  
  renderValidationResults(result) {
    if (result.passed) {
      console.log('✅ Validation PASSED\n');
    } else {
      console.log(`❌ Validation FAILED\n`);
      console.log(`  Errors: ${result.totalErrors}`);
      console.log(`  Warnings: ${result.totalWarnings}`);
    }
    
    if (result.features && result.features.length > 0) {
      result.features.forEach(feature => {
        if (feature.errors.length > 0 || feature.warnings.length > 0) {
          console.log(`\n📁 ${feature.name}:`);
          
          if (feature.errors.length > 0) {
            console.log('  Errors:');
            feature.errors.slice(0, 3).forEach(e => {
              console.log(`    ✗ ${e}`);
            });
            if (feature.errors.length > 3) {
              console.log(`    ... and ${feature.errors.length - 3} more`);
            }
          }
          
          if (feature.warnings.length > 0) {
            console.log('  Warnings:');
            feature.warnings.slice(0, 3).forEach(w => {
              console.log(`    ⚠ ${w}`);
            });
            if (feature.warnings.length > 3) {
              console.log(`    ... and ${feature.warnings.length - 3} more`);
            }
          }
        }
      });
    }
    
    if (!result.passed) {
      console.log('\n💡 To fix issues, run:');
      console.log('  /fix --feature <slug> --issue "Validation errors"');
    }
  }
  
  renderError(message) {
    console.log(`❌ Error: ${message}\n`);
    console.log('Run /help for usage information');
  }
  
  /**
   * Main execution
   */
  async execute(args) {
    const { command, options } = this.parseCommand(args);
    
    if (this.commands[command]) {
      return await this.commands[command](options);
    } else {
      console.log(`Unknown command: ${command}`);
      return this.handleHelp();
    }
  }
}

// Main CLI execution
if (require.main === module) {
  const router = new CommandRouter();
  const args = process.argv.slice(2);
  
  router.execute(args).then(result => {
    process.exit(result && result.ok ? 0 : 1);
  });
}

module.exports = CommandRouter;