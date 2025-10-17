# Canvas Workspace Tabs → Toolbar Refactor Plan

**Goal**  
Eliminate tab-specific focus behaviour (centering, layer reordering) by replacing the current “workspace tabs” strip with a lightweight toolbar that lists open notes on a single board. Clicking an item should behave exactly like clicking a toolbar button: highlight the note, do not alter panel coordinates, and keep the camera untouched unless the user explicitly requests a center-on-note action.

---

## 1. Current Behaviour Audit
- Inventory the tab rendering path (`annotation-app.tsx`) and the hooks it triggers (`handleNoteSelect`, `focusSourceRef`, centering effect).
- Document how tab clicks interact with:
  - `openWorkspaceNote` + workspace state (`canvas-workspace-context.tsx`)
  - `centerOnPanel`, layer manager, highlight events
  - Snapshot hydration (`annotation-canvas-modern.tsx`)
- Capture reproduction notes for panel “jump” symptoms (logs, DOM selectors, timings).

## 2. Toolbar UX Requirements
- Toolbar entries mirror the tab content: title, timestamp, close button, optional icons.
- Primary click behaviour:
  1. Highlight the note (same visual treatment as today’s focus).
  2. Pan/zoom the canvas so the note’s main panel is fully in view (call `centerOnPanel(noteId::main)` once per click).
  3. Update any “active” styling for the toolbar item.
- Provide secondary affordances:
  - Explicit “Center” / “Snap back” button for keyboard users.
  - Optional context menu (zoom to fit all, close others, etc.).
- Keyboard navigation / accessibility (tab order, aria labels).
- Responsive layout (overflow handling when many notes are open).

## 3. State Management Changes
- Decide where to hold “highlighted note” vs. “focused note” (if focus is still needed for other features).
- Review consumers of `focusedNoteId` (e.g., floating toolbar, text selection logic) and outline how they adapt when tabs go away.
- Ensure workspace persistence remains accurate: open/close events still update `canvas_workspace_notes`, but toolbar clicks do not re-open notes.

## 4. Camera Behaviour
- Toolbar click must pan the canvas directly to the selected note using the composite store key (`noteId::main`). Avoid any DOM selectors that can match another panel.
- Ensure subsequent centering attempts (manual buttons, keyboard shortcuts) use the same composite key.
- Remove legacy tab-specific centering hooks (`focusSourceRef`, retry loops).
- Audit other effects for unintended auto-centering and strip them unless explicitly invoked.

## 5. UI Implementation Plan
- Replace the tab list component in `annotation-app.tsx` with a toolbar component:
  - Stateless list of open notes, sorted same as current tabs.
  - Each entry: title, timestamp, highlight indicator, close button, center icon.
  - Hover/active states aligned with existing theme tokens.
- Extract reusable button styles (shared with existing toolbar).
- Update storybook / visual regression coverage if available.

## 6. Deprecation & Cleanup
- Remove tab-specific code paths:
  - `focusSourceRef`, `center_effect` hook.
  - Tab-specific CSS and layout wrappers.
  - Any tests exercising tab focus behaviour.
- Update documentation (README, onboarding docs) to reflect toolbar UX.

## 7. Testing Strategy
- Unit Tests:
  - Toolbar renders correct entries for open notes.
  - Clicking toolbar entry emits highlight only (no camera change).
  - Center button pans to correct note (use composite key).
- Integration / E2E:
  - Open, close, reopen notes via toolbar; ensure panel positions persist.
  - Drag panels, switch toolbar entries, confirm no jumps.
  - Smoke tests for multi-note scenarios (plain and collab modes).
- Manual QA checklist:
  - Large workspace with many notes.
  - Mixed note creation/deletion flows.
  - Keyboard navigation through toolbar.

## 8. Rollout Considerations
- Feature flag optional (if incremental rollout desired).
- Communicate UX change to users (release notes, tooltips).
- Monitor telemetry for time spent re-centering after toolbar launch.

## 9. Risks & Mitigations
- **Hidden panels:** Without auto-centering, users may lose sight of off-screen notes → mitigate with explicit “Center” action and mini-map hints.
- **Dependent features:** Ensure other systems relying on `focusedNoteId` (e.g., selection widgets) receive a safe default or alternative signal.
- **Snapshot migrations:** Removing tabs should not break saved snapshots; verify no hard-coded expectations exist in storage schemas.

---

**Next Steps**
1. Collect open questions with design/PM (visual design, overflow behaviour).
2. Prototype toolbar component behind a dev flag for quick validation.
3. Execute implementation following steps above, keeping changes scoped to toolbar + dependent state.
