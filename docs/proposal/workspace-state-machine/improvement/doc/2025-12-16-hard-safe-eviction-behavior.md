# Hard-Safe Eviction Behavior Reference

**Date:** 2025-12-16
**Related Implementation:** `lib/hooks/annotation/use-note-workspace-runtime-manager.ts:182-215`

---

## Overview

Hard-safe eviction ensures workspace runtimes are never destroyed unless their state is known-durable. This prevents silent data loss when persistence fails.

---

## Core Logic

```typescript
// Eviction decision (simplified)
if (isDirty && !persistResult) {
  // BLOCKED - dirty state couldn't be saved
  return { blocked: true, reason: "persist_failed_dirty" }
}
// Otherwise: proceed with eviction
```

| `isDirty` | `persistResult` | Outcome |
|-----------|-----------------|---------|
| `true` | `false` | **Blocked** - toast shown, data protected |
| `true` | `true` | Dirty cleared, eviction **proceeds** |
| `false` | N/A | Eviction **proceeds** (no persist needed) |

**Key invariant:** Eviction is blocked **only** when `isDirty=true && persistResult=false`.

---

## Dirty State Sources

A workspace is considered "dirty" when either:

1. **Component-store dirty:** `workspaceHasDirtyState(workspaceId)` returns `true`
   - Timer/Calculator/StickyNote state modified

2. **Workspace-level dirty:** `workspaceDirtyRef.current.has(workspaceId)` is `true`
   - Panel moved, note opened/closed, component added/removed

```typescript
const componentStoreDirty = workspaceHasDirtyState(targetWorkspaceId)
const workspaceLevelDirty = workspaceDirtyRef?.current?.has(targetWorkspaceId) ?? false
const isDirty = componentStoreDirty || workspaceLevelDirty
```

---

## Persist Failure Causes

Persist fails due to **actual failure conditions**, not because dirty state is "old" or "stale":

- Network offline (DevTools throttling, actual disconnection)
- API/database errors (5xx responses, connection refused)
- Authentication issues (token expired, unauthorized)
- Service worker intercepting requests
- Circuit breaker / rate limiting

**Important:** If truly online and backend healthy, persist should succeed regardless of when dirty state was created.

---

## Degraded Mode

After 3 consecutive persist failures during eviction:

```typescript
const CONSECUTIVE_FAILURE_THRESHOLD = 3
const isDegradedMode = consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD
```

**Degraded mode behavior:**
- Blocks cold opens (workspace switches requiring new runtime creation)
- Hot switches (already in 4-cap) still work
- Banner appears with Retry button

**Counter reset triggers:**
1. Successful eviction (`setConsecutiveFailures(0)`)
2. User clicks Retry in banner (`resetDegradedMode()`)
3. Page reload (in-memory state reset)

**Note:** Going online does NOT automatically reset the counter.

---

## UI Notifications

| Scenario | UI Element | Message |
|----------|------------|---------|
| Persist failed (dirty) | Toast | "Workspace save failed" |
| Active operations | Toast | "Workspace has running operations" |
| Degraded mode | **Banner** | "Workspace System Degraded" + Retry button |
| Offline Retry | Toast | "You are offline" |
| Online Retry | Toast | "Retry enabled" |

---

## Caveats and Edge Cases

### Caveat 1: Toast Frequency

"Toast on every cold switch" is only true if:
- The **selected eviction candidate** is `isDirty=true`
- Persist keeps failing for that candidate

LRU candidate selection can change based on access patterns:
- Different workspace might be selected for eviction
- If that workspace is clean or persists successfully → no toast
- Frequency is "often" rather than "always"

### Caveat 2: Dirty Clearing Requires Actual Marker Clear

`persistResult=true` is necessary but not sufficient alone. The successful persist path must actually clear:
- Component-store dirty state
- Workspace-level dirty ref

If `persistResult=true` but workspace still behaves dirty afterward → **dirty-clear bug**.

### Caveat 3: Banner Reappears on Re-entry (Fixed)

~~The degraded-mode banner has a local dismissed state. Clicking **Retry** or the dismiss **X** sets it dismissed. That dismissed state did not automatically reset when degraded mode re-entered, so the banner would not show again until a page reload.~~

**Fixed (2025-12-16):** Added `useEffect` to reset `isDismissed` when `isDegradedMode` becomes `true`:
```typescript
useEffect(() => {
  if (isDegradedMode) {
    setIsDismissed(false)
  }
}, [isDegradedMode])
```

Now the banner correctly reappears when degraded mode is re-entered after recovery.

### Caveat 3: Active Operations Protection

Workspaces with running operations (e.g., active timer) are **excluded from eviction candidate selection** entirely. They won't be selected as LRU candidate regardless of dirty state.

---

## Recovery Flow Example

```
OFFLINE PHASE:
1. Panel moved in W2 → dirty state created
2. Save attempted → FAILED (offline)
3. 3 blocked evictions → degraded mode banner appeared

RECOVERY PHASE:
4. Went online + clicked Retry → degraded mode cleared
5. Tried cold switch → eviction attempted
6. W2 still dirty, persist attempted → FAILED
   (Possible: DevTools still offline, API error, etc.)
7. Toast appeared on cold switches

FIX:
8. Moved panel in W2 while truly online → save triggered
9. Save SUCCEEDED → dirty state cleared
10. W2 is now clean → eviction proceeds → no more toast
```

---

## Implementation References

| Concept | File | Lines |
|---------|------|-------|
| Eviction blocking logic | `use-note-workspace-runtime-manager.ts` | 182-215 |
| Dirty state detection | `store-runtime-bridge.ts` | `workspaceHasDirtyState()` |
| Degraded mode check | `use-note-workspace-runtime-manager.ts` | 251-266 |
| Counter reset (successful eviction) | `use-note-workspace-runtime-manager.ts` | 217-218 |
| Counter reset (Retry action) | `use-note-workspace-runtime-manager.ts` | 83-90 |
| Banner UI | `degraded-mode-banner.tsx` | Full file |
| LRU selection | `runtime-manager.ts` | `getLeastRecentlyVisibleRuntimeId()` |

---

## Test Reference

Full manual test procedure (13 steps):
- `docs/proposal/workspace-state-machine/test/2025-12-16-hard-safe-eviction-manual-tests.md`
