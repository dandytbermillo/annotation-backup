# Interactive INITIAL.md Creation System - Implementation Proposal
Version: 1.0.0
Date: 2025-01-04
Status: PROPOSED

## Executive Summary

This proposal outlines the implementation of an interactive INITIAL.md creation system for Context-OS that leverages Claude Code's built-in agent capabilities to guide users through a conversational form-filling process. The system will detect incomplete or missing INITIAL.md files and automatically invoke a subagent to collect required information, ensuring all features start with compliant documentation.

## 1. Problem Statement

### Current Pain Points
- Users often create incomplete INITIAL.md files missing required sections
- Manual creation leads to inconsistent formatting and missing fields
- No validation until after file creation, causing rework
- New users don't know what information is required
- Interruptions during creation mean starting over

### Proposed Solution
- Interactive, conversational collection of required fields
- Progressive disclosure - only ask for what's missing
- Session persistence for resume capability
- Patch-first preview before writing
- Automatic validation after creation

## 2. Architecture Design

### 2.1 Component Overview

```
┌─────────────────────────────────────────────────────┐
│                    User Interface                    │
│              (/context-init commands)                │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│                 Context-OS CLI                       │
│            (init-interactive.js)                     │
└─────────────────────┬───────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
┌───────▼────────┐       ┌─────────▼──────────┐
│  Claude Bridge │       │   File System      │
│   (subagent)   │       │  (.tmp storage)    │
└───────┬────────┘       └─────────┬──────────┘
        │                           │
┌───────▼───────────────────────────▼──────────┐
│              Validation Layer                 │
│         (schema + doc validator)              │
└───────────────────────────────────────────────┘
```

### 2.2 Data Flow

1. **Initiation**: User runs `/context-init <feature>` or `/context-execute --init-only`
2. **Detection**: System checks for existing INITIAL.md and validity
3. **Handoff**: If invalid/missing, route to Claude subagent
4. **Collection**: Subagent runs conversational loop collecting fields
5. **Validation**: Returned JSON validated against Zod schema
6. **Preview**: Generate patch diff for user review
7. **Apply**: On approval, write file and run validator
8. **Resume**: If interrupted, restore from `.tmp/initial/<feature>.json`

### 2.3 File Structure (Refined)

```
context-os/
├── schemas/
│   ├── initial-spec.ts              # Zod schema + validators (v1.0.0)
│   └── initial-spec.test.ts         # Schema unit tests
├── prompts/
│   ├── initial-collector.md         # Subagent system prompt
│   └── initial-collector-v2.md      # Future iteration
├── templates/
│   ├── initial.md.hbs               # Handlebars template
│   └── render-initial.js            # Template renderer
├── cli/
│   ├── init-interactive.js          # Main entry point
│   ├── init-resume.js               # Resume handler
│   └── init-utils.js                # Shared utilities
├── bridge/
│   ├── bridge.js                    # Unchanged, add init route
│   └── claude-adapter.js            # Extended with invokeClaudeInit()
└── tests/
    ├── fixtures/
    │   ├── valid-initial.json       # Test data
    │   └── invalid-initial.json     # Error cases
    └── e2e/
        └── init-flow.test.ts        # End-to-end tests
```

## 3. Implementation Phases

### Phase 1: Core Schema & Validation (Week 1)

