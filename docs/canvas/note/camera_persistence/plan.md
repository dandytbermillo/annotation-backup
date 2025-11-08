# Note Canvas Camera Persistence – Implementation Plan

## Goal
Persist the notes-layer camera (pan/zoom) per overlay workspace so reopening a workspace restores both the overlay popups and the underlying notes viewport.

## Current Behavior
- The popups layer now persists its camera per workspace.
- The notes layer (document canvas) still resets to whatever default `centerOnNote` logic produces when a workspace loads.
- Notes can be centered by user actions (open note, switch note) but those positions are not stored.

## Proposed Approach
1. **Schema Extension**
   - Introduce a `notesCamera` block (e.g., `{ x, y, scale }`) either inside the existing `OverlayLayoutPayload` or in the workspace metadata table used by the notes explorer.
   - Default to identity to remain backward compatible.

2. **Backend Support**
   - Update the API normalizer (similar to what we did for the overlay camera) to accept and persist `notesCamera`.
   - Expose it in the layout envelope so clients can hydrate it.

3. **Layer Provider / Notes Context**
   - Expose a `setTransform` API for the notes layer (if not already available) similar to the popups layer.
   - Ensure the notes canvas (e.g., `notes-explorer-phase1` or the specific component managing the document viewport) can apply an absolute transform.

4. **Client State Tracking**
   - Subscribe to notes-layer transform changes (using `LayerProvider` or the notes workspace context) and mirror the latest transform in a ref (just like `latestCameraRef` for popups).
   - Detect when the notes-layer transform changes and schedule a save that includes `notesCamera`.

5. **Hydration Flow**
   - When loading a workspace, apply the saved `notesCamera` via the notes-layer `setTransform` before rendering notes.
   - Fall back gracefully to identity if the saved layout lacks `notesCamera`.

6. **Hashing & Saves**
   - Update layout hashes and/or workspace metadata hashes to include `notesCamera` so camera-only changes trigger persistence.
   - Ensure conflict resolution merges the notes camera just like the overlay camera.

7. **Testing**
   - Manual: switch between workspaces with different note-canvas views; verify each restores correctly.
   - Automated: add a unit/integration test similar to the overlay hydrating test that ensures `notesCamera` survives save/load cycles.
   - Regression: verify note centering actions (opening a note) still work and do not fight the saved transform.

8. **UX Coordination**
   - Confirm desired behavior when `centerOnNote` or other auto-centering logic runs: should it override the saved `notesCamera` immediately, or only when the user explicitly opens a note?
   - Decide whether the notes camera should be synced with overlay camera when “sync pan/zoom” is enabled, or persisted independently per layer.
