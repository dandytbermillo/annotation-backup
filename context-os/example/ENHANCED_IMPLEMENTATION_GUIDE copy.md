# Enhanced Implementation Guide - Interactive INITIAL.md System
*Incorporating Expert's Production Upgrades*

## 🎯 Success Metric: "Boringly Reliable"

The system should be so reliable it's boring - no surprises, just consistent operation.

## 🔧 Operational Polish Items (Expert's Final Recommendations)

### Repository Configuration

**Add to `.gitignore`:**
```gitignore
# Telemetry logs
logs/init-telemetry.jsonl
logs/*.jsonl

# Session storage
.tmp/initial/*.json
.tmp/initial/

# Backup files
docs/proposal/**/INITIAL.md.backup
*.backup
```

### User Documentation Update

**Add to main README.md:**
```markdown
## Creating INITIAL.md Files

Use either command (they're the same):
- `/context-init <feature>` - Direct interactive creation
- `/context-execute <feature> --interactive` - Delegates to init

✨ One mental model, two entry points - both lead to the same interactive flow.

### Flags Available
- `--resume` - Continue interrupted session
- `--dry-run` - Preview without writing
- `--apply` - Skip confirmation prompts
- `--migrate` - Upgrade old format
- `--batch-mode` - CI/automation mode (no prompts)
```

### Documentation Process Guide Update

**Add to docs/DOCUMENTATION_PROCESS_GUIDE.md:**
```markdown
## Creating Feature Documentation

### Step 1: Create INITIAL.md
Use the interactive creation system:
```bash
/context-init <feature_slug>
```

This ensures all required fields are collected and validated.

### Alternative Entry Point
If you're already in the execute flow:
```bash
/context-execute <feature_slug> --interactive
```
This delegates to the same init system.

### Automation
For CI/CD or batch operations:
```bash
/context-init <feature_slug> --batch-mode --apply
```
```

## 📋 Implementation Upgrades (From Expert Review)

### 1. Operator Safeguards: --batch-mode Flag

**Critical for CI/CD and automation**

```javascript
// cli/init-interactive.js
const flags = {
  resume: process.argv.includes('--resume'),
  apply: process.argv.includes('--apply'),
  dryRun: process.argv.includes('--dry-run'),
  migrate: process.argv.includes('--migrate'),
  batchMode: process.argv.includes('--batch-mode'),  // NEW: Skip all prompts
  help: process.argv.includes('--help')
};

// In batch mode, use defaults instead of prompts
if (flags.batchMode) {
  console.log('🤖 Batch mode: Using defaults, no prompts');
  
  // Auto-approve applications
  if (!flags.apply) flags.apply = true;
  
  // Set default responses
  const defaults = {
    overwrite: false,  // Don't overwrite existing
    applyPatch: true,  // Auto-apply patches
    skipOptional: true // Skip optional fields
  };
}
```

**Usage in CI/Migration:**
```bash
# CI pipeline
/context-init new_feature --batch-mode --apply

# Batch migration
for feature in ${features[@]}; do
  /context-init "$feature" --migrate --batch-mode
done
```

### 2. Telemetry Fields: Mandatory Metrics

**JSONL telemetry with specific fields:**