#### 3.1.1 Schema Definition (With Recommended Refinements)
```typescript
// context-os/schemas/initial-spec.ts
import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0';

// Field-level validators (deterministic, close to schema)
const sentenceCount = (min: number, max: number) => 
  z.string().refine(s => {
    const sentences = s.split(/[.!?]+/).filter(Boolean);
    return sentences.length >= min && sentences.length <= max;
  }, `Must be ${min}-${max} sentences`);

const bulletPoints = (min: number, max: number, maxLength = 120) =>
  z.array(z.string().max(maxLength)).min(min).max(max);

export const InitialSpecSchema = z.object({
  // Version for migration support
  schemaVersion: z.literal(SCHEMA_VERSION),
  
  // Required fields with strict validation
  featureSlug: z.string().regex(/^[a-z0-9_]+$/, 'Lowercase letters, numbers, and underscores only'),
  title: z.string().min(5).max(80),
  problem: sentenceCount(3, 6),
  goals: bulletPoints(3, 7, 100),
  acceptanceCriteria: bulletPoints(3, 7, 120),
  stakeholders: z.array(z.string()).min(2).max(6),
  
  // Optional fields
  nonGoals: bulletPoints(1, 5, 100).optional(),
  dependencies: z.array(z.string()).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  metrics: bulletPoints(1, 5, 100).optional(),
  
  // Metadata
  createdAt: z.string().datetime(),
  createdBy: z.string().default('context-os-init'),
  sessionId: z.string().uuid()
});

export type InitialSpec = z.infer<typeof InitialSpecSchema>;

// Migration support for future schema versions
export async function migrateSchema(data: any, fromVersion: string): Promise<InitialSpec> {
  if (fromVersion === '1.0.0') return data;
  
  // Future migrations
  // if (fromVersion === '0.9.0') {
  //   data.schemaVersion = '1.0.0';
  //   data.severity = data.priority || 'medium';
  //   delete data.priority;
  //   return data;
  // }
  
  throw new Error(`Unknown schema version: ${fromVersion}`);
}
```

#### 3.1.2 Validation Helpers
```typescript
// context-os/schemas/initial-validators.ts
export class InitialValidator {
  static validateSentences(text: string): { valid: boolean; count: number; message: string } {
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const count = sentences.length;
    
    if (count < 3) return { valid: false, count, message: `Too short: ${count} sentences (min: 3)` };
    if (count > 6) return { valid: false, count, message: `Too long: ${count} sentences (max: 6)` };
    
    return { valid: true, count, message: `Perfect: ${count} sentences` };
  }
  
  static suggestImprovements(spec: Partial<InitialSpec>): string[] {
    const suggestions: string[] = [];
    
    if (spec.goals?.length === 1) {
      suggestions.push('Consider adding 2-3 more specific goals');
    }
    
    if (spec.severity === 'critical' && !spec.metrics?.length) {
      suggestions.push('Critical features should include success metrics');
    }
    
    if (!spec.dependencies?.length) {
      suggestions.push('Consider listing any system dependencies');
    }
    
    return suggestions;
  }
}
```

### Phase 2: Claude Subagent Integration (Week 1-2)

#### 3.2.1 Subagent System Prompt (Refined with Markers)
```markdown
<!-- context-os/prompts/initial-collector.md -->
# INITIAL.md Collection Agent

You are a Context-OS INITIAL.md collection subagent. Your role is to interactively collect the required fields for creating a compliant INITIAL.md document.

## Required Fields (must collect all)
1. **title** - One-line feature name (5-80 characters)
2. **problem** - Problem description (3-6 sentences)
3. **goals** - Feature goals (3-7 bullet points, max 100 chars each)
4. **acceptanceCriteria** - Success criteria (3-7 bullet points, max 120 chars each)
5. **stakeholders** - Affected teams/people (2-6 entries)

## Optional Fields (ask if user wants to add)
- **nonGoals** - What's explicitly out of scope
- **dependencies** - External system dependencies
- **severity** - Priority level (low/medium/high/critical)
- **metrics** - Success metrics

## Conversation Rules
1. Only ask for missing or invalid fields
2. Show field requirements clearly (e.g., "3-6 sentences")
3. Echo back entries for confirmation
4. Offer examples if user is unsure
5. Use checkpoint markers during collection:
   - `[FIELD_COMPLETE: title="..."]`
   - `[FIELD_COMPLETE: goals=["...","..."]]`
   - `[FIELD_PENDING: acceptanceCriteria]`
   - `[VALIDATION_ERROR: problem="Too short: 2 sentences"]`
   - `[COLLECTION_COMPLETE: status=ready]`

## Completion
When ALL required fields are collected and valid, output ONLY this JSON structure:

```json
{
  "status": "ready",
  "spec": {
    "schemaVersion": "1.0.0",
    "featureSlug": "...",
    "title": "...",
    "problem": "...",
    "goals": ["...", "..."],
    "acceptanceCriteria": ["...", "..."],
    "stakeholders": ["...", "..."],
    "nonGoals": ["..."],
    "dependencies": ["..."],
    "severity": "medium",
    "metrics": ["..."],
    "createdAt": "ISO-8601",
    "sessionId": "uuid"
  },
  "validation": {
    "missing": [],
    "notes": ["All required fields collected"]
  }
}
```

## Error Handling
- If user provides invalid input, explain the requirement and ask again
- If user wants to skip optional fields, that's fine
- If user wants to revise a field, update it and reconfirm
- Never write files or execute commands
- Never make up information
```

