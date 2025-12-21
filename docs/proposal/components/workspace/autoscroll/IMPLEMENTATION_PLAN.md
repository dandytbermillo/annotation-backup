# Implementation Plan: Workspace Auto-Scroll Parity (Transform-Based Canvas)

**Feature Slug:** `workspace_autoscroll_parity`
**Created:** 2025-12-20
**Status:** Draft

---

## 1. Goal
Bring the workspace auto-scroll behavior in line with the dashboard experience **without** replacing the transform-based canvas. The workspace should auto-pan when dragging notes/components near edges, with consistent speed, delay, and edge detection.

## 2. Non-Goals
- Do not convert the workspace to native scrolling or add scrollbars.
- Do not change the dashboard auto-scroll implementation.
- Do not alter persistence or workspace lifecycle logic.

## 3. Constraints
- Keep transform-based canvas movement (translate/scale).
- Auto-scroll must respect zoom (screen px → world px).
- Auto-scroll must respect directional clamp rules (both X and Y axes).

## 4. Relevant Current Behavior (Refs)
- **Dashboard auto-scroll:** `components/dashboard/DashboardView.tsx`
  - Uses `useAutoScroll` with container edge detection.
- **Workspace note drag auto-scroll:** `components/canvas/canvas-panel.tsx`
  - Uses `useAutoScroll` + `useCanvasCamera.panCameraBy` (transform-based).
- **Workspace component drag auto-scroll:** `components/canvas/component-panel.tsx`
  - Uses `useAutoScroll` + `useCanvasCamera.panCameraBy`.
- **Auto-scroll engine:** `components/canvas/use-auto-scroll.ts`
  - Provides edge detection, activation delay, and speed control.
- **Directional clamp:** `lib/canvas/directional-scroll-origin.ts`
  - Clamp helpers exist for both X and Y axes.

## 5. Baseline Parameters (Current State)

| Parameter         | Dashboard | Note Panels | Component Panels | Default |
|-------------------|-----------|-------------|------------------|---------|
| threshold         | 50        | 50          | 80               | 50      |
| speedPxPerSec     | 400       | 500         | 480              | 500     |
| activationDelay   | 300       | 800         | 800 (default)    | 800     |
| Visual affordance | No        | Yes (glow + cursor) | No         | -       |
| Container         | containerRef | containerId | containerId   | window  |

**Source refs:**
- Dashboard: `components/dashboard/DashboardView.tsx`
- Notes: `components/canvas/canvas-panel.tsx`
- Components: `components/canvas/component-panel.tsx`

## 6. Isolation Reactivity Anti-Patterns (Compliance)
**Applicability:** Not applicable. This plan does not touch isolation providers, minimap/control-panel reactivity, or `useSyncExternalStore` APIs.
**Compliance:** No new provider/consumer contracts; no UI-only gating; no new hooks bound to unstable context; no coupled behavior changes.

## 7. Parity Definition (Decision Required)
**Selected target: Option A (Match dashboard feel)**
- threshold: 50
- speedPxPerSec: 400
- activationDelay: 300
- Visual affordance: remove glow/cursor in workspace (match dashboard simplicity)

**Option B: Keep workspace slower**
- threshold: 50
- speedPxPerSec: 500
- activationDelay: 800
- Visual affordance: keep glow/cursor in workspace only

**Option C: Hybrid**
- threshold: 50
- speedPxPerSec: 500
- activationDelay: 300
- Visual affordance: decide per UX (document)

Pick one option and treat it as the target profile for all workspace auto-scroll paths.

## 8. Plan of Record (Phases)

### Phase 0 — Baseline Inventory (Complete)
**Status:** ✅ Complete — see Section 5 (Baseline Parameters).

---

### Phase 1 — Shared Auto-Scroll Defaults
Introduce a shared auto-scroll config so workspace and dashboard align on behavior.

**Target files:**
- New `lib/canvas/auto-scroll-config.ts` (config constants)

**Parameters to align:**
- `threshold` (edge proximity)
- `speedPxPerSec`
- `activationDelay`
- Container-relative edge detection (use `canvas-container` id for workspace)

**Acceptance:** Workspace note drag and component drag use the selected parity profile.

---

### Phase 2 — Workspace Note Drag Parity
Ensure note panels use the shared defaults and the same edge detection strategy as the dashboard.

**Target file:**
- `components/canvas/canvas-panel.tsx`

**Notes:**
- Keep `panCameraBy({ dxScreen, dyScreen })` so zoom-corrected panning remains intact.
- No change to existing drag/cursor logic beyond aligning parameters.

**Acceptance:** Dragging a note near any edge matches dashboard feel (speed + delay).

---

### Phase 3 — Workspace Component Drag Parity
Bring component drag auto-scroll in line with the same defaults and behavior.

**Target file:**
- `components/canvas/component-panel.tsx`

**Notes:**
- Use shared defaults (match canvas-panel).
- Keep camera-based panning and clamp behavior.

**Acceptance:** Dragging timers/calculators near edges matches note panel behavior.

---

### Phase 4 — Visual Affordance Consistency
If edge glows or “pending” cursor are used in note panels, decide whether to mirror them for component panels.

**Target files (if needed):**
- `components/canvas/canvas-panel.tsx`
- `components/canvas/component-panel.tsx`

**Acceptance:** Visual affordance behavior matches the selected parity profile (Section 7).

---

### Phase 5 — Manual Verification
**Core checks:**
1. Drag a note panel to left/right/top/bottom edges → auto-scroll engages after delay.
2. Drag a component panel to edges → same behavior as note panel.
3. Repeat at zoom 0.5, 1.0, 2.0 → speed feels consistent (screen px/sec).
4. Ensure no auto-scroll when not dragging.
5. Ensure no drift past directional origin clamp on the left/up sides (X and Y axes).

**Acceptance:** All checks pass with no regressions in drag fidelity or snap-back.

---

## 9. Risks & Mitigations
- **Risk:** Auto-scroll feels too fast/slow when zoomed.
  - **Mitigation:** Use `panCameraBy` (already zoom-corrected).
- **Risk:** Component drag feels different from note drag.
  - **Mitigation:** Shared config + shared edge detection.
- **Risk:** Visual affordance inconsistency.
  - **Mitigation:** Decide in Phase 4 and document explicitly.

## 10. Open Questions
- Confirm Option A remains the target profile, or override with Option B/C.
- Should component drag show the same edge glow as note drag (if any)?
- Should activation delay differ for touch vs mouse (future)?

---

## 11. Exit Criteria
- Workspace drag auto-scroll matches the selected parity profile (Section 7).
- Both notes and components behave identically for threshold, speed, and delay.
- Transform-based canvas and directional clamp remain intact.
