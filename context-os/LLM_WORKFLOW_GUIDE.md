# LLM Workflow Guide with Context-OS

**Purpose**: Step-by-step guide for LLMs to use Context-OS for compliant feature development  
**Last Updated**: 2025-09-03

---

## 🎯 The Problem Context-OS Solves

### Without Context-OS (Current State)
```
LLM receives: "Fix the memory leak in batch operations"

LLM struggles with:
- Where to create files? 
- What structure to use?
- Which status to set?
- Where do fixes go after implementation?
- How to classify severity?

Result: 6 errors, 36 warnings in validation ❌
```

### With Context-OS (Desired State)
```
LLM receives: "Fix the memory leak in batch operations"

LLM executes: context-os/create-feature.js "memory_leak_fix"

Result: Perfect structure, 0 errors ✅
```

---

## 📋 LLM Workflow Steps

### Step 1: Feature Request Arrives
When you (the LLM) receive a feature request:

```javascript
// DON'T DO THIS:
// - Start creating files randomly
// - Put documentation anywhere
// - Mix implementation with fixes

// DO THIS INSTEAD:
1. Run: node context-os/create-feature.js "feature description"
2. Answer the prompts
3. Work in the created structure
```

### Step 2: Planning Phase
```yaml
Input: "Implement user authentication"

Context-OS will:
  1. Propose slug: "user_authentication"
  2. Ask for missing plan fields:
     - Objective? → "Secure user login system"
     - Acceptance Criteria? → ["JWT tokens", "Password hashing", "Session management"]
     - Tasks? → ["Create auth endpoints", "Add middleware", "Test security"]
  3. Create complete structure at docs/proposal/user_authentication/
```

### Step 3: Implementation Phase
Once structure is created, you can:

```bash
# Safe zones for implementation:
docs/proposal/user_authentication/
├── implementation.md              # ✅ Update status here
├── implementation-details/        # ✅ Put code documentation here
│   └── artifacts/                # ✅ Put test results here
└── reports/                      # ✅ Update main report here

# Forbidden zones during implementation:
├── post-implementation-fixes/    # ❌ Not until status: COMPLETE
```

### Step 4: Testing Phase
```javascript
// Update status in implementation.md
**Status**: 🧪 TESTING

// Run tests and capture
npm test > implementation-details/artifacts/test-results.txt

// Update main report with results
✅ All tests passing
[→ Full test results](../implementation-details/artifacts/test-results.txt)
```

### Step 5: Completion
```javascript
// Update status to COMPLETE
**Status**: ✅ COMPLETE

// Add phase boundary in main report
---
<!-- Phase boundary: Implementation complete -->
```

### Step 6: Post-Implementation Fixes
After status is COMPLETE, bugs go here:

```bash
# Bug reported: "Memory leak in auth tokens"

# 1. Classify severity
Severity: High (memory grows 30%/24h)

# 2. Create fix document
docs/proposal/user_authentication/post-implementation-fixes/high/2025-09-03-memory-leak.md

# 3. Update index
docs/proposal/user_authentication/post-implementation-fixes/README.md
```

---

## 🤖 LLM-Specific Commands

### Create Feature with Validation
```bash
# Full interactive mode
node context-os/create-feature.js "Fix batch save issues"

# With draft plan (use descriptive filename)  
node context-os/create-feature.js "Fix batch save" drafts/batch-save-fix.md
```

### Validate Structure
```bash
# After creating/modifying
./scripts/validate-doc-structure.sh

# Strict mode for CI
./scripts/validate-doc-structure.sh --strict
```

### Status Transitions
```markdown
<!-- In implementation.md -->
**Status**: 📝 PLANNED       # Before work starts
**Status**: 🚧 IN PROGRESS   # During implementation
**Status**: 🧪 TESTING       # Running tests
**Status**: ✅ COMPLETE      # Implementation done
**Status**: ❌ BLOCKED       # Need human help
```

---

## 🚫 Common LLM Mistakes Prevented

