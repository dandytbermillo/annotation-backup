#!/usr/bin/env node

/**
 * Context-OS Feature Creator
 * Orchestrates the creation of compliant feature documentation structure
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawnSync } = require('child_process');
const StatusEnforcer = require('./status-enforcer');

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
    this.statusEnforcer = new StatusEnforcer();
  }

  /**
   * Main entry point
   */
  async createFeature(description, draftPath) {
    console.log('\n🤖 Context-OS Feature Orchestrator\n');
    
    // Step A: Parse & Propose Multiple Slugs
    const slugSuggestions = this.proposeSlugs(description);
    const slug = await this.selectSlug(slugSuggestions);
    log.step(`Selected feature slug: ${slug}`);
    
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
    
    // Step C.5: Check if feature already exists and status
    const targetDir = `../docs/proposal/${slug}`;
    if (fs.existsSync(targetDir)) {
      // Check if it's COMPLETE
      if (!this.statusEnforcer.enforceStatus(targetDir, 'create')) {
        log.error('Cannot modify COMPLETE feature. Create a fix or reopen.');
        this.rl.close();
        return;
      }
    }
    
    // Step D: Confirmation Gate
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
   * Generate multiple slug suggestions from description
   */
  proposeSlugs(description) {
    const suggestions = [];
    
    // Strategy 1: Basic snake_case
    const snake = description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 50);
    suggestions.push(snake);
    
    // Strategy 2: Short descriptive (first few words)
    const words = description.toLowerCase().split(/\s+/);
    const short = words.slice(0, 3).join('_').replace(/[^a-z0-9_]/g, '');
    if (short && short !== snake) {
      suggestions.push(short);
    }
    
    // Strategy 3: Action-focused (verb + noun)
    const actionWords = ['add', 'fix', 'update', 'create', 'implement', 'enhance', 'refactor'];
    const firstWord = words[0];
    if (actionWords.includes(firstWord)) {
      const actionSlug = words.slice(0, 2).join('_').replace(/[^a-z0-9_]/g, '');
      if (actionSlug && !suggestions.includes(actionSlug)) {
        suggestions.push(actionSlug);
      }
    }
    
    // Ensure we have at least 3 unique suggestions
    while (suggestions.length < 3) {
      const suffix = suggestions.length === 1 ? '_feature' : '_impl';
      const newSlug = suggestions[0] + suffix;
      if (!suggestions.includes(newSlug)) {
        suggestions.push(newSlug);
      }
    }
    
    return suggestions.slice(0, 3);
  }
  
  /**
   * Let user select from multiple slug options
   */
  async selectSlug(suggestions) {
    console.log('\n📝 Select a feature slug:');
    suggestions.forEach((slug, index) => {
      console.log(`  ${index + 1}. ${slug}`);
    });
    console.log('  4. Enter custom slug');
    
    let choice;
    do {
      choice = await this.askUser('\nYour choice (1-4): ');
    } while (!['1', '2', '3', '4'].includes(choice));
    
    if (choice === '4') {
      const custom = await this.askUser('Enter custom slug (lowercase, underscore separated): ');
      return custom.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    }
    
    return suggestions[parseInt(choice) - 1];
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
      // Check for both metadata format (**Field**:) and header format (## Field)
      const metadataRegex = new RegExp(`\\*\\*${field}\\*\\*:`, 'i');
      const headerRegex = new RegExp(`##?\\s*${field}`, 'i');
      if (!metadataRegex.test(plan) && !headerRegex.test(plan)) {
        missing.push(field);
        continue;
      }
      
      // Check if field has actual content (not just [TO BE FILLED])
      const lines = plan.split('\n');
      const fieldIndex = lines.findIndex(l => metadataRegex.test(l) || headerRegex.test(l));
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
    const baseDir = `../docs/proposal/${slug}`;
    
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
  
  /**
   * Create a patch for review
   */
  async createPatchForReview(slug, changes) {
    const patchDir = `docs/proposal/${slug}/patches`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const patchFile = `${patchDir}/draft-${timestamp}.patch`;
    
    // Ensure patches directory exists
    if (!fs.existsSync(patchDir)) {
      fs.mkdirSync(patchDir, { recursive: true });
    }
    
    // Generate patch content
    const patchContent = this.generatePatchContent(changes);
    fs.writeFileSync(patchFile, patchContent);
    
    return patchFile;
  }
  
  /**
   * Generate patch content from changes
   */
  generatePatchContent(changes) {
    let patch = `# Context-OS Proposed Changes\n`;
    patch += `# Generated: ${new Date().toISOString()}\n\n`;
    
    for (const change of changes) {
      patch += `--- ${change.file}\n`;
      patch += `+++ ${change.file}\n`;
      patch += `@@ ${change.description} @@\n`;
      
      if (change.oldContent) {
        change.oldContent.split('\n').forEach(line => {
          patch += `- ${line}\n`;
        });
      }
      
      if (change.newContent) {
        change.newContent.split('\n').forEach(line => {
          patch += `+ ${line}\n`;
        });
      }
      patch += '\n';
    }
    
    return patch;
  }
  
  /**
   * Review patch before applying
   */
  async reviewPatch(patchFile) {
    console.log('\n📄 Patch Review:');
    console.log('─'.repeat(60));
    
    const content = fs.readFileSync(patchFile, 'utf8');
    const lines = content.split('\n');
    
    // Color-code the diff
    lines.forEach(line => {
      if (line.startsWith('+')) {
        console.log(`${colors.green}${line}${colors.reset}`);
      } else if (line.startsWith('-')) {
        console.log(`${colors.red}${line}${colors.reset}`);
      } else if (line.startsWith('@@')) {
        console.log(`${colors.blue}${line}${colors.reset}`);
      } else {
        console.log(line);
      }
    });
    
    console.log('─'.repeat(60));
    
    const decision = await this.askUser('\nApply this patch? (yes/no/edit): ');
    
    if (decision.toLowerCase() === 'edit') {
      console.log('Opening patch in editor...');
      // Try to open in default editor
      try {
        spawnSync(process.env.EDITOR || 'vi', [patchFile], { stdio: 'inherit' });
        return await this.reviewPatch(patchFile); // Re-review after edit
      } catch (e) {
        log.warn('Could not open editor. Please edit manually: ' + patchFile);
      }
    }
    
    return decision.toLowerCase() === 'yes';
  }
  
  /**
   * Apply approved patches
   */
  async applyPatch(patchFile) {
    try {
      // For demonstration, we'll use git apply
      execSync(`git apply --check ${patchFile} 2>/dev/null`);
      execSync(`git apply ${patchFile}`);
      log.info('Patch applied successfully!');
      
      // Archive the applied patch
      const appliedDir = path.dirname(patchFile);
      const appliedFile = patchFile.replace('draft-', 'applied-');
      fs.renameSync(patchFile, appliedFile);
      
      return true;
    } catch (error) {
      log.error(`Failed to apply patch: ${error.message}`);
      return false;
    }
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const description = args[0] || 'New feature';
  const draftPath = args[1];
  
  if (!description || description === '--help') {
    console.log('Usage: node context-os/create-feature.js "feature description" [draft-path]');
    console.log('Example: node context-os/create-feature.js "Fix rapid typing updates" context-os/drafts/implementation.md');
    console.log('\nNote: Drafts should be created in context-os/drafts/ to maintain compliance');
    process.exit(0);
  }
  
  const orchestrator = new FeatureOrchestrator();
  orchestrator.createFeature(description, draftPath);
}

module.exports = FeatureOrchestrator;