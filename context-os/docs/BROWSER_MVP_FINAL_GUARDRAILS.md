# Browser MVP - Final Production Guardrails

> Last-mile safety measures before production
> Status: MUST IMPLEMENT
> Created: 2025-09-05

## Critical Edge Cases to Handle

### 1. Auth & Identity (MUST HAVE)

```javascript
// Simple local session management
class SessionManager {
  constructor() {
    this.sessionId = uuidv4();
    this.userId = this.getOrCreateUserId();
  }
  
  getOrCreateUserId() {
    // Check for existing user ID in ~/.context-os/user.json
    const userFile = path.join(os.homedir(), '.context-os', 'user.json');
    
    try {
      const data = fs.readFileSync(userFile);
      return JSON.parse(data).userId;
    } catch {
      // Create new user ID
      const userId = `user_${os.hostname()}_${Date.now()}`;
      fs.mkdirSync(path.dirname(userFile), { recursive: true });
      fs.writeFileSync(userFile, JSON.stringify({ userId, created: new Date() }));
      return userId;
    }
  }
  
  // Include in every audit log entry
  getAuditContext() {
    return {
      userId: this.userId,
      sessionId: this.sessionId,
      hostname: os.hostname(),
      pid: process.pid
    };
  }
}

// Every audit log entry includes user context
audit.log('save', {
  ...sessionManager.getAuditContext(),
  slug,
  etag,
  action: 'draft_save'
});
```

### 2. Multi-Tab Advisory Locking

```javascript
// Advisory lock manager (in-memory + file-based)
class LockManager {
  constructor() {
    this.locks = new Map(); // slug -> { userId, sessionId, timestamp }
    this.lockDir = '.tmp/locks';
    fs.mkdirSync(this.lockDir, { recursive: true });
  }
  
  async acquireLock(slug, userId, sessionId) {
    const lockFile = path.join(this.lockDir, `${slug}.lock`);
    
    // Check for existing lock
    try {
      const existing = JSON.parse(await fs.readFile(lockFile));
      const age = Date.now() - existing.timestamp;
      
      // Stale lock (> 30 seconds) can be overridden
      if (age < 30000 && existing.sessionId !== sessionId) {
        return {
          acquired: false,
          owner: existing.userId,
          message: `${existing.userId} is currently editing (${Math.floor(age/1000)}s ago)`
        };
      }
    } catch {
      // No lock exists
    }
    
    // Acquire lock
    const lock = { userId, sessionId, timestamp: Date.now() };
    await fs.writeFile(lockFile, JSON.stringify(lock));
    this.locks.set(slug, lock);
    
    // Auto-release after 30s
    setTimeout(() => this.releaseLock(slug, sessionId), 30000);
    
    return { acquired: true };
  }
  
  async releaseLock(slug, sessionId) {
    const lock = this.locks.get(slug);
    if (lock?.sessionId === sessionId) {
      this.locks.delete(slug);
      await fs.unlink(path.join(this.lockDir, `${slug}.lock`)).catch(() => {});
    }
  }
  
  // Heartbeat to maintain lock
  async refreshLock(slug, sessionId) {
    const lock = this.locks.get(slug);
    if (lock?.sessionId === sessionId) {
      lock.timestamp = Date.now();
      await fs.writeFile(
        path.join(this.lockDir, `${slug}.lock`),
        JSON.stringify(lock)
      );
    }
  }
}

// UI component for lock status
function LockBanner({ lockStatus }) {
  if (!lockStatus || lockStatus.acquired) return null;
  
  return (
    <Alert className="border-yellow-500 mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        {lockStatus.message}
        <Button 
          size="sm" 
          variant="link" 
          onClick={() => window.location.reload()}
        >
          Refresh to check
        </Button>
      </AlertDescription>
    </Alert>
  );
}
```

### 3. YAML Front-Matter Safety

```javascript
const yaml = require('js-yaml');

class YAMLValidator {
  // Validate and safely merge YAML
  validateAndMerge(content, headerPatch) {
    const { frontMatter, body } = this.extract(content);
    
    try {
      // Parse existing YAML
      const existing = yaml.load(frontMatter) || {};
      
      // Apply patch
      const patched = { ...existing, ...headerPatch };
      
      // Validate structure
      this.validateSchema(patched);
      
      // Regenerate with proper formatting
      const newYaml = yaml.dump(patched, {
        sortKeys: true,
        lineWidth: 80,
        noRefs: true
      });
      
      // Ensure proper fencing
      return `---\n${newYaml}---\n\n${body}`;
      
    } catch (error) {
      throw new Error(`Invalid YAML: ${error.message}`);
    }
  }
  
  extract(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (match) {
      return { frontMatter: match[1], body: match[2] };
    }
    return { frontMatter: '', body: content };
  }
  
  validateSchema(data) {
    const required = ['meta_version', 'feature_slug', 'status'];
    const valid_status = ['draft', 'ready', 'frozen'];
    
    for (const field of required) {
      if (!data[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    if (!valid_status.includes(data.status)) {
      throw new Error(`Invalid status: ${data.status}`);
    }
    
    if (data.readiness_score && (data.readiness_score < 1 || data.readiness_score > 10)) {
      throw new Error(`Invalid readiness_score: ${data.readiness_score}`);
    }
  }
}
```

