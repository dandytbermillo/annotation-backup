# Enhanced Canvas Implementation Plan

## Goals
- Keep each note's canvas layout isolated so switching between notes never reuses another note's state.
- Persist the actual panel map and related metadata that lives in the canvas context, not just the flattened `canvasItems` array.
- Make note changes idempotent: when `noteId` changes we should reset ephemeral state, reload the correct snapshot, and avoid race conditions with the data store.

## Current Gaps
- `components/annotation-canvas-modern.tsx:96` only runs the load routine once; a user switching notes keeps the first note's layout.
- `lib/storage/canvas-storage.ts:56` always writes to a single `annotation-canvas-state` key and never enforces that the loaded snapshot matches the active `noteId`.
- `components/annotation-canvas-modern.tsx:264` persists with `new Map()` and omits isolation details, so we lose panel metadata that already exists inside `CanvasProvider`.

## Implementation Steps

### 1. Per-note storage helpers
1. Add helper functions in `lib/storage/canvas-storage.ts` to derive a storage key from a note id (e.g. `getStorageKey(noteId)` with a safe fallback when `noteId` is falsy).
2. Update `saveStateToStorage`/`loadStateFromStorage` to accept `noteId`. Embed the id in the payload, but primarily rely on the per-note key so states never collide. If a legacy combined key exists, read, split by `metadata.noteId`, then migrate or discard after first successful save.
3. Ensure `clearStoredState` accepts an optional `noteId`; default to wiping only that note's entry.

### 2. Reload canvas when note changes
1. Refactor `ModernAnnotationCanvas` so the persistence effect depends on `noteId`. When it changes, cancel inflight timers, reset `canvasState`/`canvasItems` to defaults, and re-run the load logic.
2. Guard the load routine so it requests the per-note snapshot first; if none exists, fall back to creating the default "main" panel using the existing viewport centering calculation.
3. Make the auto-save effect include `noteId` in its dependency array. Pass the id down to the storage helper so saves are scoped correctly.
4. Consider splitting `ModernAnnotationCanvas` into a thin wrapper plus an `InnerCanvas` that runs under `CanvasProvider`. This allows `InnerCanvas` to call `useCanvas()` while keeping the imperative ref intact.

### 3. Persist real panel metadata
1. Inside the provider-backed portion of the component, grab `const { state, dataStore } = useCanvas()`. Pass `state.panels` (the real `Map`) and any isolation state you need into `saveStateToStorage` instead of the placeholder `new Map()`.
2. Before saving, serialize the Map deterministically (e.g. via `Array.from(state.panels.entries())`) and optionally prune runtime fields like DOM nodes.
3. Pair the persisted map with `dataStore` content on load: when a snapshot is restored, rehydrate `CanvasProvider` by dispatching `SET_PANELS` and seeding `dataStore` entries so the UI and context stay aligned.
4. While touching the persistence surface, capture optional isolation data if `IsolationProvider` is enabled (so toggling isolation retains state after reload).

### 4. Clean note switching edge-cases
1. When note changes, clear any selection guards and stop momentum (`stopAllMomentumRef` already exists). Call both before resetting state to avoid lingering listeners from the previous note.
2. Debounce branch initialization: ensure the `CanvasProvider` loads DB branches for the new note only after the local snapshot is settled to avoid conflicting inserts.
3. Optionally emit a custom event (e.g. `canvas-note-loaded`) once the snapshot or fresh defaults are applied; the notes explorer can listen to hide its loading indicator.

## Testing & Verification
- Manual smoke test: create two notes, place unique components, switch back and forth, refresh each note—layouts must stay independent.
- Regression test for persistence utility: add unit coverage for `getStorageKey`, `saveStateToStorage(noteId)`, and `loadStateFromStorage(noteId)` ensuring they reject mismatched ids.
- Watch browser console for the existing `console.table` logs to confirm each save/load references the correct `NoteId`.
- In development, toggle isolation features (if available) to confirm persisted isolation metadata restores correctly.

## Risks & Follow-ups
- Migrating away from the single shared key means any older snapshot becomes unreachable; document that in release notes or add a one-time migration during load.
- Ensure note switching does not fight with server branch fetches—coordinate `CanvasProvider` dispatches so stale data is not reinserted after reset.
- Future work: wire persistence into the backend once Option B collaboration returns, so the per-note key path can be reused for remote sync.
