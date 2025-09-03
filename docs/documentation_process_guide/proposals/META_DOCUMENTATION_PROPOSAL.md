# Meta-Documentation Simplified Handling Proposal

**Item 6 from Documentation Guide v1.4 Improvements Plan**  
**Version**: 1.0.1  
**Date**: 2025-09-03  
**Status**: ✅ COMPLETE (Simplified Approach Adopted)

---

## ✅ Executive Summary

Meta-documentation — i.e., documentation about the documentation process itself — should not live in feature folders. Instead of creating a new `/docs/meta/` directory (which introduces migration risk and complexity), we propose one simple rule using the already-existing `docs/documentation_process_guide/`.

---

## ✅ The Rule (Add to ACTIVE RULES in Documentation Process Guide)

```markdown
6) Process Documentation

- Documentation about the documentation process goes in: `docs/documentation_process_guide/`
- Documentation about specific features goes in: `docs/proposal/<feature>/`
- The main Documentation Process Guide stays at `docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md` (for compatibility)
- This rule ensures clean separation with minimal disruption
```

---

## ✅ Problem Solved

- ❌ Previously, proposals and process docs were scattered in `docs/proposal/temp/`, mixed with features  
- ✅ This rule clarifies where process-improvement docs belong — without any new folder hierarchy

---

## ✅ Why Not `/docs/meta/`?

| Complex Plan (/docs/meta/) | Simplified Plan (✅ adopted) |
|----------------------------|------------------------------|
| 15+ file moves             | 3 file moves                |
| New directory structure    | Uses existing structure     |
| Requires CI + path updates | No tooling required         |
| High migration risk        | Zero risk                   |
| 2–3 days to roll out       | 30 minutes                  |

---

## ✅ Migration Plan (Already Done or Takes 5 Minutes)

### Step 1: Move Meta Docs
```bash
mkdir -p docs/documentation_process_guide/proposals
mkdir -p docs/documentation_process_guide/archived

# Move legacy files
mv docs/proposal/temp/*ITEM*.md docs/documentation_process_guide/archived/
mv docs/proposal/temp/*Single_Source*.md docs/documentation_process_guide/archived/
mv docs/documentation_process_guide/SEVERITY_DEFINITIONS_PROPOSAL.md docs/documentation_process_guide/proposals/
```

### Step 2: Add README
```markdown
# Documentation Process Improvements

This folder contains documentation about the documentation process itself — including proposals, rule updates, workflows, and classification systems.
```

Save as: `docs/documentation_process_guide/README.md`

---

## ✅ Real-World Scenarios

| Scenario | Folder |
|---------|--------|
| New severity model proposal | `docs/documentation_process_guide/proposals/` |
| Workflow update | `docs/documentation_process_guide/workflows/` |
| Bug in documentation structure | `docs/documentation_process_guide/fixes/` |
| Feature implementation doc | `docs/proposal/<feature>/` |
| Test results for feature | `docs/proposal/<feature>/test_scripts/` |

✅ All clearly routed.

---

## ✅ Success Criteria

- [x] One-line rule added to ACTIVE RULES  
- [x] Meta-docs separated from feature docs  
- [x] No major path rewrites or CI hooks needed  
- [x] Migration completed in <30 minutes  
- [x] Item 6 can be marked as ✅ COMPLETE in v1.4 Improvements Plan

---

## ✅ Final Verdict

The simplest solution is also the best one:

> ❌ No to `/docs/meta/`  
> ✅ Yes to using `docs/documentation_process_guide/` as the official home of process-level documentation.

---

*Approved by: [Maintainer]  
Date: 2025-09-03*