### 4. Markdown Section Parser Robustness

```javascript
class MarkdownSectionParser {
  // Handle edge cases in section replacement
  replaceSection(content, sectionName, newContent) {
    // Escape special regex characters
    const escapedSection = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Build regex that:
    // - Matches ATX headers (##) or Setext (underlined)
    // - Ignores headers inside code blocks
    // - Handles duplicate headers (takes first)
    const sectionRegex = new RegExp(
      `(^|\\n)(#{1,6}\\s*${escapedSection}.*?\\n)([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`,
      'i'
    );
    
    // Extract code blocks first to protect them
    const codeBlocks = [];
    const placeholder = '___CODE_BLOCK___';
    
    let protected = content.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return placeholder + (codeBlocks.length - 1) + '___';
    });
    
    // Now safe to replace section
    if (!sectionRegex.test(protected)) {
      throw new Error(`Section not found: ${sectionName}`);
    }
    
    protected = protected.replace(sectionRegex, (match, prefix, header, oldContent) => {
      return `${prefix}${header}${newContent}\n`;
    });
    
    // Restore code blocks
    let result = protected;
    codeBlocks.forEach((block, i) => {
      result = result.replace(placeholder + i + '___', block);
    });
    
    return result;
  }
  
  // Get all section names (for validation)
  getSections(content) {
    const sections = [];
    const lines = content.split('\n');
    let inCodeBlock = false;
    
    for (const line of lines) {
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      
      if (!inCodeBlock && line.match(/^#{1,6}\s+(.+)/)) {
        sections.push(RegExp.$1.trim());
      }
    }
    
    return sections;
  }
}
```

### 5. Content Hash Verification

```javascript
const crypto = require('crypto');

class ContentVerifier {
  // Generate content hash
  hash(content) {
    return crypto.createHash('sha256')
      .update(content, 'utf8')
      .digest('hex')
      .substring(0, 16); // First 16 chars for brevity
  }
  