#### 3.2.2 Bridge Adapter (Refined with Robustness)
```javascript
// context-os/bridge/claude-adapter.js (additions)
export async function invokeClaudeInit({ featureSlug, prior }) {
  const prompt = await fs.readFile('prompts/initial-collector.md', 'utf8');
  
  // Build context from prior session if exists
  const context = {
    featureSlug,
    existingFields: prior?.spec || {},
    completedFields: prior?.completedFields || [],
    requiredFields: ['title', 'problem', 'goals', 'acceptanceCriteria', 'stakeholders'],
    sessionId: prior?.sessionId || generateUUID()
  };
  
  try {
    const response = await claude.invokeTask({
      type: 'form_fill',
      prompt,
      context,
      constraints: {
        maxTurns: 8,
        timeout: 600000, // 10 minutes
        outputFormat: 'json',
        retryOnInvalidJson: true
      }
    });
    
    // Parse markers during conversation for debugging/logging
    const markers = extractMarkers(response.conversation);
    logMarkers(markers);
    
    // Final turn must be strict JSON
    if (response.status === 'complete') {
      try {
        const parsed = JSON.parse(response.output);
        // Validate against schema
        const validated = InitialSpec.parse(parsed.spec);
        return { status: 'ready', spec: validated };
      } catch (e) {
        // Ask Claude to resend JSON only
        const retry = await claude.invokeTask({
          type: 'json_only',
          prompt: 'Please return ONLY the JSON structure, no other text.',
          context: { lastResponse: response.output }
        });
        const parsed = JSON.parse(retry.output);
        const validated = InitialSpec.parse(parsed.spec);
        return { status: 'ready', spec: validated };
      }
    }
    
    // Save progress for resume
    await saveProgress(featureSlug, response.partialSpec);
    return { status: 'incomplete', spec: response.partialSpec };
    
  } catch (error) {
    console.error('Claude init error:', error);
    throw error;
  }
}

function extractMarkers(conversation) {
  const markers = [];
  const regex = /\[([A-Z_]+): ([^\]]+)\]/g;
  let match;
  
  while ((match = regex.exec(conversation)) !== null) {
    markers.push({
      type: match[1],
      value: match[2],
      timestamp: Date.now()
    });
  }
  
  return markers;
}
```

### Phase 3: CLI Implementation (Week 2)

