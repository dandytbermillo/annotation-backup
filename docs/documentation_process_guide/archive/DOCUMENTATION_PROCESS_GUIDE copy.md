# Documentation Process Guide for Feature Implementation and Bug Fixes

**Version**: 1.4.5  
**Last Updated**: 2025-09-03  
**Changes**: 
- v1.1.0: Added severity-based documentation requirements, expert review process, inline artifacts guidance, and simplified structure for minor fixes
- v1.2.0: Added Implementation Plan and Report Relationship section, clarified naming conventions for main reports
- v1.3.0: Standardized Post-Implementation Fixes structure - all fixes in subdirectories with links from main report
- v1.4.0: Implemented Table of Contents style reports - main reports as navigation hubs with 100% compliance checklist
- v1.4.1: Added objective severity criteria with measurable thresholds, environment multipliers, and severity classification checklist to bug fix template
- v1.4.2: Added comprehensive README.md template for post-implementation-fixes, classification examples table, FAQ, quick reference card, and detailed metric definitions
- v1.4.3: Added Process Documentation rule to clarify where meta-documentation belongs, formalized existing convention
- v1.4.4: Added Implementation Status Values rule with minimal three-status system including BLOCKED status for visibility
- v1.4.5: Added Patches Directory rule with simplified structure and clear usage guidelines  
**Purpose**: Standardize documentation practices for all feature implementations and bug fixes

## ACTIVE RULES (Authoritative — follow these only)

These are the only rules to use today. Ignore any conflicting guidance below; it is historical.

Repository policy override (this repo): PRP workflow is disabled. Use INITIAL.md (or Implementation-Plan.md) inside each feature folder under docs/proposal/<feature>/, and place Implementation Reports under docs/proposal/<feature>/reports/. Do not create PRPs/ files for this repository.

1) Directory Structure
- Feature dirs use: `reports/` (single main Implementation-Report), `implementation-details/`, and `post-implementation-fixes/` with `README.md` index and severity subfolders.
- Do not use `reports/.../fixes/`.

2) Main Implementation Report (TOC/dashboard)
- Links-only; no inline code/commands/diffs; 2–3 sentence Executive Summary.
- Include: Scope of Implementation, Key Metrics table, Code Changes (counts + links), Acceptance Criteria (checkmarks only).
- Include explicit `---` phase boundary; add "Post-Implementation Fixes" section with links only.

3) Post-Implementation Fixes
- All fixes AFTER Status: COMPLETE go under `post-implementation-fixes/<severity>/` with full details there.
- Main report contains links to fixes only; no severity counts in the main report.

4) Inline Content and Artifacts
- Main implementation report: no inline commands/diffs/logs.
- Fix reports: short inline snippets OK; long outputs go to `.../artifacts/`.

5) Severity Classification (Objective Criteria)
- **Critical**: Data loss, security (any env), prod failure, >50% perf degradation (p95 1-hour)
- **High**: Memory leak >25%/24h, 25-50% perf, >10% users affected (per hour)
- **Medium**: 10-25% perf degradation, UX disrupted, non-critical broken
- **Low**: <10% perf impact, cosmetic, code quality, dev-only (except security)
- **Environment Multiplier**: Production (as-is), Staging (-1 level), Dev (-2 levels)
- **EXCEPTION**: Security issues always Critical regardless of environment
- **Measurement Windows**: Performance: 1-hour p95 | Memory: 24-hour | User impact: per-hour
- **Classification Examples**: 147% CPU in Dev = Medium (Critical -2), SQL injection in Dev = Critical (exception)
- Document specific metrics in fix reports (%, time windows, user counts)

6) Process Documentation
- Documentation about the documentation process goes in: `docs/documentation_process_guide/`
- Documentation about specific features goes in: `docs/proposal/<feature>/`
- The main Documentation Process Guide stays at `docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md` (for compatibility)
- This rule ensures clean separation with minimal disruption

7) Implementation Status Values
- 🚧 IN PROGRESS - Active work on the feature (default for all work)
- ✅ COMPLETE - All criteria met, implementation phase ends (cannot go backward)
- ❌ BLOCKED - Cannot proceed, requires human intervention (must include reason)

