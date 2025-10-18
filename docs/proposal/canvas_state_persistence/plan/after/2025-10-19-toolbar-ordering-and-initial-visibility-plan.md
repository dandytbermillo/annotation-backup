# Plan: Toolbar Ordering & Initial Visibility Hardening

**Date**: 2025-10-19  
**Owner**: Canvas Platform Team  
**Status**: Draft (awaiting review)

---

## Context

Recent work added re-select highlighting for workspace tabs, but it assumes the toolbar array and visible panels are already stable after reload. In practice, users see:
- toolbar entries appearing in different orders between sessions,
- only the previously focused note rendered on first paint,
- the re-select highlight firing immediately on load.

We need to codify deterministic ordering and full-state restoration so the highlight enhancement sits on solid ground. Isolation/reactivity anti-pattern guidance (2025-10-16 review) does not apply because we are not modifying isolation providers or adding new hooks—this effort focuses on persistence playback and event sequencing.

---

## Goals

1. **Deterministic Toolbar Ordering**  
   - Persist toolbar entries in the same order they were last arranged (drag-sorted or MRU, whichever we choose) and restore that order before initial render.

2. **Full Panel Visibility on Reload**  
   - Hydrate every note and non-note panel that was open at shutdown and render them in their saved positions before user interaction is possible.

3. **Highlight Emission Discipline**  
   - Ensure `workspace:highlight-note` fires only on explicit user reselection, never during initial hydration.

4. **User Feedback & QA Hooks**  
   - Provide telemetry and automated checks so regressions in ordering or visibility fail fast.

---

## Deliverables

| ID | Deliverable | Description |
| --- | --- | --- |
| D1 | Toolbar order persistence contract | Schema + hooks ensuring stable ordered array across sessions. |
| D2 | Canvas snapshot replay | Hydration path that instantiates all panels (notes + widgets) prior to first paint. |
| D3 | Highlight guardrail | Logic changes preventing highlight event during boot; unit test coverage. |
| D4 | QA instrumentation | Telemetry event + Playwright/RTL checks verifying ordering and visibility. |
| D5 | Documentation addendum | Update the 2025-10-16 plan to reference this follow-up and note acceptance tests. |

---

## Work Breakdown

### D1. Toolbar Order Persistence
- Audit where the toolbar array is stored (`workspace.state.openNotes`, etc.).
- Define a single ordered list (`openTabs[]`) persisted atomically with canvas save events.
- Update mutations (add, close, reorder) to write the ordered list.
- Ensure hydration reads the list before rendering toolbar; expose via context.
- Add unit test asserting save/restore preserves order.

### D2. Canvas Snapshot Replay
- Extend workspace snapshot to include both note panels and other widget instances (`components`, `position`, `layerId`).
- Modify hydration hook to instantiate all panels synchronously, using stored bounds; avoid lazy creation tied to toolbar clicks.
- Verify main panel seeding still uses `loadedNotes` guard to skip defaults when data exists.
- Add Playwright scenario: open note + widget, reload → both visible without interaction.

### D3. Highlight Guardrail
- Refine `handleNoteSelect` (or equivalent) logic to emit `workspace:highlight-note` only when `noteId === focusedNoteId` *and* the selection event originated from a user action (exclude bootstrapping).
- Introduce a flag (`isHydrating`) or event source to distinguish hydration from clicks.
- Unit test to assert no highlight dispatch during initial load.

### D4. QA Instrumentation
- Emit telemetry (`workspace_toolbar_state_rehydrated`) with ordered IDs, focusedId, panelCount.
- Alert when `panelCount` on boot is 1 but persisted snapshot indicated >1.
- Add automated test verifying toolbar DOM order matches persisted order (mock snapshot fixture).

### D5. Documentation
- Update `docs/proposal/canvas_state_persistence/plan/2025-10-16-workspace-tab-highlight-plan.md` with a “Dependencies” or “Follow-ups” section referencing this plan.
- Record acceptance criteria in Phase 1 dashboard / QA checklist.

---

## Acceptance Criteria

- Toolbar order after reload matches the last saved order in both DOM and persistence logs.
- All persisted panels (notes + widgets) appear immediately after reload without user clicks.
- Highlight animation never appears on first load; only after an explicit reselection of the active tab.
- Telemetry shows `panelCount` ≥ persisted count and triggers no alerts.
- Automated tests covering these paths are green in CI.

---

## Risks & Mitigations

- **Race conditions during hydration**: use an `await workspace.ready` guard before rendering toolbar and panels.
- **Large snapshots**: ensure replay uses batching or requestAnimationFrame to avoid jank.
- **Legacy data**: handle older snapshots without ordering metadata by defaulting to creation time but recording a warning.

---

## Timeline (Indicative)

| Week | Focus |
| --- | --- |
| Week 1 | D1 (order persistence) + D3 (highlight guard) |
| Week 2 | D2 (full replay) + initial Playwright test |
| Week 3 | D4 instrumentation + telemetry dashboards |
| Week 4 | D5 documentation, final QA, handoff |

---

## Follow-ups

- Consider configurable ordering modes (MRU vs manual pinning) in a later UX review.
- Explore decoupling note focus from canvas active component if users need clearer non-note focus cues.