#### 3.3.1 Main Entry Point (Refined)
```javascript
#!/usr/bin/env node
// context-os/cli/init-interactive.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { InitialSpec } from '../schemas/initial-spec.js';
import { renderInitial } from '../templates/render-initial.js';
import { invokeClaudeInit } from '../bridge/claude-adapter.js';
import { validateStructure } from './validate-cli.js';
import { createPatch, showDiff } from '../utils/patch-utils.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

const feature = process.argv[2];
const flags = {
  resume: process.argv.includes('--resume'),
  apply: process.argv.includes('--apply'),
  dryRun: process.argv.includes('--dry-run') || !process.argv.includes('--apply'),
  help: process.argv.includes('--help')
};

async function run() {
  if (flags.help || !feature) {
    showHelp();
    return;
  }
  
  const dir = `docs/proposal/${feature}`;
  const initialPath = path.join(dir, 'INITIAL.md');
  const tmpPath = `.tmp/initial/${feature}.json`;
  
  console.log(chalk.blue('🚀 Interactive INITIAL.md Creation'));
  console.log(chalk.gray(`Feature: ${feature}`));
  console.log('');
  
  try {
    // Check existing file
    let existingContent = null;
    try {
      existingContent = await fs.readFile(initialPath, 'utf8');
      if (existingContent && !flags.resume) {
        const { overwrite } = await inquirer.prompt([{
          type: 'confirm',
          name: 'overwrite',
          message: 'INITIAL.md already exists. Overwrite?',
          default: false
        }]);
        
        if (!overwrite) {
          console.log(chalk.yellow('Aborted.'));
          return;
        }
      }
    } catch {
      // File doesn't exist, proceed
    }
    
    // Load prior session if resuming
    const prior = flags.resume ? await maybeLoad(tmpPath) : null;
    if (prior) {
      console.log(chalk.green('✓ Resuming previous session'));
      console.log(chalk.gray(`  Completed: ${prior.completedFields?.join(', ') || 'none'}`));
      console.log('');
    }
    
    // Collect via subagent
    console.log(chalk.blue('📝 Starting interactive collection...'));
    console.log(chalk.gray('The assistant will guide you through the required fields.'));
    console.log('');
    
    const result = await invokeClaudeInit({ featureSlug: feature, prior });
    
    if (result.status !== 'ready') {
      console.log(chalk.yellow('Collection incomplete. Use --resume to continue.'));
      return;
    }
    
    // Validate with Zod
    const parsed = InitialSpec.parse(result.spec);
    
    // Render template
    const md = renderInitial(parsed);
    
    // Create and show diff
    const patch = createPatch(existingContent || '', md, initialPath);
    
    console.log('');
    console.log(chalk.blue('📄 Preview:'));
    console.log(chalk.gray('─'.repeat(60)));
    showDiff(patch);
    console.log(chalk.gray('─'.repeat(60)));
    
    // Handle dry-run
    if (flags.dryRun) {
      console.log(chalk.yellow('Dry-run mode: No files written'));
      return;
    }
    
    // Apply decision
    const shouldApply = flags.apply || await confirmApply();
    
    if (!shouldApply) {
      console.log(chalk.yellow('Patch not applied.'));
      return;
    }
    
    // Create directory and write file
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(initialPath, md, 'utf8');
    
    console.log(chalk.green(`✓ INITIAL.md created: ${initialPath}`));
    
    // Clean up tmp file
    await fs.unlink(tmpPath).catch(() => {});
    
    // Run validator
    console.log('');
    console.log(chalk.blue('🔍 Running validation...'));
    await validateStructure(dir);
    
    // Next steps
    console.log('');
    console.log(chalk.blue('📚 Next steps:'));
    console.log(`  1. Review: ${initialPath}`);
    console.log(`  2. Create plan: /context-execute ${feature}`);
    console.log(`  3. Validate: /context-validate ${feature}`);
    
  } catch (error) {
    console.error(chalk.red('✗ Error:'), error.message);
    if (error.stack && process.env.DEBUG) {
      console.error(chalk.gray(error.stack));
    }
    console.error(chalk.gray('Use --resume to continue from saved state'));
    process.exit(1);
  }
}

async function maybeLoad(p) { 
  try { 
    return JSON.parse(await fs.readFile(p, 'utf8')); 
  } catch { 
    return null; 
  } 
}

async function confirmApply() {
  const { apply } = await inquirer.prompt([{
    type: 'confirm',
    name: 'apply',
    message: 'Apply this patch?',
    default: true
  }]);
  return apply;
}

function showHelp() {
  console.log(`
${chalk.bold('Interactive INITIAL.md Creator')}

${chalk.blue('Usage:')}
  /context-init <feature>           Create new INITIAL.md
  /context-init <feature> --resume  Resume interrupted session
  /context-init <feature> --dry-run Preview without writing
  /context-init <feature> --apply   Apply without confirmation

${chalk.blue('Examples:')}
  /context-init unified_offline_foundation
  /context-init auth_system --resume
  /context-init dark_mode --dry-run

${chalk.gray('Sessions saved to .tmp/initial/<feature>.json')}
  `);
}

run().catch(e => { 
  console.error(e); 
  process.exit(1); 
});
```

#### 3.3.2 Template Renderer (Refined)
```javascript
// context-os/templates/render-initial.js
import Handlebars from 'handlebars';
import fs from 'node:fs/promises';
import path from 'node:path';

// Register helpers
Handlebars.registerHelper('default', (value, defaultValue) => value || defaultValue);
Handlebars.registerHelper('date', () => new Date().toISOString().split('T')[0]);
Handlebars.registerHelper('bulletList', (items) => {
  if (!items || !items.length) return '- Not specified';
  return items.map(item => `- ${item}`).join('\n');
});

let compiledTemplate = null;

export async function renderInitial(spec) {
  if (!compiledTemplate) {
    const templatePath = path.join('templates', 'initial.md.hbs');
    const source = await fs.readFile(templatePath, 'utf8');
    compiledTemplate = Handlebars.compile(source);
  }
  
  return compiledTemplate(spec);
}
```

