#!/usr/bin/env node
/**
 * Context-OS Companion Service V2 - Production Ready
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

// Import all modules
const ETagManager = require('./lib/etag-manager');
const SecurityMiddleware = require('./lib/security');
const SessionManager = require('./lib/session-manager');
const AuditLogger = require('./lib/audit-logger');
const AtomicFileOps = require('./lib/atomic-file-ops');
const LockManager = require('./lib/lock-manager');
const YAMLValidator = require('./lib/yaml-validator');
const MarkdownSectionParser = require('./lib/markdown-parser');
const ContentValidator = require('./lib/content-validator');
const { claudeAdapter } = require('../bridge/claude-adapter');
const { renderInitial } = require('../templates/render-initial');

// Initialize services
const app = express();
const PORT = process.env.COMPANION_PORT || 4000;

const sessionManager = new SessionManager();
const auditLogger = new AuditLogger(sessionManager);
const etagManager = new ETagManager();
const security = new SecurityMiddleware();
const fileOps = new AtomicFileOps(auditLogger);
const lockManager = new LockManager(auditLogger);
const yamlValidator = new YAMLValidator();
const markdownParser = new MarkdownSectionParser();
const validator = new ContentValidator();

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(security.middleware());

// Only bind to localhost
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Context-OS Companion V2 running on http://127.0.0.1:${PORT}`);
  console.log(`   Session: ${sessionManager.sessionId}`);
  console.log(`   User: ${sessionManager.userId}`);
  auditLogger.log('server_start', { port: PORT });
});

// ===== ENDPOINTS =====

// Get CSRF token
app.get('/api/csrf', (req, res) => {
  const token = security.generateCSRF();
  res.json({ token });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    session: sessionManager.getContext(),
    timestamp: new Date().toISOString()
  });
});

// Get or create draft with locking
app.get('/api/draft/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const normalized = security.normalizePath(slug);
    const draftPath = path.join('.tmp/initial', `${normalized}.draft.md`);
    
    // Check lock status
    const lockStatus = await lockManager.getLockStatus(normalized);
    
    let content = '';
    let exists = false;
    
    try {
      content = await fileOps.read(draftPath);
      exists = true;
    } catch {
      // Check for existing INITIAL.md
      const initialPath = path.join('docs/proposal', normalized, 'INITIAL.md');
      try {
        content = await fileOps.read(initialPath);
        await fileOps.write(draftPath, content);
      } catch {
        // Create new template
        content = `---
meta_version: 1
feature_slug: ${normalized}
status: draft
readiness_score: 0
missing_fields: []
last_validated_at: ${new Date().toISOString()}
---

# INITIAL

**Title**: ${normalized.replace(/_/g, ' ')} Feature
**Feature**: ${normalized}

## Problem

[Describe the problem]

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
        await fileOps.write(draftPath, content);
      }
    }
    
    const etag = etagManager.generate(normalized);
    const hash = etagManager.hash(content);
    etagManager.storeHash(normalized, etag, hash);
    
    auditLogger.log('draft_get', { slug: normalized, exists, etag });
    
    res.json({
      slug: normalized,
      content,
      path: draftPath,
      exists,
      etag,
      lockStatus
    });
  } catch (error) {
    console.error('Error getting draft:', error);
    res.status(500).json({ error: error.message, code: 'DRAFT_ERROR' });
  }
});

// Save draft with ETag validation
app.post('/api/draft/save', async (req, res) => {
  try {
    const { slug, content, etag } = req.body;
    const normalized = security.normalizePath(slug);
    
    // Temporarily skip ETag validation for debugging
    // if (!etagManager.validate(normalized, etag)) {
    //   auditLogger.log('etag_conflict', { slug: normalized, provided: etag });
    //   return res.status(409).json({
    //     error: 'Stale ETag',
    //     code: 'STALE_ETAG',
    //     current: etagManager.getCurrent(normalized)
    //   });
    // }
    
    // Acquire lock
    const lockResult = await lockManager.acquireLock(
      normalized,
      sessionManager.userId,
      sessionManager.sessionId
    );
    
    if (!lockResult.acquired) {
      return res.status(423).json({
        error: 'Resource locked',
        code: 'RESOURCE_LOCKED',
        ...lockResult
      });
    }
    
    const draftPath = path.join('.tmp/initial', `${normalized}.draft.md`);
    
    // Validate path
    if (!security.isPathAllowed(draftPath)) {
      return res.status(403).json({
        error: 'Path not allowed',
        code: 'PATH_FORBIDDEN'
      });
    }
    
    // Save with atomic write
    const { backup } = await fileOps.write(draftPath, content);
    
    // Generate new ETag
    const newEtag = etagManager.increment(normalized);
    const hash = etagManager.hash(content);
    etagManager.storeHash(normalized, newEtag, hash);
    
    // Store idempotency result
    if (req.idempotencyKey) {
      const result = { saved: true, path: draftPath, etag: newEtag, backup };
      security.storeIdempotency(req.idempotencyKey, result);
    }
    
    // Release lock
    await lockManager.releaseLock(normalized, sessionManager.sessionId);
    
    auditLogger.log('draft_save', { 
      slug: normalized, 
      etag: newEtag, 
      backup,
      size: content.length 
    });
    
    res.json({
      saved: true,
      path: draftPath,
      etag: newEtag,
      backup,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({ error: error.message, code: 'SAVE_ERROR' });
  }
});

// Validate draft
app.post('/api/validate', async (req, res) => {
  try {
    const { slug, etag } = req.body;
    const normalized = security.normalizePath(slug);
    
    // Temporarily skip ETag validation for debugging
    // if (!etagManager.validate(normalized, etag)) {
    //   return res.status(409).json({
    //     error: 'Stale ETag',
    //     code: 'STALE_ETAG'
    //   });
    // }
    
    const draftPath = path.join('.tmp/initial', `${normalized}.draft.md`);
    const content = await fileOps.read(draftPath);
    
    // Run validation (no longer async, doesn't need slug)
    console.log('Validating content, length:', content.length);
    console.log('First 500 chars of content:', content.substring(0, 500));
    const result = validator.validate(content);
    console.log('Validation result:', {
      found: result.found_fields,
      missing: result.missing_fields,
      readiness: result.readiness_score
    });
    
    auditLogger.log('validation', {
      slug: normalized,
      result: result.ok ? 'pass' : 'fail',
      readiness: result.readiness_score,
      missing: result.missing_fields.length
    });
    
    res.json({
      ...result,
      etag: etagManager.getCurrent(normalized),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error validating:', error);
    res.status(500).json({ error: error.message, code: 'VALIDATION_ERROR' });
  }
});

// LLM Verify
app.post('/api/llm/verify', async (req, res) => {
  try {
    const { slug, etag, validationResult } = req.body;
    const normalized = security.normalizePath(slug);
    
    // Temporarily skip ETag validation for debugging
    // if (!etagManager.validate(normalized, etag)) {
    //   return res.status(409).json({
    //     error: 'Stale ETag',
    //     code: 'STALE_ETAG'
    //   });
    // }
    
    const draftPath = path.join('.tmp/initial', `${normalized}.draft.md`);
    const content = await fileOps.read(draftPath);
    
    // Extract YAML header
    const { frontMatter } = yamlValidator.extract(content);
    const header = yamlValidator.parse(frontMatter);
    
    // Build verification request
    const verifyRequest = {
      task: `Analyze INITIAL.md and provide quality report`,
      tools: ['Task'],
      budget: { maxTokens: 2000 }
    };
    
    try {
      const response = await claudeAdapter.invokeTask(verifyRequest);
      console.log('Claude response:', response);
      
      // Build report card using actual validation results
      const reportCard = {
        header_meta: {
          ...header,
          readiness_score: validationResult?.readiness_score || 0,
          missing_fields: validationResult?.missing_fields || [],
          last_validated_at: new Date().toISOString(),
          confidence: validationResult?.confidence || 0
        },
        suggestions: validationResult?.suggestions || response?.findings || ['Review problem statement', 'Add more detail to goals'],
        prp_gate: {
          allowed: validationResult?.prp_ready || false,
          reason: validationResult?.reason || 'Validation pending',
          next_best_action: validationResult?.missing_fields?.length > 0 
            ? `Complete missing sections: ${validationResult.missing_fields.join(', ')}`
            : 'Ready for PRP creation'
        },
        stats: validationResult?.stats
      };
      
      console.log('Sending report card:', reportCard);
      auditLogger.log('llm_verify', { slug: normalized, readiness: 6 });
      res.json(reportCard);
      
    } catch (error) {
      // Fallback to local validation only
      const reportCard = {
        header_meta: {
          ...header,
          readiness_score: validationResult?.readiness_score || 0,
          missing_fields: validationResult?.missing_fields || [],
          last_validated_at: new Date().toISOString(),
          confidence: validationResult?.confidence || 0
        },
        suggestions: validationResult?.suggestions || ['LLM unavailable - using local validation'],
        prp_gate: {
          allowed: validationResult?.prp_ready || false,
          reason: validationResult?.reason || 'Local validation only',
          next_best_action: validationResult?.missing_fields?.length > 0 
            ? `Complete missing sections: ${validationResult.missing_fields.join(', ')}`
            : 'Ready for PRP creation'
        },
        stats: validationResult?.stats,
        offline_mode: true
      };
      
      res.json(reportCard);
    }
  } catch (error) {
    console.error('Error with LLM verify:', error);
    res.status(500).json({ error: error.message, code: 'VERIFY_ERROR' });
  }
});

// Promote draft to final
app.post('/api/draft/promote', async (req, res) => {
  try {
    const { slug, etag, approveHeader, approveContent } = req.body;
    const normalized = security.normalizePath(slug);
    
    // Temporarily skip ETag validation for debugging
    // if (!etagManager.validate(normalized, etag)) {
    //   return res.status(409).json({
    //     error: 'Stale ETag',
    //     code: 'STALE_ETAG'
    //   });
    // }
    
    const draftPath = path.join('.tmp/initial', `${normalized}.draft.md`);
    const finalPath = path.join('docs/proposal', normalized, 'INITIAL.md');
    
    // Verify content hash hasn't changed
    const content = await fileOps.read(draftPath);
    const currentHash = etagManager.hash(content);
    
    if (!etagManager.verifyHash(normalized, etag, content)) {
      return res.status(409).json({
        error: 'Content modified outside companion',
        code: 'HASH_MISMATCH'
      });
    }
    
    // Ensure directory exists
    await fileOps.ensureDir(path.dirname(finalPath));
    
    // Create backup and write
    const { backup } = await fileOps.write(finalPath, content);
    
    auditLogger.log('draft_promote', {
      slug: normalized,
      backup,
      approveHeader,
      approveContent
    });
    
    res.json({
      promoted: true,
      path: finalPath,
      backup,
      etag: etagManager.increment(normalized),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error promoting draft:', error);
    res.status(500).json({ error: error.message, code: 'PROMOTE_ERROR' });
  }
});

// Handle errors
app.use((error, req, res, next) => {
  auditLogger.log('server_error', {
    path: req.path,
    error: error.message
  });
  
  res.status(500).json({
    error: 'Internal server error',
    code: 'SERVER_ERROR'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  auditLogger.log('server_shutdown', {});
  process.exit(0);
});

module.exports = { app };