# Browser MVP Implementation Plan - Addendum

> Expert feedback incorporated
> Created: 2025-09-05

## 1. Fix: Correct PRP Flow (CRITICAL)

### Wrong (Current POC)
```javascript
// ❌ Promotes before PRP creation
async function handleCreatePRP() {
  await promote();  // WRONG ORDER!
  await createPRP();
}
```

### Correct Implementation
```javascript
// ✅ Only promote when ready AND after PRP approved
async function handleCreatePRP() {
  const { mode, shouldPromote } = determineMode();
  
  // 1. Create PRP (draft or final)
  const prp = await createPRP(slug, mode, etag);
  
  // 2. Show PRP preview
  const approved = await showPRPPreview(prp);
  
  // 3. Only promote if ready + approved
  if (shouldPromote && approved) {
    await promote(slug, etag);
  }
}

function determineMode() {
  if (reportCard?.prp_gate?.allowed) {
    return { mode: 'strict', shouldPromote: true };
  } else {
    return { mode: 'draft', shouldPromote: false };
  }
}
```

## 2. Observability Layer (New)

### Metrics to Track
```typescript
interface CompanionMetrics {
  counters: {
    'api.request': { endpoint, status, error_code? }
    'validation.run': { slug, result: 'pass'|'fail' }
    'llm.call': { type: 'verify'|'fill', success }
    'file.operation': { type: 'save'|'promote', result }
  };
  
  histograms: {
    'api.latency': { endpoint, p50, p95, p99 }
    'validation.duration': { p50, p95, p99 }
    'llm.latency': { type, p50, p95, p99 }
  };
  
  alerts: {
    'repeated.stale_etag': threshold(5, '1m')
    'repeated.path_forbidden': threshold(3, '1m')
    'validation.slow': threshold(p95 > 2000ms)
    'llm.timeout': threshold(3, '5m')
  };
}

// Emit to console/file for now, Prometheus later
function emitMetric(type: string, data: any) {
  const entry = {
    timestamp: new Date().toISOString(),
    metric_type: type,
    ...data
  };
  fs.appendFileSync('.logs/metrics.jsonl', JSON.stringify(entry) + '\n');
}
```

### Success Metrics (Updated)
- **Verify latency**: p95 < 2s, p99 < 3s
- **Save success rate**: > 99.9%
- **Stale ETag rate**: < 5% (indicates good debouncing)
- **LLM availability**: > 95% (with graceful degradation)

## 3. Data Retention & Redaction

### Configuration
```javascript
const RETENTION_CONFIG = {
  backups: {
    maxCount: 5,           // Keep last 5 backups
    maxAge: 7 * 24 * 3600, // 7 days in seconds
    pattern: '.bak.*'
  },
  
  auditLog: {
    maxSize: 100 * 1024 * 1024,  // 100MB
    rotation: 'daily',
    retention: 30,                // 30 days
    compress: true                 // gzip old logs
  },
  
  drafts: {
    maxAge: 24 * 3600,    // Clean up drafts older than 24h
    excludeActive: true    // Don't delete if recently accessed
  }
};
```

### Redaction for LLM Payloads
```javascript
function redactSensitive(content: string): string {
  // Redact tokens/keys
  content = content.replace(/([A-Z0-9]{20,})/g, '[REDACTED_TOKEN]');
  
  // Redact URLs with credentials
  content = content.replace(
    /https?:\/\/[^:]+:[^@]+@[^\s]+/g, 
    '[REDACTED_URL]'
  );
  
  // Redact email addresses (optional)
  content = content.replace(
    /[\w._%+-]+@[\w.-]+\.[A-Z]{2,}/gi,
    '[EMAIL]'
  );
  
  return content;
}

// Apply before sending to LLM
const sanitizedContent = redactSensitive(draftContent);
```

## 4. Frozen State UI Affordance