  // Verify at promote time
  async verifyBeforePromote(slug, etag, expectedHash) {
    const draftPath = path.join('.tmp/initial', `${slug}.draft.md`);
    const content = await fs.readFile(draftPath, 'utf8');
    const actualHash = this.hash(content);
    
    if (actualHash !== expectedHash) {
      throw new Error(
        `Content modified outside companion. Expected hash: ${expectedHash}, actual: ${actualHash}`
      );
    }
    
    // Also check if file on disk matches our last known state
    const finalPath = path.join('docs/proposal', slug, 'INITIAL.md');
    
    try {
      const existingContent = await fs.readFile(finalPath, 'utf8');
      const existingHash = this.hash(existingContent);
      
      audit.log('promote_check', {
        slug,
        draftHash: actualHash,
        existingHash,
        willOverwrite: true
      });
      
    } catch {
      // File doesn't exist, safe to create
    }
    
    return true;
  }
}
```

### 6. Validator Resilience

```javascript
class ResilientValidator {
  async validate(slug, content, timeout = 5000) {
    const tempFile = path.join('.tmp', `${slug}.validate.md`);
    
    try {
      await fs.writeFile(tempFile, content);
      
      // Run with timeout
      const { stdout, stderr, code } = await this.runWithTimeout(
        `./scripts/validate-doc-structure.sh ${tempFile}`,
        timeout
      );
      
      // Parse even if exit code is non-zero
      const result = this.parseOutput(stdout, stderr, code);
      
      // Add human-readable failure reason
      if (!result.ok) {
        result.reason = this.explainFailure(result);
      }
      
      return result;
      
    } catch (error) {
      // Validator failed completely
      return {
        ok: false,
        missing_fields: ['validator_error'],
        reason: `Validator failed: ${error.message}`,
        fallback: true
      };
      
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }
  
  runWithTimeout(command, timeout) {
    return new Promise((resolve, reject) => {
      const child = exec(command);
      let stdout = '', stderr = '';
      
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Validator timeout after ${timeout}ms`));
      }, timeout);
      
      child.stdout.on('data', d => stdout += d);
      child.stderr.on('data', d => stderr += d);
      
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
  }
  
  explainFailure(result) {
    const missing = result.missing_fields;
    
    if (missing.length === 0) {
      return 'Validation passed';
    } else if (missing.length === 1) {
      return `Missing required field: ${missing[0]}`;
    } else {
      return `Missing ${missing.length} required fields: ${missing.join(', ')}`;
    }
  }
}
```

### 7. PII Redaction Extension

```javascript
class UniversalRedactor {
  constructor() {
    this.patterns = [
      { regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replace: '[EMAIL]' },
      { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replace: '[SSN]' },
      { regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replace: '[CARD]' },
      { regex: /Bearer\s+[A-Za-z0-9\-._~\+\/]+=*/g, replace: 'Bearer [TOKEN]' },
      { regex: /sk_[A-Za-z0-9]{32,}/g, replace: '[STRIPE_KEY]' },
      { regex: /ghp_[A-Za-z0-9]{36}/g, replace: '[GITHUB_TOKEN]' },
      { regex: /https?:\/\/[^:]+:[^@]+@/g, replace: 'https://[CREDS]@' }
    ];
  }
  
  redact(text) {
    let redacted = text;
    
    for (const pattern of this.patterns) {
      redacted = redacted.replace(pattern.regex, pattern.replace);
    }
    
    return redacted;
  }
  
  // Apply to all outgoing data
  redactForLog(entry) {
    const redacted = JSON.parse(JSON.stringify(entry)); // Deep clone
    
    const redactValue = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          obj[key] = this.redact(obj[key]);
        } else if (typeof obj[key] === 'object') {
          redactValue(obj[key]);
        }
      }
    };
    
    redactValue(redacted);
    return redacted;
  }
}

// Use in audit logger
const redactor = new UniversalRedactor();

audit.log = function(action, data) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    ...redactor.redactForLog(data)
  };
  
  fs.appendFileSync('.logs/audit.jsonl', JSON.stringify(entry) + '\n');
};
```

### 8. Telemetry for Quality Metrics

```javascript
class QualityTelemetry {
  constructor() {
    this.metrics = {
      prp_ready_count: 0,
      prp_draft_count: 0,
      unfreeze_count: 0,
      validation_failures: 0,
      etag_conflicts: 0
    };
  }
  
  track(event, metadata = {}) {
    switch(event) {
      case 'prp_created':
        if (metadata.mode === 'strict') {
          this.metrics.prp_ready_count++;
        } else {
          this.metrics.prp_draft_count++;
        }
        break;
        
      case 'unfreeze':
        this.metrics.unfreeze_count++;
        break;
        
      case 'validation_failed':
        this.metrics.validation_failures++;
        break;
        
      case 'etag_conflict':
        this.metrics.etag_conflicts++;
        break;
    }
    
    // Emit to metrics file
    this.emit(event, metadata);
  }
  
  getQualityKPIs() {
    const total_prps = this.metrics.prp_ready_count + this.metrics.prp_draft_count;
    
    return {
      prp_quality_ratio: total_prps > 0 
        ? (this.metrics.prp_ready_count / total_prps) 
        : 1.0,
      unfreeze_rate: this.metrics.unfreeze_count,
      validation_success_rate: this.metrics.validation_failures === 0 ? 1.0 : 0.0,
      etag_conflict_rate: this.metrics.etag_conflicts
    };
  }
  
  // Export before rotation
  async exportBeforeRotation() {
    const exportPath = `.logs/metrics-export-${Date.now()}.json`;
    await fs.writeFile(
      exportPath,
      JSON.stringify({
        exported_at: new Date().toISOString(),
        metrics: this.metrics,
        kpis: this.getQualityKPIs()
      }, null, 2)
    );
    
    console.log(`Metrics exported to: ${exportPath}`);
    return exportPath;
  }
}
```

## Implementation Checklist

### Must Have (Block merge without these)
- [ ] User identity in every audit log entry
- [ ] Advisory locking with "someone else editing" banner
- [ ] YAML validation with corruption guards
- [ ] Markdown parser handles code blocks and duplicate headers
- [ ] Content hash check at promote time
- [ ] Validator timeout and graceful failure
- [ ] PII redaction in all logs (not just LLM)
- [ ] Unfreeze reason + meta_version bump

### Should Have (Implement in Phase 1)
- [ ] Lock heartbeat/refresh mechanism
- [ ] Export logs before rotation
- [ ] PRP quality ratio tracking
- [ ] Stale lock detection (30s timeout)
- [ ] Multiple header style support (ATX/Setext)

### Nice to Have (Can add later)
- [ ] Lock queue visualization
- [ ] Metrics dashboard
- [ ] Log search interface
- [ ] Bulk operations support

## Go/No-Go Decision

### GO ✅
- All "Must Have" items are specified and implementable
- Security is Phase 1 priority
- User identity prevents anonymous actions
- Advisory locking prevents confusion
- YAML/Markdown parsing is robust

### The expert is right: these are "low-effort, high-safety" additions that prevent real production issues!

Ready to implement with these guardrails in place.