### 1. Wrong Directory Structure
```bash
# LLM might create:
docs/fixes/memory-leak.md           # ❌ Wrong
docs/proposal/fixes/issue.md        # ❌ Wrong
reports/memory/leak.md              # ❌ Wrong

# Context-OS ensures:
docs/proposal/feature_name/post-implementation-fixes/high/memory-leak.md  # ✅
```

### 2. Missing Required Fields
```markdown
# LLM might forget:
- Objective
- Acceptance Criteria
- Status

# Context-OS validates and prompts for all required fields
```

### 3. Phase Violations
```javascript
// LLM might try:
if (status === 'COMPLETE') {
  editImplementationDetails();  // ❌ Forbidden
}

// Context-OS prevents this with clear boundaries
```

### 4. Inconsistent Naming
```bash
# LLM might use:
Fix-Memory-Leak.md          # ❌ Inconsistent
fix memory leak.md           # ❌ Spaces
FIX_MEMORY_LEAK.MD          # ❌ Wrong case

# Context-OS enforces:
2025-09-03-memory-leak.md   # ✅ Consistent
```

---

## 📊 Success Metrics

### Before Context-OS
- Structure Compliance: 0%
- Documentation Complete: 60%
- Proper Severity: Random
- Phase Boundaries: Missing
- Validation Errors: 6+

### After Context-OS  
- Structure Compliance: 100%
- Documentation Complete: 100%
- Proper Severity: Measured
- Phase Boundaries: Enforced
- Validation Errors: 0

---

## 🎮 Quick Start for LLMs

```bash
# 1. Receive task
Task: "Implement dark mode toggle"

# 2. Create structure
node context-os/create-feature.js "dark mode toggle"

# 3. Follow prompts
Objective? > "Add theme switching capability"
Criteria? > "Toggle works", "Preferences saved", "No flash on reload"

# 4. Work in created structure
cd docs/proposal/dark_mode_toggle
vim implementation-details/theme-implementation.md

# 5. Update status as you progress
Status: IN PROGRESS → TESTING → COMPLETE

# 6. Validate compliance
../../scripts/validate-doc-structure.sh

# Result: ✅ Perfect structure, 0 errors
```

---

## 💡 Pro Tips for LLMs

1. **Always start with Context-OS** - Don't create files manually
2. **Follow the prompts** - They ensure compliance
3. **Update status regularly** - Shows progress
4. **Use the validator** - Catches issues early
5. **Respect phase boundaries** - Implementation vs Fixes
6. **Capture artifacts** - Tests, logs, metrics
7. **Link, don't embed** - Main report has links only

---

## 🔄 Complete Example Workflow

```javascript
// Day 1: Feature Request
User: "We need to fix the annotation sync issues"

// LLM Action 1: Create Structure
$ node context-os/create-feature.js "fix annotation sync"
// Answer prompts...
✓ Feature workspace created at docs/proposal/fix_annotation_sync/

// Day 2: Implementation
// LLM updates implementation.md
**Status**: 🚧 IN PROGRESS

// LLM creates documentation
$ vim docs/proposal/fix_annotation_sync/implementation-details/sync-logic.md

// Day 3: Testing
**Status**: 🧪 TESTING
$ npm test > implementation-details/artifacts/test-results.txt
✓ All tests passing

// Day 4: Complete
**Status**: ✅ COMPLETE

// Day 5: Bug Found
User: "There's a race condition in the sync"

// LLM creates fix (status already COMPLETE)
$ vim post-implementation-fixes/high/2025-09-03-race-condition.md
$ vim post-implementation-fixes/README.md  # Update index

// Final validation
$ ./scripts/validate-doc-structure.sh
✅ All feature directories follow the Documentation Process Guide v1.4.5!
```

---

## 📚 Resources

- `context-os/create-feature.js` - Main orchestrator
- `scripts/validate-doc-structure.sh` - Compliance checker
- `docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md` - The rules
- `docs/documentation_process_guide/CONTEXT_OS_INTEGRATION_STRATEGY.md` - Strategy

---

**Remember**: Context-OS is your safety net. Use it to ensure perfect documentation structure every time!