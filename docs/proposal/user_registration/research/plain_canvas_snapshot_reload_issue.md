# Plain Canvas Snapshot Reload Issue — Research Plan

## Objective
When editing in plain mode, switching notes shows the latest content, but a browser reload briefly reverts to stale text until a second refresh. Autosave queueing confirms only one save per note/panel is in flight, so the regression stems from local canvas state replay. This plan outlines how to diagnose and fix the snapshot restore so the first reload reflects server content immediately.

## Current Behaviour Summary
- `PlainOfflineProvider` loads fresh content; `[PlainAutosave][Provider] load:adapter-success` logs show the document version matches the latest save before the UI reverts.
- `canvas-storage.ts` restores viewport/items (and layer nodes) from localStorage as soon as the note mounts, regardless of provider state.
- The snapshot likely contains panel content attributes (e.g. `originalText`) that older code used, so the canvas reapply overwrites the refreshed TipTap editor.
- Pending-save restore in `TiptapEditorPlain` is already guarded to avoid rehydrating stale localStorage when the provider has content, so remaining regression points to canvas snapshot handling.

## Hypotheses
1. **Snapshot Rehydrate Overwrites Provider Load**: In `annotation-canvas-modern.tsx`, the `useEffect` that calls `loadStateFromStorage` sets `canvasItems` before the editor finishes loading. That array may still reference branch data with outdated text used by downstream renderers.
2. **Layer Nodes Store Old Branch State**: `canvas-storage` optionally serializes layer nodes via `layer-manager`. On reload, `layerManager.deserializeNodes` replays DOM overlays that include cached text, replacing the updated editor content.
3. **Annotation Components Use Cached `originalText`**: Components (e.g., `annotation-canvas-modern.tsx`, `annotation-toolbar.tsx`) register listeners on `canvasDataStore`. If `canvasDataStore` rehydrates old `originalText` or `content` fields before the provider refresh event, the editor might see the stale payload via props.
4. **Background Auto-Restore of `pending_save_*` Items**: Although the editor guard prevents direct restoration, the canvas state loader might still find the same data and schedule a provider save (creating the 409 you noticed). Need to verify whether `canvas-storage` triggers an implicit save on mount.

## Files to Inspect
- `components/annotation-canvas-modern.tsx`: snapshot load sequence, `setCanvasItems`, calls to `canvasDataStore.set`.
- `components/canvas/canvas-context.tsx`: handles `canvasDataStore`, branch loading, and may reapply cached branch content.
- `lib/canvas/canvas-storage.ts`: serialization/deserialization of viewport, items, and layer nodes.
- `components/canvas/panel.tsx` + `annotation-toolbar.tsx`: determine whether they read cached panel content and push it into TipTap.
- `PlainOfflineProvider.refreshDocumentFromRemote`: confirm it emits `document:remote-update` early enough for the canvas to react.

## Instrumentation Plan
1. **Add Snapshot Version Logging** in `canvas-storage.ts` when loading; include `parsed.savedAt`, `items.length`, and any branch IDs with cached `content`.
2. **Log `canvasDataStore.set` Calls** (guarded by `NEXT_PUBLIC_DEBUG_AUTOSAVE` or a dedicated flag) to see which branch IDs and fields are populated before/after provider load.
3. **Hook into `document:remote-update`** in `canvas-context.tsx` to confirm whether we reapply branch data after the fresh content arrives.
4. **Capture Layer Manager Activity**: temporary logging in `getLayerManager().deserializeNodes` to check if layer overlays embed stale text.

## Proposed Fix Options
### A. Snapshot Version Check (Preferred)
- Persist provider document version (or `savedAt`) alongside the canvas snapshot.
- During load, compare snapshot timestamp/version with `provider.getDocumentVersion(noteId, panelId)`.
- Skip or delay any state restore if provider already holds a newer version.

### B. Deferred Snapshot Restore
- Wait for the provider to emit `document:remote-update` (or confirm `load:complete`) before applying `setCanvasItems` and layer nodes.
- Potential implementation: store snapshot in a ref, apply inside an effect triggered by a new `document:ready` event.

### C. Snapshot Sanitization
- Remove `originalText`/`content` fields from stored canvas items so the snapshot no longer carries stale editor text; rely solely on provider data for content.
- Requires confirming nothing else depends on those fields (tooltips, preview components, etc.).

### D. Layer Nodes Opt-Out
- If layer overlays are pushing stale HTML, disable their restoration until the provider finishes. Either skip `deserializeNodes` or re-run it after the provider updates.

## Validation Strategy
1. **Manual**: Type in a note, wait for autosave, reload once. With console filtered to `[PlainAutosave]`, ensure `load:adapter-success` and `load:complete` fire before any snapshot logs, and verify the UI shows the latest text immediately.
2. **Automation**: Create a Playwright flow that types text, reloads once, and asserts the note retains the edits without reloading twice.
3. **Regression**: Ensure annotations, panel positions, and viewport still restore correctly (snapshot still valuable for layout).

## Open Questions
- Do any components rely on `canvasDataStore`’s cached `originalText` to display initial content? (If so, we must replace it with provider-sourced data.)
- Does the layer manager store more than layout? Need to confirm before disabling it.
- Should we record provider document version or `savedAt` in the snapshot for better comparisons?

## Next Steps
1. Instrument snapshot load (`canvas-storage.ts`, `canvas-context.tsx`) and capture console logs during the double-reload repro.
2. Decide between Option A (version check) and B (deferred restore) based on findings.
3. Implement the chosen guard and re-run manual/Playwright tests.
4. If conflicts persist, evaluate Option C (sanitizing snapshot content) and ensure no consumer depends on the removed fields.
