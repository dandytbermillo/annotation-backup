# Single Source of Truth Combined Proposal (FINAL)

**Focus**: Fixing Issue #2 - Contradictory Version Rules  
**Current Stability**: 2/10 (CRITICAL)  
**Target Stability**: 9/10  
**Base**: item-2 proposal + urgency from STABILITY + CI from codex  

## The Core Problem (URGENT)

The Documentation Process Guide is **unfollowable** due to mixing 4 versions in one file:

### Actual Contradictions in Current Guide:
```markdown
Line 127: "inline artifacts for small (<10 LOC) changes" (v1.1 rule)
Line 138: "no inline fixes regardless of severity" (v1.4 rule)
Line 226: "No inline content" (100% compliance checklist)
Lines 320-340: Shows inline code examples
```
**Result**: LLM sees "use inline" AND "never use inline" - cannot compute!

### Impact:
- LLMs make arbitrary decisions
- Humans create inconsistent docs
- Our own implementation violates v1.4 rules
- 15+ contradicting rules found

## Proposed Solution: Active Rules + Quarantined History

### 1. Guide Structure (Clean Separation)

```markdown
# Documentation Process Guide
---
guide: Documentation Process Guide
active_version: 1.4.0
last_updated: YYYY-MM-DD
effective_as_of: <commit-sha>
---

## ACTIVE RULES
[Current rules ONLY - no version references, no "if v1.3", no "previously"]

### Directory Structure
[Show ONLY current structure]

### Main Report Rules
- Main reports are navigation dashboards (links only)
- No inline code, commands, or detailed file lists
- Executive summary: 2-3 sentences maximum
- All details in linked subdirectories

### Post-Implementation Fixes
- ALL fixes go to post-implementation-fixes/<severity>/
- Main report contains links only
- README.md index is MANDATORY

[Continue with other active rules...]

---

## APPENDIX: DEPRECATED RULES (DO NOT USE)
[Historical reference only - never overrides Active Rules]

### Deprecated in v1.4.0
❌ Inline artifacts for <10 LOC (from v1.1.0)
- Reason: Created inconsistency
- Replacement: Always use subdirectories  
- Migration: Move inline code to post-implementation-fixes/<severity>/

❌ reports/fixes/ paths (from v1.2.0)
- Reason: Conflicts with standard tree
- Replacement: post-implementation-fixes/<severity>/
- Migration: mv reports/fixes/* → post-implementation-fixes/
```

### 2. Machine-Readable Headers (YAML)

**Guide Header**:
```yaml
---
guide: Documentation Process Guide
active_version: 1.4.0
last_updated: 2025-09-02
effective_as_of: abc123def
---
```

**Main Report Header**:
```yaml
---
guide_version: 1.4.0
compliance: true
validated: 2025-09-02
---
```

### 3. Migration Plan (v1.3 → v1.4)

#### Week 1: Guide Restructuring
1. Extract v1.4 rules → Active Rules section
2. Move v1.1/v1.2/v1.3 rules → Deprecated section
3. Remove ALL version references from Active Rules
4. Fix template examples to match Active Rules

#### Week 2: Path Normalization
```bash
# Find and fix old paths
find docs/proposal -path "*/reports/fixes/*" -type f | while read f; do
  new_path=$(echo "$f" | sed 's|reports/fixes/|post-implementation-fixes/|')
  mkdir -p $(dirname "$new_path")
  git mv "$f" "$new_path"
done
```

#### Week 3: Report Cleanup
- Add YAML headers to all main reports
- Remove inline code/commands from main reports
- Add Scope of Implementation sections
- Ensure phase boundary (---) present

#### Week 4: Validation & Enforcement
- Enable doc-lint in CI
- Fix all violations
- Mark compliance: true

## CI Automation (Doc-Lint)

