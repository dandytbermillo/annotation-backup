# Hard-Safe 4-Cap Eviction - Manual Test Documentation

**Date:** 2025-12-16
**Feature:** Hard-Safe 4-Cap Eviction (No Silent Data Loss)
**Spec:** `docs/proposal/workspace-state-machine/improvement/2025-12-15-hard-safe-4cap-eviction.md`

---

## Overview

The hard-safe 4-cap eviction system ensures that workspace runtimes are never destroyed unless their state is known-durable. This prevents silent data loss when persistence fails.

### Key Behaviors

| Scenario | Workspace Dirty? | Persist Result | Eviction Outcome |
|----------|------------------|----------------|------------------|
| Normal eviction | No | N/A | Evicted (safe) |
| Normal eviction | Yes | Success | Evicted (saved) |
| Blocked eviction | Yes | Failed | **Blocked** (data preserved) |
| Degraded mode | Any | 3+ failures | **Cold opens blocked** (new runtime creation blocked) |

### Key Files

- `lib/hooks/annotation/use-note-workspace-runtime-manager.ts` - Eviction logic
- `lib/workspace/store-runtime-bridge.ts` - Dirty state detection
- `lib/workspace/eviction-toast.ts` - Toast notifications
- `components/dashboard/DashboardInitializer.tsx` - Callback registration

---

## Pre-Test Setup

### Requirements
1. Dev server running: `npm run dev`
2. Browser with DevTools open (Console + Network tabs)
3. At least 5+ workspaces available for testing

### Understanding Workspace Capacity
- **Runtime capacity:** 4 workspaces can be "hot" (in memory) at once
- **Eviction trigger:** Opening a 5th workspace triggers eviction of the LRU (least recently used) workspace
- **LRU selection:** `getLeastRecentlyVisibleRuntimeId()` excludes pinned, active, and visible workspaces

### Understanding Dirty State
A workspace is "dirty" (has unsaved changes) when:
1. **Component store dirty:** Timer/calculator state modified (but NOT started - running timers create "active operations" which prevent the workspace from being selected as eviction candidate at all)
2. **Workspace-level dirty:** Panel moved, note opened/closed, component added/removed

**Important:** Typing in the note editor does NOT trigger workspace-level dirty state (it uses a separate persistence path via TipTap).

**Note on Active Operations:** A workspace with a running timer is protected from being selected as an eviction candidate entirely (see `lib/workspace/runtime-manager.ts:1081-1099`). For testing dirty state blocking, use panel movement instead.

---

## Test 1: Basic Eviction Flow (Normal Operation)

### Objective
Verify that when persistence is available (online), eviction proceeds normally and workspace state is preserved and restored correctly.

### Prerequisites
- Network: **Online**
- Starting state: Fresh browser session or cleared workspaces

### Test Steps

#### Step 1: Create Initial Workspaces
1. Open **Workspace 1** (Note A)
2. Add a component (e.g., Timer) to create some state
3. Move the panel to a memorable position
4. Open **Workspace 2** (Note B)
5. Add different content/components
6. Open **Workspace 3** (Note C)
7. Add different content/components
8. Open **Workspace 4** (Note D)
9. Add different content/components

**Console checkpoint:** You should see 4 workspace runtimes active.

#### Step 2: Trigger Eviction
1. Open **Workspace 5** (Note E or create new)
2. This exceeds the 4-cap limit

**Console checkpoint:** Look for:
```
[EVICTION] Start: { workspaceId: "...", isDirty: true/false, ... }
[EVICTION] Persist result: { workspaceId: "...", persistResult: true, ... }
[EVICTION] Proceeding - safe to evict: { ... }
```

#### Step 3: Verify Eviction Occurred
1. Console should show `workspace_runtime_evicted` action
2. One of Workspaces 1-4 (the LRU) should have been evicted

#### Step 4: Verify State Restoration
1. Navigate back to the evicted workspace
2. Verify:
   - Panel positions are restored
   - Components are restored (but timers are paused - "preserve state, not behavior")
   - Note content is intact

### Expected Results
- Eviction proceeds without blocking
- No toast notification (eviction was successful)
- State is fully restored when returning to evicted workspace

