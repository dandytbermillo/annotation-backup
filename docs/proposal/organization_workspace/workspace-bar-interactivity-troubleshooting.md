# Workspace Chrome Interactivity – Investigation Log

## 2025-11-03 — Summary
Repeated attempts were made to ensure the workspace controls (dropdown caret and snapshot `+`) remain interactive when the overlay popups layer is active. Despite multiple refactors, the buttons still fail to respond under certain conditions.

### Changes Attempted
1. **Un-gated Wrapper Pointer Events**
   - Removed `pointer-events: none` from the outer chrome wrapper (`components/annotation-app.tsx:3202`).
   - Result: No change; controls remained non-interactive whenever overlay popups were visible.

2. **Rebuilt the Chrome Layout**
   - Converted the chip to a segmented control with a dedicated caret button and snapshot button (`components/annotation-app.tsx:3174`).
   - Added new handler wiring (`aria` attributes, focus management) and moved workspace selection UI out of the sidebar (`components/sidebar/canvas-sidebar.tsx`).
   - Result: Visual update succeeded, but interaction remained blocked when popups were active.

3. **Adjusted Host Container Pointer Events**
   - Updated the canvas host div so it only disables pointer events while the Constellation view is visible, not during overlay mode (`components/annotation-app.tsx:3331`).
   - Despite the change, the dev build still shows hits being swallowed; the chrome remains inert in the reproduction environment.

4. **Reset Workspace State Post Snapshot**
   - Ensured snapshot flow clears `overlayPopups` and resets the dropdown state to rule out stale layout interactions.
   - Functionally improved UX, but did not address the dead controls.

### Observed Behaviour
- Terminal and browser console show repeated `/api/debug/log` POSTs while interacting with the canvas; no errors accompany the dead click events.
- DOM inspection confirms buttons render with expected handlers, but events never fire when the popups layer is active.
- After rebuilding the dev server and hard-refreshing, the issue persists—suggesting another ancestor element (or an overlaid canvas) continues to intercept pointer events.

### Next Steps / Hypotheses
- The actual ModernAnnotationCanvas may still render an overlay with a transparent layer on top of the chrome, preventing events. Need to inspect its internals (`components/annotation-canvas-modern.tsx`) for global mouse-blocking divs.
- Instrument event listeners to confirm whether clicks reach React handlers or are stopped earlier (e.g., `stopPropagation` in a capturing listener).
- Consider lifting the chrome outside the host container entirely to rule out z-index/pointer-order conflicts.

### Current Status
Unresolved. Controls work intermittently in isolated tests but fail consistently in the reporter’s environment. Further tracing inside the canvas rendering stack is required.