8) Patches Directory (Optional)
- Location: `docs/proposal/<feature_slug>/patches/` (flat directory per feature)
- Purpose: Store proposed code changes as `git format-patch` files when direct edits are not appropriate
- When to use (any of):
  - Requires review/approval before merge (e.g., expert review)
  - Risky or reversible change where a precise audit trail matters
  - External contributor's change or cross-repo coordination
- Naming: `YYYY-MM-DD-descriptive-name.patch` (e.g., `2025-09-03-fix-memory-leak.patch`)
- Documentation: Maintain a single `patches/README.md` index explaining each patch (what/why/how to apply)
- Linking: Reference the patch from the related implementation or fix report under **Related → Patch**

---

## DEPRECATED (Do Not Use)

- "Inline artifacts for <10 LOC" in the main implementation report (legacy v1.1 guidance).
- Any `reports/.../fixes/` paths — use `post-implementation-fixes/<severity>/`.

---

Note: The sections below are historical/background and may include examples that do not conform to Active Rules.

## Creating Feature Documentation

### Step 1: Create INITIAL.md with Interactive System
Use the interactive creation system to ensure all required fields are collected:

```bash
# Direct interactive creation
/context-init <feature_slug>

# Alternative entry point (delegates to same system)
/context-execute <feature_slug> --interactive
```

This interactive system ensures:
- All required sections are included (title, problem, goals, acceptanceCriteria, stakeholders)
- Proper schema validation (v1.0.0)
- Session persistence for resumability
- Automatic telemetry tracking

### Step 2: Automation for CI/CD
For batch operations or CI/CD pipelines:

```bash
# Create without prompts
/context-init <feature_slug> --batch-mode --apply

# Migrate existing documentation
/context-init <feature_slug> --migrate --batch-mode

# Dry run to preview changes
/context-init <feature_slug> --dry-run
```

### Step 3: Validate Created Documentation
After creation, validate the INITIAL.md meets standards:

```bash
# Validate single feature
node scripts/validate-initial-sections.js --feature <feature_slug> --json

# Validate all features
node scripts/validate-initial-sections.js --all --json
```

## Overview

This guide defines the standard process for documenting feature implementations, bug fixes, and improvements. All implementations MUST follow this structure to maintain consistency and traceability.

## Directory Structure

### Feature Workspace Structure (v1.4.0 Standard)
```
docs/proposal/<feature_slug>/
├── Implementation-Plan.md (or INITIAL.md serving as the plan)
├── reports/
│   └── Implementation-Report.md        # Main report (navigation hub only)
├── implementation-details/             # Detailed implementation documentation
│   ├── [technical-docs].md
│   ├── files-modified.md              # List of all changed files
│   └── artifacts/                     # Test results, logs, screenshots
│       ├── test-results.md
│       ├── benchmarks.md
│       └── diffs.md
├── post-implementation-fixes/         # Issues found AFTER Status: COMPLETE
│   ├── README.md                      # MANDATORY index with statistics
│   ├── critical/
│   ├── high/
│   ├── medium/
│   └── low/
├── patches/                           # Optional code patches
│   ├── implementation/
│   └── post-impl/
├── test_scripts/
├── test_pages/
└── supporting_files/
```

### Legacy Paths Clarification
- fixing_doc is deprecated. Do not use for new documentation.
- Always place new implementation reports under reports/. Place all post-implementation fixes under post-implementation-fixes/.
- When updating older work found in fixing_doc, prefer moving or linking it from reports/ and note the migration in the updated report.

## Implementation Plan and Report Relationship

### Naming and Linking Requirements
Every implementation plan MUST have a corresponding main implementation report that clearly identifies the relationship:

1. **Option A - Descriptive Naming** (Preferred):
   - Plan: `<Feature-Name>.md` or `IMPLEMENTATION_PLAN.md`
   - Main Report: `<Feature-Name>-Implementation-Report.md`
   - Example: `Interval-Free-Batch-Cleanup.md` → `Interval-Free-Batch-Cleanup-Implementation-Report.md`

