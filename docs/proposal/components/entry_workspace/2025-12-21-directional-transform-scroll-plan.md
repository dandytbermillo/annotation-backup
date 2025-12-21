# Entry Workspace Directional Scroll Plan (Transform-based)

**Feature Slug:** `entry_workspace_directional_scroll`
**Created:** 2025-12-21
**Status:** Planning

---

## 1. Overview

### Goal
Keep the transform-based (infinite) workspace canvas, but constrain horizontal panning so users can:
- Scroll up and down freely.
- Scroll to the right freely.
- Scroll to the left only to return toward the starting position (no leftward movement past the origin).

This is directional pan control, not a switch to native scrolling.

---

## 2. Constraints / Non-goals

- Do not replace the transform-based canvas with a native scroll container.
- Do not change minimap/isolation provider contracts (not applicable here).
- Do not alter zoom mechanics beyond enforcing directional bounds for pan inputs.

---

## 3. Current State (Context)

- Workspace camera uses `translateX/translateY/zoom` via transforms.
- Panning happens through:
  - Mouse drag (space/hand tool) in `use-canvas-pointer-handlers.ts`.
  - Auto-scroll during drag via `useCanvasCamera().panCameraBy`.
- The camera math currently decreases `translateX` when the user pans right
  (see `lib/hooks/use-canvas-camera.ts`).

This plan adds a horizontal boundary so `translateX` cannot move beyond the
starting position in the left direction.

---

## 4. Definitions

- **originTranslateX**: The baseline `translateX` captured once the workspace is
  ready (after restore/hydration or initial camera state has settled). Avoid
  capturing during transient restoring states.
  - Policy: capture once per workspace lifecycle "ready" transition and do not
    recapture on hot re-renders.
- **Directional rule**: `translateX` cannot be greater than `originTranslateX`.
  - This allows moving right (translateX decreases),
  - and allows moving left only until `originTranslateX` is reached.

If the sign feels inverted during testing, the rule is still the same conceptually:
**never allow the camera to move left of the origin**. Confirm sign once and encode
the correct clamp.

---

## 5. Implementation Plan

### Phase 1: Capture Origin
1. Record `originTranslateX` once per workspace after hydration/restore completes
   (workspace lifecycle is ready), not during intermediate restoring states.
2. Store it in a ref that survives re-renders and is reset on workspace change.
3. Keep origin stable across hot switches (do not recapture on re-render or
   reselect when already ready).
4. Add a helper to reset the origin when the user explicitly resets the view or
   centers a note (recommended).

### Phase 2: Centralized Directional Clamp
1. Create a helper to clamp horizontal movement relative to `originTranslateX`.
2. Apply the clamp in all user-driven pan paths:
   - Drag pan (space/hand tool).
   - Wheel pan (once added).
   - Auto-scroll pan from panel drag (via `panCameraBy`).
3. Ensure both hook paths share the same clamp logic so auto-scroll cannot bypass
   the boundary.

### Phase 3: Programmatic Camera Changes
Decide how to treat non-user camera changes:
- **Option A (strict):** Apply clamp to all camera updates, including programmatic
  centering. This enforces the rule everywhere.
- **Option B (recommended):** Allow programmatic moves to bypass the clamp, and
  update `originTranslateX` afterward so the new position becomes the origin.

Document which option is chosen and apply consistently.

---

## 6. Origin Timing Rationale (Scenarios)

- **Cold restore**: If origin is captured on mount (default camera), it will be
  wrong once the real camera state loads. Capture after lifecycle is ready.
- **Entry switch**: Remount can briefly show default state; capturing origin in
  that window clamps too early. Wait for ready.
- **Hot switch**: The camera is already stable. Recapturing on each render would
  move the boundary and weaken the rule, so keep origin fixed.
- **Reset view / center note**: These are explicit user actions; it is reasonable
  to update origin afterward so the new view becomes the baseline.

---

## 7. Suggested File Touchpoints

- `lib/hooks/annotation/use-canvas-transform.ts`
  - Store `originTranslateX` ref.
  - Apply clamp when updating `translateX` for user pan.
- `lib/hooks/use-canvas-camera.ts`
  - Apply the same clamp in `panCameraBy` (auto-scroll path).
- `lib/hooks/annotation/use-canvas-pointer-handlers.ts`
  - Use the shared clamp for drag and wheel panning.
- Any explicit "reset view" or "center note" handlers
  - Optionally reset `originTranslateX` if you allow programmatic moves.

---

## 8. Testing Checklist

### Directional Pan
- [ ] From origin, scroll left: no movement.
- [ ] Scroll right: movement occurs.
- [ ] Scroll left after moving right: returns to origin and stops.
- [ ] Scroll up/down: always allowed.
- [ ] Verify sign convention: after one right pan, confirm whether `translateX`
      increases or decreases and align the clamp accordingly.
- [ ] Cold restore: origin captured after ready, not before (no early clamp).
- [ ] Hot switch: origin remains stable (boundary does not move).
- [ ] Reset view / center note: origin updates to the new baseline if enabled.

### Auto-scroll + Drag
- [ ] Drag a panel near the right edge: auto-scroll works.
- [ ] Drag near the left edge: auto-scroll does not move past origin.

### Programmatic Changes
- [ ] Center note / reset view behavior matches the chosen rule (strict vs reset-origin).

---

## 9. Acceptance Criteria

- Users can pan vertically in both directions without restriction.
- Users can pan right without restriction.
- Users cannot pan left past the origin position.
- Auto-scroll during drag respects the same horizontal boundary.