### Console Log Pattern (Success)
```
[EVICTION] Start: { workspaceId: "ws-123", isDirty: true, componentStoreDirty: false, workspaceLevelDirty: true, ... }
[EVICTION] Persist result: { workspaceId: "ws-123", persistResult: true, isDirty: true }
[EVICTION] Proceeding - safe to evict: { workspaceId: "ws-123", persistResult: true, isDirty: true }
```

---

## Test 2: Blocked Eviction (Dirty State Cannot Persist)

### Objective
Verify that when a dirty workspace cannot be persisted (offline), eviction is blocked and the user is notified via toast.

### Prerequisites
- Network: Will go **Offline** during test
- Starting state: At least 4 workspaces with content

### Test Steps

#### Step 1: Visit 4 Workspaces
1. Open **Workspace 1** (Note A)
2. Open **Workspace 2** (Note B)
3. Open **Workspace 3** (Note C)
4. Open **Workspace 4** (Note D)

This fills the 4-cap runtime capacity.

#### Step 2: Go Offline
1. Open DevTools → Network tab
2. Select **"Offline"** from the throttling dropdown
3. Verify the "No internet" icon appears in Chrome

#### Step 3: Create Dirty State on Workspace 2
1. Open **Workspace 2**
2. **Move a panel** - drag it to a different position on the canvas
   - This triggers `scheduleSave` which sets `workspaceDirtyRef`
3. **Checkpoint (recommended, immediate):** Verify dirty state was recorded by checking console for:
   - `save_schedule` action (from `use-workspace-persistence.ts`)

**Fallback (post-hoc):** If you missed the `save_schedule` event, you can still confirm the dirty bit later in Step 6 by checking the eviction start log for `workspaceLevelDirty: true`. This is useful for validation, but it does not confirm the dirty state was set *before* proceeding to Step 4.

**Important:** Moving a panel is the key action. Simply typing in the editor won't trigger workspace-level dirty state. If you don't see the `save_schedule` event, the move didn't register - try moving the panel again.

#### Step 4: Make Workspace 2 the LRU (Least Recently Used)
1. Visit **Workspace 3** (click to open)
2. Visit **Workspace 4** (click to open)
3. Visit **Workspace 1** (click to open)

Now the access order is: Workspace 1 (most recent) → 4 → 3 → **2 (LRU)**

This ensures Workspace 2 (the dirty one) will be selected for eviction.

#### Step 5: Trigger Blocked Eviction
1. Click **Workspace 5** to attempt opening it
2. System attempts to evict Workspace 2 (LRU) → fails because it's dirty and offline
3. **Switch is aborted** - you remain on the current workspace (Workspace 1)
   - `ensureRuntimePrepared` returns `blocked`, and `selectWorkspace` stops (see `use-workspace-selection.ts:211-227`)
   - Workspace 5 does NOT open

#### Step 6: Verify Blocked Eviction
**Console should show:**
```
[EVICTION] Start: { workspaceId: "...", isDirty: true, componentStoreDirty: false, workspaceLevelDirty: true, ... }
[EVICTION] Persist result: { workspaceId: "...", persistResult: false, isDirty: true }
[EVICTION] BLOCKED - persist failed on dirty workspace: { ... }
```

**Toast notification should appear:**
- Title: "Workspace save failed"
- Description: "Unable to switch workspaces. The current workspace has unsaved changes that couldn't be persisted..."
- Variant: Destructive (red)

#### Step 7: Verify Data Preserved
1. Navigate back to Workspace 2
2. Verify the panel is still in its moved position
3. All state is intact (nothing was lost)

### Expected Results
- Eviction is blocked (runtime NOT removed)
- **Switch is aborted** - you remain on Workspace 1, Workspace 5 does NOT open
- Toast notification appears: "Workspace save failed"
- Console shows `[EVICTION] BLOCKED`
- The dirty workspace's (Workspace 2) state is preserved
- User cannot open Workspace 5 until persistence is restored (go back online)

### Console Log Pattern (Blocked)
```
[EVICTION] Start: { workspaceId: "ws-456", isDirty: true, componentStoreDirty: false, workspaceLevelDirty: true, ... }
[EVICTION] Persist result: { workspaceId: "ws-456", persistResult: false, isDirty: true }
[EVICTION] BLOCKED - persist failed on dirty workspace: { workspaceId: "ws-456", persistResult: false, isDirty: true }
[EVICTION NOTIFY] notifyEvictionBlocked called: { workspaceId: "ws-456", blockType: "persist_failed", callbackCount: 1 }
[EVICTION TOAST] Callback triggered: { workspaceId: "ws-456", blockType: "persist_failed", ... }
[EVICTION TOAST] Showing persist_failed toast
```