### Core Checks:
```bash
#!/bin/bash
# doc-lint.sh

GUIDE="docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md"
ERRORS=0

# 1. Ensure single Active Rules section
if [ $(grep -c "^## ACTIVE RULES$" "$GUIDE") -ne 1 ]; then
  echo "ERROR: Must have exactly one '## ACTIVE RULES' section"
  ERRORS=$((ERRORS + 1))
fi

# 2. No version references in Active Rules
if grep -A 1000 "^## ACTIVE RULES$" "$GUIDE" | grep -B 1000 "^---$" | grep -E "v1\.[0-3]|since v|as of v|previously"; then
  echo "ERROR: Active Rules contains version references"
  ERRORS=$((ERRORS + 1))
fi

# 3. No legacy paths in Active Rules
if grep -A 1000 "^## ACTIVE RULES$" "$GUIDE" | grep "reports/fixes/"; then
  echo "ERROR: Active Rules contains deprecated 'reports/fixes/' paths"
  ERRORS=$((ERRORS + 1))
fi

# 4. Check main reports for inline content
for report in docs/proposal/*/reports/*Implementation-Report.md; do
  if grep -A 100 "^## Post-Implementation Fixes$" "$report" | grep "^\`\`\`"; then
    echo "ERROR: $report has inline code after Post-Implementation Fixes"
    ERRORS=$((ERRORS + 1))
  fi
done

# 5. Ensure post-implementation-fixes/ has README
for fixes_dir in docs/proposal/*/post-implementation-fixes/; do
  if [ -d "$fixes_dir" ] && [ ! -f "$fixes_dir/README.md" ]; then
    echo "ERROR: $fixes_dir missing README.md index"
    ERRORS=$((ERRORS + 1))
  fi
done

exit $ERRORS
```

### GitHub Action:
```yaml
name: Documentation Lint
on: [push, pull_request]
jobs:
  doc-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run doc-lint
        run: |
          chmod +x scripts/doc-lint.sh
          ./scripts/doc-lint.sh
```

## Success Metrics

| Metric | Current | Week 1 | Week 2 | Week 4 |
|--------|---------|--------|--------|--------|
| Contradicting rules | 15+ | 5 | 1 | **0** |
| Version refs in Active | 20+ | 5 | 1 | **0** |
| Legacy paths | Many | Some | Few | **0** |
| Doc-lint failures | N/A | 50+ | 10 | **0** |
| Stability score | 2/10 | 5/10 | 7/10 | **9/10** |

## Governance

### CODEOWNERS:
```
/docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md @doc-team @arch-lead
/docs/proposal/*/reports/ @doc-team
/scripts/doc-lint.sh @ci-team
```

### PR Checklist Addition:
```markdown
## Documentation Compliance
- [ ] Main report follows TOC/dashboard template
- [ ] No inline code/commands in main report
- [ ] Post-implementation fixes under correct path
- [ ] README.md index updated if fixes added
- [ ] doc-lint passes (run: ./scripts/doc-lint.sh)
- [ ] YAML header includes guide_version: 1.4.0
```

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing workflows | High | Keep deprecated rules visible with ❌ marker |
| Partial migrations | Medium | doc-lint blocks PRs with legacy patterns |
| LLM confusion | High | Clear ACTIVE/DEPRECATED separation |
| Rollout delays | Low | 4-week phased approach |

## Implementation Timeline

### Immediate (Day 0):
- Create this proposal
- Get approval for approach

### Week 1:
- Restructure guide (Active vs Deprecated)
- Update templates
- Add YAML headers

### Week 2:
- Migrate top 3 features
- Fix paths (reports/fixes → post-implementation-fixes)
- Create fix indexes

### Week 3:
- Enable doc-lint (warning mode)
- Fix violations
- Complete migrations

### Week 4:
- Enable doc-lint (blocking mode)
- Mark compliance: true
- Release v1.4.0 (clean)

## Bottom Line

Current guide has **15+ contradictions** making it impossible to follow. This proposal:
1. Creates **single source of truth** (Active Rules)
2. **Quarantines history** (Deprecated section)
3. **Automates compliance** (doc-lint CI)
4. **Fixes urgently** (4-week timeline)

From 2/10 chaos → 9/10 clarity!