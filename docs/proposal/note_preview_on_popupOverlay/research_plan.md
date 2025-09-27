# Note Preview Tooltip – Research Plan

## Context
- **Symptom:** Hovering notes inside the popup overlay keeps the tooltip body in the "Loading preview…" state. The preview icon appears, but the rich text never renders.
- **Recent Work:** Added additional logging and fallback data sources for `/api/items/[id]`; endpoint now returns both `content` (TipTap JSON) and `contentText`. Front-end caches preview text and emits debug log events (`preview_request`, `preview_fetch_success`, `preview_fetch_error`).
- **Debug Evidence:** Postgres `debug_logs` table shows repeated `preview_request` events with `existingStatus: "loading"`, `shouldFetch: false`, and no corresponding `preview_fetch_success`/`preview_fetch_error` events. Requests sometimes log `loadingTooLong: true`, meaning the promise never resolves or completion handlers are skipped.

## Goals
1. Identify why the preview fetch never transitions out of the `loading` state despite the API responding with content.
2. Restore tooltip parity with the inspector preview: show cached snippet instantly, refresh when new data arrives, and fall back gracefully when API data is missing.
3. Maintain CLAUDE.md compliance (structured debug logs, no console noise).

## Working Hypotheses
1. **Promise Lifecycle Bug:** The fetch resolves, but state updates are short-circuited (e.g., closure retains stale popupId, or guard returns early when entry map mutated). Evidence: repeated `shouldFetch:false` entries while the UI stays on "loading".
2. **Race Between Popups:** Portal re-renders replace popup IDs before the async handler commits, discarding the success state.
3. **Tooltip Render Path:** Tooltip body still reads `previewEntry?.entries` from pre-update state because `setPreviewState` fails to propagate (maybe due to immutable copy issues or missing `requestedAt`).
4. **Network Response Handling:** Even though `/api/items/[id]` works in isolation, the fetch might be rejected (CORS, credentials) within the app if `credentials: 'same-origin'` or environment-specific headers differ.

## Investigation Plan
1. **Reproduce with Fresh Logs**
   - Hover a single note; immediately query `debug_logs` for `preview_%` events to confirm absence of success logs.
   - Capture the popup ID and note ID from metadata for targeted tracing.
2. **Instrument Fetch Promise**
   - Add debug log just before `fetch` returns (e.g., `preview_fetch_resolved` with `response.ok`, `status`).
   - Log inside the `.catch` path and before `setPreviewState` to ensure state transitions occur.
3. **Trace State Mutations**
   - Temporarily log `previewState` size or active child in debug logs (`preview_state_set`) to ensure the map retains entries.
   - Verify `setPreviewState` closure sees latest `previewStateRef` values.
4. **Check Popup Lifecycle**
   - Log when popups mount/unmount (`visiblePopups`) with the same popupId to detect ID churn during async fetch.
5. **Validate Tooltip Rendering**
   - Inspect the Radix tooltip content generation path to guarantee it uses `previewEntry?.entries[child.id]` after state update.
6. **API Cross-Check**
   - Confirm `/api/items/[childId]` returns quickly inside the browser (Network tab / `fetch` via console) to rule out environment-specific latency.

## Affected Files (Current Focus)
- `components/canvas/popup-overlay.tsx`
- `app/api/items/[id]/route.ts`
- `lib/utils/debug-logger.ts`

## Exit Criteria
- Hovering a note shows a textual snippet (from cache or API) within 1 s.
- `debug_logs` display paired `preview_request` and `preview_fetch_success` entries, with occasional `preview_cache_hit` when re-hovering.
- Tooltip no longer stuck in "Loading preview…" even after rapid hover/unhover cycles.