2. **Option B - Date-Based Naming with Header Link**:
   - Plan: `<Feature-Name>.md` or `IMPLEMENTATION_PLAN.md`
   - Main Report: `YYYY-MM-DD-<phase>-implementation-report.md`
   - **Required**: Add header link in report:
     ```markdown
     **Main Implementation Report for**: [<Plan-Name>.md](../<Plan-Name>.md)
     ```

### Main Report Identification
- Each feature MUST have exactly ONE main implementation report
- Additional fix reports go under post-implementation-fixes/; the main implementation report remains the single source of overall status
- The main report tracks overall implementation status and links to sub-reports

### Example Structure
```
docs/proposal/Example_Feature/
├── Example-Feature.md                           # Implementation Plan
├── reports/
│   ├── Example-Feature-Implementation-Report.md # Main Report (clear naming)
│   # OR
│   ├── 2025-09-02-implementation-report.md      # Main Report (with header link)
└── post-implementation-fixes/
    └── critical/
        └── 2025-09-02-specific-fix.md           # Fix report (full details)
```

## Post-Implementation Fixes Structure

### Standard Approach for All Fixes
Post-implementation fixes discovered after the initial implementation is "complete" should follow a consistent structure:

1. **In Main Implementation Report**:
   - Add a `## Post-Implementation Fixes` section after the `---` phase boundary
   - Include ONLY a link to the README index
   - Optionally list recent fixes as simple links
   - **NO code, NO severity counts, NO implementation details**

2. **In post-implementation-fixes/README.md** (MANDATORY):
   - Total fix count and status summary
   - Severity breakdown with counts
   - Table of all fixes with dates, status, and links
   - Fix patterns and lessons learned

3. **In Subdirectories** (`post-implementation-fixes/<severity>/`):
   - Place detailed fix reports with full documentation
   - Include code changes, test results, and artifacts

### Example Main Report Section
```markdown
---
<!-- Phase boundary -->

## Post-Implementation Fixes
[→ View all fixes and statistics](../post-implementation-fixes/README.md)

### Recent Fixes
- [Missing interval cleanup](../post-implementation-fixes/high/2025-09-02-disconnect-cleanup.md)
- [Timeout handling](../post-implementation-fixes/medium/2025-09-03-timeout.md)
```

### Benefits
- Keeps main report clean and focused
- Consistent handling of all fixes regardless of size
- Easy to see all post-implementation issues at a glance
- Main report doesn't grow unbounded with each fix

### Note on Inline Fixes
While v1.1.0 introduced inline artifacts for small (<10 LOC) changes, post-implementation fixes should always use the subdirectory structure for consistency. Inline code is only appropriate within fix reports themselves, not in the main implementation report.

## Documentation Requirements by Severity

All post-implementation fixes go in `post-implementation-fixes/<severity>/` directories based on objective criteria:

### 🔴 Critical (Immediate Action Required)
- **Criteria**: Data loss/corruption, security vulnerabilities, complete prod failure, >50% performance degradation
- **Response Time**: Immediate
- **Documentation**: Full fix report in `post-implementation-fixes/critical/` with complete artifacts folder
- **Example**: SQL injection, data corruption, production down

### 🟠 High (Within 24 Hours)  
- **Criteria**: Memory leak >25%/24h, 25-50% perf degradation, >10% users affected, core features broken
- **Response Time**: Within 24 hours
- **Documentation**: Fix report in `post-implementation-fixes/high/` with key artifacts
- **Example**: Memory leak causing OOM in 48h, API latency +35%, 12% of users getting errors

### 🟡 Medium (Within 1 Week)
- **Criteria**: 10-25% perf degradation, UX workflow disrupted, non-critical features broken
- **Response Time**: Within 1 week  
- **Documentation**: Fix report in `post-implementation-fixes/medium/`
- **Example**: Slow batch save, UI freezes for some users, browser compatibility issues

### 🟢 Low (As Time Permits)
- **Criteria**: <10% perf impact, cosmetic issues, code quality, dev-only issues (unless security)
- **Response Time**: As time permits
- **Documentation**: Fix report in `post-implementation-fixes/low/` OR commit message only
- **Example**: Typos, formatting, deprecated dependencies, refactoring needs

