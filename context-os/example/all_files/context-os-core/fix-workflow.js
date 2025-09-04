#!/usr/bin/env node

/**
 * Fix Workflow Manager - Handles post-implementation fix workflows
 * Part of Context-OS orchestration system
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const ClassifierAgent = require('./agents/classifier-agent');
const StatusEnforcer = require('./status-enforcer');

class FixWorkflowManager {
  constructor() {
    this.classifier = new ClassifierAgent();
    this.statusEnforcer = new StatusEnforcer();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    this.colors = {
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      blue: '\x1b[34m',
      reset: '\x1b[0m'
    };
  }
  
  /**
   * Main entry point for creating a fix
   */
  async createFix(featureSlug, issueDescription) {
    console.log('\n🔧 Fix Workflow Manager\n');
    
    // Step 1: Locate feature
    const featurePath = path.join('docs/proposal', featureSlug);
    if (!fs.existsSync(featurePath)) {
      this.error(`Feature not found: ${featureSlug}`);
      this.info('Available features:');
      this.listFeatures();
      this.rl.close();
      return;
    }
    
    // Step 2: Check feature status
    const { isComplete, status } = this.statusEnforcer.checkStatus(featurePath);
    if (!isComplete) {
      this.warn(`Feature is not COMPLETE (${status}). Fixes are typically for completed features.`);
      const proceed = await this.askUser('Continue anyway? (yes/no): ');
      if (proceed.toLowerCase() !== 'yes') {
        this.rl.close();
        return;
      }
    }
    
    // Step 3: Gather issue details
    console.log('\n📝 Issue Details:');
    const issue = {
      title: issueDescription,
      description: await this.askUser('Detailed description: '),
      environment: await this.askUser('Environment (prod/staging/dev): '),
      metrics: {}
    };
    
    // Ask for metrics if relevant
    const hasMetrics = await this.askUser('Do you have performance/impact metrics? (yes/no): ');
    if (hasMetrics.toLowerCase() === 'yes') {
      const perf = await this.askUser('Performance degradation % (0-100): ');
      const users = await this.askUser('Users affected % (0-100): ');
      issue.metrics.performanceDegradation = parseInt(perf) || 0;
      issue.metrics.usersAffected = parseInt(users) || 0;
    }
    
    // Step 4: Classify the issue
    this.step('Classifying issue...');
    const classification = this.classifier.classify(issue);
    
    console.log('\n📊 Classification Result:');
    console.log(`  Severity: ${classification.icon} ${classification.severity}`);
    console.log(`  Type: ${classification.type}`);
    console.log(`  SLA: ${classification.sla}`);
    console.log(`  Workflow: ${classification.workflow}`);
    
    // Step 5: Show recommendations
    if (classification.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      classification.recommendations.forEach(r => console.log(`  ${r}`));
    }
    
    // Step 6: Confirm routing
    const fixPath = path.join(featurePath, 'post-implementation-fixes', classification.directory);
    console.log(`\n📂 Fix will be created in: ${fixPath}/`);
    
    const confirm = await this.askUser('Proceed with fix creation? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes') {
      this.warn('Fix creation cancelled.');
      this.rl.close();
      return;
    }
    
    // Step 7: Route and create fix document
    const result = this.classifier.routeIssue(issue, featurePath);
    this.success(`Fix document created: ${result.path}`);
    
    // Step 8: Update the main README index
    await this.updateFixIndex(featurePath, result, issue);
    
    // Step 9: Provide next steps based on workflow
    console.log('\n📋 Next Steps for', classification.workflow + ':');
    this.printWorkflowSteps(classification.workflow, result.path);
    
    this.rl.close();
  }
  
  /**
   * Update the post-implementation-fixes README
   */
  async updateFixIndex(featurePath, result, issue) {
    const indexPath = path.join(featurePath, 'post-implementation-fixes', 'README.md');
    
    if (!fs.existsSync(indexPath)) {
      this.warn('README.md not found in post-implementation-fixes/');
      return;
    }
    
    const content = fs.readFileSync(indexPath, 'utf8');
    const date = new Date().toISOString().split('T')[0];
    const filename = path.basename(result.path);
    
    // Create table row
    const severityConfig = this.classifier.severityLevels[result.classification.severity];
    const tableRow = `| ${date} | ${issue.title} | ${issue.environment} | Perf: ${issue.metrics.performanceDegradation || 'N/A'}% | 🚧 In Progress | [${filename}](./${severityConfig.directory}/${filename}) |`;
    
    // Find the right section and insert
    const sectionMarker = `## ${severityConfig.icon} ${this.getSeverityTitle(result.classification.severity)}`;
    const lines = content.split('\n');
    
    let inserted = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(sectionMarker)) {
        // Find the table
        for (let j = i; j < Math.min(i + 10, lines.length); j++) {
          if (lines[j].includes('| *No ')) {
            // Replace the "No issues" line
            lines[j] = tableRow;
            inserted = true;
            break;
          } else if (lines[j].startsWith('|') && !lines[j].includes('---')) {
            // Insert before first real row
            lines.splice(j, 0, tableRow);
            inserted = true;
            break;
          }
        }
        break;
      }
    }
    
    if (inserted) {
      // Update counts
      const newContent = this.updateFixCounts(lines.join('\n'));
      fs.writeFileSync(indexPath, newContent);
      this.success('Updated post-implementation-fixes/README.md');
    }
  }
  
  /**
   * Update fix counts in README
   */
  updateFixCounts(content) {
    const stats = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    };
    
    // Count fixes by severity
    const lines = content.split('\n');
    lines.forEach(line => {
      if (line.startsWith('|') && !line.includes('---') && !line.includes('*No ')) {
        if (line.includes('🔴')) stats.critical++;
        else if (line.includes('🟠')) stats.high++;
        else if (line.includes('🟡')) stats.medium++;
        else if (line.includes('🟢')) stats.low++;
      }
    });
    
    const total = stats.critical + stats.high + stats.medium + stats.low;
    
    // Update header
    return content
      .replace(/\*\*Total Fixes\*\*: \d+/, `**Total Fixes**: ${total}`)
      .replace(/🔴 Critical: \d+/, `🔴 Critical: ${stats.critical}`)
      .replace(/🟠 High: \d+/, `🟠 High: ${stats.high}`)
      .replace(/🟡 Medium: \d+/, `🟡 Medium: ${stats.medium}`)
      .replace(/🟢 Low: \d+/, `🟢 Low: ${stats.low}`);
  }
  
  /**
   * Print workflow-specific steps
   */
  printWorkflowSteps(workflow, fixPath) {
    const steps = {
      'bug-fix': [
        '1. Reproduce the bug locally',
        '2. Write a failing test case',
        '3. Implement the fix',
        '4. Verify test passes',
        '5. Run full test suite',
        '6. Update fix document with solution'
      ],
      'performance-fix': [
        '1. Profile current performance',
        '2. Identify bottlenecks',
        '3. Implement optimizations',
        '4. Measure improvements',
        '5. Add performance tests',
        '6. Document benchmarks in fix'
      ],
      'security-fix': [
        '1. Verify the vulnerability',
        '2. Assess impact and scope',
        '3. Implement secure fix',
        '4. Conduct security review',
        '5. Add security tests',
        '6. Update security documentation'
      ],
      'ux-fix': [
        '1. Document current UX issue',
        '2. Create mockups/designs',
        '3. Get design approval',
        '4. Implement UI changes',
        '5. Conduct user testing',
        '6. Update UX documentation'
      ],
      'enhancement': [
        '1. Define enhancement scope',
        '2. Update acceptance criteria',
        '3. Implement enhancement',
        '4. Add tests',
        '5. Update documentation',
        '6. Get stakeholder approval'
      ]
    };
    
    const workflowSteps = steps[workflow] || steps['bug-fix'];
    workflowSteps.forEach(step => console.log(`  ${step}`));
    
    console.log(`\n📝 Edit fix document: ${fixPath}`);
    console.log(`🔍 Track progress using the checkboxes in the document`);
  }
  
  /**
   * List available features
   */
  listFeatures() {
    const proposalDir = 'docs/proposal';
    if (!fs.existsSync(proposalDir)) {
      return;
    }
    
    const dirs = fs.readdirSync(proposalDir).filter(d => {
      const fullPath = path.join(proposalDir, d);
      return fs.statSync(fullPath).isDirectory() && !d.startsWith('.');
    });
    
    dirs.forEach(d => console.log(`  - ${d}`));
  }
  
  /**
   * Get severity title for sections
   */
  getSeverityTitle(severity) {
    const titles = {
      CRITICAL: 'Critical Issues (Immediate Action Required)',
      HIGH: 'High Priority (Within 24 Hours)',
      MEDIUM: 'Medium Priority (Within 1 Week)',
      LOW: 'Low Priority (As Time Permits)'
    };
    return titles[severity] || severity;
  }
  
  // Helper methods
  askUser(question) {
    return new Promise(resolve => {
      this.rl.question(question, resolve);
    });
  }
  
  success(msg) {
    console.log(`${this.colors.green}✓${this.colors.reset} ${msg}`);
  }
  
  warn(msg) {
    console.log(`${this.colors.yellow}⚠${this.colors.reset} ${msg}`);
  }
  
  error(msg) {
    console.log(`${this.colors.red}✗${this.colors.reset} ${msg}`);
  }
  
  step(msg) {
    console.log(`${this.colors.blue}→${this.colors.reset} ${msg}`);
  }
}

// CLI interface
if (require.main === module) {
  const manager = new FixWorkflowManager();
  const args = process.argv.slice(2);
  
  if (args.length < 2 || args[0] === '--help') {
    console.log('Usage: fix-workflow <feature-slug> "issue description"');
    console.log('Example: fix-workflow center_note_window "Window not centering on small screens"');
    process.exit(0);
  }
  
  const [featureSlug, ...descParts] = args;
  const description = descParts.join(' ');
  
  manager.createFix(featureSlug, description);
}

module.exports = FixWorkflowManager;