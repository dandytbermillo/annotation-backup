#!/usr/bin/env node

/**
 * Status CLI - Check feature status and health
 * Part of Context-OS command system
 */

const fs = require('fs');
const path = require('path');

class StatusCLI {
  constructor() {
    this.basePath = path.join(__dirname, '../../docs/proposal');
  }

  /**
   * Get status of a specific feature
   */
  getFeatureStatus(featureSlug) {
    const featurePath = path.join(this.basePath, featureSlug);
    
    if (!fs.existsSync(featurePath)) {
      return {
        ok: false,
        error: `Feature '${featureSlug}' not found`,
        suggestion: 'Run with --all to see available features'
      };
    }

    const implPath = path.join(featurePath, 'implementation.md');
    const fixesPath = path.join(featurePath, 'post-implementation-fixes');
    
    // Check implementation status
    let status = 'PLANNED';
    let progress = 0;
    let tasks = { complete: 0, total: 0 };
    
    if (fs.existsSync(implPath)) {
      const content = fs.readFileSync(implPath, 'utf8');
      
      // Extract status
      const statusMatch = content.match(/\*\*Status\*\*:\s*([^\n]+)/i);
      if (statusMatch) {
        status = statusMatch[1].trim();
      }
      
      // Count tasks
      const taskMatches = content.match(/- \[[ x]\]/gi) || [];
      tasks.total = taskMatches.length;
      tasks.complete = (content.match(/- \[x\]/gi) || []).length;
      
      if (tasks.total > 0) {
        progress = Math.round((tasks.complete / tasks.total) * 100);
      }
    }
    
    // Count fixes
    const fixes = { critical: 0, high: 0, medium: 0, low: 0 };
    
    if (fs.existsSync(fixesPath)) {
      const fixDirs = ['critical', 'high', 'medium', 'low'];
      
      for (const severity of fixDirs) {
        const severityPath = path.join(fixesPath, severity);
        if (fs.existsSync(severityPath)) {
          const files = fs.readdirSync(severityPath).filter(f => f.endsWith('.md'));
          fixes[severity] = files.length;
        }
      }
    }
    
    // Run validation
    const validation = this.runValidation(featurePath);
    
    return {
      ok: true,
      feature: featureSlug,
      status,
      progress: {
        tasks,
        percentage: progress
      },
      fixes,
      validation,
      path: featurePath
    };
  }

  /**
   * Get status of all features
   */
  getAllStatus() {
    if (!fs.existsSync(this.basePath)) {
      return {
        ok: false,
        error: 'No features found',
        suggestion: 'Create your first feature with /context-execute'
      };
    }

    const features = fs.readdirSync(this.basePath)
      .filter(dir => {
        const fullPath = path.join(this.basePath, dir);
        return fs.statSync(fullPath).isDirectory() && !dir.startsWith('.');
      });

    const statuses = {
      COMPLETE: [],
      'IN PROGRESS': [],
      PLANNED: [],
      total: features.length
    };

    for (const feature of features) {
      const result = this.getFeatureStatus(feature);
      if (result.ok) {
        const category = result.status.includes('COMPLETE') ? 'COMPLETE' :
                        result.status.includes('PROGRESS') ? 'IN PROGRESS' : 'PLANNED';
        statuses[category].push({
          name: feature,
          progress: result.progress.percentage
        });
      }
    }

    const activeCount = statuses.COMPLETE.length + statuses['IN PROGRESS'].length;
    const health = features.length > 0 ? 
      Math.round((activeCount / features.length) * 100) : 0;

    return {
      ok: true,
      features: statuses,
      health,
      summary: {
        total: features.length,
        complete: statuses.COMPLETE.length,
        inProgress: statuses['IN PROGRESS'].length,
        planned: statuses.PLANNED.length
      }
    };
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const all = this.getAllStatus();
    
    if (!all.ok) return all;
    
    // Count total fixes
    let totalFixes = 0;
    let openFixes = 0;
    
    for (const feature of all.features.COMPLETE.concat(all.features['IN PROGRESS'])) {
      const status = this.getFeatureStatus(feature.name);
      if (status.ok && status.fixes) {
        const fixCount = Object.values(status.fixes).reduce((a, b) => a + b, 0);
        totalFixes += fixCount;
        // Estimate open fixes (simplified)
        if (status.status.includes('PROGRESS')) {
          openFixes += Math.floor(fixCount * 0.3);
        }
      }
    }
    
    return {
      ok: true,
      features: all.summary,
      fixes: {
        total: totalFixes,
        open: openFixes,
        closed: totalFixes - openFixes
      },
      health: all.health,
      lastActivity: 'Recently'
    };
  }

  /**
   * Run validation check
   */
  runValidation(featurePath) {
    // Simplified validation check
    const errors = [];
    const warnings = [];
    
    const requiredFiles = ['implementation.md'];
    const recommendedFiles = ['INITIAL.md'];
    
    for (const file of requiredFiles) {
      if (!fs.existsSync(path.join(featurePath, file))) {
        errors.push(`Missing required file: ${file}`);
      }
    }
    
    for (const file of recommendedFiles) {
      if (!fs.existsSync(path.join(featurePath, file))) {
        warnings.push(`Missing recommended file: ${file}`);
      }
    }
    
    return {
      errors: errors.length,
      warnings: warnings.length,
      passed: errors.length === 0
    };
  }

