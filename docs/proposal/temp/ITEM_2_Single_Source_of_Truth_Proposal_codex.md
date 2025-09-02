# Documentation Guide v1.4 — Item 2: Single Source of Truth Proposal

Status: Proposed
Date: 2025-09-02
Target: DOCUMENTATION_PROCESS_GUIDE.md v1.4.0

## Problem
Contradictory rules from multiple versions (v1.1–v1.3) co-exist in one guide, causing confusion for both humans and LLMs. The guide needs a single normative source of truth, with historical context separated and non‑blocking.

## Objectives
- One normative section (“Active Rules”) that is the only content teams must follow.
- A clear separation of history (“Appendix: Rule History & Deprecations”) that never overrides Active Rules.
- Explicit versioning, effective scope, and change control so teams know when and how rules apply.
- Automated checks to prevent regressions (contradictions or legacy patterns creeping back).

## Design

### 1) Guide Structure (Normative vs. Historical)
The guide file is restructured into two strict parts:
- Active Rules (normative): The only section that defines what to do now.
- Appendix: Rule History & Deprecations (historical): Explanations of what changed and why, with migration notes.

Required file skeleton:
```markdown
# Documentation Process Guide
Version: vX.Y.Z
Last Updated: YYYY-MM-DD
Effective As Of: <commit SHA or tag>
Rule Set ID: DRG-vX.Y.Z

## Active Rules
1. Directory Structure (Item 1) – canonical tree and phase boundary
2. Naming & Linking (Plan ↔ Main Report)
3. Severity & Fix Placement
4. Implementation Report Shape (ToC style)
5. Post-Implementation Fixes Index (mandatory README)
6. LLM Safety Guardrails & Stop Conditions
7. Process Steps (Implementation → Fixes)
8. Validation Checklist

---

## Appendix: Rule History & Deprecations
- Deprecated Rules (with reasons, replacements, migration)
- Rule Evolution Table
- Examples from real incidents
```

### 2) Rule Identification and Traceability
- Assign stable IDs to each normative rule for cross-referencing and reviews.
  - Format: R.<Domain>.<Number>, e.g., R.DIR.1 (Directory structure), R.NAM.2 (Naming), R.SEV.3 (Severity), R.REP.4 (Report shape), R.FIX.5 (Fix placement), R.SAFE.6 (Guardrails).
- Each rule in Active Rules begins with its ID and one-sentence mandate, followed by short details and a “Rationale” line.

Example:
```markdown
R.FIX.5 — Post‑implementation fixes MUST live under post-implementation-fixes/<severity>/ with a mandatory README index.
Rationale: Single location enables reliable search, indexing, and CI checks.
```

### 3) Versioning Semantics (SemVer)
- Major (X): Breaking changes to Active Rules (e.g., change canonical paths, phase boundaries).
- Minor (Y): Additions or clarifications that don’t invalidate prior compliant docs.
- Patch (Z): Typos, formatting, and non-behavioral clarifications.
- “Effective As Of”: Each release states the commit/tag that makes this version binding for new work.
- Backport note: When a rule is Major-changed, include a short “Migration Required” banner linking to steps.

### 4) Deprecation Workflow (Non‑Normative, in Appendix)
Each deprecated rule entry includes:
- Deprecated In: vA.B.C
- Replacement: reference the new R.ID
- Migration Steps: exact file and path changes required
- Removal Timeline: optional date/version when references should be fully gone

Example entry:
```markdown
Deprecated In: v1.4.0
Old: “Inline artifacts allowed for <10 LOC”
Replacement: R.FIX.5 + fix reports only
Migration: Move any inline fix evidence into post-implementation-fixes/<severity>/..., link from main report’s Post‑Implementation Fixes section.
```

### 5) Change Control (“Guide Change Record”)
Add a compact, append-only record in the Appendix to track guide edits:
- Fields: Date, Version, Change Type (Major/Minor/Patch), Rules Affected (IDs), Summary, Author, Link to PR/commit.
- This record is meta; it never alters the meaning of Active Rules without incrementing Version.

### 6) Enforcement & CI Signals
Automate checks to keep the guide consistent and prevent regressions:
- Single Active Rules section:
  - Check: exactly one “## Active Rules” heading.
- Legacy path bans (normative scope):
  - Check: no “reports/fixes/” mention in Active Rules.
  - Check: required “post-implementation-fixes/” appears in Active Rules.
- Rule ID coverage:
  - Check: all top-level Active Rules lines start with “R.” IDs.
- Effective marker present:
  - Check: “Effective As Of:” exists and is non-empty.

Sample grep-based CI (pseudo):
```bash
rg -n "^## Active Rules$" docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md | wc -l | xargs test 1 -eq
! rg -n "reports/fixes/" docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md | rg -n "^## Active Rules$" -B 200 -A 200
rg -n "post-implementation-fixes/" docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md | rg -n "^## Active Rules$" -B 200 -A 200
rg -n "^R\.[A-Z]+\.[0-9]+\b" docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md
rg -n "^Effective As Of:\s+\S+" docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md
```

### 7) Migration Guidance (High‑level)
- New work: Follow Active Rules only, at the current guide version.
- Existing docs:
  - Do not rewrite history; add new fix docs under the canonical paths.
  - When touching old docs, include a short “Migration Note” referencing the new R.IDs and updated paths.

### 8) Rollout Plan
1) Publish v1.4.0 with this structure and IDs.
2) Add CI checks in the docs pipeline using the signals above.
3) Update templates (main report, fix report) to reference rule IDs.
4) Monitor CI and fix any rule/structure drift as it appears.

### 9) Success Criteria
- One “Active Rules” section, present and complete.
- 100% of normative rules carry R.IDs and map to the plan items (1–7).
- No legacy patterns in Active Rules (e.g., no “reports/fixes/”).
- CI prevents reintroduction of deprecated structures.

## Minimal Templates

### Active Rules Entry Template
```markdown
R.<DOMAIN>.<N> — <One‑sentence mandate>
Details: <1–3 lines max with exact paths or names>
Rationale: <Why this must be true>
```

### Deprecation Entry Template (Appendix)
```markdown
Deprecated In: vX.Y.Z
Replaces: <R.DOMAIN.N> or legacy text
Replacement: <R.DOMAIN.N>
Migration: <Concrete steps>
Removal Timeline: <Optional date/version>
```

---

This proposal confines the normative truth to a single “Active Rules” section, labels rules with stable IDs, pushes history into a separate appendix, and wires in CI‑friendly signals so contradictions can’t creep back in. It pairs clean day‑to‑day usage (read one section) with strong traceability (appendix and change record).

