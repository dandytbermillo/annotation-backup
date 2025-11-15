# Optimistic Overlay Hydration Plan

Goal: allow overlay workspaces (popups + camera) to hydrate in the background while keeping the canvas fully interactive, so users can drag/pan immediately after opening the overlay layer without “Workspace: hydrating” snapping the view back.

Pre-flight: re-read `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` before touching shared canvas contexts. We will keep provider contracts stable and fence all UI changes behind feature flags to avoid the “consumer leads provider” pitfall called out there.

---

## 1. Diagnose Current Locking

1.1 `isWorkspaceLayoutLoading` remains `true` from the moment `lib/hooks/annotation/use-overlay-layout-persistence.tsx` calls `adapter.loadLayout()` until `applyOverlayLayout` completes.  
1.2 `components/canvas/popup-overlay.tsx` receives that flag as `isLocked`, which freezes gesture handlers in `usePopupSelectionAndDrag`, and `LayerProvider` ignores pointer events while locked.  
1.3 Regardless of user input, `useOverlayLayoutPersistence` invokes `setCameraTransform(savedCamera)` after hydration, overwriting the in-flight transform and producing the “snap back.”

Instrumentation deliverable:
- Add `debugLog` entries inside `popup-overlay.tsx` (`usePopupSelectionAndDrag` + render root) and `use-overlay-layout-persistence.tsx` to capture:
  - `overlay_lock_state_changed` with `isLocked` transitions and stack traces (use `new Error().stack` trimmed to top frame) so we know every place that toggles the lock.
  - `overlay_camera_applied` with payload `{ source: "db" | "user", reason }`.
- Capture one screenshot of the React DevTools timeline showing that `PopupOverlay` is the only lock origin; QA acceptance criterion: logs prove no other modules (gesture controller, workspace provider) keep the lock once `loadLayout` resolves.

---

## 2. Allow Immediate Interaction

2.1 Remove the blanket `isLocked` prop; instead gate only destructive actions (delete/relink) via a new `isRepairingLayout` flag. Drag/pan handlers (`usePopupSelectionAndDrag`, `useOverlayPanState`) must stop reading the lock flag.  
2.2 Keep the status pill (“Hydrating overlay…”) visible, but only as informational text tied to `isWorkspaceLayoutLoading`.  
2.3 First workspace veil decision: YES, but it is cosmetic. Show `components/workspace/workspace-overlay-layer.tsx` a translucent veil (`opacity: 0.15`, pointer-events: none) for max 200 ms after mounting a workspace with zero cached layout entries. The veil disappears immediately when either (a) the first popup arrives or (b) the 200 ms timer expires. Because pointer events stay enabled, this does not reintroduce the lock. Document this UX contract so QA can assert: “veil visible ≤200 ms, interactions still work, pill text updates.”

---

## 3. Merge Camera Transforms Safely

3.1 Ownership: `lib/hooks/annotation/use-overlay-layout-persistence.tsx` already owns layout hydration. Extend it with two refs:
  - `overlayCameraFromUserRef = { transform, timestamp }` updated from `useOverlayPanState` (subscribe via callback prop).
  - `latestCameraRef` tracks the last committed camera, reset whenever `workspaceId` changes (inside `components/workspace/workspace-overlay-layer.tsx`).
3.2 When `applyOverlayLayout` resolves:
  - Compare `overlayCameraFromUserRef.timestamp` with `layoutLoadStartedAt`.
  - If user timestamp ≤ start, call `cameraController.apply(savedCamera)` and update both refs.
  - If user timestamp > start, skip applying DB transform, mark `cameraSkippedDueToUserDrag = true`, and leave the user camera as is.
3.3 Overlap handling: maintain `currentWorkspaceHydrationId` to ignore stale promises—if workspace A kicks off hydration, then workspace B starts before A finishes, reject the late camera merge when IDs mismatch.  
3.4 Telemetry/logging: `debugLog` `overlay_camera_applied` with fields `{ workspaceId, applied: boolean, reason: "user_moved" | "fresh_load" }`.

---

## 4. Popups State Sync

