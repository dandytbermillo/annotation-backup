# Single Source of Truth Stability Proposal

**Focus Area**: Fixing Issue #2 - Contradictory Version Rules  
**Date**: 2025-09-02  
**Current Stability**: 2/10  
**Target Stability**: 9/10  

## The Core Problem

The Documentation Process Guide mixes 4 versions (v1.1, v1.2, v1.3, v1.4) in one file, creating impossible contradictions:

### Example Contradictions Found:
```markdown
Line 127: "inline artifacts for small (<10 LOC) changes" (v1.1 rule)
Line 138: "no inline fixes regardless of severity" (v1.4 rule)
```
**Result**: LLM cannot follow both rules simultaneously!

## Proposed Solution: True Single Source Architecture

### File Structure
```
docs/proposal/
├── DOCUMENTATION_PROCESS_GUIDE.md         # Active rules ONLY (no versions)
├── DOCUMENTATION_GUIDE_CHANGELOG.md       # Version history (quarantined)
└── DOCUMENTATION_GUIDE_MIGRATION.md       # How to update old docs
```

### New DOCUMENTATION_PROCESS_GUIDE.md Structure

```markdown
# Documentation Process Guide
<!-- NO VERSION NUMBERS IN HEADER -->

## ⚡ ACTIVE RULES
<!-- These are THE rules. No "if v1.3" or "since v1.2" statements -->

### Main Report Rules
- Main reports are navigation dashboards (links only)
- No inline code, commands, or detailed file lists
- Maximum 2-3 sentence executive summary
- All details go in linked subdirectories

### Post-Implementation Fixes Rules  
- ALL fixes go to post-implementation-fixes/<severity>/
- Main report contains links only
- README.md index is MANDATORY

### Directory Structure
[Show ONLY the current structure, no legacy paths]

### Templates
[Examples that ACTUALLY follow the active rules]

---

## ⚠️ DEPRECATED RULES (DO NOT USE)
<!-- Clearly marked as historical reference only -->

### Removed in January 2025
❌ Inline artifacts for <10 LOC (from v1.1.0)
- Why removed: Created inconsistency
- Replacement: Always use subdirectories

❌ Expert Review inline sections (from v1.2.0)
- Why removed: Contradicted navigation-hub principle
- Replacement: Use post-implementation-fixes/

[Continue with other deprecated rules...]
```

## Implementation Steps

### Phase 1: Extract Active Rules (Immediate)
1. Create new section with ONLY v1.4.0 rules
2. Remove ALL version references from active rules
3. Remove ALL conditional statements ("if", "while", "previously")
4. Fix ALL template examples to match active rules

### Phase 2: Quarantine Old Rules (Day 1)
1. Move all v1.1, v1.2, v1.3 rules to DEPRECATED section
2. Mark each with ❌ symbol
3. Explain why deprecated and what replaced it
4. Add migration instructions

### Phase 3: Fix Contradicting Examples (Day 2)
1. Audit all code examples in guide
2. Update to follow v1.4.0 rules strictly
3. Remove inline bash commands from templates
4. Ensure 100% compliance with checklist

### Phase 4: Create Migration Guide (Day 3)
1. Document how to update v1.1/v1.2/v1.3 docs to v1.4
2. Provide before/after examples
3. Create validation checklist

## Validation Criteria

### Must Pass ALL:
- [ ] Zero version references in Active Rules section
- [ ] Zero conditional statements about versions
- [ ] All templates follow stated rules
- [ ] No inline content in main report examples
- [ ] Deprecated rules clearly quarantined
- [ ] Migration path documented

## Expected Outcomes

### Before (Current State):
- LLM sees: "Use inline for <10 LOC" AND "Never use inline"
- Human asks: "Which rule do I follow?"
- Result: Arbitrary decisions, inconsistent docs

### After (Proposed State):
- LLM sees: One clear rule per topic
- Human sees: Unambiguous instructions
- Result: Consistent documentation

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Contradicting rules | 15+ | 0 |
| Version references in active section | 20+ | 0 |
| Templates violating own rules | 5 | 0 |
| LLM decision points | Many | None |
| Stability score | 2/10 | 9/10 |

## Risk Mitigation

### Risk: Breaking existing workflows
**Mitigation**: Keep deprecated rules visible but clearly marked as "DO NOT USE"

### Risk: Confusion during transition
**Mitigation**: Clear migration guide with examples

### Risk: Incomplete implementation
**Mitigation**: Validation checklist must be 100% before release

## Timeline

- Day 1: Extract and clean active rules
- Day 2: Fix examples and templates
- Day 3: Create migration documentation
- Day 4: Validation and testing
- Day 5: Release v1.4.0 (clean version)

## Bottom Line

The current guide is **unfollowable** due to contradictions. This proposal creates a **single, unambiguous source** where:
- Active rules have NO version references
- Deprecated rules are quarantined
- Templates match rules
- Migration is clear

This moves us from 2/10 stability (contradictory mess) to 9/10 stability (clear, consistent, maintainable).