### Troubleshooting

#### Toast Not Appearing
1. Check console for `callbackCount: 0` in `[EVICTION NOTIFY]`
   - If 0, the callback wasn't registered - check `DashboardInitializer.tsx`
2. Check toast z-index - should be `z-[9999]` in `components/ui/toast.tsx`

#### Eviction Not Blocked
1. Check if `isDirty: false` in the logs
   - If false, the workspace wasn't dirty - move a panel first
2. Check if `workspaceLevelDirty: true` appears
   - If false, the panel move didn't trigger dirty state

#### Wrong Workspace Evicted
1. The LRU workspace is evicted, not necessarily the one you modified
2. Solution: Keep the dirty workspace as the 2nd or 3rd most recently accessed

#### Workspace 5 Appears Empty (Gotcha)
If somehow Workspace 5 does open while offline (e.g., eviction succeeded on a non-dirty workspace), it may appear empty. This is because:
1. The adapter load fails when offline
2. No cached snapshot exists for Workspace 5

This is separate from eviction logic and can confuse the tester. The key validation is:
- Did the eviction block? (check console for `[EVICTION] BLOCKED`)
- Did the toast appear?
- Are you still on the previous workspace?

---

## Test 3: Degraded Mode (Multiple Persist Failures)

### Objective
Verify that after 3 consecutive persist failures during eviction, the system enters "degraded mode" and blocks cold opens (switches that require creating a new runtime).

### Quick Reference (All 13 Steps) — Verified Working 2025-12-18

```
 1. Reload the page (clears consecutiveFailures)
 2. Visit Workspaces 1 → 2 → 3 → 4 (fills the 4-cap; don't start timers)
 3. Go Offline (DevTools Network → Offline)
 4. In Workspace 2, create dirty state by moving a panel
 5. Visit Workspaces 3 → 4 → 1 (so Workspace 2 becomes LRU)
 6. Click Workspace 5 (cold) → eviction BLOCKED (#1)
 7. Click Workspace 6 (cold) → BLOCKED (#2)
 8. Click Workspace 7 (cold) → BLOCKED (#3), degraded mode = true
 9. Click Workspace 8 (cold) → blocked by degraded gate, banner appears
10. While offline, click Retry → toast "You are offline", banner stays
11. Go Online (DevTools Network → No throttling)
12. Click Retry → banner hides, toast "Retry enabled"
13. Click cold workspace (e.g., WS 8) → should open normally
```

### Key Concepts

**Degraded Mode Trigger:**
- `consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD` (threshold = 3)
- Counter increments on each blocked eviction (dirty + persist failed)
- Counter resets on: successful eviction, `resetDegradedMode()` call, or page reload

**Cold vs Hot Opens:**
- **Cold open:** Workspace not in the 4-cap (requires runtime creation → triggers eviction gate)
- **Hot open:** Workspace already in memory (no eviction needed → bypasses gate)
- Degraded mode only blocks cold opens; hot switches may still work

**Counter Reset Behavior:**
- Going online does NOT reset the counter
- Only resets on: successful eviction, explicit `resetDegradedMode()`, or page reload

### Prerequisites
- Network: Will go **Offline** during test
- Starting state: Fresh page load (to reset `consecutiveFailures` to 0)
- At least 8 workspaces available (4 hot + 4 cold for testing)

### Critical Setup Notes

1. **Reload page first** - This resets `consecutiveFailures` to 0. Going online alone does NOT reset the counter.

2. **Cold opens required** - Workspaces 5, 6, 7, 8 must NOT already be hot (not visited this session). If they're in the 4-cap, `ensureRuntimePrepared` won't trigger eviction.

3. **No running timers** - Running timers create "active operations" which protect workspaces from being selected as eviction candidates. Use panel moves only.

4. **Fill 4-cap ONLINE first** - Visit workspaces 1-4 while online so they load properly with panels. Then go offline and make one dirty.

### Test Steps

#### Step 1: Reset State
1. **Reload the page** (resets `consecutiveFailures` to 0)
2. Clear console for clean logs

