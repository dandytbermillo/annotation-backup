#!/usr/bin/env node

/**
 * Context-OS Feature Creator
 * Orchestrates the creation of compliant feature documentation structure
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// Colors for output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

const log = {
  info: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  step: (msg) => console.log(`${colors.blue}→${colors.reset} ${msg}`)
};

class FeatureOrchestrator {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Main entry point
   */
  async createFeature(description, draftPath) {
    console.log('\n🤖 Context-OS Feature Orchestrator\n');
    
    // Step A: Parse & Propose
    const slug = this.proposeSlug(description);
    log.step(`Proposed feature slug: ${slug}`);
    
    // Step B: Locate Draft Plan
    const planPath = draftPath || 'drafts/implementation.md';
    const plan = await this.loadOrCreatePlan(planPath, slug, description);
    
    // Step C: Validate Plan
    const validation = this.validatePlan(plan);
    if (!validation.isValid) {
      log.warn('Plan validation failed:');
      validation.missing.forEach(field => log.error(`  Missing: ${field}`));
      
      const fix = await this.askUser('Would you like to fix these issues? (yes/no): ');
      if (fix.toLowerCase() === 'yes') {
        await this.fillMissingFields(plan, validation.missing);
      } else {
        log.error('Cannot proceed without a valid plan. Please update and retry.');
        this.rl.close();
        return;
      }
    }
    
    // Step D: Confirmation Gate
    const targetDir = `docs/proposal/${slug}`;
    console.log('\n📋 Action Summary:');
    console.log(`  • Create feature at: ${targetDir}/`);
    console.log(`  • Move plan to: ${targetDir}/implementation.md`);
    console.log(`  • Create standard directories and stubs`);
    
    const confirm = await this.askUser('\nProceed with scaffolding? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes') {
      log.warn('Scaffolding cancelled by user.');
      this.rl.close();
      return;
    }
    
    // Step E: Scaffold & Move
    await this.scaffoldFeature(slug, plan);
    
    // Step F: Success & Next Steps
    log.info(`Feature workspace created successfully!`);
    console.log(`\n📂 Next steps:`);
    console.log(`  1. cd ${targetDir}`);
    console.log(`  2. Review implementation.md`);
    console.log(`  3. Update status to IN PROGRESS when starting`);
    console.log(`  4. Use validate-doc-structure.sh to verify compliance`);
    
    this.rl.close();
  }

  /**
   * Generate a slug from description
   */
  proposeSlug(description) {
    return description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 50);
  }

  /**
   * Load existing plan or create minimal one
   */
  async loadOrCreatePlan(planPath, slug, description) {
    if (fs.existsSync(planPath)) {
      log.info(`Found draft plan at: ${planPath}`);
      return fs.readFileSync(planPath, 'utf8');
    }
    
    log.warn(`No draft found at ${planPath}, creating minimal plan...`);
    
    const date = new Date().toISOString().split('T')[0];
    return `# ${description}

**Feature Slug**: ${slug}
**Date**: ${date}
**Status**: 📝 PLANNED

## Objective
[TO BE FILLED]

## Acceptance Criteria
- [ ] [TO BE FILLED]
- [ ] [TO BE FILLED]
- [ ] [TO BE FILLED]

## Implementation Tasks
- [TO BE FILLED]
- [TO BE FILLED]
- [TO BE FILLED]
`;
  }

  /**
   * Validate required fields in plan
   */
  validatePlan(plan) {
    const required = [
      'Feature Slug',
      'Status',
      'Objective',
      'Acceptance Criteria',
      'Implementation Tasks'
    ];
    
    const missing = [];
    for (const field of required) {
      const regex = new RegExp(`##?\\s*${field}`, 'i');
      if (!regex.test(plan)) {
        missing.push(field);
        continue;
      }
      
      // Check if field has actual content (not just [TO BE FILLED])
      const lines = plan.split('\n');
      const fieldIndex = lines.findIndex(l => regex.test(l));
      const nextLines = lines.slice(fieldIndex + 1, fieldIndex + 5).join('\n');
      if (nextLines.includes('[TO BE FILLED]') || nextLines.trim().length < 10) {
        missing.push(field);
      }
    }
    
    return {
      isValid: missing.length === 0,
      missing
    };
  }

  /**
   * Interactive field filling
   */
  async fillMissingFields(plan, missingFields) {
    log.step('PlanFillerAgent activated...');
    
    for (const field of missingFields) {
      console.log(`\n📝 ${field}:`);
      
      switch (field) {
        case 'Objective':
          const objective = await this.askUser('What is the main goal of this feature? ');
          plan = plan.replace('[TO BE FILLED]', objective);
          break;
          
        case 'Acceptance Criteria':
          console.log('Enter acceptance criteria (one per line, empty line to finish):');
          const criteria = await this.collectMultilineInput();
          const criteriaList = criteria.map(c => `- [ ] ${c}`).join('\n');
          plan = plan.replace(/- \[ \] \[TO BE FILLED\]\n/g, '');
          plan = plan.replace('## Acceptance Criteria', `## Acceptance Criteria\n${criteriaList}`);
          break;
          
        case 'Implementation Tasks':
          console.log('Enter implementation tasks (one per line, empty line to finish):');
          const tasks = await this.collectMultilineInput();
          const tasksList = tasks.map(t => `- ${t}`).join('\n');
          plan = plan.replace(/- \[TO BE FILLED\]\n/g, '');
          plan = plan.replace('## Implementation Tasks', `## Implementation Tasks\n${tasksList}`);
          break;
      }
    }
    
    log.info('Plan completed successfully!');
    return plan;
  }

  /**
   * Scaffold the feature structure
   */
  async scaffoldFeature(slug, plan) {
    const baseDir = `docs/proposal/${slug}`;
    
    log.step('Creating directory structure...');
    
    // Create directories
    const dirs = [
      baseDir,
      `${baseDir}/reports`,
      `${baseDir}/implementation-details`,
      `${baseDir}/implementation-details/artifacts`,
      `${baseDir}/post-implementation-fixes`,
      `${baseDir}/post-implementation-fixes/critical`,
      `${baseDir}/post-implementation-fixes/high`,
      `${baseDir}/post-implementation-fixes/medium`,
      `${baseDir}/post-implementation-fixes/low`,
      `${baseDir}/patches`
    ];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log.info(`Created: ${dir}`);
      }
    }
    
    // Write implementation.md
    fs.writeFileSync(`${baseDir}/implementation.md`, plan);
    log.info(`Created: ${baseDir}/implementation.md`);
    
    // Create main report stub
    const reportStub = this.generateReportStub(slug);
    const reportPath = `${baseDir}/reports/${slug}-Implementation-Report.md`;
    fs.writeFileSync(reportPath, reportStub);
    log.info(`Created: ${reportPath}`);
    
    // Create fixes README
    const fixesReadme = this.generateFixesReadme(slug);
    fs.writeFileSync(`${baseDir}/post-implementation-fixes/README.md`, fixesReadme);
    log.info(`Created: ${baseDir}/post-implementation-fixes/README.md`);
    
    // Create artifacts index
    const artifactsIndex = '# Artifacts Index\n\nNo artifacts yet.\n';
    fs.writeFileSync(`${baseDir}/implementation-details/artifacts/INDEX.md`, artifactsIndex);
    log.info(`Created: ${baseDir}/implementation-details/artifacts/INDEX.md`);
    
    // Create patches README
    const patchesReadme = '# Patches\n\nNo patches yet.\n';
    fs.writeFileSync(`${baseDir}/patches/README.md`, patchesReadme);
    log.info(`Created: ${baseDir}/patches/README.md`);
  }

  /**
   * Generate report template
   */
  generateReportStub(slug) {
    const title = slug.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const date = new Date().toISOString().split('T')[0];
    
    return `# ${title} Implementation Report

**Implementation Plan**: [implementation.md](../implementation.md)
**Date Started**: ${date}
**Date Completed**: TBD
**Status**: 🚧 IN PROGRESS

## Executive Summary
[2-3 sentences maximum once complete]

## Scope of Implementation
- What Was Planned: See implementation.md
- What Was Delivered: TBD

## Quick Status
⏳ In Progress

## Key Metrics
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| TBD | TBD | TBD | TBD |

## Documentation Index

### 📋 Implementation Details
- [Feature Implementation](../implementation-details/feature.md)

### 🧪 Testing & Validation
- Test results will be linked here

### 📝 Code Changes
- Files modified will be listed here

## Acceptance Criteria ✓
See implementation.md for criteria

---
<!-- Phase boundary: Everything above = implementation, below = post-implementation -->

## Post-Implementation Fixes
[→ View all fixes and statistics](../post-implementation-fixes/README.md)

### Recent Fixes
None yet - feature still in progress
`;
  }

  /**
   * Generate fixes README template
   */
  generateFixesReadme(slug) {
    const title = slug.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const date = new Date().toISOString().split('T')[0];
    
    return `# Post-Implementation Fixes Index

**Feature**: ${title}
**Last Updated**: ${date}
**Total Fixes**: 0
**Severity Breakdown**: 🔴 Critical: 0 | 🟠 High: 0 | 🟡 Medium: 0 | 🟢 Low: 0

## 🔴 Critical Issues (Immediate Action Required)
*Definition: Data loss, security, prod down, >50% perf degradation*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| *No critical issues* | | | | | |

## 🟠 High Priority (Within 24 Hours)
*Definition: Memory leak >25%/day, 25-50% perf, >10% users affected*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| *No high priority issues* | | | | | |

## 🟡 Medium Priority (Within 1 Week)
*Definition: 10-25% perf degradation, UX disrupted, non-critical broken*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| *No medium priority issues* | | | | | |

## 🟢 Low Priority (As Time Permits)
*Definition: <10% perf impact, cosmetic, code quality*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| *No low priority issues* | | | | | |

## Fix Patterns & Lessons Learned
To be updated as fixes are implemented.

## Statistics
To be calculated once fixes are recorded.
`;
  }

  /**
   * Helper: Ask user a question
   */
  askUser(question) {
    return new Promise(resolve => {
      this.rl.question(question, resolve);
    });
  }

  /**
   * Helper: Collect multiline input
   */
  async collectMultilineInput() {
    const lines = [];
    let line;
    do {
      line = await this.askUser('  > ');
      if (line) lines.push(line);
    } while (line);
    return lines;
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const description = args[0] || 'New feature';
  const draftPath = args[1];
  
  if (!description || description === '--help') {
    console.log('Usage: node create-feature.js "feature description" [draft-path]');
    console.log('Example: node create-feature.js "Fix rapid typing updates" drafts/implementation.md');
    process.exit(0);
  }
  
  const orchestrator = new FeatureOrchestrator();
  orchestrator.createFeature(description, draftPath);
}

module.exports = FeatureOrchestrator;