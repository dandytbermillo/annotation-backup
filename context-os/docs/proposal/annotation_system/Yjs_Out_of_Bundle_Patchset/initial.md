# Proposal — Yjs Out of Bundle Patchset

Feature: `yjs_out_of_bundle_patchset`
Folder: `context-os/docs/proposal/annotation_system/Yjs_Out_of_Bundle_Patchset/`

Status: draft
Owner: <assign>
Created: 2025-09-09

## Problem Statement
Plain-mode users pay an unnecessary bundle cost when Yjs (and TipTap collab extensions) are statically imported. Missing or typo’d env flags can accidentally initialize collaboration code on fresh machines. We need a fail‑closed default to plain mode and a clear separation so Yjs loads only when explicitly enabled.

## Goals
- Fail‑closed default to plain mode with runtime lock and guardrails.
- Keep Yjs out of plain‑mode bundles via dynamic imports (code splitting).
- Preserve full collaboration behavior in Yjs mode (including cursors and persistence).

## Non‑Goals / Constraints
- No backend/API changes.
- Avoid wide refactors; keep import‑only swaps and minimal component changes.
- Do not introduce provider timing races in Phase 1 (provider loading remains synchronous).

## High‑Level Approach
1) Add collab‑mode helpers and guard Rails (fail‑closed plain).
2) Replace direct yjs‑provider imports with `UnifiedProvider`.
3) Split a collab‑only editor and lazy‑load Y.Doc in Yjs mode.
4) Keep provider loading synchronous in Phase 1 (optional Phase 2: dynamic provider import + ready gate).

## Acceptance Criteria
- Plain mode: no Yjs initialization and no Yjs code in initial bundles; annotations work normally.
- Yjs mode: collab editor and Y.Doc load on demand; cursors/persistence work.
- No regressions in annotation creation, selection, toolbars, or panels.

## ATTEMPT HISTORY
- 2025‑09‑09: Initial plan drafted and implementation.md created.

## ERRORS (if canonical structure cannot be followed)
- N/A

---

See `implementation.md` for detailed file‑level changes, risks, validation, and rollback plan.

