# Popup Overlay Hydration Guard (2025-02-15)

## Problem Statement
- Switching workspaces reinitializes the overlay adapter. `overlayAdapter.loadLayout()` runs while we still render the *previous* workspace’s popups, so `isWorkspaceLayoutLoading` stays `true` until the fetch completes.
- During that window users could still drag or resize popups. Those edits mutated local state but were silently overwritten the moment `applyOverlayLayout()` replayed the freshly loaded server layout, making panels “snap back”.
- Because the loader flag also drives the “Hydrating…” pill, users assumed dragging caused hydration. In reality the hydrate was already running; we simply allowed interactions against stale data.

## Root Cause
1. `handleWorkspaceSelect` updates `currentWorkspaceId`, which resets `layoutLoadedRef` and schedules a new `overlayAdapter.loadLayout()` call.
2. The loader effect (`components/annotation-app.tsx:1358-1411`) immediately sets `isWorkspaceLayoutLoading = true` and only clears it in the fetch `finally`.
3. While that flag was `true`, the overlay component kept accepting drags/resizes:
   - `handlePointerDown`, `handleResizePointerDown`, and the measurement effect ignored the loading state.
   - Any move/resize mutated client state but did **not** persist (saving remains disabled until hydration finishes).
4. When the fetch resolved we ran `applyOverlayLayout()` and overwrote those mutations, causing the observed snap-back right as the “Hydrating…” badge was visible.

## Fix Summary
| Area | Change |
| --- | --- |
| `components/annotation-app.tsx` | Adds `isLocked={isWorkspaceLayoutLoading}` to `<PopupOverlay />`, so the overlay receives an explicit “don’t accept input” signal while hydration runs. |
| `components/canvas/popup-overlay.tsx` | Introduces the `isLocked` prop and threads it through pan/drag/resize handlers, measurement, and pointer styles. When locked we: block pointer events, keep measurement queues empty, and short-circuit drag/resize callbacks. |
| `styles/popup-overlay.css` | Adds the `popup-overlay-lock-*` styles for a subtle “Workspace hydrating…” pill so users know interaction is temporarily paused. |

## Implementation Details
1. **Lock propagation**
   ```tsx
   <PopupOverlay
     …
     onResizePopup={handleResizePopup}
     isLocked={isWorkspaceLayoutLoading}
     sidebarOpen={isPopupLayerActive}
     backdropStyle={backdropStyle}
   />
   ```
   Passing the flag keeps the overlay logic self-contained and avoids re-running workspace effects.

2. **Interaction guards (`popup-overlay.tsx`)**
   - `isMeasurementBlocked` now checks `isLocked`, preventing the layout sampler from emitting stale positions/sizes.
   - `handlePointerDown`, popup-header drag hooks, and resize handlers return early when locked, so no interim state changes occur.
   - `overlayInteractive = popups.size > 0 && !isLocked` drives `pointer-events`, `touchAction`, and the cursor (`wait` while locked).

3. **User feedback**
   - When locked we render `<div className="popup-overlay-lock-banner">Workspace hydrating…</div>` over the canvas.
   - CSS adds a translucent gradient plus a pulsing dot to reinforce the temporary pause without hiding the existing popups.

## Verification Guidance
1. **Manual flow**
   1. Open Workspace A, drag a popup — works normally.
   2. Switch to Workspace B and immediately try to drag: header shows `cursor: wait`, popup stays put, lock pill appears.
   3. Once the pill disappears (hydration complete), drag/resizes behave as before and state persists.
2. **Regression spot-checks**
   - Resize a popup post-hydration and confirm the measurement hook still syncs sizes (lock stops local sampling only while true).
   - Toggle back to Workspace A; verify the lock reappears briefly and no popups snap back after it clears.

## Follow-up Ideas (optional)
- Consider dimming connection lines while locked so the state is even clearer.
- Log hydration duration metrics via `debugLog` to catch unusually long workspace loads.

All edits stay inside `components/annotation-app.tsx`, `components/canvas/popup-overlay.tsx`, and `styles/popup-overlay.css`, fully satisfying the resize/overlay guardrails outlined in `docs/proposal/components/popups/resize/IMPLEMENTATION_NOTES.md` and respecting the isolation/reactivity anti-pattern guide (no provider contract changes).***
