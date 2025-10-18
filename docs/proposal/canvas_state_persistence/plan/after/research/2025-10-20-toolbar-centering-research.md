# Toolbar Centering Snapback – Research Plan (2025-10-20)

## Problem Statement
Clicking a workspace entry triggers two separate motions:
1. The main panel “teleports” to an older coordinate while the canvas is motionless.
2. Shortly after, the viewport pans and the panel returns to its expected position.

The jump only affects the newly focused note and occurs even when the saved panel coordinates are correct. We must determine which lifecycle (snapshot restore, workspace seeding, retry logic, or camera persistence) causes the initial teleport so we can eliminate the visible jitter.

## Hypotheses
1. **Snapshot Restore Re-applies Viewport**  
   `ModernAnnotationCanvasInner` loads viewport state from `loadStateFromStorage`. If that restore runs after the toolbar emits centering, it can overwrite `translateX/translateY`.
2. **Workspace Seeding Updates Panel Position**  
   The `workspaceSeedAppliedRef` effect may still execute for “new” notes and reassign the main panel position to a default/workspace value after we’ve panned.
3. **Centering Retry Interference**  
   `centerOnNotePanel` and `centerOnPanel` both schedule retries. Their combined timing could yank the panel toward a DOM fallback before the final pan resolves.
4. **Camera Persistence Rewrites State**  
   `useCameraPersistence` might persist and immediately restore pre-centering coordinates (especially if debounced flush fires while the viewport is in transit).

## Investigation Steps
1. **Capture Sequenced Logs**
   - Wrap `setCanvasState`, `dispatch({ type: 'SET_CANVAS_STATE' })`, and `centerNoteOnCanvas` to log timestamps, note IDs, and translate values.
   - Record when `loadStateFromStorage` completes and when `useCameraPersistence` persists or enqueues camera updates.
2. **Video + Log Correlation**
   - Record the UI while reproducing the bug. Note timestamps for the initial jump and the subsequent pan. Align them with console logs to see which event fires first.
3. **Panel Position Monitoring**
   - Log the main panel’s world coordinates before and after the jump (read from `canvasItems`, workspace store, and DOM fallback) to confirm whether the panel itself is being mutated or only the viewport.
4. **Feature Isolation Tests**
   - Temporarily disable `useCameraPersistence` to see whether the snapback disappears. Repeat with snapshot restore bypassed (e.g., skip calling `loadStateFromStorage`) to identify the culprit.
5. **Retry Timing Adjustment**
   - Inspect `centerOnPanel`’s retry schedule vs. `centerNoteOnCanvas` retries. If both run concurrently, log their attempt numbers and adjust delays to ensure they don’t conflict.

## Deliverables
1. Timeline log enumerating each viewport mutation (source function, translate values, timestamps).
2. Determination of which lifecycle step triggers the initial jump (snapshot restore, workspace seeding, retries, or camera persistence).
3. Draft fix proposal tailored to the confirmed cause (e.g., gating snapshot restore, updating workspace cache before restore, or pausing persistence during centering).

## Affected Files
- `components/annotation-app.tsx`
- `components/annotation-canvas-modern.tsx`
- `lib/hooks/use-camera-persistence.ts`
- `lib/canvas/center-on-note.ts`

## Next Steps
1. Implement instrumentation based on the steps above.
2. Gather logs/screenshots illustrating the order of operations.
3. Summarize findings and propose a fix once the root cause is confirmed.
