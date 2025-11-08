# Overlay Lazy Load & Autosave Guard – Implementation Plan

## Goals
- Stop hydrating the overlay workspace (popups, camera, sidebar folders) until the user explicitly opts into it (toggle layer tab or View button). This prevents unnecessary fetches and avoids interfering with note autosave on cold reloads.
- Keep note autosave stable by ensuring the pending snapshot promotion waits for the provider cache to load before issuing the first `saveDocument`.

## Current Pain
- `AnnotationAppContent` hydrates overlay state on every load, even if the user never opens the overlay layer.
- Pending snapshot promotion in `components/canvas/tiptap-editor-plain.tsx` calls `provider.saveDocument` before `PlainOfflineProvider.loadDocument` has filled `documentVersions`, causing `baseVersion = 0` saves and 409 errors.

## Implementation Steps

### 1. Defer Overlay Hydration
1.1 Add a `shouldLoadOverlay` flag (`useState(false)`) in `AnnotationAppContent`.  
1.2 Flip the flag when:
   - User switches the canvas layer tab to `overlay` (existing tab handler).
   - User clicks the floating toolbar “View”/overlay button (propagate a callback down to set the flag).
1.3 Wrap overlay-specific `useEffect`s (workspace layout load, sidebar folder fetches, hover popup timers) with `if (!shouldLoadOverlay) return`.  
1.4 Condition-render `<PopupOverlay />` and sidebar hover popups only when `shouldLoadOverlay` is true (keep placeholder containers to avoid layout shifts).

### 2. Lazy-load Assets
2.1 Convert overlay-heavy components to dynamic imports where possible so they don’t bundle-load until needed (PopupOverlay is already a separate component; just guard its mount).  
2.2 Ensure `LayerProvider` can skip overlay transforms until `shouldLoadOverlay` turns true.

### 3. Guard Pending Snapshot Promotion
3.1 In `components/canvas/tiptap-editor-plain.tsx`, inside the pending snapshot promotion block, call `await provider.loadDocument(noteId, panelId)` (or wait for `isContentLoading` to clear) before invoking `provider.saveDocument`.  
3.2 Only run the promotion once `documentVersions` has a value; if `loadDocument` fails, skip promotion rather than attempting a `baseVersion=0` save.

### 4. Telemetry / Logging
4.1 Add lightweight debug logs to confirm when `shouldLoadOverlay` flips and when pending promotion skips due to load failure.  
4.2 Optionally emit a metric when a promotion retry succeeds (to confirm the guard works).

## Testing Plan
- Manual:
  - Reload in a note-only flow, verify no overlay fetches run until the overlay tab is opened.
  - Reload, type before opening overlay; ensure no `baseVersion` errors appear.
  - Open overlay after interacting with notes; popups/camera should hydrate as before.
- Automated:
  - Add a regression test around the pending snapshot guard to ensure it waits for `loadDocument`.
  - Optional integration test to assert overlay layout load isn’t called when `shouldLoadOverlay` stays false.
