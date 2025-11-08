# Optimistic Overlay Hydration Plan

Goal: allow overlay workspaces (popups + camera) to hydrate in the background while keeping the canvas fully interactive, so users can drag/pan immediately after opening the overlay layer without “Workspace: hydrating” snapping the view back.

---

## 1. Diagnose Current Locking

1.1 `isWorkspaceLayoutLoading` remains `true` from the moment we call `adapter.loadLayout()` until `applyOverlayLayout` is done and `setOverlayPopups` resolves.  
1.2 We pass `isLocked={isWorkspaceLayoutLoading}` into `<PopupOverlay/>`, which prevents drag/pan and resets gestures.  
1.3 Even if the user forces a transform (LayerProvider drag), `applyOverlayLayout` blindly re-applies the saved camera, so the view “snaps back.”

Deliverable: short doc block or logging confirming where the lock is enforced (PopupOverlay, LayerProvider transform updates).

---

## 2. Allow Immediate Interaction

2.1 Remove the `isLocked` prop from `PopupOverlay` (or rewire it so it only locks while the user explicitly repairs mismatched popups).  
2.2 Ensure gesture handlers in `PopupOverlay`/LayerProvider don’t early-return on `isWorkspaceLayoutLoading`.  
2.3 Keep the “Workspace: Hydrating…” label for awareness, but treat it as purely informational.

Open question: do we need a “loading veil” for the *first* workspace to avoid half-rendered popups? If yes, allow a short (e.g., 200 ms) veil but still permit camera movement underneath.

---

## 3. Merge Camera Transforms Safely

3.1 Track user-origin camera transforms separately:  
 - Add `overlayCameraFromUserRef` that stores the last user drag timestamp + transform.  
 - When LayerProvider emits a popups transform change (drag/pan), update the ref.  
3.2 When `applyOverlayLayout` runs:
 - Compare the saved camera to `latestCameraRef` (current).  
 - If the user hasn’t moved since hydration started (timestamp before `layoutLoadStartedAt`), it’s safe to apply the DB camera.  
 - If they have moved, skip setting the transform (but still update `latestCameraRef` so persistence uses the user’s position).  
3.3 Log whenever we skip the DB camera to aid debugging.

---

## 4. Popups State Sync

4.1 Continue replacing the popups array with the hydrated set, but guard moves: if a popup is already being dragged (`isDragging` true), merge child metadata without clobbering `canvasPosition`.  
4.2 Consider keyed merges where we only update popups whose data actually changed; skip untouched ones to reduce flicker during hydration.

---

## 5. Persistence & Autosave

5.1 Ensure the layout save effect still waits for `layoutLoadedRef` but does **not** rely on `isWorkspaceLayoutLoading`; the flag will drop earlier now.  
5.2 When we skip the DB camera (because the user moved first), mark the layout as “dirty” so the eventual save writes the user’s transform back to the DB (so future loads land at the new spot).

---

## 6. Telemetry & UX Polish

6.1 Add structured logs:
 - `overlay_layout_hydrate_start` with workspace id.  
 - `overlay_layout_hydrate_finish` plus `cameraApplied: true/false`.  
 - `overlay_layout_user_drag_during_hydrate` to quantify how often we skip the DB camera.

6.2 Update the workspace status pill text to something less alarming (e.g., “Synced at 10:32 PM”) once hydration finishes; keep the “Hydrating…” only while the DB call is in-flight.

---

## 7. Testing

Manual:
- Reload, open overlay, immediately drag → view should stay put even if “Hydrating…” briefly shows.
- Switch workspaces rapidly to confirm no extra flicker/locking.

Automation (optional):
- Add a Playwright smoke test that fakes `adapter.loadLayout()` latency and asserts the canvas transform changes while hydration is pending.

---

## 8. Rollout Notes

Potential risk: skipping the DB camera could leave a stale transform if the user never drags (no delta recorded). Mitigation: if no user drag occurred during hydration, still apply the DB camera; otherwise preserve the user’s position.

Document the new behavior in `docs/Workspace/overlay-architecture.md` once implemented so future changes respect the optimistic flow.
