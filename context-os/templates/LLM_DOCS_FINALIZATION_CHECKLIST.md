# LLM Docs Finalization Checklist — hover_annotation_icon

Purpose: Ensure docs under `docs/proposal/hover_annotation_icon/` remain perfectly aligned with the Documentation Process Guide and CLAUDE.md after any fix.

Use this after every related fix/refactor/UX change.

## Goal
- Keep the feature workspace documented to spec with a single, links‑only main report, severity-indexed fixes, and accurate references.

## When To Run
- Immediately after completing a change that affects: hover icon (square/emoji), tooltip logic, cursor behavior, content sanitization, scroll caps, or positioning.

## Inputs (provide to the agent)
- 1–3 sentence summary of what changed and why.
- List of runtime files touched (paths).
- Validation outcomes (lint, type-check, unit/integration/e2e) or links.
- Severity classification for the fix (Critical/High/Medium/Low).

## Docs‑Only Update Steps (no runtime edits)

1) Main Implementation Report (links‑only dashboard)
- File: `docs/proposal/hover_annotation_icon/reports/2025-09-09-implementation-report.md`
- Ensure:
  - Header link: `Main Implementation Report for: [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md)`
  - Sections (links/short text only):
    - Scope of Implementation
    - Key Metrics (summary only)
    - Code Changes (paths/links, no inline diffs)
    - Acceptance Criteria (checkmarks only)
    - Post‑Implementation Fixes (link to fixes index)

2) Implementation Plan
- File: `docs/proposal/hover_annotation_icon/IMPLEMENTATION_PLAN.md`
- Update if architecture/state changes (plain vs Yjs split, icon differences).
- Keep the link to `TOOLTIP_REFERENCE.md` intact.

3) Post‑Implementation Fixes Index
- File: `docs/proposal/hover_annotation_icon/post-implementation-fixes/README.md`
- Do:
  - Add the new fix row (date, title, severity, link).
  - Update totals and severity counts.
  - Place the fix file under: `post-implementation-fixes/<severity>/YYYY-MM-DD-<short-title>.md`.

4) Fix Report (new file per fix)
- Directory: `post-implementation-fixes/<severity>/`
- Include:
  - Summary (what/why)
  - Changes (paths only; no large diffs)
  - Validation (commands and short outcomes)
  - Risks/limitations; Next steps
  - Links to runtime files and artifacts (if large, use `artifacts/`)

5) Tooltip Reference
- File: `docs/proposal/hover_annotation_icon/TOOLTIP_REFERENCE.md`
- Update when backend fetch/sanitization/scroll/positioning/ID normalization changes:
  - Endpoints, DB flow, `coerceEntityId` and `normalizePanelId` behavior
  - Content extraction rules (HTML strip vs PM JSON traversal)
  - Scroll caps and `.has-scroll` toggling
  - Positioning offsets and clamping differences
  - Security notes (title escaping)

6) Canonical Code Mirrors (only if files changed)
- File: `docs/proposal/hover_annotation_icon/post-implementation-fixes/exact-code-mirrors.md`
- Refresh exact copies of these modules if modified:
  - `components/canvas/annotation-decorations-hover-only.ts`
  - `components/canvas/annotation-tooltip.ts`
  - `components/canvas/webkit-annotation-cursor-fix.ts`

## Quality Gates
- One main Implementation Report (links‑only). No long logs/diffs there.
- Fixes organized under severity subfolders with an index readme.
- Cross‑links kept accurate (Plan ↔ Main Report ↔ Fixes Index ↔ Fix Reports ↔ References).
- CLAUDE.md honesty: clearly state “intended for X vs currently applied Y” when applicable.

## Validation Snippet (add to Fix Report)
```bash
npm run lint
npm run type-check
npm run test
# If DB/integration touched
docker compose up -d postgres && npm run test:integration
# If UI interactions changed
npm run test:e2e
```
Summarize outcomes or link to logs.

## Severity Guidance (objective)
- 🔴 Critical: Data loss/security/prod failure; >50% perf degradation
- 🟠 High: Core UX broken, >10% users affected, cross‑browser breakage
- 🟡 Medium: UX degraded but usable; moderate scope
- 🟢 Low: Cosmetic or doc‑only

## Don’ts
- Don’t modify runtime code as part of documentation finalization.
- Don’t add inline large logs/diffs to the main report.
- Don’t create additional main implementation reports.