### Environment Multiplier
Apply these adjustments based on where the issue occurs:
- **Production**: Use severity as-is
- **Staging**: Reduce by 1 level (Critical → High)  
- **Development**: Reduce by 2 levels (Critical → Medium)
- **EXCEPTION**: Security issues are ALWAYS Critical

### Classification Examples

| Issue | Environment | Metrics | Base Severity | Final Severity |
|-------|-------------|---------|---------------|-----------------|
| 147% CPU spike | Dev | >50% CPU | Critical | **Medium** (dev -2) |
| API latency +35% | Prod | p95 +35% | High | **High** |
| Memory leak | Prod | +30%/24h | High | **High** |
| 12% users get errors | Prod | 12% sessions | High | **High** |
| Missing button label | Prod | Cosmetic | Low | **Low** |
| SQL injection found | Dev | Security | Critical | **Critical** (exception) |
| Feature broken | Staging | Core feature | Critical | **High** (staging -1) |
| Slow test suite | CI | +40% time | High | **Medium** (dev -2) |

### Severity Classification FAQ

**Q: What if we can't measure the exact percentage?**  
A: Use best estimate and document uncertainty. Example: "Approximately 20-30% degradation based on user reports"

**Q: How do we handle intermittent issues?**  
A: Use worst-case measurement during incident. If it happens 50% of the time with 40% degradation, document as "40% degradation when occurring (50% of requests)"

**Q: What about issues affecting specific customers?**  
A: Consider business impact. One customer = Low, unless it's enterprise/critical customer, then treat as percentage of revenue affected

**Q: Can we override the environment multiplier?**  
A: Yes, with justification. Example: "Dev issue but blocking all development work = High"

**Main report contains links only** - no inline fixes regardless of severity.

## Post-Implementation Fixes Organization

All post-implementation fixes use the standard structure:

```
docs/proposal/<feature_slug>/
├── reports/
│   └── Implementation-Report.md      # main (links only)
└── post-implementation-fixes/
    ├── README.md                     # MANDATORY index
    ├── critical/                     # full documentation
    ├── high/                         # full documentation
    ├── medium/                       # full documentation
    └── low/                          # brief notes OK
```

Inline artifacts are allowed within fix report files, but NOT in the main implementation report.

### Post-Implementation Fixes README.md Template

**File**: `post-implementation-fixes/README.md` (MANDATORY)

```markdown
# Post-Implementation Fixes Index

**Feature**: [Feature Name]
**Last Updated**: YYYY-MM-DD
**Total Fixes**: X
**Severity Breakdown**: 🔴 Critical: 0 | 🟠 High: 1 | 🟡 Medium: 2 | 🟢 Low: 1

## 🔴 Critical Issues (Immediate Action Required)
*Definition: Data loss, security, prod down, >50% perf degradation*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| *No critical issues* | | | | | |

## 🟠 High Priority (Within 24 Hours)
*Definition: Memory leak >25%/day, 25-50% perf, >10% users affected*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| 2025-09-02 | Memory leak in HMR | Dev | 30%/24h growth | ✅ Fixed | [Details](./high/2025-09-02-memory-leak.md) |

## 🟡 Medium Priority (Within 1 Week)
*Definition: 10-25% perf degradation, UX disrupted, non-critical broken*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| 2025-09-03 | Slow batch save | Prod | 15% p95 latency | 🚧 In Progress | [Details](./medium/2025-09-03-batch-save.md) |
| 2025-09-03 | UI freezes | Staging | 12% users affected | ⚠️ Blocked | [Details](./medium/2025-09-03-ui-freeze.md) |

## 🟢 Low Priority (As Time Permits)
*Definition: <10% perf impact, cosmetic, code quality*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| 2025-09-04 | Typo in error msg | Prod | Cosmetic | ✅ Fixed | [Details](./low/2025-09-04-typo.md) |

## Fix Patterns & Lessons Learned
- **Memory Leaks**: Most common in development with HMR (3 instances)
- **Performance**: Environment-specific issues need multiplier consideration
- **Security**: Always Critical regardless of environment (1 instance)

## Statistics
- **Average Time to Fix**: Critical: <2h | High: <24h | Medium: 3 days | Low: 1 week
- **Most Affected Environment**: Development (60%), Production (30%), Staging (10%)
- **Root Cause Distribution**: Code bugs (50%), Config (30%), Dependencies (20%)
```

