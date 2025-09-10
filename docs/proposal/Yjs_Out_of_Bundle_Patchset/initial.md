# Proposal — Yjs Out of Bundle Patchset

Feature: `yjs_out_of_bundle_patchset`
Folder: `docs/proposal/Yjs_Out_of_Bundle_Patchset/`

Status: 🚧 IN PROGRESS
Owner: <assign>
Created: 2025-09-09

## Problem Statement
Plain-mode users download and parse Yjs (and TipTap collab extensions) due to static imports in client components, even when collaboration is off. Missing/typo’d env flags can accidentally initialize Yjs. We need a fail‑closed default and strict separation so Yjs loads only when collaboration is explicitly active.

## Goals
- Fail‑closed default to plain mode with runtime lock and guardrails.
- Exclude Yjs from plain-mode bundles via dynamic imports (code splitting).
- Preserve collaboration feature parity in Yjs mode (cursors, persistence).

## Non‑Goals / Constraints
- No backend/schema changes.
- Limit scope to import-only swaps and minimal component changes.
- Avoid provider timing regressions in Phase 1 (keep provider load synchronous).

## High‑Level Approach
1) Collab‑mode helpers and guardrails (fail‑closed plain).
2) Replace direct yjs‑provider imports with `UnifiedProvider`.
3) Split collab‑only editor and lazy‑load Y.Doc in Yjs mode.
4) Keep provider loading synchronous; consider Phase 2 for dynamic provider import + ready gate.

## Acceptance Criteria
- Plain mode: no Yjs initialization; no Yjs code in initial bundles; annotations work.
- Yjs mode: collab editor + Y.Doc load on demand; cursors/persistence work.
- No regressions in annotation flows (create, select, tooltips, panels).

## ATTEMPT HISTORY
- 2025‑09‑09: Initial plan drafted and implementation.md created.

## ERRORS (if canonical structure cannot be followed)
- N/A

---

See `implementation.md` for detailed plan, file-level changes, risks, validation, and rollback.