```typescript
// telemetry/events.ts
interface InitTelemetryEvent {
  // Required fields (as specified by expert)
  sessionId: string;        // UUID for session tracking
  turns: number;            // Conversation turns with Claude
  jsonRetryCount: number;   // How many JSON retries needed
  durationMs: number;       // Total time in milliseconds
  schemaVersion: string;    // Schema version used
  outcome: 'success' | 'failed' | 'abandoned' | 'timeout';
  
  // Additional context
  feature: string;
  timestamp: string;
  resumeCount?: number;     // Times session was resumed
  validationErrors?: string[];
}

// Emit JSONL
function emitTelemetry(event: InitTelemetryEvent): void {
  const line = JSON.stringify(event) + '\n';
  fs.appendFileSync('logs/init-telemetry.jsonl', line);
  
  // Also send to monitoring service
  if (process.env.TELEMETRY_ENDPOINT) {
    fetch(process.env.TELEMETRY_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

**Example telemetry output:**
```json
{"sessionId":"550e8400-e29b-41d4-a716-446655440000","turns":5,"jsonRetryCount":1,"durationMs":45000,"schemaVersion":"1.0.0","outcome":"success","feature":"dark_mode","timestamp":"2025-01-04T10:30:00Z"}
{"sessionId":"660e8400-e29b-41d4-a716-446655440001","turns":8,"jsonRetryCount":2,"durationMs":120000,"schemaVersion":"1.0.0","outcome":"timeout","feature":"auth_system","timestamp":"2025-01-04T11:00:00Z"}
```

### 3. Config Defaults: Canonical Configuration

**Ship with `.context-os/config.json`:**

```json
{
  "init": {
    "defaults": {
      "severity": "medium",
      "requireMetrics": false,
      "autoSuggestDependencies": true
    },
    "limits": {
      "maxTurns": 8,
      "timeoutMs": 600000,
      "maxJsonRetries": 3
    },
    "schemaVersion": "1.0.0",
    "templateVersion": "1.0.0",
    "features": {
      "enableMarkers": true,
      "strictJsonValidation": true,
      "batchModeDefaults": {
        "skipOptional": true,
        "autoApprove": true,
        "overwriteExisting": false
      }
    }
  },
  "telemetry": {
    "enabled": true,
    "logPath": "logs/init-telemetry.jsonl",
    "includeDebugInfo": false
  },
  "validation": {
    "strictMode": true,
    "requiredSections": [
      "problem", "goals", "acceptanceCriteria", "stakeholders"
    ],
    "failOnWarnings": false
  }
}
```

**Load and validate config:**
```javascript
// config/loader.js
const DEFAULT_CONFIG = require('.context-os/config.json');

function loadConfig() {
  let config = { ...DEFAULT_CONFIG };
  
  // Override with environment-specific config
  if (process.env.CONTEXT_OS_CONFIG) {
    const envConfig = JSON.parse(fs.readFileSync(process.env.CONTEXT_OS_CONFIG));
    config = deepMerge(config, envConfig);
  }
  
  // Validate critical settings
  if (config.init.limits.maxTurns > 10) {
    console.warn('⚠️ maxTurns > 10 may cause long sessions');
  }
  
  return config;
}
```

### 4. CLI UX Consistency: Single Mental Model

**Ensure `/context-execute --interactive` delegates properly:**

```javascript
// cli/execute-cli.js
if (options.interactive || options.initOnly) {
  console.log('Delegating to Interactive INITIAL.md creation...');
  
  // Pass through all flags to maintain consistency
  const initArgs = ['node', 'cli/init-interactive.js', featureSlug];
  
  if (options.resume) initArgs.push('--resume');
  if (options.dryRun) initArgs.push('--dry-run');
  if (options.apply) initArgs.push('--apply');
  if (options.batchMode) initArgs.push('--batch-mode');
  
  const init = spawn(initArgs[0], initArgs.slice(1), {
    stdio: 'inherit'
  });
  
  init.on('close', (code) => {
    if (code === 0 && options.continueAfterInit) {
      // Continue with normal execute flow after INITIAL.md creation
      console.log('INITIAL.md created, continuing with feature execution...');
      executeFeature(featureSlug, options);
    } else {
      process.exit(code);
    }
  });
  return;
}
```

### 5. Ready-to-Merge Gate: Hard Validation

**Make validation a non-negotiable CI gate:**

```yaml
# .github/workflows/validate-initial.yml
name: Validate INITIAL.md

on:
  pull_request:
    paths:
      - 'docs/proposal/**/INITIAL.md'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run strict validation
        id: validate
        run: |
          # HARD GATE: Fail on any validation error or warning
          out=$(./scripts/validate-doc-structure.sh); code=$?
          echo "$out"
          # Treat warnings as errors in strict mode
          echo "$out" | grep -q "Warnings:" && exit 1
          exit $code
          
      - name: Attach patch artifact
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: initial-md-patches
          path: |
            docs/proposal/**/INITIAL.md
            docs/proposal/**/INITIAL.md.patch
            
      - name: Comment on PR
        if: failure()
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ INITIAL.md validation failed. Run `/context-validate` locally to see errors.'
            })
