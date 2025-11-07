## Overlay Infinite Canvas Implementation Plan

### Background
- Dragging popups beneath the sidebar or far outside the initial viewport currently makes them disappear because `PopupOverlay` clamps its bounds to `canvasRect - sidebarOverlap` and applies `clipPath: inset(...)`. Anything whose translated screen position falls inside that clipped strip never renders, which violates the “infinite canvas” expectation users have from the note canvas.
- The instrumentation pipeline is also noisy: with `NEXT_PUBLIC_DEBUG_LOGGING=true`, every pointer move issues multiple `/api/debug/log` POSTs, flooding the terminal whenever you pan.

### Goals
1. Make the popup overlay behave like an infinite canvas: popups stay visible regardless of how far you pan, including beneath the sidebar.
2. Keep the sidebar interactive (no accidental drag capture) without clipping or hiding the overlay.
3. Reduce debug-log chatter so dragging does not spam `/api/debug/log`.

### Non‑Goals
- No schema/data migrations and no workspace reconciliation in this plan.
- No changes to the Knowledge Base fetching path; popups continue to pull content from the global `/api/items` endpoints.
- No changes to LayerProvider contracts (per `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`); we stay within the existing APIs.

### Constraints & Compliance
- **Isolation Reactivity Anti-Patterns:** Applicable. We must avoid altering shared context contracts or introducing new hooks that could desync providers/consumers. Plan sticks to local overlay math, pointer guards, and logging throttles.
- Sidebar list must always mirror the Knowledge Base tree regardless of workspace; any guard we add must not hide entries.
- Workspace IDs remain layout-only. Folder content continues to load from the Knowledge Base without workspace headers.

### Implementation Steps
1. **Baseline & Feature Flagging**
   - Confirm current overlay bounds via `PopupOverlay` logs and browser DevTools to measure sidebar overlap.
   - Add a temporary `NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN` flag (default true) to gate the new behavior for easy rollback.

2. **Expand the Overlay Container**
   - Update `recomputeOverlayBounds` to always use the full `canvasRect` (or fallback host) without subtracting sidebar overlap.
   - Keep storing the sidebar’s width for pointer hit-testing but stop shrinking `left/width`.
   - Remove `clipPath` usage from the overlay wrapper; instead rely on standard overflow hidden and the transform container.

3. **Pointer Guard via Hit-Testing**
   - Replace the pointer guard offset with runtime checks in `handlePointerDown`:
     - If the pointer is within the sidebar’s bounding box, exit early so sidebar interactions still work.
     - Otherwise proceed with pan logic. This preserves UX without clipping geometry.

4. **Viewport Rendering Guardrails**
   - Move the `visiblePopups` filter to use the overlay’s full virtual viewport (canvas size + generous margin) instead of `window.innerWidth`.
   - Ensure popups with negative coordinates are still considered visible as long as they intersect the expanded viewport.
   - Keep the connection-line renderer unculled so lines remain visible even when parents/children temporarily exit the screen.

5. **Debug Log Throttling**
   - Introduce a utility (e.g., `useThrottledDebugLog`) or timestamp guard inside `PopupOverlay` so pointer move logging runs at most every 250 ms during drag, or disable pointer-level logs entirely unless `debugLoggingEnabled && debugDragTracing`.
   - Continue to respect `NEXT_PUBLIC_DEBUG_LOGGING`; when false, no network calls occur.

6. **QA & Regression Testing**
   - Manual: drag large popup stacks beneath the sidebar, off-screen in all directions, and confirm they remain visible and interactive.
   - Verify the sidebar still receives hover/click while panning near it.
   - Monitor the terminal to ensure `/api/debug/log` chatter drops to expected levels during long drags.
   - Workspace switching: confirm overlay hydration, caching, and connection lines still function in default and additional workspaces.

### Acceptance Criteria
- Popups never disappear solely because they are dragged under/behind the sidebar; they remain visible after re-entering the viewport.
- Connection lines stay rendered regardless of popup position.
- Sidebar interactions remain unaffected (no accidental drag capture).
- Dragging no longer spams `/api/debug/log`; terminal output is quiet unless debug logging is explicitly enabled with the new drag-trace flag.
- No changes to context contracts, no layout regression when `NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN` is toggled off.

### Rollback Plan
- Guard the new behavior behind the env flag. If issues arise, set `NEXT_PUBLIC_POPUP_OVERLAY_FULLSPAN=false` and redeploy to revert to the previous clipping logic while continuing investigation.