Pipeline:
4.1 Source of `isDragging`: `components/canvas/popup-overlay/hooks/usePopupSelectionAndDrag.ts` already tracks the active drag id. Surface this through context so `PopupOverlay` knows if a popup is mid-drag.  
4.2 Merge rules (implemented in `lib/hooks/annotation/use-overlay-layout-persistence.tsx`):
  - Always trust database values for `content`, `metadata.label`, and `zIndex`.
  - Preserve in-memory `canvasPosition`, `dimensions`, and `dragState` whenever `dragState.isDragging === true` for that popup id.
  - When `dragState` is false, replace `canvasPosition` with DB coordinates to avoid drift.
4.3 Update only changed popups: build a keyed map and diff by `updatedAt`/`position` before mutating React state to minimize flicker.

---

## 5. Persistence & Autosave

5.1 The autosave effect lives in `use-overlay-layout-persistence.tsx`. Update it to gate on `layoutLoadedRef.current === true` rather than `isWorkspaceLayoutLoading`.  
5.2 Introduce `layoutDirtyRef` toggled by:
  - Any user drag while hydration is pending.
  - Any popup drag/resizing event after hydration completes.
  The effect should trigger `persistOverlayLayout` whenever `layoutDirtyRef` is true and either `debounceTimer` fires or the user switches workspaces.
5.3 When we skip applying the DB camera (Section 3), immediately set `layoutDirtyRef.current = true` so the next autosave writes the user’s transform back. Acceptance: after a skipped camera, closing/reopening the workspace should restore the user’s last transform.

---

## 6. Telemetry & UX Polish

Transport: use `debugLog` + the existing `/api/debug/log` endpoint (same as other canvas telemetry). Schema for each event:
- `overlay_layout_hydrate_start`: `{ workspaceId: string, beganAt: string }`
- `overlay_layout_hydrate_finish`: `{ workspaceId, durationMs: number, cameraApplied: boolean, skippedReason?: "user_moved" }`
- `overlay_layout_user_drag_during_hydrate`: `{ workspaceId, firstDragMsSinceStart: number }`
Ensure no PII—workspace IDs already sanitized UUIDs.

UX polish: the status pill text should become “Overlay synced at HH:MM” once `overlay_layout_hydrate_finish` fires. Designers request font-weight normal, grey-500. QA checks: pill text flips within 100 ms of hydration finish; console log shows matching event.

---

## 7. Testing

Manual acceptance (run in staging with `NEXT_PUBLIC_OVERLAY_OPTIMISTIC_HYDRATE=enabled`):
- Reload, open overlay, drag immediately: transform must not snap back, logs show `overlay_layout_user_drag_during_hydrate`.
- Switch between two workspaces while the first is still hydrating: ensure the hydration ID guard prevents the first camera from applying later.
- Verify the first-workspace veil: appears ≤200 ms, pointer interactions still work.

Automation:
- **Unit:** add tests in `__tests__/unit/use-overlay-layout-persistence.test.ts` (new) that simulate:
  1. “No drag” → DB camera applies.
  2. “Drag before finish” → DB camera skipped, dirty flag set.
- **Integration (Playwright):** extend `playwright/overlay-hydration.spec.ts` to stub `/api/overlay/layout` with delay, drag the canvas during hydrate, assert viewport transform after promise resolves.
- **Telemetry:** in the unit test, mock `debugLog` to ensure `overlay_layout_hydrate_finish` carries correct `cameraApplied` flag.

---

## 8. Rollout Notes

Feature flag: gate all optimistic behavior behind `NEXT_PUBLIC_OVERLAY_OPTIMISTIC_HYDRATE`. Default `disabled` in prod until soak tests pass.
Rollout checklist:
1. Enable flag in staging, run the manual scenarios plus the Playwright suite.
2. Monitor `overlay_layout_hydrate_finish` metrics in Grafana (new dashboard) for 24 h; if `cameraApplied=false` spikes above 30% without corresponding drag events, flip the flag off.
3. Document kill switch: toggling the env flag immediately reverts to the old locking behavior.
4. After prod rollout, update `docs/Workspace/overlay-architecture.md` with the optimistic flow and log schemas to keep future refactors aligned.
