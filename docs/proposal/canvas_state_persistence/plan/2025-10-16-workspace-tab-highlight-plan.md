# Workspace Tab Re-Select Highlight Plan

**Date**: 2025-10-16  
**Owner**: Canvas Platform  
**Status**: Implementation Plan (pending approval)

---

## Context & Goal

Workspace tabs at the top of the canvas currently re-center and snap the main panel when the user clicks a note that is already focused. The desired behaviour is: re-selecting an already-focused tab should leave the layout untouched and instead briefly highlight the note panel (e.g., glow effect). We must retain existing behaviour when switching to a different tab, keep persistence intact, and avoid the isolation/reactivity anti-patterns checklist (reviewed 2025-10-16; not applicable because we are not modifying isolation providers or related reactivity).

---

## High-Level Approach

1. **Event-driven highlight trigger**  
   - On a “re-select”, emit a workspace-level event that targets the note instead of altering canvas state.
   - Maintain current open/focus logic for first-time selections.

2. **Panel-level visual response**  
   - Panels listen for the highlight event, set local highlight state, and apply a CSS animation (glow/pulse).  
   - The effect auto-clears after a short duration.

3. **Styling**  
   - Define reusable highlight classes in CSS (e.g., a Tailwind utility or module-scoped styles) to avoid inline style duplication.

4. **Persistence & telemetry unchanged**  
   - No database or workspace persistence changes; highlighting is purely UI state.

---

## Detailed Implementation Steps

### 1. Wire highlight event publishing
1. Update `components/annotation-app.tsx`:
   - In `handleNoteSelect`, detect when `noteId === focusedNoteId`.
   - Instead of incrementing `centerTrigger`, emit an event via `workspace.events.emit('workspace:highlight-note', { noteId })`.
   - Keep existing logic for other cases (opening/focusing different notes, refreshing recents).
2. Ensure event is emitted only after checking the workspace provider is ready to avoid race conditions.

### 2. Subscribe in panel component
1. In `components/canvas/canvas-panel.tsx`:
   - Consume `workspace.events` (via `useCanvasWorkspace().getWorkspace` or inject through props) to attach a listener on mount.
   - Listener verifies payload note matches the panel’s `noteId` and that `panelId === 'main'`.
   - When triggered, set a local `isHighlighting` state boolean and start a timeout (`HIGHLIGHT_TIMEOUT_MS`, e.g., 1600 ms) to reset.
   - Clean up listener and timeout on unmount.
2. Optionally throttle multiple triggers (e.g., reset timer if already highlighting) to keep animation responsive.

### 3. Highlight styling
1. Add CSS (Tailwind utility or module) for glow:
   - Example: `shadow-[0_0_0_3px_rgba(129,140,248,0.8)]`, `ring-2 ring-indigo-400`, plus `transition` or `animate-pulse`.
2. In `CanvasPanel` JSX, conditionally add highlight classes when `isHighlighting` is true.
3. Ensure z-index layering maintains visibility (no layout shifts).

### 4. Remove legacy re-center trigger
1. Remove `centerTrigger` state and the effect that calls `canvasRef.current.centerOnPanel('main')` on same-note reselects.
2. Retain centering when `focusedNoteId` actually changes (switch between notes).

### 5. QA & Testing
- Manual tests:
  1. Select different tabs → canvas re-centers as before.
  2. Re-click current tab → panel glows; no camera movement.
  3. Close tab → highlight listener cleans up (no warnings).
  4. Multiple tabs open, emit highlight quickly → animation restarts smoothly.
- Automated (optional):
  - Add a unit test for the highlight event handler (e.g., `CanvasPanel` hook toggling state).
  - E2E smoke (Playwright) verifying no transform change on reselect (nice-to-have).

---

## Dependencies & Considerations

- Requires access to shared `workspace.events` within `CanvasPanel`.
- Ensure event name is namespaced (`workspace:highlight-note`) to avoid collisions.
- Highlight duration should align with existing UI timing constants (`lib/constants/ui-timings.ts`).
- No changes to API, persistence, or workspace data structures.
- Confirm we’re not introducing new hooks or provider changes that could trigger isolation/reactivity anti-patterns (verified as not applicable).

---

## Rollout Notes

- Feature is safe to ship without flags (pure UX enhancement).
- Verify in plain mode and collaborative mode (Yjs) since `CanvasPanel` runs in both.
- Document behaviour in relevant UX notes or README once implemented.

---

## Next Actions

1. Review and approve this plan.  
2. Implement steps above.  
3. Run `npm run type-check` and regression smoke tests.  
4. Capture before/after GIF for release notes.