#### Step 2: Fill the 4-Cap (Online)
1. Visit **Workspace 1**
2. Visit **Workspace 2**
3. Visit **Workspace 3**
4. Visit **Workspace 4**

All 4 runtime slots are now filled with properly loaded workspaces.

**Do NOT start any timers** - they create active operations protection.

#### Step 3: Go Offline
1. Open DevTools → Network tab
2. Select **"Offline"** from the throttling dropdown
3. Verify the "No internet" icon appears

#### Step 4: Create Dirty State on Workspace 2
1. Open **Workspace 2** (if not already there)
2. **Move a panel** - drag it to a different position

**Checkpoint:** Console should show `save_schedule` event (persist will fail because offline, but dirty flag is set).

#### Step 5: Make Workspace 2 the LRU
1. Visit **Workspace 3** (updates its access time)
2. Visit **Workspace 4** (updates its access time)
3. Visit **Workspace 1** (updates its access time)

Now Workspace 2 is the least recently used (LRU) and will be selected for eviction.

#### Step 6: Trigger Blocked Eviction #1
1. Click **Workspace 5** (must be cold - not visited this session)
2. System attempts to evict Workspace 2 (LRU) → fails (dirty + offline)

**Console should show:**
```
workspace_runtime_eviction_start: { isDirty: true, workspaceLevelDirty: true }
workspace_runtime_eviction_persist_result: { persistResult: false, isDirty: true }
workspace_runtime_eviction_blocked_persist_failed: { ... }
consecutive_persist_failure: { previousFailures: 0, newFailures: 1, threshold: 3, isDegradedMode: false }
```

**Toast:** "Workspace save failed"
**Result:** Switch aborted, you stay on Workspace 1 (the last visited)

#### Step 7: Trigger Blocked Eviction #2
1. Click **Workspace 6** (must be cold)

**Console should show:**
```
[EVICTION] BLOCKED
consecutive_persist_failure: { previousFailures: 1, newFailures: 2, threshold: 3, isDegradedMode: false }
```

**Toast:** "Workspace save failed"

#### Step 8: Trigger Blocked Eviction #3 (Enters Degraded Mode)
1. Click **Workspace 7** (must be cold)

**Console should show:**
```
workspace_runtime_eviction_blocked_persist_failed: { ... }
consecutive_persist_failure: { previousFailures: 2, newFailures: 3, threshold: 3, isDegradedMode: true }
```

**Toast:** "Workspace save failed"
**State:** System is now in degraded mode (`consecutiveFailures = 3`)

#### Step 9: Verify Degraded Mode Gate
1. Click **Workspace 8** (must be cold)

**Console should show (NO eviction logs - gate blocks before eviction):**
```
workspace_open_blocked_degraded_mode: {
  requestedWorkspaceId: "...",
  reason: "select_workspace",
  consecutiveFailures: 3,
  threshold: 3
}
```

**Banner:** A persistent banner appears at the top of the screen (different from previous toasts!)
- Title: "Workspace System Degraded"
- Description: "Multiple save failures detected. Opening new workspaces is blocked to prevent data loss."
- Actions: **Retry** button only (no dismiss X button — user must click Retry to clear)

**Key validation:** The `workspace_open_blocked_degraded_mode` log appears WITHOUT any preceding eviction logs. This confirms the gate blocks at `ensureRuntimePrepared` level, before eviction is even attempted.

#### Step 10: Test Offline Retry (Guardrail)
1. While still **offline**, click the **Retry** button in the degraded mode banner

**Expected behavior:**
- Toast appears at bottom: "You are offline - Please check your connection and try again." (red/destructive)
- Banner stays visible (degraded mode NOT reset)

#### Step 11: Go Back Online
1. Open DevTools → Network tab
2. Select **"No throttling"** (or any online option)
3. Verify the "No internet" icon disappears

#### Step 12: Test Online Retry (Success)
1. Click the **Retry** button in the degraded mode banner

**Expected behavior:**
- Toast appears at bottom: "Retry enabled - You can now try switching workspaces again."
- Banner dismisses (disappears)
- `consecutiveFailures` is reset to 0
- Console shows: `degraded_mode_reset` action

#### Step 13: Verify Recovery
1. Click **Workspace 8** (or any cold workspace, e.g., Workspace 9)