## Documentation Templates

### 1. Main Implementation Report Template (Table of Contents Style)

File: `reports/<Feature-Name>-Implementation-Report.md` or `reports/YYYY-MM-DD-<phase>-implementation-report.md`

```markdown
# [Feature Name] Implementation Report

**Implementation Plan**: [<Implementation-Plan-Name>.md](../<Implementation-Plan-Name>.md)  
**Date Started**: YYYY-MM-DD  
**Date Completed**: YYYY-MM-DD  
**Duration**: ~X hours (optional)  
**Status**: ✅ COMPLETE  <!-- Critical phase marker -->

## Executive Summary
[2-3 sentences maximum. No more.]

## Scope of Implementation
- What Was Planned: [bullet points]
- What Was Delivered: [checkmarks]

## Quick Status
✅ Delivered on time
✅ All tests passing  
✅ Performance targets met

## Key Metrics
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| [Metric] | [Value] | [Value] | [%] |

## Documentation Index

### 📋 Implementation Details
[Links only - no descriptions]
- [Feature Implementation](../implementation-details/feature.md)
- [Architecture Decisions](../implementation-details/architecture.md)

### 🧪 Testing & Validation  
✅ All tests passing
✅ Performance targets met
[→ Full test results](../implementation-details/artifacts/test-results.md)

### 📝 Code Changes
**Files Modified**: X  
**Lines Changed**: ~Y  
[→ File list](../implementation-details/files-modified.md)  
[→ Diffs](../implementation-details/artifacts/diffs.md)

## Acceptance Criteria ✓
[Checkmarks only - no details]
✅ Criteria 1 met
✅ Criteria 2 met
✅ Criteria 3 met

---
<!-- Phase boundary: Everything above = implementation, below = post-implementation -->

## Post-Implementation Fixes
[→ View all fixes and statistics](../post-implementation-fixes/README.md)

### Recent Fixes
[Links only - no severity counts or details here]
- [Description](../post-implementation-fixes/severity/YYYY-MM-DD-fix.md)
```

#### 100% Compliance Checklist
- ❌ **No inline content**: No commands, diffs, or long file lists in main report
- ✅ **Links only**: Implementation Details and Post-Implementation sections contain links only
- ✅ **Phase boundary**: Status shows COMPLETE with visible `---` separator
- ✅ **Executive summary**: Limited to 2-3 sentences maximum
- ✅ **Testing section**: Only 1-2 outcome bullets, rest in linked files
- ✅ **File changes**: Only counts shown, details in linked files
- ✅ **Post-implementation**: Links only, statistics moved to README index
- ✅ **Acceptance criteria**: Checkmarks only, no explanations
- ✅ **Metrics table**: Present and minimal
- ✅ **Directory structure**: Matches standard (reports/, implementation-details/, post-implementation-fixes/)

### 2. Bug Fix/Enhancement Template

File: `post-implementation-fixes/<severity>/YYYY-MM-DD-<fix-name>.md`

