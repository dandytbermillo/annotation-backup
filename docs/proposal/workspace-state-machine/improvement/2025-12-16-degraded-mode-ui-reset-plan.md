# Implementation Plan: Wire `resetDegradedMode()` to UI (State‑Driven, Safe)

## Status: ✅ COMPLETE (2025-12-16, updated 2025-12-17)

**Implementation verified and tested.** All phases completed successfully.

**2025-12-17 Update:** Removed dismiss (X) button from `DegradedModeBanner`. Degraded mode is a hard gate for data loss prevention — allowing users to hide the only explanation creates confusion. User must click Retry to dismiss the banner.

---

## Context

Degraded mode is entered after repeated blocked evictions due to persistence failure (offline / adapter error). In degraded mode, `ensureRuntimePrepared(...)` blocks cold opens before eviction is attempted.

~~Current known gap:~~
- ~~Degraded mode does **not** auto-clear when coming back online.~~
- ~~The runtime manager exposes `resetDegradedMode()`, but no UI invokes it.~~

**Resolved:** The `DegradedModeBanner` component now provides a Retry button that calls `resetDegradedMode()`.

Manual test reference:
- `docs/proposal/workspace-state-machine/test/2025-12-16-hard-safe-eviction-manual-tests.md` (Test 3, Steps 1-13)

## Goals

1. Provide an explicit user recovery action: **Retry** (calls `resetDegradedMode()`).
2. Make degraded UX **state-driven** (rendered from `noteWorkspaceState.isDegradedMode`) rather than only a side-effect toast emitted from inside the hook.
3. Preserve safety invariants:
   - no silent eviction
   - no capacity growth when durability cannot be ensured
4. Avoid Isolation/Provider anti-patterns:
   - no new provider/consumer API skew
   - no new `useSyncExternalStore` contract changes required for UI

## Non‑Goals

- Implement a full offline durable queue for workspaces (out of scope here).
- Automatically replay “the blocked navigation” after recovery (optional follow-up).
- Change active-operations protection rules.

## Design Decision

**Move degraded-mode UX ownership to the UI layer that already owns workspace switching controls**, using:
- `isDegradedMode` (boolean) to render a banner/toast
- `resetDegradedMode()` as an explicit user action

Keep the runtime manager hook responsible only for:
- tracking counters
- gating `ensureRuntimePrepared`
- emitting debug logs

### Why UI-driven is better than “toast in hook”

- The toast module cannot access the hook’s `resetDegradedMode()` without unsafe coupling.
- The hook firing a toast can produce repeated toasts for multiple call sites (`select_workspace`, `preview_snapshot`, etc.).
- A state-driven banner/toast can be shown once per entry into degraded mode and can present actions reliably.

## Implementation Steps

### Phase 0 — Identify the correct UI host (always visible) ✅

Before writing UI code, identify the exact component that:

- is always mounted while the annotation workspace UI is in use (so the banner/toast is always visible), and
- already has access to `noteWorkspaceState` (or can receive `isDegradedMode` / `resetDegradedMode` as props).

Typical candidates in this repo:
- `components/annotation-app-shell.tsx` (often the best option because it owns workspace switching UI)
- the top-level dashboard/workspace header component that renders the workspace selector

Acceptance:
- We can point to the specific UI file/component where the degraded indicator will be rendered.

### Phase 1 — Confirm and expose the API at the UI boundary ✅

1. Verify `useNoteWorkspaces` already returns:
   - `isDegradedMode`
   - `resetDegradedMode`
2. Ensure these are present in the result type and are passed to the UI component that owns workspace switching (e.g., the app shell/dashboard UI).

Acceptance:
- UI has access to both values without introducing new providers or global singletons.

### Phase 2 — Add a state-driven degraded indicator with "Retry" ✅

Implement a small UI element (choose one):

**Option A (recommended): persistent banner**
- A banner that appears whenever `isDegradedMode === true`.
- Contains:
  - message: “Saving is unavailable; opening new workspaces is blocked to prevent data loss.”
  - actions:
    - **Retry**: calls `resetDegradedMode()` (see Phase 3 guardrails)
    - **Dismiss** (optional): hides banner but keeps degraded mode active (banner can reappear on next blocked attempt)

**Option B: actionable toast**
- Show a toast once when transitioning `false → true`.
- Includes a **Retry** action button that calls `resetDegradedMode()`.
- Still consider a banner if testers report missing the toast.