#### 3.3.3 Template File (Using .hbs as recommended)
```handlebars
<!-- context-os/templates/initial.md.hbs -->
# INITIAL

**Title**: {{title}}
**Feature**: {{featureSlug}}
**Status**: PLANNED
**Severity**: {{default severity "medium"}}
**Created**: {{date}}
**Schema Version**: {{schemaVersion}}

## Problem

{{problem}}

## Goals

{{bulletList goals}}

## Non-Goals

{{bulletList nonGoals}}

## Stakeholders

{{bulletList stakeholders}}

## Dependencies

{{bulletList dependencies}}

## Acceptance Criteria

{{bulletList acceptanceCriteria}}

## Success Metrics

{{bulletList metrics}}

## Implementation Notes

_This document was created via interactive collection. Use `/context-execute {{featureSlug}}` to create the implementation plan._

---
Generated by Context-OS Interactive Init v{{schemaVersion}}
Session: {{sessionId}}
```

### Phase 4: Integration & Testing (Week 2-3)

#### 3.4.1 Command Integration (Refined)
```javascript
// Add to context-os/cli/execute-cli.js
if (options.initOnly || options.interactive) {
  console.log('Redirecting to interactive INITIAL.md creation...');
  const { spawn } = require('child_process');
  const init = spawn('node', ['cli/init-interactive.js', featureSlug], {
    stdio: 'inherit'
  });
  init.on('close', (code) => {
    if (code === 0 && options.continueAfterInit) {
      // Continue with normal execute flow
      executeFeature(featureSlug, options);
    } else {
      process.exit(code);
    }
  });
  return;
}
```

#### 3.4.2 Unit Tests (Fast Test Plan)
```typescript
// context-os/tests/initial-spec.test.ts
import { describe, it, expect } from 'vitest';
import { InitialSpecSchema, InitialValidator } from '../schemas/initial-spec';

describe('InitialSpec Schema', () => {
  it('validates correct spec', () => {
    const valid = {
      schemaVersion: '1.0.0',
      featureSlug: 'test_feature',
      title: 'Test Feature',
      problem: 'This is sentence one. This is sentence two. This is sentence three.',
      goals: ['Goal 1', 'Goal 2', 'Goal 3'],
      acceptanceCriteria: ['Criteria 1', 'Criteria 2', 'Criteria 3'],
      stakeholders: ['Team A', 'Team B'],
      severity: 'medium',
      createdAt: new Date().toISOString(),
      sessionId: '123e4567-e89b-12d3-a456-426614174000'
    };
    
    expect(() => InitialSpecSchema.parse(valid)).not.toThrow();
  });
  
  it('rejects invalid feature slug', () => {
    const invalid = {
      featureSlug: 'Test-Feature', // Should be lowercase with underscores
      // ... other fields
    };
    
    expect(() => InitialSpecSchema.parse(invalid)).toThrow(/lowercase/i);
  });
  
  it('validates sentence count', () => {
    const twoSentences = InitialValidator.validateSentences('One. Two.');
    expect(twoSentences.valid).toBe(false);
    expect(twoSentences.message).toContain('Too short');
    
    const fourSentences = InitialValidator.validateSentences('One. Two. Three. Four.');
    expect(fourSentences.valid).toBe(true);
    
    const sevenSentences = InitialValidator.validateSentences('One. Two. Three. Four. Five. Six. Seven.');
    expect(sevenSentences.valid).toBe(false);
    expect(sevenSentences.message).toContain('Too long');
  });
  
  it('validates slug format', () => {
    const validSlugs = ['feature_one', 'test123', 'my_awesome_feature'];
    const invalidSlugs = ['Feature-One', 'test.feature', 'my awesome feature'];
    
    validSlugs.forEach(slug => {
      expect(() => InitialSpecSchema.shape.featureSlug.parse(slug)).not.toThrow();
    });
    
    invalidSlugs.forEach(slug => {
      expect(() => InitialSpecSchema.shape.featureSlug.parse(slug)).toThrow();
    });
  });
});
```

