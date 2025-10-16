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

## Validation
- `npm run type-check`
- `npx playwright test e2e/canvas-first-reload.spec.ts --project=chromium`

Manual spot checks confirm:
1. Opening multiple notes keeps existing panels in place while centering the newly opened one.
2. Branch panels open beside their respective parent notes even when multiple notes share the canvas.
3. Dragging a panel persists positions per note and survives reloads (verified by Playwright).

## Remaining Work
- Hydration still runs per-note; consolidate `useCanvasHydration` to hydrate all open notes in a single pass.
- Camera state is shared; add “center on note” helpers and minimap affordances to quickly navigate dense workspaces.
- Consider a workspace-aware close mechanic (e.g., “Remove from board”) inside `CanvasPanel` to trigger `closeNote`.
- Expand automated coverage for multi-note scenarios (e.g., open two notes, move both, reload) once hydration refactor lands.
- Review performance of large workspaces (many notes) and layer-manager ordering; may require virtualization or batching.

## Next Steps
1. **Hydration Orchestration** — Update `useCanvasHydration` to accept arrays of `(noteId, panel snapshots)` so all open notes rehydrate in one run. Ensure `canvasItems` is populated before canvas starts rendering.
2. **Camera / Navigation** — Implement “Center on note” actions (per workspace tab, minimap entries) and tidy layer toggles for multi-note mode.
3. **Workspace Tab UX** — Replace `focusedNoteId` logic with selection affordances (highlight active note, close note button) while keeping the unified board visible.
4. **Regression Coverage** — Add Playwright cases that open two notes, drag both, reload, and verify positions + branch panels.

