#!/usr/bin/env node
/**
 * Context-OS Companion Service
 * Handles safe file I/O, validation, and LLM orchestration for the browser UI
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { claudeAdapter } = require('../bridge/claude-adapter');
const { renderInitial } = require('../templates/render-initial');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.COMPANION_PORT || 4000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Ensure directories exist
async function ensureDirectories() {
  const dirs = [
    '.tmp/initial',
    'docs/proposal',
    '.logs',
    'context-os/companion/backups'
  ];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

// Backup helper
async function createBackup(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join('context-os/companion/backups', 
      `${path.basename(filePath)}.bak.${timestamp}`);
    await fs.writeFile(backupPath, content, 'utf8');
    return backupPath;
  } catch (error) {
    return null; // File doesn't exist yet
  }
}

// Audit logger
async function logAction(action, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    ...details
  };
  const logPath = '.logs/context-os-companion.jsonl';
  await fs.appendFile(logPath, JSON.stringify(entry) + '\n', 'utf8');
}

// ===== ENDPOINTS =====

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'context-os-companion',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Get or create draft
app.get('/api/draft/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const draftPath = path.join('.tmp/initial', `${slug}.draft.md`);
    
    // Check if draft exists
    let content = '';
    let exists = false;
    try {
      content = await fs.readFile(draftPath, 'utf8');
      exists = true;
    } catch (error) {
      // Draft doesn't exist, check for existing INITIAL.md
      const initialPath = path.join('docs/proposal', slug, 'INITIAL.md');
      try {
        content = await fs.readFile(initialPath, 'utf8');
        // Copy to draft
        await fs.writeFile(draftPath, content, 'utf8');
      } catch {
        // Neither exists, return empty template
        content = `# INITIAL

**Title**: ${slug.replace(/_/g, ' ')} Feature
**Feature**: ${slug}
**Status**: PLANNED
**Created**: ${new Date().toISOString().split('T')[0]}

## Problem

[Describe the problem this feature solves]

## Goals

- [Goal 1]
- [Goal 2]
- [Goal 3]

## Acceptance Criteria

- [Criteria 1]
- [Criteria 2]
- [Criteria 3]

## Stakeholders

- Development Team
- Product Team
`;
        await fs.writeFile(draftPath, content, 'utf8');
      }
    }
    
    await logAction('draft_get', { slug, exists });
    
    res.json({
      slug,
      content,
      path: draftPath,
      exists
    });
  } catch (error) {
    console.error('Error getting draft:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save draft (autosave)
app.post('/api/draft/save', async (req, res) => {
  try {
    const { slug, content } = req.body;
    const draftPath = path.join('.tmp/initial', `${slug}.draft.md`);
    
    // Create backup if file exists
    const backupPath = await createBackup(draftPath);
    
    // Write new content
    await fs.writeFile(draftPath, content, 'utf8');
    
    await logAction('draft_save', { slug, backupPath });
    
    res.json({
      saved: true,
      path: draftPath,
      backup: backupPath,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validate draft structure
app.post('/api/validate', async (req, res) => {
  try {
    const { content, slug } = req.body;
    
    // Save content to temp file for validator script
    const tempPath = `.tmp/initial/${slug}.validate.md`;
    await fs.writeFile(tempPath, content, 'utf8');
    
    // Run the validation script
    try {
      const { stdout, stderr } = await execAsync(
        `./scripts/validate-doc-structure.sh ${tempPath}`
      );
      
      // Parse validator output
      const lines = stdout.split('\n');
      const missingFields = [];
      const warnings = [];
      let isValid = true;
      
      for (const line of lines) {
        if (line.includes('Missing:')) {
          missingFields.push(line.replace(/.*Missing:\s*/, ''));
          isValid = false;
        }
        if (line.includes('Warning:')) {
          warnings.push(line.replace(/.*Warning:\s*/, ''));
        }
        if (line.includes('ERROR')) {
          isValid = false;
        }
      }
      
      await logAction('validate', { slug, isValid, missingFields: missingFields.length });
      
      res.json({
        valid: isValid,
        missingFields,
        warnings,
        log: stdout,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      // Validator script failed
      res.json({
        valid: false,
        missingFields: ['Unable to validate'],
        warnings: [],
        log: error.stderr || error.message,
        timestamp: new Date().toISOString()
      });
    } finally {
      // Clean up temp file
      await fs.unlink(tempPath).catch(() => {});
    }
    
  } catch (error) {
    console.error('Error validating:', error);
    res.status(500).json({ error: error.message });
  }
});

// LLM Verify (non-invasive check)
app.post('/api/llm/verify', async (req, res) => {
  try {
    const { content, slug, validationResult } = req.body;
    
    // Build verification request
    const verifyRequest = {
      task: `Analyze this INITIAL.md draft and provide a quality report card.
      
Draft content:
${content}

Validation result:
${JSON.stringify(validationResult, null, 2)}

Provide:
1. Readiness score (1-10)
2. Status (draft/ready/frozen)
3. Specific missing or weak sections
4. 1-3 focused suggestions
5. Whether it's ready for PRP generation`,
      tools: ['Task'],
      budget: { maxTokens: 2000 }
    };
    
    // Call Claude adapter
    const response = await claudeAdapter.invokeTask(verifyRequest);
    
    // Parse response into report card format
    const reportCard = {
      header_meta: {
        meta_version: 1,
        feature_slug: slug,
        status: 'draft',
        readiness_score: 6,
        missing_fields: validationResult.missingFields || [],
        last_validated_at: new Date().toISOString(),
        confidence: 0.7,
        validator: 'validate-doc-structure.sh@1.2.0'
      },
      suggestions: response.findings || [
        'Add more detail to the problem statement',
        'Clarify acceptance criteria',
        'Consider adding non-goals section'
      ],
      prp_gate: {
        allowed: validationResult.valid,
        reason: validationResult.valid ? 'Ready for PRP generation' : 'Missing required fields',
        next_best_action: validationResult.valid ? 'Generate PRP' : 'Complete missing sections'
      }
    };
    
    await logAction('llm_verify', { slug, readiness: reportCard.header_meta.readiness_score });
    
    res.json(reportCard);
    
  } catch (error) {
    console.error('Error with LLM verify:', error);
    res.status(500).json({ error: error.message });
  }
});

