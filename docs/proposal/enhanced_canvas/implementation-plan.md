# Enhanced Canvas Implementation Plan

## Goals
- Persist per-note canvas layouts so switching notes restores the correct viewport, panels, and component positions.
- Keep the persistence logic plain-mode friendly by relying on browser storage and the existing `CanvasProvider` bootstrap.
- Guard against stale data by keying snapshots with the current `noteId` and falling back to safe defaults when no snapshot exists.

## Current Baseline (2025-09 revert)
- `components/annotation-canvas-modern.tsx:35-140` always seeds `canvasState`/`canvasItems` with the same defaults whenever the note changes; there is no attempt to load an existing layout.
- The component skips persistence entirely—no helper exists under `lib/` and the old `canvas-storage` module was removed when the revert landed.
- `CanvasProvider` (`components/canvas/canvas-context.tsx:69-210`) still loads branch metadata for the active note, so the explorer can populate panels once the viewport is in place.

## Implementation Steps

### 1. Introduce per-note storage helpers
- Create `lib/canvas/canvas-storage.ts` that exports `saveStateToStorage`, `loadStateFromStorage`, and `clearStateFromStorage`.
- Use a namespaced key such as `annotation-canvas-state:${noteId}` and persist a sanitized payload: viewport (zoom/translate/showConnections) plus an array of simplified `CanvasItem` records (panel/component ids, types, positions, dimensions, titles, minimized state).
- Handle JSON parsing failures defensively and ignore mismatched `noteId` metadata so legacy blobs never leak into the wrong note.

### 2. Reset & hydrate on note changes
- In `ModernAnnotationCanvas`, add helpers like `createDefaultCanvasState()` and `createDefaultCanvasItems()` that match the existing defaults (zoom = 1, translate = -1000/-1200, a single main panel).
- When `noteId` changes, clear any pending auto-save timer, reset state to defaults, and attempt to load a snapshot via `loadStateFromStorage(noteId)`. If a snapshot exists, apply the stored viewport and replace `canvasItems` (ensuring the main panel entry exists even if the snapshot is incomplete).
- Track an `isStateLoaded` flag so downstream effects know when it is safe to resume auto-saving.

### 3. Auto-save with throttling
- Add a memoized `viewportSnapshot` derived from `canvasState` (zoom/translate/showConnections only).
- After `isStateLoaded` becomes true, watch `[viewportSnapshot, canvasItems, noteId]` and schedule a debounced save (e.g., 400–500 ms) that writes through `saveStateToStorage` with sanitized items.
- Cancel the timer on unmount and whenever the dependencies change to avoid overlapping writes.

### 4. Developer ergonomics & safeguards
- Export a `clearStateFromStorage(noteId)` helper so future tests/dev-tools can wipe a single note without blowing away all keys.
- Console-log save/load summaries (matching the existing debugging style) to help verify which note was persisted.
- Keep the helpers browser-only: bail out early if `window`/`localStorage` is unavailable to avoid SSR crashes.

## Validation
- Manual: create two notes, arrange panels differently, switch between them, and refresh—each note should restore its own layout and viewport.
- Manual: delete the per-note key via devtools/localStorage and confirm the canvas falls back to the default main panel without errors.
- Optional unit test: mock `window.localStorage` and assert `saveStateToStorage`/`loadStateFromStorage` round-trip sanitized payloads and ignore mismatched note ids.

## Risks & Follow-ups
- Snapshots currently capture `CanvasItem` arrays only; if deeper panel metadata (e.g., isolation flags) becomes critical, extend the sanitized record and rehydrate logic accordingly.
- Loading happens before `CanvasProvider` finishes hydrating branches—if we need to gate on provider readiness, we can later expose an event from `CanvasProvider` and await it before applying snapshots.
- The first load after this change will ignore legacy single-key data; document that users may need to reposition panels once to seed per-note saves.