#### 3.4.3 Fixture Tests
```javascript
// context-os/tests/fixtures/claude-responses.js
export const goodResponse = {
  status: 'ready',
  spec: {
    schemaVersion: '1.0.0',
    featureSlug: 'test_feature',
    title: 'Test Feature',
    problem: 'First sentence. Second sentence. Third sentence.',
    goals: ['Goal 1', 'Goal 2', 'Goal 3'],
    acceptanceCriteria: ['AC 1', 'AC 2', 'AC 3'],
    stakeholders: ['Team A', 'Team B'],
    createdAt: new Date().toISOString(),
    sessionId: 'test-session-id'
  }
};

export const badResponse = {
  status: 'ready',
  spec: {
    // Missing schemaVersion
    featureSlug: 'TEST-FEATURE', // Invalid format
    title: 'T', // Too short
    problem: 'Only one sentence',
    goals: ['Single goal'], // Too few
    acceptanceCriteria: [], // Empty
    stakeholders: ['Solo'], // Too few
  }
};

// Test bridge rejection and re-prompt
describe('Claude Response Validation', () => {
  it('accepts good response', () => {
    expect(() => InitialSpecSchema.parse(goodResponse.spec)).not.toThrow();
  });
  
  it('rejects bad response and triggers re-prompt', async () => {
    const result = await bridgeValidateResponse(badResponse);
    expect(result.needsRetry).toBe(true);
    expect(result.errors).toContain('schemaVersion');
    expect(result.errors).toContain('featureSlug');
  });
});
```

#### 3.4.4 E2E Tests (Dry-run and Apply)
```bash
#!/bin/bash
# context-os/tests/e2e/init-flow.sh

# Test 1: Dry-run mode
echo "Testing dry-run mode..."
CLAUDE_MOCK_RESPONSES='fixtures/good-response.json' \
  node cli/init-interactive.js test_feature --dry-run

if [ ! -f "docs/proposal/test_feature/INITIAL.md" ]; then
  echo "✓ Dry-run: No file written"
else
  echo "✗ Dry-run: File should not exist"
  exit 1
fi

# Test 2: Apply mode
echo "Testing apply mode..."
CLAUDE_MOCK_RESPONSES='fixtures/good-response.json' \
  node cli/init-interactive.js test_feature --apply

if [ -f "docs/proposal/test_feature/INITIAL.md" ]; then
  echo "✓ Apply: File written"
  
  # Validate content
  if grep -q "schemaVersion.*1.0.0" docs/proposal/test_feature/INITIAL.md; then
    echo "✓ Content: Schema version present"
  else
    echo "✗ Content: Missing schema version"
    exit 1
  fi
else
  echo "✗ Apply: File not written"
  exit 1
fi

# Test 3: Validator pass
./scripts/validate-doc-structure.sh docs/proposal/test_feature
if [ $? -eq 0 ]; then
  echo "✓ Validation: PASS"
else
  echo "✗ Validation: FAIL"
  exit 1
fi

echo "All E2E tests passed!"
```

## 4. Migration Strategy

### 4.1 For Existing Features
```bash
#!/bin/bash
# context-os/scripts/migrate-existing-initials.sh

for dir in docs/proposal/*/; do
  feature=$(basename "$dir")
  initial="$dir/INITIAL.md"
  
  if [[ -f "$initial" ]]; then
    echo "Checking $feature..."
    
    # Try to parse with new schema
    node -e "
      const fs = require('fs');
      const { InitialSpecSchema } = require('../schemas/initial-spec.js');
      
      try {
        const content = fs.readFileSync('$initial', 'utf8');
        // Extract fields from markdown
        const spec = parseMarkdownToSpec(content);
        InitialSpecSchema.parse(spec);
        console.log('  ✓ Already compliant');
      } catch (e) {
        console.log('  ⚠ Needs migration: ' + e.message);
        console.log('  Run: /context-init $feature --migrate');
      }
    "
  else
    echo "  ✗ Missing INITIAL.md"
    echo "  Run: /context-init $feature"
  fi
done
```