**Expected behavior:**
- Degraded mode gate does NOT block (counter is 0)
- Eviction proceeds normally
- If persist succeeds (online): Workspace 8 opens successfully with content
- If persist fails for other reasons: Blocked with "persist_failed_dirty" (not degraded mode)

**Console should show:**
```
workspace_runtime_eviction_start: { workspaceId: "...", ... }
workspace_runtime_eviction_persist_result: { workspaceId: "...", persistResult: true, ... }
workspace_runtime_evicted: { ... }
```

### Expected Results

| Step | Console Log | UI Feedback | Outcome |
|------|-------------|-------------|---------|
| 6 | `[EVICTION] BLOCKED` + `newFailures: 1` | Toast: "Workspace save failed" | Switch aborted |
| 7 | `[EVICTION] BLOCKED` + `newFailures: 2` | Toast: "Workspace save failed" | Switch aborted |
| 8 | `[EVICTION] BLOCKED` + `newFailures: 3, isDegradedMode: true` | Toast: "Workspace save failed" | Degraded mode entered |
| 9 | `workspace_open_blocked_degraded_mode` (no eviction logs) | Banner: "Workspace System Degraded" | Gate blocks before eviction |
| 10 | (none) | Toast: "You are offline" (red) | Retry blocked, banner stays |
| 11 | (none) | (none) | Now online |
| 12 | `degraded_mode_reset` | Toast: "Retry enabled", banner hides | Degraded mode cleared |
| 13 | `workspace_runtime_evicted` | (none) | Workspace opens successfully |

### Expected Behavior: Multiple `[DEGRADED MODE]` Logs Per Click

When in degraded mode, you may see multiple `[DEGRADED MODE]` logs per workspace click with different reasons:
- `reason: 'select_workspace'`
- `reason: 'preview_snapshot'`
- `reason: 'current_workspace'`
- `reason: 'pending_workspace'`

This is expected - `ensureRuntimePrepared` is called from multiple code paths during a workspace switch, and all are correctly blocked by the degraded mode gate.

### Hot Switches Still Work

While in degraded mode, switching between already-hot workspaces (1, 2, 3, 4) should still work because hot switches don't require runtime creation and bypass `ensureRuntimePrepared`.

### Recovery from Degraded Mode

**Going online does NOT automatically clear degraded mode.**

The `consecutiveFailures` counter only resets in these scenarios:
1. **Successful eviction** - `setConsecutiveFailures(0)` in eviction path
2. **Retry button** - Calls `resetDegradedMode()` from the degraded mode banner
3. **Page reload** - Resets all in-memory state

**Recovery Steps (via Retry button):**
1. Go online (DevTools → Network → select "No throttling")
2. Click **Retry** in the degraded mode banner
3. If online: Banner dismisses, toast shows "Retry enabled"
4. If offline: Toast shows "You are offline" - banner stays
5. Try switching workspaces again

**Alternative recovery:**
- **Reload the page** - Resets counter to 0 (simplest method)

### Console Log Patterns

**Blocked Eviction (Steps 6-8):**
```
[EVICTION] Start: { workspaceId: "...", isDirty: true, ... }
[EVICTION] Persist result: { workspaceId: "...", persistResult: false, isDirty: true }
[EVICTION] BLOCKED - persist failed on dirty workspace: { ... }
consecutive_persist_failure: { previousFailures: N, newFailures: N+1, threshold: 3, isDegradedMode: false/true }
```

**Degraded Mode Gate (Step 9+):**
```
[DEGRADED MODE] Blocking workspace open: {
  requestedWorkspaceId: "...",
  reason: "select_workspace",
  consecutiveFailures: 3,
  threshold: 3
}
```

### Troubleshooting

#### Eviction Succeeds Instead of Blocking
1. **Workspace not dirty** - Check `isDirty: true` in logs. Move a panel again.
2. **Wrong workspace evicted** - The LRU workspace was evicted, which might not be the dirty one. Ensure dirty workspace is LRU.
3. **Online** - Verify Network tab shows "Offline"

#### `[DEGRADED MODE]` Log Not Appearing
1. **Counter not at 3** - Check `consecutiveFailures` in logs. May need more blocked evictions.
2. **Workspace is hot** - The clicked workspace is already in the 4-cap. Use a workspace not visited this session.
3. **Counter was reset** - A successful eviction resets the counter. Start over with page reload.

