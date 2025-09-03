# Documentation Process Guide Patches

This directory contains proposed patches for improving the Documentation Process Guide.

## Available Patches

### 2025-09-03-rule1-readme-indexes.patch (NEW - RECOMMENDED)

**Purpose**: Strengthens Rule 1 to require README.md indexes in ALL standard folders

**What it does**:
- Updates Rule 1 to mandate README.md in reports/, implementation-details/, and post-implementation-fixes/
- Improves navigation for both humans and LLMs
- Based on deep analysis showing need for consistent indexing

**To apply this patch**:
```bash
cd /Users/dandy/Downloads/annotation_project/annotation-backup
git apply docs/documentation_process_guide/patches/2025-09-03-rule1-readme-indexes.patch
```

### 2025-09-03-rule8-patches-directory-v2.patch (RECOMMENDED)

**Purpose**: Adds Rule 8 for Patches Directory management to the Documentation Process Guide (improved version based on expert review)

**What it does**:
- Updates version from 1.4.4 to 1.4.5
- Adds changelog entry for v1.4.5
- Adds Rule 8 to ACTIVE RULES section with expert-refined wording

**The new Rule 8 (expert-approved version)**:
```markdown
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
```

**Improvements over v1**:
- ✅ Uses exact path `docs/proposal/<feature_slug>/patches/` for consistency
- ✅ Specifies `git format-patch` command precisely
- ✅ Single README.md index instead of per-patch READMEs
- ✅ Adds linking requirement for discoverability
- ✅ Expanded "When to use" with concrete scenarios

**To apply this patch**:
```bash
cd /Users/dandy/Downloads/annotation_project/annotation-backup
git apply docs/documentation_process_guide/patches/2025-09-03-rule8-patches-directory-v2.patch
```

### 2025-09-03-rule8-patches-directory.patch (v1 - superseded)

**Purpose**: Adds Rule 8 for Patches Directory management to the Documentation Process Guide

**What it does**:
- Updates version from 1.4.4 to 1.4.5
- Adds changelog entry for v1.4.5
- Adds Rule 8 to ACTIVE RULES section

**The new Rule 8**:
```markdown
8) Patches Directory (Optional)
- Location: `feature/patches/` - Simple flat directory
- Purpose: Store proposed code changes as git-format patches when direct editing is not appropriate
- When to use: Expert reviews, risky changes, or when changes need approval before applying
- Naming: `YYYY-MM-DD-descriptive-name.patch` (e.g., `2025-09-03-fix-memory-leak.patch`)
- Documentation: Each patch needs a README.md explaining what it does and why
```

**Why this approach**:
- **Simpler** than the proposed implementation/post-impl subdirectory structure
- **Clearer** about when and why to use patches
- **Specific** naming convention with example
- **Matches reality** - projects already use flat patches/ directories

**To apply this patch**:
```bash
cd /Users/dandy/Downloads/annotation_project/annotation-backup
git apply docs/documentation_process_guide/patches/2025-09-03-rule8-patches-directory.patch
```

**To check before applying**:
```bash
git apply --check docs/documentation_process_guide/patches/2025-09-03-rule8-patches-directory.patch
```

## Previous Patches

### 2025-09-02-doc-guide-lite-active-deprecated.patch
- Already applied in v1.4.0
- Added ACTIVE RULES and DEPRECATED sections structure