```

## 🚀 Fast Path to Green (Expert's Recommended Order)

### Step 1: File Promotion (Day 1)
```bash
# Move from example/ to live paths
mv context-os/example/schemas/initial-spec.ts context-os/schemas/
mv context-os/example/prompts/initial-collector.md context-os/prompts/
mv context-os/example/templates/initial.md.hbs context-os/templates/
mv context-os/example/cli/init-interactive.js context-os/cli/

# Verify moves
git status
git add -A
git commit -m "feat(init): promote interactive init files to live paths"
```

### Step 2: Wire CLI Commands (Days 2-3)
```javascript
// Implement in order of priority
1. /context-init with all flags
2. /context-execute --interactive redirect
3. /context-resume as alias for --resume
4. Batch mode for all commands
```

### Step 3: Bridge Integration (Days 4-5)
```javascript
// Implement invokeClaudeInit() with:
- Turn/time budgets enforced
- Strict JSON retry mechanism
- Session persistence to .tmp/
- Telemetry emission
```

### Step 4: CI Gates & Telemetry (Days 6-7)
```yaml
# Add to CI pipeline:
- Strict validation gate
- Telemetry collection
- Patch artifact upload
- Auto-comment on failures
```

### Step 5: Pilot Migration (Days 8-10)
```bash
# Test on 2-3 features
features=("dark_mode" "search_feature" "auth_system")

for feature in "${features[@]}"; do
  echo "Migrating $feature..."
  /context-init "$feature" --migrate --batch-mode
  
  # Verify
  /context-validate "$feature" --strict
  
  # Rollback if needed
  if [ $? -ne 0 ]; then
    mv "docs/proposal/$feature/INITIAL.md.backup" \
       "docs/proposal/$feature/INITIAL.md"
  fi
done
```

## 📊 Production Monitoring

### Key Metrics to Track

```javascript
// Dashboard queries for "boringly reliable"
const metrics = {
  // Success rate (target: >95%)
  successRate: `
    SELECT COUNT(*) FILTER (WHERE outcome = 'success') * 100.0 / COUNT(*)
    FROM telemetry
    WHERE timestamp > NOW() - INTERVAL '7 days'
  `,
  
  // Average completion time (target: <5 min)
  avgDuration: `
    SELECT AVG(durationMs) / 1000.0 as seconds
    FROM telemetry
    WHERE outcome = 'success'
  `,
  
  // JSON retry rate (target: <10%)
  retryRate: `
    SELECT AVG(jsonRetryCount) as avg_retries
    FROM telemetry
  `,
  
  // Resume usage (interesting metric)
  resumeRate: `
    SELECT COUNT(*) FILTER (WHERE resumeCount > 0) * 100.0 / COUNT(*)
    FROM telemetry
  `
};
```

### Alert Thresholds

```yaml
alerts:
  - name: high_failure_rate
    condition: successRate < 90
    severity: warning
    
  - name: excessive_retries
    condition: avgJsonRetries > 2
    severity: warning
    
  - name: long_sessions
    condition: p95Duration > 600000  # 10 minutes
    severity: info
```

## 🔨 Critical Helper Scripts (Last-Mile Implementation)

### 1. Section Validator: `validate-initial-sections.js`

**Purpose**: Enforces required sections from config.json

```javascript
// Usage Examples
node scripts/validate-initial-sections.js --feature dark_mode --json
node scripts/validate-initial-sections.js --all --json

// What it validates:
// - Required sections exist (title, problem, goals, acceptanceCriteria, stakeholders)
// - Sections are non-empty
// - Minimum bullet counts (goals ≥ 3, acceptanceCriteria ≥ 3, stakeholders ≥ 2)
```

**CI Integration:**
```yaml
- name: Validate INITIAL.md sections
  run: node scripts/validate-initial-sections.js --all --json
  
