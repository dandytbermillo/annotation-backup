# Phase 2 Implementation Plan — Unified Multi-Note Canvas

> Goal: move from a single-note canvas to a shared “board” where every open note’s panels are visible together, similar to a Miro/Figma workspace.

## 1. Composite Identifiers & Store Plumbing
- Introduce helper utilities (`ensurePanelKey`, `makePanelKey`, `parsePanelKey`) that produce deterministic IDs `noteId::panelId`.
- Migrate core data structures to composite keys:
  - `DataStore`, branches map, LayerManager, and `CanvasItem` instances carry a `noteId` and `storeKey`.
  - Update `StateTransaction`, persistence adapters, and hydration payloads to resolve composite keys.
- Provide shims so legacy callers can pass either raw panel IDs (falls back to current note) or the new composite IDs during migration.
- Unit/integration checks: drag, save, and reload behaviour for a single note must remain intact.

## 2. Unified Canvas Rendering
- Remove the `focusedNoteId` guard in `AnnotationApp`; feed a single `ModernAnnotationCanvas` the entire `openNotes` array from the workspace provider.
- Ensure `ModernAnnotationCanvas` mounts all panel items and visual components together, using composite IDs to avoid collisions.
- LayerManager: either use one shared manager keyed by composite IDs or mount per-note managers and federate them into a shared view.
- Verify core interactions (drag, autoscroll, selection) across at least two simultaneous notes.

## 3. Hydration & Persistence Rework
- Extend `useCanvasHydration` to accept arrays of (noteId, workspace state) and create canvas items for each note.
- Rework `usePanelPersistence` and offline queue handling so PATCH payloads include `noteId` alongside each panel update.
- Update workspace main-position sync to handle multiple notes without race conditions.
- Manual smoke: open multiple notes, move panels, reload, and ensure every layout persists.

## 4. Shared Camera & Navigation
- Decide on camera policy (shared viewport vs. per-note cameras).
- Implement navigation aids (e.g., “center on note” actions, minimap entries, tab shortcuts) so users can quickly focus a specific note.
- Confirm autoscroll and keyboard shortcuts operate correctly with panels from different notes.

## 5. Verification & Cleanup
- Expand `tsconfig.type-check.json` coverage as layers stabilise; aim for a clean `npm run type-check`.
- Manual regression checklist: drag/save/autoscroll, workspace tab close, note creation, offline queue replay.
- Clean up migration shims and document any residual risks or follow-up work (e.g., performance tuning, pagination).

## Deliverables & Notes
- Plan to merge in reviewable slices (sections above) to limit risk.
- Document each stage in this folder with findings, known issues, and verification notes.
- Coordinate with QA once unified canvas is feature-complete to schedule broader testing.
