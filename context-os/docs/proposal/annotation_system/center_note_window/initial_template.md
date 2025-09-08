# 📝 Proposal: Center Note Window on Selection

**Proposal Name:** `center_note_window`  
**Directory:** `context-os/docs/proposal/annotation_system/center_note_window`

---

## 📂 File Location Instructions

- **Proposal File:**  
  Save this proposal to:  
  `context-os/docs/proposal/annotation_system/center_note_window/PROPOSAL.md`

- **Implementation Plan (once approved):**  
  Save the plan to the same directory:  
  `context-os/docs/proposal/annotation_system/center_note_window/implementation.md`

Repository policy exception: Standard location is `docs/proposal/<feature_slug>/`. This repo currently stores this feature under `context-os/docs/proposal/annotation_system/center_note_window/` by owner approval. If enforcing the canonical structure, migrate accordingly and record the migration in `initial.md`.

---

# Center Note Window on Selection — INITIAL.md

Conventions: This is the authoritative INITIAL.md for the `center_note_window` feature per claude.md. Implementation Reports should live under `.../reports/`. PRP workflow is disabled in this repo.

- status:
- iteration_count:
- owner:
- created_at:

Position resolution strategy: two-phase approach — default to main panel’s known position when unknown; otherwise resolve runtime position via provider (collab) or DOM lookup (plain mode).

## Summary

## Scope

## Non-Goals

## Current Behavior

## Desired Behavior

## Design / Implementation Plan

## Edge Cases / Risks

## Acceptance Criteria

## Validation Plan

## Affected Files
- `components/annotation-app.tsx`
- `components/annotation-canvas-modern.tsx`
- `lib/canvas/pan-animations.ts`
- `components/notes-explorer.tsx`
- `components/canvas/canvas-panel.tsx` (add `data-panel-id={panelId}` for DOM lookup in plain mode)

## Rollback Plan

## Tasks

## ATTEMPT HISTORY

## ERRORS

## References
- `docs/documentation_process_guide/DOCUMENTATION_PROCESS_GUIDE.md`
- `claude.md`
