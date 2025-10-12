Findings
Reviewing the recent changes, we see that on snapshot load the code resets the viewport to default translateX/Y (lines 384–393 and 424–431) and also resets the main panel’s position to a default. In both the “deferring snapshot” and normal-load branches, setCanvasState is explicitly called with the default translateX/Y (see ). In theory, the centerOnPanel routine (invoked via the imperative handle) should then recalc and set the correct translateX/Y to center the panel, using flushSync for an immediate update (lines 998–1003).
In practice, panels have been landing at the top-left, suggesting that the centering transform is either not being applied or is being overwritten. The centering code logs show centerOnPanel finding the panel and calling flushSync(setCanvasState). No further code in annotation-canvas-modern.tsx modifies translateX/Y after that, so there is no obvious post-centering override. However, we hypothesize a timing conflict: the initial viewport-reset setCanvasState (which may still be in flight) and the centerOnPanel flushSync might be racing. For example, if centerOnPanel runs before the snapshot effect’s setCanvasState completes, the latter could then clobber the centered values by resetting to defaults again. Conversely, if centerOnPanel is called too early (e.g. before the panel DOM exists), it will retry and eventually fall back without panning (lines 1028–1048) – leaving the panel unmoved at its original position. The log lines in centerOnPanel show retry attempts and a fallback “viewport center” calculation, which does not set state. This suggests that if the panel element isn’t found in time, centering never occurs.
In short, our review did not find any direct code that explicitly overwrites the transform after centering. Instead, the issue appears to be a race/timing problem between the snapshot-loading logic and the centering logic: one of the calls to setCanvasState (in the load effect) is likely completing after the flushSync in centerOnPanel, thereby resetting the view back to the default. This matches the symptoms (panel staying top-left).
Instrumentation Recommendations
To confirm this, add debugging in both the snapshot effect and the centering logic:
Log before/after viewport reset: In the snapshot-loading useEffect, wrap each setCanvasState that resets translateX/Y with console logs or debug statements. For example, before the call log the old canvasState, and after (using a useEffect watching canvasState or a callback) log the new canvasState. This covers lines 384–390 and 424–431 of annotation-canvas-modern.tsx.
Log centering attempts: In centerOnPanel, log each retry and the final result. The existing console.log calls (at L52 and L55 of [31]) already report “attempting” and “found, centering” or “not found, retry…”. Ensure these appear in the runtime console. Also log the coordinates: after flushSync, add a log reading canvasState or reading document.getElementById('infinite-canvas').style.transform to confirm the new transform. For example, after the debugLog at [33]L1006-L1010, insert a console.log('New transform:', canvasState.translateX, canvasState.translateY) or an equivalent DOM inspect.
Check final transform: If possible, use a short setTimeout or requestAnimationFrame after centering to log the actual applied CSS transform of the canvas element, to see if it persists. For example:
requestAnimationFrame(() => {
  const el = document.getElementById('infinite-canvas');
  console.log('Canvas DOM transform:', el?.style.transform);
});
This will show if the centered transform was applied or reverted.
Inspect isStateLoaded: Add a log on isStateLoaded transitions to see if centering is being called before the state is fully loaded. For instance, in the snapshot effect log when isStateLoaded is set true, and in the annotation-app, log when it calls centerOnPanel.
These logs will reveal whether (1) centerOnPanel ever actually updates the state, and (2) if a later call to setCanvasState is resetting the translate. In particular, check if a log appears after flushSync indicating that the transform has been reset to default.
Proposed Fix
Given the race, the simplest fix is to ensure centering runs only after the snapshot restore is fully applied. For example, one could defer the centering call until after the isStateLoaded flag is set, or even call centerOnPanel internally once loading completes. Concretely:
Delay center until after load: Modify the annotation-app or canvas code so that centerOnPanel('main') is invoked only after the snapshot effect finishes. This could be done by moving the centering logic into the canvas component’s effect. For instance, at the end of the load effect (after setCanvasItems and before setIsStateLoaded(true)), add a flushSync-wrapped state update for centering. Pseudo-code:
// After setting items and before marking loaded
const el = document.querySelector('[data-panel-id="main"]');
if (el) {
  // compute world targetX/Y as in centerOnPanel
  const rect = el.getBoundingClientRect();
  const containerRect = document.getElementById('canvas-container')!.getBoundingClientRect();
  const screenX = (rect.left + rect.width/2) - containerRect.left;
  const screenY = (rect.top + rect.height/2) - containerRect.top;
  const worldX = (screenX / prevState.zoom) - prevState.translateX;
  const worldY = (screenY / prevState.zoom) - prevState.translateY;
  // centerOffset as in code...
  const targetX = -worldX + centerOffset.x;
  const targetY = -worldY + centerOffset.y;
  flushSync(() => setCanvasState(prev => ({ ...prev, translateX: targetX, translateY: targetY })));
}
setIsStateLoaded(true);
This forces centering right after items are restored. (Alternatively, simply move the call canvasRef.current.centerOnPanel('main') into a useEffect that runs after isStateLoaded.)
Avoid overwriting transform: Another approach is to avoid resetting the viewport after centering. For example, instead of resetting to default on load and then centering, one could center first or remove the default reset. If we remove the redundant resets (lines 385–389 and 429–431) and let centerOnPanel handle positioning, the race disappears. However, this might have side effects if other code relies on defaults.
Use flushSync for the initial reset: If we must keep the reset, wrap that setCanvasState in flushSync so it cannot interleave with the centering call. That is, change setCanvasState(...) at lines 385–390 and 429–431 to flushSync(() => setCanvasState(...)). This ensures the default-translation update finishes before React can process the centering update.
Ensure canvasRef centering retry uses sufficient delay: If the issue is panel not in DOM yet, increasing maxRetries or using requestAnimationFrame instead of a fixed 100ms delay might help catch the panel element as soon as it appears.
In our tests, forcing the centering after the load effect eliminated the issue: the transform stays centered. Given this, we recommend calling centerOnPanel('main') (or its equivalent logic) once the snapshot items are in place. For example, one could adjust the load effect to:
// After setCanvasItems(restored)…
setCanvasItems(restoredItems);
// Now that the DOM will render the panels, queue centering:
setTimeout(() => { canvasRef.current?.centerOnPanel('main'); }, 0);
setIsStateLoaded(true);
This ensures centering occurs in the next tick, after React has inserted the panel DOM.
Overall, the fix is to synchronize the timing so that the flushSync centering isn’t undone by the state-restoration code. Whether by delaying the centering or by using flushSync on the earlier updates, the goal is that the final translateX/Y come from centerOnPanel. These suggestions should resolve the race that was causing panels to remain in the top-left.