```markdown
# [Fix/Enhancement Title]

**Date**: YYYY-MM-DD  
**Status**: [✅ Resolved | 🚧 In Progress | ⚠️ Partial Fix]  
**Severity**: [Critical | High | Medium | Low]  
**Affected Version**: [Version/Phase identifier]  

## Severity Classification
- [ ] Performance impact measured: _____% (metric: _____, window: _____)
- [ ] Environment identified: [Production | Staging | Development]  
- [ ] Environment multiplier applied: [Yes | No | N/A-Security]
- [ ] User impact quantified: _____% over _____ period
- [ ] Security implications reviewed: [Yes - Critical | No]

**Final Severity**: [Critical | High | Medium | Low]
**Justification**: [1-2 sentences with specific metrics]

## Problem
[One sentence summary of the issue]

### Detailed Symptoms
- [Symptom 1 with exact error message]
- [Symptom 2 with observed behavior]
- [Impact on users/system with metrics]

## Root Cause Analysis
1. **[Primary cause]**: [Explanation]
2. **[Secondary cause]**: [Explanation]
3. **[Contributing factor]**: [Explanation]

## Solution Applied

### 1. [Solution Component Title]
\```typescript
// Code showing the fix
const example = 'actual code from the fix'
\```

### 2. [Another Component if needed]
\```typescript
// More code
\```

## Files Modified
- \`path/to/file1.ts:10-15\` - [What was changed and why]
- \`path/to/file2.ts:25-30\` - [What was changed and why]
- \`path/to/file3.ts:45\` - [Single line change description]

## Verification

### Test Commands
\```bash
# Test command 1 with full curl example
curl -X POST http://localhost:3001/api/endpoint \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
# Expected Result: HTTP 200
# Actual Result: HTTP 200 ✅
\```

### Test Results
- ✅ [Test case 1]: [Result]
- ✅ [Test case 2]: [Result]
- ✅ [Test case 3]: [Result]

## Key Learnings
1. **[Pattern/Principle]**: [What was learned]
2. **[Best Practice]**: [How to avoid this in future]
3. **[Technical Insight]**: [Deep technical understanding gained]

## Related
- Original implementation: [Link to main report]
- Related patches: [List any patches referenced or applied]
- Follow-up issues: [Any new issues discovered]
- Dependencies: [External dependencies affected]
- Artifacts: [→ ./YYYY-MM-DD-<fix-name>-artifacts/](Link to artifacts folder)
```

## Expert Review Process

When external review identifies issues or discrepancies:

1. Add a link in the Post-Implementation Fixes section of the main report
2. Create a detailed fix report in `post-implementation-fixes/<severity>/`
3. Include "Expert Review" as the source in the fix report
4. Update the `post-implementation-fixes/README.md` index
5. Follow the standard structure (no inline code in main report)

## Inline Artifacts Guidance

For code changes within fix reports themselves (not in main implementation reports), embed evidence directly when under ~10 LOC:

```markdown
### Inline Artifacts

**Before**:
```diff
- setInterval(...)
+ cleanupProcessedKeys(); // lazy sweep on request
```

**After**:
```bash
rg -n "setInterval\(" app/api/postgres-offline
# No results
```
```

If more evidence is needed (e.g., multi-command sessions), promote to an artifacts subfolder.

## Iterative Updates

When claims and implementation diverge, or after reviewer feedback:

- Update the original report with a "Corrections" or "Expert Review" section, linking to the exact commit or patch.
- If additional artifacts are produced, add them under `post-implementation-fixes/<severity>/YYYY-MM-DD-<fix-name>-artifacts/`, keeping artifacts co-located with the fix.
- Clearly mark superseded statements and provide the corrected snippet.

## Artifacts Management

### Purpose
Preserve text-based error reports, logs, and test outputs from bug reports and investigations.

### Artifacts Folder Structure
For each fix, create an artifacts folder:
```
YYYY-MM-DD-<fix-name>-artifacts/
├── 01-original-error-report.md    # User's text error reports
├── 02-terminal-output.txt         # Terminal text (copy-pasted)
├── 03-browser-console.txt         # Browser console errors (text)
├── 04-curl-test-before.txt        # Our failed test attempts
├── 05-curl-test-after.txt         # Our successful tests
├── 06-git-diff.patch              # Code changes we made
└── INDEX.md                        # Manifest of actual files (no placeholders)
```

