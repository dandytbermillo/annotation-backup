# Plain Mode Double Reload Fix Plan (2025-05-09)

> **Symptom**: After editing a note in plain mode and reloading once, the user sees stale content. A second reload shows the correct content. Newly created notes don’t need the second reload.

## Current Understanding

1. **Provider Save Semantics**
   - `TiptapEditorPlain` debounces saves (300 ms) and uses `PlainOfflineProvider.saveDocument` (optimistic + queue).
   - On beforeunload/visibilitychange it writes `pending_save_{noteId}_{panelId}` to `localStorage` and fires an async `saveDocument`.
   - The provider updates its in-memory `documents`/`documentVersions` immediately for optimistic UI.

2. **Reload Flow**
   1. User reloads while an autosave may still be in flight.
   2. Browser writes pending backup and kicks off `saveDocument`, but unload doesn’t wait for the network.
   3. On next mount the provider cache is empty; the editor (and previously canvas panel) call `loadDocument`.
   4. When the backup’s save hasn’t reached Postgres yet, `loadDocument` returns the older version.
   5. The new pending-save restore logic only replays `localStorage` when provider content is stale; otherwise it bails out. Newly created notes with no snapshot hit this path once (hence one reload).

3. **Canvas Snapshot**
   - `annotation-canvas-modern.tsx` restores viewport/items from `canvas-storage.ts` immediately on mount.
   - `canvas-context.tsx` rehydrates branches into `canvasDataStore` using data from `PlainOfflineProvider.adapter.listBranches` and existing snapshots.
   - Snapshot payloads (`CanvasItem`) include panel `title`, `originalText`, and other metadata from previous sessions. If the snapshot still holds old `content`/`originalText`, components that read from `canvasDataStore` (e.g., tooltips, overlays) can briefly display stale text until the provider refresh arrives.

4. **StrictMode Effect**
   - In dev, React StrictMode mounts, unmounts, and remounts components twice, doubling initial loads and snapshot restores. Production doesn’t duplicate mounts, but stale snapshots still apply once.

5. **Observations from Logs**
   - `[PlainAutosave][Provider] load:adapter-success` shows the provider receiving the latest version on the *first* reload.
   - Immediately afterward, `[PlainAutosave][Adapter] save:start` often fires with a lower baseVersion, triggered by pending-save restore or canvas snapshot replay.
   - `canvasDataStore` global still replays `originalText` for historic branches; portals and overlays may inject the old DOM nodes before the editor finishes.

## Hypotheses

1. **Snapshot Replay Race**: The canvas restores `canvasItems` and layer nodes before the provider’s `document:remote-update` completes, repainting the panel with stale `originalText` values. When the autosave eventually lands, the next reload shows the correct text.
2. **Pending Save Timing**: Even with the version guard, the first reload may still see the DB return version N while the backup contains version N+1. We need to promote the backup to canonical state if the provider report is older.
3. **Branch Metadata Drift**: `dataStore` may store branch `content` that components rely on (e.g., `annotation-toolbar`, `preview` widgets). If those consumers render before the provider refresh applies, they show the older content.

## Research Tasks

### 1. Instrument Provider & Snapshot Interactions
- Add guarded `console.debug` (using flag `NEXT_PUBLIC_DEBUG_AUTOSAVE`) in:
  - `canvas-storage.ts` → log `savedAt`, `items.length`, any `originalText` fields.
  - `annotation-canvas-modern.tsx` → log when snapshot is skipped/applied, including provider version.
  - `canvas-context.tsx` → log when `dataStore.set` runs for `'main'` and branch entries.
  - `PlainOfflineProvider.refreshDocumentFromRemote` → log version, diff detection.

### 2. Correlate Reload Timeline
- Reproduce double reload while recording console logs.
- Capture sequence: snapshot load → provider version → any pending-save restore → `document:remote-update` → autosave queue flush.

### 3. Evaluate Consumers of Snapshot Content
- Search for `canvasDataStore.get('main')` / `branch.content` usage (e.g., `CanvasPanel`, toolbars, overlays).
- Confirm whether UI pulls content from branch metadata prior to provider load.

### 4. Simulate Save Timing
- Use Playwright script to:
  1. Type change A.
  2. Reload immediately (before debounce fires).
  3. Wait for app to load once (verify stale text).
  4. Reload second time (verify fresh text).
- Capture network timings (via `page.on('requestfinished')`) to see when `/documents` POST completes relative to reload.

## Proposed Fixes

1. **Version-Aware Snapshot Guard** *(primary)*
   - Persist provider version (or timestamp) alongside `canvas-storage` state.
   - On load, compare provider’s cached version (`getDocumentVersion`) with snapshot’s stored version.
   - Skip restoring snapshot when provider version is newer.
   - Optionally, reapply snapshot after `document:remote-update` only if provider version is equal or older.

2. **Deferred Snapshot Apply**
   - Store snapshot in ref; wait for editor to emit `onContentLoaded` and `document:remote-update` before applying.
   - This ensures provider content paints first, then layout is restored.

3. **Snapshot Sanitization**
   - Strip `content`/`originalText` from `canvasItems` before saving; only keep layout metadata. Let the provider supply actual text.
   - Update all consumers to rely on provider data instead of snapshot values.

4. **Pending Save Promotion**
   - When `localStorage` backup has higher version than provider, promote it immediately (already implemented partially). Ensure version metadata is included in the backup, and provider replays it synchronously before snapshot restore runs.

5. **Parent-Child Content Flow**
   - Ensure only the editor fetches `loadDocument`; parent components should wait for editor’s `onContentLoaded`. (Already implemented, confirm no regression.)

## Validation

1. Run Playwright suite covering: type → immediate reloads → ensure fresh content after first reload.
2. Manual: edit multiple notes, reload once, confirm text is correct without flicker.
3. Monitor `[PlainAutosave]` logs to ensure no extra `/documents` POST with stale baseVersion occurs after first reload.

## Deliverables

- Code changes implementing snapshot guard / sanitization.
- Updated research doc summarizing instrumentation findings.
- Playwright test(s) verifying no double reload required.
- Optional feature flag for the new behaviour to allow testing before merge.

## Open Questions

- Where do overlays/tooltips get their text? Do they rely on snapshot `originalText`? If removing that field, ensure we have provider fallbacks.
- Should we clear existing snapshots the first time the guard detects stale data? (Consider migration script that prunes localStorage entries.)
- How to handle older snapshots lacking version metadata? (Maybe treat as stale and skip restore.)

---

**Next Steps**: Instrument to gather logs on the first reload, implement version-aware snapshot guard, and update the editor backup logic accordingly.


## Supporting Files
- `docs/proposal/user_registration/research/supporting_files/tiptap-editor-plain.tsx`
- `docs/proposal/user_registration/research/supporting_files/canvas-panel.tsx`
- `docs/proposal/user_registration/research/supporting_files/annotation-canvas-modern.tsx`
- `docs/proposal/user_registration/research/supporting_files/canvas-context.tsx`
- `docs/proposal/user_registration/research/supporting_files/canvas-storage.ts`
- `docs/proposal/user_registration/research/supporting_files/plain-offline-provider.ts`