### 4.2 Migration Command
```javascript
// Add to init-interactive.js
if (flags.migrate) {
  const existing = await fs.readFile(initialPath, 'utf8');
  const parsed = parseExistingInitial(existing);
  
  console.log('Migrating to schema v1.0.0...');
  
  // Fill in missing fields via subagent
  const result = await invokeClaudeInit({
    featureSlug: feature,
    prior: { spec: parsed, completedFields: Object.keys(parsed) }
  });
  
  // Continue with normal flow...
}
```

## 5. Risk Analysis & Mitigation

### 5.1 Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Claude API unavailable | High | Low | Fallback to template-based creation |
| Invalid JSON from Claude | Medium | Medium | Retry with stricter prompts + markers |
| Session corruption | Low | Low | Validation on load, auto-backup |
| Schema drift | Medium | Low | Version field enables migrations |
| Marker parsing failures | Low | Medium | Markers for debugging only, not critical path |

### 5.2 User Experience Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| User fatigue from long forms | High | Progressive disclosure, save progress |
| Confusing validation errors | Medium | Clear error messages with examples |
| Lost work from crashes | High | Auto-save after each field |
| Unclear requirements | Medium | Show examples, offer templates |

## 6. Success Metrics

### 6.1 Quantitative
- **Completion Rate**: >90% of initiated sessions result in valid INITIAL.md
- **Time to Complete**: <5 minutes average for all required fields
- **Resume Usage**: >30% of interrupted sessions successfully resumed
- **Validation Pass Rate**: >95% of created files pass validator first try
- **JSON Retry Rate**: <10% require JSON re-prompt

### 6.2 Qualitative
- User feedback on ease of use
- Reduction in support requests about INITIAL.md format
- Improved consistency across feature documentation
- Developer satisfaction with resume capability

## 7. Implementation Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 1: Schema & Validation | 3 days | Zod schema, validators, unit tests |
| Phase 2: Claude Integration | 4 days | Subagent prompt, bridge adapter, marker parsing |
| Phase 3: CLI Implementation | 3 days | Interactive CLI, resume capability |
| Phase 4: Testing & Integration | 3 days | E2E tests, fixtures, command integration |
| Phase 5: Migration & Rollout | 2 days | Migration scripts, documentation |
| **Total** | **15 days** | **Production-ready system** |

## 8. Command Reference (Updated)

### Primary Commands
```bash
# Create new INITIAL.md interactively (NEW)
/context-init <feature>

# Resume interrupted session (NEW)
/context-init <feature> --resume
# Alternative: /context-resume <feature>

# Preview without writing
/context-init <feature> --dry-run

# Apply without confirmation
/context-init <feature> --apply

# Migrate existing INITIAL.md to new schema
/context-init <feature> --migrate

# Integration with execute
/context-execute <feature> --interactive  # Good default
/context-execute <feature> --init-only    # Just INITIAL.md
```

### Supporting Commands
```bash
# Validate existing INITIAL.md
/context-validate <feature>

# Clean up temp sessions older than 7 days
/context-init --cleanup

# Show all pending sessions
/context-init --list-sessions
```

## 9. Configuration

### 9.1 Environment Variables
```bash
# Claude API configuration
CLAUDE_API_KEY=<key>
CLAUDE_API_ENDPOINT=<endpoint>

# Feature behavior
CONTEXT_OS_INIT_TIMEOUT=600000        # 10 minutes default
CONTEXT_OS_INIT_MAX_TURNS=8          # Max conversation turns
CONTEXT_OS_INIT_AUTO_SAVE=true       # Auto-save progress
CONTEXT_OS_INIT_STRICT_JSON=true     # Require strict JSON at completion

# Development
CLAUDE_MOCK_RESPONSES=<json>         # For testing
CONTEXT_OS_DEBUG=true                # Verbose logging
CONTEXT_OS_SHOW_MARKERS=true         # Display checkpoint markers
```

### 9.2 Config File
```json
// .context-os/config.json
{
  "init": {
    "defaultSeverity": "medium",
    "requireMetrics": false,
    "autoSuggestDependencies": true,
    "templateVersion": "1.0.0",
    "schemaVersion": "1.0.0",
    "enableMarkers": true,
    "retryOnBadJson": true,
    "maxJsonRetries": 3
  },
  "validation": {
    "strict": false,
    "customRules": [],
    "allowPartialFields": false
  },
  "session": {
    "autoCleanupDays": 7,
    "backupEnabled": true,
    "compressOldSessions": true
  }
}
```