// LLM Fill (suggest missing sections)
app.post('/api/llm/fill', async (req, res) => {
  try {
    const { content, slug, missingFields } = req.body;
    
    if (!missingFields || missingFields.length === 0) {
      return res.json({
        content_patches: [],
        notes: ['No missing fields to fill']
      });
    }
    
    // Build fill request
    const fillRequest = {
      task: `Analyze this INITIAL.md draft and suggest content ONLY for the missing sections.
      
Current draft:
${content}

Missing sections: ${missingFields.join(', ')}

Provide minimal, focused content suggestions for each missing section.
Do not rewrite existing content.`,
      tools: ['Task'],
      budget: { maxTokens: 3000 }
    };
    
    // Call Claude adapter
    const response = await claudeAdapter.invokeTask(fillRequest);
    
    // Create content patches (simplified for POC)
    const patches = missingFields.map(field => ({
      section: field,
      suggestion: `[Suggested content for ${field}]`,
      diff: `+ ${field}: [Add your content here]`
    }));
    
    await logAction('llm_fill', { slug, fields: missingFields.length });
    
    res.json({
      content_patches: patches,
      notes: ['Suggestions provided for missing sections']
    });
    
  } catch (error) {
    console.error('Error with LLM fill:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create PRP
app.post('/api/prp/create', async (req, res) => {
  try {
    const { slug, initialContent } = req.body;
    
    // Generate PRP content
    const prpRequest = {
      task: `Generate a Pull Request Plan (PRP) based on this INITIAL.md:
      
${initialContent}

Create a detailed implementation plan with:
- Clear objectives and scope
- Technical approach
- File changes needed
- Testing strategy
- Rollback plan`,
      tools: ['Task'],
      budget: { maxTokens: 4000 }
    };
    
    const response = await claudeAdapter.invokeTask(prpRequest);
    
    // Create PRP content
    const prpContent = `# Pull Request Plan: ${slug.replace(/_/g, ' ')}

Generated from INITIAL.md on ${new Date().toISOString()}

## Objectives
${response.findings ? response.findings.join('\n') : '- Implement feature as specified'}

## Technical Approach
[Implementation details based on INITIAL.md]

## Files to Modify
- TBD based on architecture review

## Testing Strategy
- Unit tests for core logic
- Integration tests for API endpoints
- E2E tests for user workflows

## Rollback Plan
- Revert commits if issues detected
- Feature flag for gradual rollout
`;
    
    // Save PRP draft
    const prpDir = path.join('docs/proposal', slug, 'reports');
    await fs.mkdir(prpDir, { recursive: true });
    
    const prpPath = path.join(prpDir, `${slug}-PRP.md`);
    await fs.writeFile(prpPath, prpContent, 'utf8');
    
    await logAction('prp_create', { slug, path: prpPath });
    
    res.json({
      prp_artifact: {
        path: prpPath,
        content: prpContent,
        status: 'draft'
      },
      next: 'review_and_approve'
    });
    
  } catch (error) {
    console.error('Error creating PRP:', error);
    res.status(500).json({ error: error.message });
  }
});

// Promote draft to final
app.post('/api/draft/promote', async (req, res) => {
  try {
    const { slug } = req.body;
    const draftPath = path.join('.tmp/initial', `${slug}.draft.md`);
    const finalDir = path.join('docs/proposal', slug);
    const finalPath = path.join(finalDir, 'INITIAL.md');
    
    // Read draft content
    const content = await fs.readFile(draftPath, 'utf8');
    
    // Create backup of existing file if it exists
    const backupPath = await createBackup(finalPath);
    
    // Ensure directory exists
    await fs.mkdir(finalDir, { recursive: true });
    
    // Write final file
    await fs.writeFile(finalPath, content, 'utf8');
    
    await logAction('draft_promote', { slug, backup: backupPath });
    
    res.json({
      promoted: true,
      path: finalPath,
      backup: backupPath,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error promoting draft:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get available features
app.get('/api/features', async (req, res) => {
  try {
    const proposalDir = 'docs/proposal';
    const entries = await fs.readdir(proposalDir, { withFileTypes: true });
    
    const features = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const slug = entry.name;
        const initialPath = path.join(proposalDir, slug, 'INITIAL.md');
        
        try {
          await fs.access(initialPath);
          features.push({
            slug,
            hasInitial: true,
            path: initialPath
          });
        } catch {
          features.push({
            slug,
            hasInitial: false,
            path: null
          });
        }
      }
    }
    
    res.json({ features });
    
  } catch (error) {
    console.error('Error listing features:', error);
    res.json({ features: [] });
  }
});

// Start server
async function start() {
  await ensureDirectories();
  
  app.listen(PORT, () => {
    console.log(`🚀 Context-OS Companion running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`   Ready to serve browser UI requests`);
  });
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down companion service...');
  process.exit(0);
});

// Run if executed directly
if (require.main === module) {
  start().catch(console.error);
}

module.exports = { app };