**Note**: Screenshots provided as [Image #1] cannot be extracted. Document their description in text instead.

### Artifact Categories

#### 1. Input Artifacts (From User Report - Text Only)
- Original error messages (text)
- Terminal outputs (copy-pasted text)
- Browser console logs (text)
- Description of screenshots (when user provides [Image #1], describe what they report seeing)

#### 2. Diagnostic Artifacts (Our Investigation)
- Failed test commands and outputs (text)
- Database query results (text)
- Debug logs we generate (text)
- Curl commands and responses (text)

#### 3. Solution Artifacts (Our Fix)
- Successful test outputs (text)
- Git diffs of changes (text)
- Performance comparisons (text)
- Verification commands and results (text)

### INDEX.md Template
```markdown
# Artifacts Index for [Fix Name]

**Fix Document**: [Link to main fix document]
**Date Collected**: YYYY-MM-DD
**Purpose**: [Why these artifacts were collected]

## Artifact Manifest

| File | Description | Referenced In |
|------|-------------|---------------|
| 01-original-error.md | User's error report | Problem section |
| 02-terminal.txt | Full terminal output | Symptoms section |
| ... | ... | ... |

## How to Use These Artifacts
1. **Reproducing**: Use artifacts 01-03
2. **Understanding**: Review artifacts 04-06
3. **Verifying**: Check artifacts 07-09
```

### Best Practices for Artifacts

#### DO:
- ✅ Preserve original text formatting and errors (including typos)
- ✅ Include timestamps when available
- ✅ Name files with numbered prefixes for ordering
- ✅ Create an INDEX.md listing only files that actually exist
- ✅ Document what screenshots showed when user provides [Image #1]
- ✅ Include both failed and successful test outputs (text)
- ✅ Save our test commands and their outputs as .txt files

#### DON'T:
- ❌ Edit or "clean up" original error messages
- ❌ Include sensitive data (passwords, tokens)
- ❌ Create placeholder files for artifacts we can't extract
- ❌ List non-existent files in INDEX.md
- ❌ Mix artifacts from different fixes

## Process Steps

### Phase 1: Implementation

1. **Before Starting**:
   - Create feature folder: `docs/proposal/<feature_slug>/`
   - Create/update IMPLEMENTATION_PLAN.md
   - Use TodoWrite tool to track tasks

2. **During Implementation**:
   - Track all file modifications with line numbers
   - Save exact error messages when encountered
   - Document decisions and trade-offs

3. **After Implementation**:
   - Create implementation report immediately
   - Include 1-2 test outcome bullets in main report
   - Put full test commands in `implementation-details/artifacts/test-results.md`
   - Document acceptance criteria with checkmarks only

### Phase 2: Bug Fixes and Enhancements

1. **When Bug is Found**:
   - Note exact error messages and symptoms
   - Identify root cause before fixing
   - Document attempted solutions (even failures)

2. **Creating Fix Documentation**:
   - Add one-line entry to main report
   - Create detailed fix file in subfolder
   - Use consistent naming: `YYYY-MM-DD-<descriptive-name>.md`

3. **After Fixing**:
   - Run verification tests
   - Document test commands with actual output
   - Update status in TodoWrite tool

## Best Practices

### DO:
- ✅ Date everything using YYYY-MM-DD format
- ✅ Include exact file paths and line numbers
- ✅ Show actual code snippets, not descriptions
- ✅ Include both successful and failed test results
- ✅ Document immediately while context is fresh
- ✅ Use consistent naming conventions that clearly show plan-report relationships
- ✅ Link main implementation reports to their plans
- ✅ Link between related documents
- ✅ Include exact error messages
- ✅ Track with TodoWrite tool

### DON'T:
- ❌ Write vague descriptions like "fixed the bug"
- ❌ Omit test commands or verification steps
- ❌ Forget to document failed attempts
- ❌ Mix multiple fixes in one document
- ❌ Use relative dates like "yesterday"
- ❌ Skip root cause analysis
- ❌ Forget to update the main report
- ❌ Create ambiguous report names that don't identify which is the main report
- ❌ Skip linking implementation reports back to their plans

## Naming Conventions

### Feature Slugs
- Format: `<feature_name>_<optional_qualifier>`
- Examples:
  - `unified_offline_foundation`
  - `adding_batch_save`
  - `annotation_feature_no_yjs`

### Report Files
- Main Implementation Report (choose one):
  - **Preferred**: `<Feature-Name>-Implementation-Report.md`
  - Alternative: `YYYY-MM-DD-<phase>-implementation-report.md` (must include header link to plan)
- Fix Reports: `YYYY-MM-DD-<descriptive-fix-name>.md`
- Examples:
  - `Interval-Free-Batch-Cleanup-Implementation-Report.md` (main report - preferred)
  - `2025-09-01-phase3-implementation-report.md` (main report - with header link)
  - `2025-09-02-uuid-coercion-fix.md` (fix report)
  - `2025-09-03-batch-operation-timeout.md` (fix report)

### Test Files
- Scripts: `<feature>-<test-type>.js`
- Pages: `<feature>-test.html` or `page.tsx`
- Examples:
  - `phase3-conflict-test.js`
  - `offline-sync-test.html`

## Version Control Integration

### Commit Messages
When committing documentation:
```
docs(proposal): add phase 3 implementation report

- Document conflict resolution UI implementation
- Add test results and verification steps
- Include UUID coercion fix details
```

### Pull Request References
Always reference documentation in PRs:
```markdown
## Documentation
- Implementation Report: `docs/proposal/<feature>/reports/...`
- Test Results: [Link to specific test section]
- Known Issues: `docs/proposal/<feature>/post-implementation-fixes/`
```

## Maintenance

### Regular Updates
1. **Weekly**: Review and update IN PROGRESS items
2. **Post-Release**: Mark features as COMPLETE
3. **Quarterly**: Archive old feature folders

### Documentation Health Checks
- [ ] All fixes have detailed documentation
- [ ] Main reports link to all fix files
- [ ] Test commands are reproducible
- [ ] File paths are absolute and valid
- [ ] Dates are in YYYY-MM-DD format

## Tools Integration

### TodoWrite Tool
Always use for tracking:
```javascript
todos: [
  {
    content: "Document UUID coercion fix",
    status: "in_progress",
    activeForm: "Documenting UUID coercion fix"
  }
]
```

### Search and Discovery
Documentation should be searchable:
```bash
# Find all fixes for a specific error
grep -r "invalid input syntax for type uuid" docs/proposal/

# Find all fixes on a specific date
find docs/proposal -name "2025-09-02-*.md"

# Find all phase 3 related docs
find docs/proposal -name "*phase3*"
```

## Examples

### Good Documentation Example
✅ **Specific and Actionable**:
```markdown
**Problem**: [2025-09-02] UUID coercion missing in postgres-offline endpoints causing annotation persistence failures  
[→ Details](../post-implementation-fixes/medium/2025-09-02-uuid-coercion-fix.md)
```

### Poor Documentation Example
❌ **Vague and Unhelpful**:
```markdown
Fixed some database errors in the API endpoints.
```

## Appendix: Quick Reference

### Severity Quick Reference Card

```
🔴 Critical: Data loss | Security | Prod down | >50% perf hit
🟠 High: Memory leak >25%/day | 25-50% perf | >10% users
🟡 Medium: 10-25% perf | UX disrupted | Non-critical broken
🟢 Low: <10% perf | Cosmetic | Code quality

Remember: Dev issues -2 levels (except security)
```

### Metric Definitions

#### Performance Metrics
- **p95 latency**: 95th percentile response time (95% of requests complete within this time)
- **Throughput**: Requests/transactions per second
- **CPU usage**: Average across all cores
- **Memory usage**: RSS (Resident Set Size) or heap usage

#### User Impact Metrics  
- **Active users**: Unique users in time window
- **Sessions**: Individual user sessions
- **API requests**: Total API calls
- **Error rate**: Failed requests / total requests

#### Time Windows
- **Immediate**: Within 5 minutes
- **Urgent**: Within 1 hour
- **Daily**: 24-hour rolling window
- **Sustained**: Continuous for specified period

### File Structure Checklist
- [ ] Feature folder exists: `docs/proposal/<feature_slug>/`
- [ ] Reports folder exists: `reports/`
- [ ] Main implementation report created
- [ ] post-implementation-fixes/ exists with README index
- [ ] Test scripts documented
- [ ] Test pages created

### Documentation Checklist
- [ ] Problem clearly stated
- [ ] Root cause identified
- [ ] Solution documented with code
- [ ] Files modified listed with line numbers
- [ ] Verification commands included
- [ ] Test results documented
- [ ] Key learnings captured

---

*This guide is a living document. Update it as new patterns and best practices emerge.*