## 10. Documentation Updates

### 10.1 User Guide Addition
```markdown
## Creating Features with Interactive Init

The Context-OS Interactive Init system guides you through creating a compliant INITIAL.md file using a conversational interface.

### Quick Start
```bash
/context-init my_new_feature
```

The system will:
1. Ask for required information (title, problem, goals, etc.)
2. Validate your inputs in real-time
3. Show checkpoint markers as fields complete
4. Display a preview diff before writing
5. Create the INITIAL.md file
6. Run validation automatically

### Resuming Sessions
If interrupted, your progress is automatically saved:
```bash
/context-init my_new_feature --resume
# Or use the shorthand:
/context-resume my_new_feature
```

### Understanding Markers
During collection, you'll see progress markers:
- `[FIELD_COMPLETE: title="..."]` - Field successfully collected
- `[FIELD_PENDING: goals]` - Currently collecting this field
- `[VALIDATION_ERROR: ...]` - Input needs correction
- `[COLLECTION_COMPLETE: status=ready]` - All fields collected

### Tips for Success
- Keep descriptions concise (3-6 sentences for problems)
- Use specific, measurable acceptance criteria
- List all stakeholders who need to review
- Add metrics for critical features
- If unsure, the assistant will provide examples
```

### 10.2 Developer Documentation
```markdown
## Extending the Interactive Init System

### Custom Validators
Add field validators to `schemas/initial-spec.ts`:
```typescript
const customValidator = z.string().refine(
  val => myValidationLogic(val),
  'Custom error message'
);
```

### Schema Migrations
When updating schema version:
1. Increment SCHEMA_VERSION in initial-spec.ts
2. Add migration logic in migrateSchema()
3. Test with existing sessions
4. Document changes in CHANGELOG

### Marker System
Markers provide conversation checkpoints:
- Used for debugging and progress tracking
- Not required for JSON parsing
- Can be disabled via config

### Testing with Mocks
```bash
CLAUDE_MOCK_RESPONSES='fixtures/test-response.json' \
  node cli/init-interactive.js test_feature
```
```

## 11. Monitoring & Observability

### 11.1 Metrics to Track
```typescript
interface InitMetrics {
  // Session metrics
  sessionsStarted: number;
  sessionsCompleted: number;
  sessionsAbandoned: number;
  sessionsResumed: number;
  
  // Performance metrics
  averageCompletionTime: number;
  averageTurns: number;
  fieldRevisionRate: Map<string, number>;
  
  // Quality metrics
  validationFailures: number;
  schemaValidationErrors: number;
  jsonRetryCount: number;
  
  // Schema metrics
  schemaVersions: Map<string, number>;
  migrationCount: number;
}
```

### 11.2 Structured Logging
```javascript
// Structured logging for analysis
logger.info('session.started', { 
  feature: featureSlug,
  sessionId,
  schemaVersion: SCHEMA_VERSION,
  timestamp
});

logger.info('field.completed', {
  sessionId,
  field: 'goals',
  attempts: 2,
  duration: 45000,
  marker: '[FIELD_COMPLETE: goals=...]'
});

logger.warn('json.retry', {
  sessionId,
  attempt: 1,
  error: 'Invalid JSON structure',
  willRetry: true
});
```

## 12. Future Enhancements

### 12.1 Version 2.0 Features
- **AI-Powered Suggestions**: Analyze codebase to suggest goals/dependencies
- **Template Library**: Pre-built templates for common feature types
- **Collaborative Mode**: Multiple users contribute to same INITIAL.md
- **Rich Media**: Support diagrams and mockups in problem statement
- **Smart Defaults**: Infer likely values from feature name and context

### 12.2 Integration Opportunities
- IDE plugins for in-editor creation
- GitHub Actions for PR validation
- Slack bot for async collection
- Web UI for non-CLI users
- REST API for programmatic access

## Appendix A: Complete Example Session

```
$ /context-init unified_offline_foundation

🚀 Interactive INITIAL.md Creation
Feature: unified_offline_foundation

📝 Starting interactive collection...
The assistant will guide you through the required fields.