#### Hot Switch Works in Degraded Mode
This is expected. Degraded mode only blocks cold opens (runtime creation). Switching between already-hot workspaces (1-4) bypasses the gate.

### Implementation References

- **Degraded mode check:** `lib/hooks/annotation/use-note-workspace-runtime-manager.ts:251-266`
- **Counter increment:** `lib/hooks/annotation/use-note-workspace-runtime-manager.ts:186-201`
- **Counter reset:** `lib/hooks/annotation/use-note-workspace-runtime-manager.ts:218` (on success)
- **Reset function:** `lib/hooks/annotation/use-note-workspace-runtime-manager.ts:84-91`
- **Banner UI:** `components/workspace/degraded-mode-banner.tsx`
- **Threshold constant:** `CONSECUTIVE_FAILURE_THRESHOLD = 3`

---

## Summary of UI Notifications

| Scenario | Type | Title | Description | Actions |
|----------|------|-------|-------------|---------|
| Persist failed (dirty) | Toast | "Workspace save failed" | "Unable to switch workspaces..." | None |
| Active operations | Toast | "Workspace has running operations" | "Cannot close workspace - X operation(s)..." | None |
| Degraded mode | **Banner** | "Workspace System Degraded" | "Multiple save failures detected..." | **Retry** (no dismiss — user must click Retry) |

---

## Key Implementation Details

### Dirty State Detection (`store-runtime-bridge.ts:workspaceHasDirtyState`)
```typescript
// Gap 1 fix: Check BOTH component store dirty state AND workspace-level dirty state
const componentStoreDirty = workspaceHasDirtyState(targetWorkspaceId)
const workspaceLevelDirty = workspaceDirtyRef?.current?.has(targetWorkspaceId) ?? false
const isDirty = componentStoreDirty || workspaceLevelDirty
```

### Eviction Blocking Logic (`use-note-workspace-runtime-manager.ts:199-235`)
```typescript
// HARD-SAFE EVICTION: Only block if dirty AND persist failed
if (!persistResult && isDirty) {
  // Increment consecutive failure counter
  setConsecutiveFailures((prev) => prev + 1)
  // Notify UI
  notifyEvictionBlockedPersistFailed(targetWorkspaceId, reason)
  return { evicted: false, blocked: true, reason: "persist_failed_dirty", workspaceId: targetWorkspaceId }
}
```

### Degraded Mode Check (`use-note-workspace-runtime-manager.ts:256-271`)
```typescript
const CONSECUTIVE_FAILURE_THRESHOLD = 3
const isDegradedMode = consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD

if (isDegradedMode) {
  emitDebugLogRef.current?.({
    component: "NoteWorkspaceRuntime",
    action: "workspace_open_blocked_degraded_mode",
    metadata: { requestedWorkspaceId: workspaceId, reason, consecutiveFailures, threshold: CONSECUTIVE_FAILURE_THRESHOLD },
  })
  // UI shows degraded banner via isDegradedMode state (see DegradedModeBanner component)
  return { ok: false, blocked: true, blockedWorkspaceId: "" }
}
```

**Note:** Degraded mode notification moved from `showDegradedModeToast()` to UI-driven `DegradedModeBanner` component (2025-12-16). The banner provides a Retry button that calls `resetDegradedMode()`, with online/offline guardrails.

---

## Changelog

| Date | Change |
|------|--------|
| 2025-12-16 | Initial test documentation created |
| 2025-12-16 | Fixed toast z-index (100 → 9999) to appear above minimap |
| 2025-12-16 | Fixed callback registration in DashboardInitializer |
| 2025-12-16 | Added showDegradedModeToast() call for degraded mode |
| 2025-12-16 | Clarified degraded mode semantics/recovery; corrected dirty checkpoint event name (`save_schedule`) |
| 2025-12-16 | Implemented `DegradedModeBanner` component with Retry button; moved degraded UX to UI layer |
| 2025-12-16 | Added Steps 10-13 for testing Retry button (offline guardrail, online recovery, workspace switch verification) |
| 2025-12-17 | Updated degraded mode code example to match current implementation (no toast, UI-driven banner) |
| 2025-12-17 | Fixed banner re-entry bug by removing dismiss (X) button — user must click Retry to dismiss |
| 2025-12-18 | Full test re-verified with prune transient mismatch fix in place; Workspace 8 opens with content intact |