Acceptance:
- When degraded mode is active, the user can see an obvious recovery affordance without needing DevTools.

### Phase 3 — Guardrails for "Retry" ✅

Implement these rules for the Retry button:

1. If `navigator.onLine === false`:
   - disable Retry, or
   - allow clicking but show “You are offline” toast/message and do not reset.
2. If online:
   - call `resetDegradedMode()`
   - optionally show a confirmation toast “Retry enabled; try switching again.”

Optional enhancement (safe, but not required):
- Track the last blocked workspaceId the user attempted to open, and after reset, re-attempt the switch once.

**V1 scope:** Do **not** auto re-attempt the blocked navigation. Keep recovery simple: reset → user clicks again.

Acceptance:
- Retry does not encourage unsafe behavior while offline; it does not silently clear degraded mode when connectivity is still down (unless explicitly chosen).

### Phase 4 — Reduce duplicate degraded toasts emitted from the hook ✅

Today, degraded-mode toasting is triggered inside `ensureRuntimePrepared`. After adding UI-driven UX, choose one:

**Option A (preferred): remove hook-side degraded toast**
- Keep only debug logs in the hook.
- UI is the sole owner of user-facing messaging.

**Option B: keep hook toast but make it one-shot**
- Only show the degraded toast once per transition into degraded mode (requires tracking “notified” state).

Acceptance:
- Clicking while degraded does not spam multiple toasts per attempt.

### Phase 5 — Update manual tests ✅

Update Test 3 expectations:
- After going online, user can click **Retry** to clear the degraded gate without a reload.
- Verify a cold open proceeds after Retry (assuming persistence is actually available).

Doc to update:
- `docs/proposal/workspace-state-machine/test/2025-12-16-hard-safe-eviction-manual-tests.md`

## Validation Checklist

### Manual

1. Run Test 3 to enter degraded mode.
2. While still offline, confirm:
   - degraded indicator appears
   - Retry is disabled or warns “offline”
3. Go online.
4. Click Retry.
5. Attempt to open a cold workspace:
   - degraded gate no longer blocks
   - if persistence is now available, the switch succeeds

### Logging

Confirm logs show:
- degraded mode entry (counter hits threshold)
- degraded mode reset action invoked (new `degraded_mode_reset` log already exists)

## Files Likely Touched (by implementation)

- UI owner of workspace switching (likely `components/annotation-app-shell.tsx` or workspace toolbar component)
- Hook return types / wiring (if not already exposed): `lib/hooks/annotation/workspace/workspace-types.ts`, `lib/hooks/annotation/use-note-workspaces.ts`
- If removing hook-side toast: `lib/hooks/annotation/use-note-workspace-runtime-manager.ts`
- Manual test doc update: `docs/proposal/workspace-state-machine/test/2025-12-16-hard-safe-eviction-manual-tests.md`

## Rollback Plan

- If the UI affordance causes regressions, revert the UI banner/toast and keep the degraded gate logic unchanged.
- As a temporary safety fallback, users can still recover by page reload (resets counter).

---

## Implementation Summary (Completed 2025-12-16)

### Files Created

| File | Description |
|------|-------------|
| `components/workspace/degraded-mode-banner.tsx` | New component with Retry button, `navigator.onLine` guardrail, dismiss functionality |

### Files Modified

| File | Changes |
|------|---------|
| `components/annotation-app-shell.tsx` | +1 import, +8 lines to render `DegradedModeBanner` |
| `lib/hooks/annotation/use-note-workspace-runtime-manager.ts` | Removed `showDegradedModeToast()` call and import |
| `docs/.../2025-12-16-hard-safe-eviction-manual-tests.md` | Added Steps 10-13 for Retry button testing |

### Choices Made

| Decision Point | Choice | Rationale |
|----------------|--------|-----------|
| Phase 0: UI host | `annotation-app-shell.tsx` | Already owns `noteWorkspaceState` |
| Phase 2: UI element | Option A (persistent banner) | More visible than toast |
| Phase 3: Offline behavior | Allow click + show "You are offline" toast | Better UX than disabled button |
| Phase 4: Hook toast | Option A (removed) | UI is sole owner of messaging |

### Test Results

All 13 steps of Test 3 passed:
- Steps 1-9: Degraded mode entry (existing behavior)
- Step 10: Offline Retry shows "You are offline" toast ✅
- Step 12: Online Retry shows "Retry enabled" toast, banner hides ✅
- Step 13: Cold workspace opens successfully after recovery ✅