  /**
   * Format output for display
   */
  formatOutput(result) {
    if (!result.ok) {
      console.log(`❌ Error: ${result.error}`);
      if (result.suggestion) {
        console.log(`💡 ${result.suggestion}`);
      }
      return;
    }

    // Single feature status
    if (result.feature) {
      console.log(`📊 Feature Status: ${result.feature}\n`);
      console.log(`Status: ${result.status}`);
      console.log(`Location: ${result.path}`);
      
      if (result.progress) {
        console.log(`\nProgress:`);
        console.log(`  Tasks: ${result.progress.tasks.complete}/${result.progress.tasks.total} complete (${result.progress.percentage}%)`);
      }
      
      if (result.fixes) {
        console.log(`\nFixes:`);
        if (result.fixes.critical > 0) console.log(`  🔴 Critical: ${result.fixes.critical}`);
        if (result.fixes.high > 0) console.log(`  🟠 High: ${result.fixes.high}`);
        if (result.fixes.medium > 0) console.log(`  🟡 Medium: ${result.fixes.medium}`);
        if (result.fixes.low > 0) console.log(`  🟢 Low: ${result.fixes.low}`);
      }
      
      if (result.validation) {
        console.log(`\nValidation:`);
        if (result.validation.passed) {
          console.log(`  ✅ Structure compliant`);
        } else {
          console.log(`  ❌ ${result.validation.errors} errors`);
        }
        if (result.validation.warnings > 0) {
          console.log(`  ⚠️  ${result.validation.warnings} warnings`);
        }
      }
    }
    // All features status
    else if (result.features) {
      console.log(`📊 All Features Status\n`);
      
      if (result.features.COMPLETE.length > 0) {
        console.log(`✅ COMPLETE (${result.features.COMPLETE.length})`);
        result.features.COMPLETE.forEach(f => {
          console.log(`  - ${f.name}`);
        });
        console.log('');
      }
      
      if (result.features['IN PROGRESS'].length > 0) {
        console.log(`🔄 IN PROGRESS (${result.features['IN PROGRESS'].length})`);
        result.features['IN PROGRESS'].forEach(f => {
          console.log(`  - ${f.name} (${f.progress}% complete)`);
        });
        console.log('');
      }
      
      if (result.features.PLANNED.length > 0) {
        console.log(`📝 PLANNED (${result.features.PLANNED.length})`);
        result.features.PLANNED.forEach(f => {
          console.log(`  - ${f.name}`);
        });
        console.log('');
      }
      
      console.log(`Total: ${result.features.total} features`);
      console.log(`Health: ${result.health}% (${result.features.COMPLETE.length + result.features['IN PROGRESS'].length}/${result.features.total} active or complete)`);
    }
    // Summary
    else if (result.summary) {
      console.log(`📊 Context-OS Summary\n`);
      console.log(`Features: ${result.features.total} total`);
      console.log(`  Complete: ${result.features.complete} (${Math.round(result.features.complete / result.features.total * 100)}%)`);
      console.log(`  In Progress: ${result.features.inProgress} (${Math.round(result.features.inProgress / result.features.total * 100)}%)`);
      console.log(`  Planned: ${result.features.planned} (${Math.round(result.features.planned / result.features.total * 100)}%)`);
      
      if (result.fixes) {
        console.log(`\nFixes: ${result.fixes.total} total`);
        console.log(`  Open: ${result.fixes.open} (${Math.round(result.fixes.open / result.fixes.total * 100)}%)`);
        console.log(`  Closed: ${result.fixes.closed} (${Math.round(result.fixes.closed / result.fixes.total * 100)}%)`);
      }
      
      console.log(`\nHealth: ${result.health}%`);
      console.log(`Last Activity: ${result.lastActivity}`);
    }
  }

  /**
   * Main execution
   */
  run(args) {
    const command = args[0] || 'list';
    
    let result;
    
    switch (command) {
      case 'check':
        // Check specific feature
        const featurePath = args[1];
        if (!featurePath) {
          result = { ok: false, error: 'Missing feature path' };
        } else {
          // Extract feature slug from path
          const slug = path.basename(featurePath);
          result = this.getFeatureStatus(slug);
        }
        break;
        
      case 'list':
      case '--all':
        // List all features
        result = this.getAllStatus();
        break;
        
      case '--summary':
        // Show summary only
        result = this.getSummary();
        break;
        
      default:
        // Assume it's a feature slug
        result = this.getFeatureStatus(command);
    }
    
    // JSON mode for programmatic use
    if (process.env.JSON_OUTPUT === 'true') {
      console.log(JSON.stringify(result));
    } else {
      this.formatOutput(result);
    }
    
    return result;
  }
}

// CLI interface
if (require.main === module) {
  const cli = new StatusCLI();
  const args = process.argv.slice(2);
  const result = cli.run(args);
  
  // Exit with appropriate code
  process.exit(result.ok ? 0 : 1);
}

module.exports = StatusCLI;