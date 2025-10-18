# Phase 2 Progress — Unified Canvas (2025-10-16)

## Summary
- Removed the single-note `focusedNoteId` canvas mount. The UI now renders one shared `ModernAnnotationCanvas` that receives the full `openNotes` list and mounts every note’s main panel simultaneously.
- Introduced `SHARED_WORKSPACE_ID` in `CanvasWorkspaceProvider` so the unified canvas consumes a single `DataStore`/`EventEmitter`/`LayerManager` instance for all notes.
- Updated `ModernAnnotationCanvas` to:
  - Bootstrap one main panel per open note using composite keys.
  - Track note ownership on each `CanvasItem` and derive noteIds from `storeKey` when needed.
  - Route panel creation/close events through note-aware helpers (`handleCreatePanel`, `handlePanelClose`), including branch panels opened from hover icons, toolbar actions, or tiptap decorations.
  - Pass note-aware props into `CanvasPanel` so persistence calls include the correct noteId.
- Hardened `usePanelPersistence` to parse composite keys. All PATCH/POST/DELETE operations now send the panel’s true noteId to `/api/canvas/layout`, `/api/canvas/panels`, and offline queue entries.
- Extended frontend events (`create-panel`) across toolbar/hover/tiptap sites to include `noteId`, allowing the canvas to open branch panels for the appropriate parent note.

## Key Files
- `components/annotation-app.tsx`
- `components/annotation-canvas-modern.tsx`
- `components/canvas/canvas-workspace-context.tsx`
- `components/canvas/{canvas-panel.tsx, branch-item.tsx, annotation-toolbar.tsx, annotation-decorations-*.tsx, tiptap-editor*.tsx}`
- `lib/hooks/use-panel-persistence.ts`

## Toolbar UX Update (2025-10-20)
- Workspace tabs have been converted into a toolbar. Clicking an entry now emits the highlight pulse **and** recenters the canvas on the note’s `noteId::main` panel using the composite key helper.
- The toolbar still surfaces dedicated actions: crosshair button for manual “snap back” and the close button to remove the note from the shared workspace.
- Canvas centering retries are handled via `lib/canvas/center-on-note.ts`, ensuring deferred renders still snap into view without duplicating logic inside the React component.
- Automated coverage: `__tests__/unit/lib/canvas/center-on-note.test.ts` exercises composite-key centering, retry behaviour, and the early-exit guard when the canvas handle is unavailable.
- Validation commands run for this update:
  - `npm run type-check`
  - `npm test -- __tests__/unit/lib/canvas/center-on-note.test.ts`

### Manual QA Checklist
- [ ] Open three notes, switch between toolbar entries, and confirm the board pans each time while previously opened panels remain fixed.
- [ ] Re-click the active toolbar entry to verify only the glow animation plays (no additional pan).
- [ ] Trigger the crosshair button on a hidden note to confirm manual centering still works after the refactor.
- [ ] Close a note from the toolbar and ensure the remaining notes stay centered correctly.

## Validation
- `npm run type-check`
- `npx playwright test e2e/canvas-first-reload.spec.ts --project=chromium`

Manual spot checks confirm:
1. Opening multiple notes keeps existing panels in place while centering the newly opened one.
2. Branch panels open beside their respective parent notes even when multiple notes share the canvas.
3. Dragging a panel persists positions per note and survives reloads (verified by Playwright).

## Remaining Work
- Hydration still runs per-note; consolidate `useCanvasHydration` to hydrate all open notes in a single pass.
- Evaluate camera smoothing/minimap affordances for dense workspaces now that toolbar centering is always-on.
- Consider a workspace-aware close mechanic (e.g., “Remove from board”) inside `CanvasPanel` to trigger `closeNote`.
- Expand automated coverage for multi-note scenarios (e.g., open two notes, move both, reload) once hydration refactor lands.
- Review performance of large workspaces (many notes) and layer-manager ordering; may require virtualization or batching.

## Next Steps
1. **Hydration Orchestration** — Update `useCanvasHydration` to accept arrays of `(noteId, panel snapshots)` so all open notes rehydrate in one run. Ensure `canvasItems` is populated before canvas starts rendering.
2. **Navigation Enhancements** — Monitor toolbar centering telemetry, add minimap shortcuts, and refine keyboard navigation for large boards.
3. **Workspace Tab UX** — Replace `focusedNoteId` logic with selection affordances (highlight active note, close note button) while keeping the unified board visible.
4. **Regression Coverage** — Add Playwright cases that open two notes, drag both, reload, and verify positions + branch panels.
