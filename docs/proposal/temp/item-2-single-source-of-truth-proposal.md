# Item 2: Single Source of Truth Proposal (v1.0)

Purpose: Eliminate contradictory rules across guide versions by establishing one authoritative "Active Rules" section and a clear deprecation history that tools and humans can follow without ambiguity.

## Objectives

- Single, authoritative ruleset at the top of the guide (no contradictions).
- Machine- and human-readable markers for version and compliance.
- Clear deprecations with reasons, replacements, and migration steps.
- Lightweight linting to prevent regressions.

## Deliverables

1. Guide structure change in `DOCUMENTATION_PROCESS_GUIDE.md`:
   - Add top-level "Active Rules (vX.Y.Z)" section.
   - Move all legacy guidance into "Appendix: Rule History & Deprecations".
   - Include a "Rule Evolution Table" (why each rule changed).
2. Machine-readable header (YAML or flat key/value) for the guide and for every main report:
   - Guide header example:
     ```yaml
     ---
     guide: Documentation Process Guide
     active_version: 1.4.0
     last_updated: YYYY-MM-DD
     ---
     ```
   - Main report header example:
     ```yaml
     ---
     guide_active_version: 1.4.0
     compliance: true
     last_validated: YYYY-MM-DD
     ---
     ```
3. Template updates (TOC main report): ensure sections match Item 4 and reference the guide version in header.
4. Migration map: v1.1/v1.2/v1.3 → v1.4 rules mapping with concrete string patterns to find/fix.
5. Lint spec (bash/rg-based): checks for common violations.

## Active Rules Model

Active Rules contains the only normative instructions required today. Everything else is informative.

- Normative words: MUST, MUST NOT, SHOULD, SHOULD NOT.
- Precedence: Active Rules > Feature docs > Historical appendices.
- Phase boundaries: When Status = COMPLETE in main report, move all subsequent changes to `post-implementation-fixes/`.

## Deprecations Model

Each deprecated rule entry includes:

- Deprecated in vX.Y.Z
- Reason
- Replacement rule
- Migration steps (one-liners + reference scripts)

Example entry:
```markdown
### Deprecated in v1.4.0
❌ reports/fixes/… (any severity)
- Reason: Conflicts with standard feature tree; caused duplication
- Replacement: post-implementation-fixes/<severity>/
- Migration: move reports/fixes/* → post-implementation-fixes/<severity>/* and add README index
```

## Migration Plan (v1.3 → v1.4)

1. Directory normalization
   - Replace any `reports/.*/fixes` with `post-implementation-fixes/`.
   - Create `post-implementation-fixes/README.md` with severity counts and links.
2. Main report cleanup
   - Enforce TOC/dashboard: links-only after `---` boundary.
   - Add Scope of Implementation; keep Executive Summary ≤ 3 sentences.
3. Artifacts relocation
   - Move command outputs/diffs under `implementation-details/artifacts/` (implementation) or `post-implementation-fixes/<severity>/…-artifacts/` (fixes).
4. Version header insertion
   - Add YAML headers to guide and main reports with `active_version` and `compliance`.
5. Verification
   - Run doc-lint (see below) and fix findings.

## Doc-Lint Spec (lightweight)

Rules and checks (grep/rg-based):

- Main report (reports/*Implementation-Report*.md):
  - MUST contain: "Status: ✅ COMPLETE", "## Executive Summary", "## Scope of Implementation", `---` boundary, "## Post-Implementation Fixes" link to README.
  - MUST NOT contain: inline code blocks below "## Post-Implementation Fixes", lines matching `^\s*````, or long command outputs.
  - SHOULD contain: a metrics table header `| Metric | Before | After |`.
- Fix placement:
  - MUST NOT match `reports/.*/fixes/` anywhere.
  - MUST match `post-implementation-fixes/<severity>/` paths for fixes.
- Artifacts:
  - Implementation artifacts under `implementation-details/artifacts/`.
  - Fix artifacts under `post-implementation-fixes/<severity>/*-artifacts/`.

Pseudo-commands (to implement as a script later):
```bash
# 1) Ensure no reports/.../fixes usage
rg -n "reports/.*/fixes" docs/proposal && exit 1

# 2) Ensure main report required sections exist
rg -n "Status: ✅ COMPLETE" docs/proposal/*/reports/*Implementation-Report*.md
rg -n "^## Executive Summary$" docs/proposal/*/reports/*Implementation-Report*.md
rg -n "^## Scope of Implementation$" docs/proposal/*/reports/*Implementation-Report*.md
rg -n "^---$" docs/proposal/*/reports/*Implementation-Report*.md
rg -n "^## Post-Implementation Fixes$" docs/proposal/*/reports/*Implementation-Report*.md

# 3) Ensure no code blocks below Post-Implementation Fixes in main reports (heuristic)
rg -n "^## Post-Implementation Fixes$" -n docs/proposal/*/reports/*Implementation-Report*.md \
  | cut -d: -f1 | xargs -I{} rg -n "^```" {} -A 200 | rg -n "^```" && exit 1
```

## Governance & CI

- CODEOWNERS: Assign doc owners for `docs/proposal/**` and the guide file.
- PR checklist additions:
  - [ ] Main report follows TOC/dashboard template and includes Scope of Implementation.
  - [ ] Fixes under `post-implementation-fixes/` with README index updated.
  - [ ] Artifacts placed correctly.
  - [ ] Updated `compliance: true` after validation.
- CI (future): Add a GitHub Action to run doc-lint; warn on failures initially, then enforce.

## Risks & Mitigations

- Risk: Partial migrations leave mixed patterns.
  - Mitigation: doc-lint blocks `reports/.*/fixes` and missing README index.
- Risk: Overhead for small fixes.
  - Mitigation: Allow commit-message-only for Low severity; keep fix template lightweight.
- Risk: LLM confusion with history blocks.
  - Mitigation: Clearly separate Active Rules from Appendices; add STOP conditions in Active Rules.

## Success Metrics

- 0 occurrences of `reports/.*/fixes` in repository.
- 100% of features with `post-implementation-fixes/README.md` present.
- 100% of main reports include Scope of Implementation and phase boundary.
- doc-lint passes on CI for all PRs.

## Rollout Plan

1. Week 1: Update guide structure, templates, and add headers.
2. Week 2: Migrate top 3 active feature folders; add their fix indexes.
3. Week 3: Enable doc-lint in warn mode; complete migrations.
4. Week 4: Enforce doc-lint; monitor and iterate.

## References

- Item 1 (Standard Feature Directory Structure): canonical directory tree.
- Item 4 (Implementation Report Content Structure): TOC/dashboard template.
- Current guide: `docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md`