### Visual Indicators
```tsx
function FrozenBadge({ status, onUnfreeze }) {
  if (status !== 'frozen') return null;
  
  return (
    <Alert className="border-blue-500">
      <Lock className="h-4 w-4" />
      <AlertDescription>
        <div className="flex justify-between">
          <span>
            Document frozen - Implementation in progress.
            Semantic edits blocked.
          </span>
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => {
              if (confirm('Unfreeze will reset status. Continue?')) {
                onUnfreeze();
              }
            }}
          >
            Unfreeze
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
```

### Field-Level Blocking
```javascript
function isFieldEditable(field: string, status: string): boolean {
  const semanticFields = ['problem', 'goals', 'intent_summary'];
  
  if (status === 'frozen' && semanticFields.includes(field)) {
    return false; // Show lock icon, disable editing
  }
  
  return true;
}
```

## 5. Offline/LLM-Down Graceful Mode

### Fallback Implementation
```javascript
async function verifyWithFallback(content: string, slug: string) {
  try {
    // Try LLM first
    return await llmVerify(content, slug);
  } catch (error) {
    console.warn('LLM unavailable, using local validation only');
    
    // Fallback to local validation + rubric
    const validation = await validate(content, slug);
    const score = calculateReadinessScore(validation);
    
    return {
      header_meta: {
        status: score >= THRESHOLD ? 'ready' : 'draft',
        readiness_score: score,
        missing_fields: validation.missing_fields,
        confidence: 0.5, // Lower confidence without LLM
        validator: 'local-only'
      },
      suggestions: [
        'LLM unavailable - showing basic validation only',
        ...generateLocalSuggestions(validation)
      ],
      prp_gate: {
        allowed: score >= THRESHOLD,
        reason: 'Based on local validation',
        next_best_action: validation.missing_fields[0] 
          ? `Add ${validation.missing_fields[0]}`
          : 'Ready for PRP'
      },
      offline_mode: true
    };
  }
}

// Local suggestion generator
function generateLocalSuggestions(validation: ValidationResult): string[] {
  const suggestions = [];
  
  if (validation.missing_fields.includes('goals')) {
    suggestions.push('Add 3-7 clear, measurable goals');
  }
  
  if (validation.warnings.includes('problem_too_short')) {
    suggestions.push('Expand problem statement to 3-6 sentences');
  }
  
  return suggestions;
}
```

## 6. CI Pipeline Setup

### GitHub Actions Workflow
```yaml
# .github/workflows/context-os-mvp.yml
name: Context-OS Browser MVP

on:
  push:
    branches: [feat/context-os-browser-mvp]
  pull_request:
    branches: [main, dev]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run lint
        run: npm run lint
      
      - name: Type check
        run: npm run type-check
      
      - name: Unit tests
        run: npm test
      
      - name: Start companion
        run: |
          node context-os/companion/server.js &
          sleep 2
          curl http://localhost:4000/api/health
      
      - name: Contract tests
        run: npm run test:contracts
      
      - name: 10-minute smoke test
        run: |
          npm run test:smoke -- \
            --feature=test_mvp \
            --timeout=600
      
      - name: Security scan
        run: |
          # Check for exposed ports
          netstat -an | grep LISTEN | grep -v 127.0.0.1
          
          # Verify CSRF protection
          curl -X POST http://localhost:4000/api/draft/save \
            -H "Content-Type: application/json" \
            -d '{"slug":"test"}' | grep "CSRF_REQUIRED"
```

### Required Checks
```javascript
// package.json scripts
{
  "scripts": {
    "test:contracts": "jest __tests__/contracts --coverage",
    "test:smoke": "node tests/smoke-test.js",
    "test:security": "node tests/security-audit.js"
  }
}
```

## Summary of Changes

1. ✅ **Fixed premature promotion** - PRP first, then optional promote
2. ✅ **Added observability** - Metrics, alerts, latency tracking
3. ✅ **Data retention/redaction** - Configurable retention, sensitive data scrubbing
4. ✅ **Frozen state UI** - Visual indicators, unfreeze button
5. ✅ **Offline graceful mode** - Local validation fallback when LLM down
6. ✅ **CI pipeline** - Smoke tests, contract tests, security checks

These additions make the system production-ready with proper monitoring, safety, and resilience.