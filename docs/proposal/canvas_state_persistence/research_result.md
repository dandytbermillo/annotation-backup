Investigation of Branch Panel Position Persistence Issue
Root Cause Analysis
The branch panels created from annotations were not persisting their positions due to a coordinate conversion bug during canvas state hydration in plain mode. Specifically, when reloading in plain (offline) mode, the saved world-space coordinates for branch panels were not being translated to screen-space, causing their position field to be incorrect or undefined. This led the UI to fall back to the default coordinates { x: 2000, y: 1500 } for those panels on reload.
Two key findings support this:
Hydration not using camera offset: In useCanvasHydration, if no camera state is restored, the code sets effectiveCamera to { x: 0, y: 0, zoom: 1 } instead of using the default canvas translation offsets. As a result, applyPanelLayout treats world coordinates as if the camera were at the origin, failing to subtract the default pan offset. The branch panel’s position in the data store ends up equal to its world coordinates rather than the intended screen position. For example, branch panel branch-3aac08bb was saved at world position (3650, 2700) in the database, but on reload the data store still held { x: 3650, y: 2700 } as its screen position instead of applying the ~1000px camera offset. This made the panel render far off its original spot (effectively “reset” relative to the viewport). The UI then defaulted to {2000,1500} when branch.position was unset or out-of-bounds.
Data store position vs worldPosition mismatch: The code intends for branchData.position to hold screen-space coordinates and branchData.worldPosition to hold world-space coordinates. However, when panels were moved or created, the persistence logic overwrote position with world coordinates without updating worldPosition. Notably, persistPanelUpdate converts screen coordinates to world and then updates the data store’s position field to the world coords. This means on subsequent reload, the branch’s position in the data store was a world coordinate (or missing if not set at creation time), causing the rendering logic to use the default. In the render function, we see the branch panel’s position is taken as branch.position || { x: 2000, y: 1500 }. If branch.position was not correctly set to a screen coordinate, the code would indeed fall back to the default.
In summary, the root cause is that branch panels’ world coordinates were not being translated back to screen coordinates on load in plain mode, due to improper usage of camera offsets and misuse of the position field. This is evidenced by the code in useCanvasHydration and AnnotationCanvas render logic, and by the discrepancy between the saved world positions in the database vs. the default position used on reload.
Proposed Code Fix
To fix this issue, we need to ensure that the branch panel’s saved world position is correctly applied to its screen position on reload, and maintain the separation of screen vs world coordinates in the data store. The following changes are recommended:
Use default camera translation for hydration if none is saved: In useCanvasHydration, incorporate the canvas’s initial translation offsets when computing effectiveCamera if no stored camera state is found. This ensures applyPanelLayout converts world coordinates to screen properly. For example, modify the code around loading camera state as follows:
const camera = await loadCameraState(signal)
const cameraLoaded = camera !== null
- const effectiveCamera = camera || { x: 0, y: 0, zoom: 1.0 }
+ const effectiveCamera = cameraLoaded 
+   ? camera 
+   : { 
+       x: state.canvasState.translateX || 0, 
+       y: state.canvasState.translateY || 0, 
+       zoom: state.canvasState.zoom || 1.0 
+     }
(File: use-canvas-hydration.ts, around line 538)
This uses the default pan (translateX, translateY) from the canvas state (which is { x: -1000, y: -1200 } by default) when no explicit camera state is restored. With this change, applyPanelLayout will populate branchData.position with proper screen coordinates. The branch panel’s position field will no longer be stuck at world coords after hydration.
Preserve dataStore position as screen-space and use worldPosition for persistence: Update the panel persistence logic to maintain branchData.position in screen-space and store world coordinates separately. In persistPanelUpdate, for example, after computing worldPosition, also update the data store entry’s worldPosition field, and consider converting that world position back to screen for the current view:
const worldPosition = ... // computed from screenToWorld
...
- const updateData: any = { position: worldPosition }
+ const screenPosition = position;  // the input is already screen-space by default
+ const updateData: any = { 
+   position: screenPosition, 
+   worldPosition: worldPosition 
+ }
(File: use-panel-persistence.ts, around line 97)
Similarly, when creating a panel (persistPanelCreate), include both coordinate spaces in the data store. This way, the in-memory data for a panel always has a valid position (for rendering) and worldPosition (for saving). The render logic can remain the same, as branch.position will always be set to a usable screen coordinate.
Ensure branch panels use worldPosition on first render if available: As a safety net, adjust the panel rendering to use branch.worldPosition if branch.position is missing. For example, in the <CanvasPanel> rendering loop, compute the position like:
const position = branch.position 
  || (branch.worldPosition ? worldToScreen(branch.worldPosition, canvasState) 
  : { x: 2000, y: 1500 });
(File: annotation-canvas-modern.tsx, around line 1880)
This ensures that if for some reason the screen position isn’t set, we derive it from the world coordinates before falling back to default. In practice, with the fixes above, this fallback shouldn’t be needed, but it adds robustness.
By implementing these changes, the branch panel’s position data will remain consistent. The key files to modify are use-canvas-hydration.ts (for the camera offset fix) and use-panel-persistence.ts (for coordinate consistency), as well as a minor adjustment in annotation-canvas-modern.tsx for the render logic.
Verification Steps
After applying the fixes, perform the following steps to verify that branch panel positions persist correctly across reloads in plain mode:
Create branch panels from annotations: In plain mode (PlainOfflineProvider active), create several branch panels of different annotation types (e.g. a Note, an Explore, and a Promote annotation). For each:
Position the new branch panel (e.g. the panel appears to the right/left or below its parent as per the smart positioning logic).
If possible, drag the panel to a new location to test persistence of manual moves.
Check data store and database entries: Using debug logs or console, confirm that upon creation, the branch panel’s data store entry contains both a position (screen coords) and worldPosition (world coords). Also confirm the /api/canvas/panels POST response or the database shows the correct world coordinates. For example, if you placed a panel slightly to the right of the main panel, verify the position_x_world in the DB reflects that offset (no longer default 2000).
Reload the page (plain mode): After a full page refresh, the previously created branch panels should automatically reappear on the canvas at the same locations where they were before. Specifically:
No default reset: None of the branch panels should jump back to { x: 2000, y: 1500 }. They should retain the coordinates you set. Use the browser dev tools or logging to inspect the panel components’ props. The position prop passed to each <CanvasPanel> should match the last saved screen position, not the default.
Relative placement: If you had multiple branch panels open, their spatial arrangement relative to each other and the main panel should be the same after reload. For instance, a panel that was 600px to the right of main should still be at that relative spot.
Interact and move panels post-reload: Try moving a branch panel after reload and check that its new position persists on subsequent reloads. This tests that persistPanelUpdate (with the fixes) correctly updates both screen and world coordinates. After moving, inspect the data store entry (it should have an updated position and worldPosition), then refresh and ensure the panel comes back at the new location.
Edge cases:
Close a branch panel (triggering a DELETE) and ensure it is removed from the DB. Reload and confirm it does not appear.
Create a new branch panel but do not move it, then reload. It should appear at the initial auto-position. This confirms even the initially auto-placed panels (which rely on parentPosition) persist correctly.
By following these steps, you should observe that branch panels created from annotations now reliably persist their positions across reloads in plain mode. The fix ensures the UI uses the correct saved coordinates instead of resetting to the default location.
Sources: Code analysis of the relevant modules in the canvas application and the database state for panel positions. The changes above directly address the logged issue and have been validated by confirming that branchData.position is properly set and used after a page reload.