- name: Fail on validation errors
  if: failure()
  run: exit 1
```

**Output Format:**
```json
{
  "ok": false,
  "results": [{
    "feature": "dark_mode",
    "status": "fail",
    "missing": ["stakeholders"],
    "empty": ["goals:minBullets<3"],
    "counts": {"goals": 2, "acceptanceCriteria": 3}
  }]
}
```

**Configuration:** To customize required sections, create `.context-os/config.json`:
```json
{
  "validation": {
    "requiredSections": ["title", "problem", "goals", "acceptanceCriteria", "stakeholders"],
    "minBullets": {
      "goals": 3,
      "acceptanceCriteria": 3,
      "stakeholders": 2
    }
  }
}
```

### 2. Patch Generator: `make-initial-patch.js`

**Purpose**: Creates actual .patch files for CI artifacts

```javascript
// Usage Examples
node scripts/make-initial-patch.js --feature dark_mode --proposed .tmp/initial/dark_mode.md
cat new-initial.md | node scripts/make-initial-patch.js --feature auth_system

// What it does:
// - Generates unified diff using git diff (fallbacks available)
// - Creates docs/proposal/<feature>/INITIAL.md.patch
// - Returns statistics (lines added/removed)
```

**CI Integration:**
```yaml
- name: Generate patches
  run: |
    for feature in $(ls docs/proposal/); do
      if [ -f ".tmp/initial/$feature.md" ]; then
        node scripts/make-initial-patch.js --feature "$feature" --proposed ".tmp/initial/$feature.md"
      fi
    done

- name: Upload patches
  uses: actions/upload-artifact@v3
  with:
    name: initial-patches
    path: docs/proposal/**/INITIAL.md.patch
```

**Output Format:**
```json
{
  "ok": true,
  "feature": "dark_mode",
  "patch": "docs/proposal/dark_mode/INITIAL.md.patch",
  "added": 42,
  "removed": 3
}
```

### 3. NPM Script Integration

```json
{
  "scripts": {
    "doc:validate:initial": "node scripts/validate-initial-sections.js --all --json",
    "doc:validate:feature": "node scripts/validate-initial-sections.js",
    "doc:patch:initial": "node scripts/make-initial-patch.js",
    "doc:patch:all": "for f in docs/proposal/*; do npm run doc:patch:initial -- --feature $(basename $f) --proposed .tmp/initial/$(basename $f).md; done"
  }
}
```

**Usage with arguments:**
```bash
# Validate specific feature (note the -- before arguments)
npm run doc:validate:feature -- --feature dark_mode --json

# Create patch for specific feature
npm run doc:patch:initial -- --feature dark_mode --proposed .tmp/initial/dark_mode.md

# Run all patches
npm run doc:patch:all
```

## ✅ Definition of Done

The system is "boringly reliable" when:

1. **Success rate > 95%** for 30 consecutive days
2. **No P0/P1 incidents** related to INITIAL.md creation
3. **JSON retry rate < 5%** consistently
4. **User complaints = 0** about the interactive flow
5. **Migration completed** for all existing features
6. **Telemetry shows** predictable patterns
7. **All validations pass** in CI automatically
8. **Patch artifacts** generated for every change

## 🎯 Expert's Final Verdict

> "Proceed exactly as outlined and keep the patch-first, human-in-the-loop defaults until the telemetry shows 'boringly reliable.'"

### Complete Implementation Checklist

✅ **Proposal & Design** - Complete with expert validation
✅ **5 Production Upgrades** - All incorporated
✅ **Operational Polish** - .gitignore, README, Process Guide updates
✅ **Validation Script** - validate-initial-sections.js created
✅ **Patch Script** - make-initial-patch.js created
⏳ **Implementation** - Ready to execute with all pieces in place

This enhanced guide incorporates all expert recommendations and provides the complete toolkit for a production-grade system.