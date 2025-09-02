# Documentation Process Guide for Feature Implementation and Bug Fixes

**Version**: 1.0.0  
**Last Updated**: 2025-09-02  
**Purpose**: Standardize documentation practices for all feature implementations and bug fixes

## Overview

This guide defines the standard process for documenting feature implementations, bug fixes, and improvements. All implementations MUST follow this structure to maintain consistency and traceability.

## Directory Structure

### Feature Workspace Structure
```
docs/proposal/<feature_slug>/
├── IMPLEMENTATION_PLAN.md (or INITIAL.md serving as the plan)
├── reports/
│   ├── YYYY-MM-DD-<phase>-implementation-report.md
│   └── YYYY-MM-DD-<phase>-implementation-report/
│       ├── YYYY-MM-DD-<fix-name>.md
│       ├── YYYY-MM-DD-<fix-name>-artifacts/
│       │   ├── 01-original-error-report.md
│       │   ├── 02-terminal-output.txt
│       │   ├── 03-screenshot-description.md
│       │   └── INDEX.md
│       └── YYYY-MM-DD-<enhancement-name>.md
├── test_scripts/
├── test_pages/
├── supporting_files/
└── fixing_doc/ (legacy - use reports subfolder instead)
```

## Documentation Templates

### 1. Main Implementation Report Template

File: `reports/YYYY-MM-DD-<phase>-implementation-report.md`

```markdown
# [Feature Name] Implementation Report - [Phase]
*Date: YYYY-MM-DD*  
*Duration: ~X hours*  
*Status: [✅ COMPLETE | 🚧 IN PROGRESS | ❌ BLOCKED]*

## Executive Summary
[Brief description of what was implemented]

## Tickets Completed
### [TICKET-ID]: [Ticket Title]
- **Status**: ✅ Complete
- **Owner**: [FE/BE/Full-stack]
- **Estimate**: Xd (Actual: Yh)
- **Changes**:
  - [List of changes]

## Files Created/Modified
### New Files
\```
path/to/new/file1.ts
path/to/new/file2.tsx
\```

### Modified Files
\```
path/to/modified/file1.ts (lines X-Y - description)
path/to/modified/file2.ts (lines X-Y - description)
\```

## Test Commands
\```bash
# Command 1
npm run test

# Command 2
curl -X POST http://localhost:3001/api/...
\```

## Acceptance Criteria Verification
✅ **[Criterion 1]**
- [How it was verified]

✅ **[Criterion 2]**
- [How it was verified]

## Post-Implementation Fixes
**Problem**: [YYYY-MM-DD] [One sentence problem summary]  
[→ Details](./YYYY-MM-DD-<report-name>/<fix-file>.md)
```

### 2. Bug Fix/Enhancement Template

File: `reports/YYYY-MM-DD-<report-name>/YYYY-MM-DD-<fix-name>.md`

```markdown
# [Fix/Enhancement Title]

**Date**: YYYY-MM-DD  
**Status**: [✅ Resolved | 🚧 In Progress | ⚠️ Partial Fix]  
**Severity**: [Critical | High | Medium | Low]  
**Affected Version**: [Version/Phase identifier]  

## Problem
[One sentence summary of the issue]

### Detailed Symptoms
- [Symptom 1 with exact error message]
- [Symptom 2 with observed behavior]
- [Impact on users/system]

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
   - Include all test commands used
   - Document acceptance criteria verification

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
- ✅ Use consistent naming conventions
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

## Naming Conventions

### Feature Slugs
- Format: `<feature_name>_<optional_qualifier>`
- Examples:
  - `unified_offline_foundation`
  - `adding_batch_save`
  - `annotation_feature_no_yjs`

### Report Files
- Implementation: `YYYY-MM-DD-<phase>-implementation-report.md`
- Fixes: `YYYY-MM-DD-<descriptive-fix-name>.md`
- Examples:
  - `2025-09-01-phase3-implementation-report.md`
  - `2025-09-02-uuid-coercion-fix.md`
  - `2025-09-03-batch-operation-timeout.md`

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
- Known Issues: [Link to fixes subfolder]
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
[→ Details](./2025-09-01-phase3-implementation-report/2025-09-02-uuid-coercion-fix.md)
```

### Poor Documentation Example
❌ **Vague and Unhelpful**:
```markdown
Fixed some database errors in the API endpoints.
```

## Appendix: Quick Reference

### File Structure Checklist
- [ ] Feature folder exists: `docs/proposal/<feature_slug>/`
- [ ] Reports folder exists: `reports/`
- [ ] Main implementation report created
- [ ] Fixes subfolder created (when needed)
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