## Overlay Workspace Minimap Implementation Plan

### Background
- The popup overlay now behaves like an infinite canvas, but users still lack spatial awareness when they drag far from the origin. A minimap gives immediate feedback on where popups sit relative to the viewport, making it easier to confirm the infinite behavior and to jump around large layouts.
- The constellation minimap already solves similar problems (renders arbitrary nodes, tracks the camera transform, and handles large coordinate ranges) and is a better starting point than the note/panel minimap, which is tightly coupled to document layout.

### Goals
1. Provide a lightweight, always-on minimap that reflects the popup overlay’s layout for any workspace.
2. Keep the minimap in sync with the overlay’s pan/zoom state so users can orient themselves and reposition quickly.
3. Reuse as much of the constellation minimap infrastructure as possible to reduce risk and preserve proven behaviors (infinite plane, clustering, throttled updates).

### Non-Goals
- No changes to how popups load their content or save layouts.
- No attempt to merge the note and overlay minimaps; each path remains separate.
- No new workspace persistence for minimap state beyond what the overlay already stores (camera transform, popups).

### Constraints & Compliance
- **Isolation Reactivity Anti-Patterns:** Not triggered—we’re not modifying shared context contracts, only reading existing transforms and popups.
- Overlay content still comes from the global Knowledge Base; minimap must render the same nodes regardless of workspace while using workspace IDs only for layout save/restore.
- Keep debug logging optional; the minimap should not introduce per-frame log spam.

### Implementation Steps
1. **Audit Existing Minimap Code**
   - Review the constellation minimap component (e.g., `components/constellation/minimap.tsx` and associated hooks) to understand how it renders nodes, handles transforms, and syncs with user gestures.
   - Identify dependencies we can reuse (camera state, debounce logic, clustering) versus what needs to be reimplemented for the overlay context.

2. **Define Overlay Minimap Adapter**
   - Add a selector or hook (e.g., `useOverlayMinimapData`) that maps current popups (`Map<string, PopupData>`) to minimap nodes: id, position, and optionally hierarchy depth for styling.
   - Derive the active transform (already computed in `PopupOverlay`) and expose it to the minimap along with viewport dimensions so the minimap can render the current camera rectangle.

3. **Embed Minimap UI**
   - Place a minimap container in the overlay layer (bottom-right corner, above the Hydrating banner). Respect user toggles (e.g., show/hide) and ensure it doesn’t interfere with popup interactions.
   - Borrow the constellation minimap’s SVG drawing logic: render nodes as circles, highlight the current viewport rectangle, and optionally draw parent-child lines in miniature.
   - Include zoom/pan controls if available from the referenced minimap, but keep them optional; primary focus is orientation.

4. **Sync Gestures**
   - Enable clicking/dragging inside the minimap to reposition the overlay: when users drag the viewport rectangle or click a location, translate that into `setTransform` / `layerCtx.updateTransformByDelta`.
   - Use the constellation minimap’s debounced update pattern so we don’t thrash React renders while dragging the main canvas.

5. **Performance Guards**
   - Batch minimap updates: only recompute node positions when popups or transforms change, and memoize the derived data.
   - Gate minimap render by `popups.size > 0` to avoid blank boxes; optionally show a “No popups yet” placeholder.
   - Keep debug logs behind `NEXT_PUBLIC_DEBUG_POPUP_DRAG_TRACE` or a new specific flag to avoid extra `/api/debug/log` traffic.

6. **QA & Verification**
   - Manual: open multiple workspaces, drag popups far from the origin, and verify the minimap reflects their positions and the viewport outline.
   - Interaction: click/drag inside the minimap to recenter the overlay; ensure the main canvas responds smoothly.
   - Edge cases: test with dense popup clusters (clustering still legible) and with very sparse layouts (viewport rectangle stays visible).

### Acceptance Criteria
- The minimap displays all popups for the active workspace, updating as soon as layouts change.
- The viewport rectangle on the minimap tracks the overlay’s pan/zoom state in real time.
- Clicking or dragging within the minimap changes the overlay’s camera without noticeable lag.
- No regressions to popup rendering, hydration, or connection lines; sidebar interactions remain unaffected.

### Rollback Plan
- Guard the minimap behind `NEXT_PUBLIC_OVERLAY_MINIMAP` (default false until fully verified). If issues arise, disable the flag and redeploy; the overlay reverts to its current behavior without the minimap while preserving the rest of the infinite-canvas work.
