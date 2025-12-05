# Fix: Cleanup Effect Clearing Navigation Context

**Date:** 2025-12-05
**Status:** RESOLVED
**Component:** `useNoteWorkspaces` hook
**Affected File:** `lib/hooks/annotation/use-note-workspaces.ts`

---

## Problem Description

When navigating from Entry Dashboard to Entry Workspace via the dropdown menu, the wrong workspace was being loaded. For example:

1. User clicks "test10" in Quick Links → Entry Dashboard loads correctly
2. User clicks "test10" in the workspace dropdown
3. **Expected:** Entry Workspace "test10" loads
4. **Actual:** Entry Workspace "test12" (the default) loads instead

The header showed "test12" instead of "test10" even though the user explicitly selected "test10".

---

## Root Cause Analysis

### The Navigation Flow

When a user clicks a workspace in the Dashboard dropdown:

1. `DashboardView.handleWorkspaceSelect()` calls `onNavigate(entryId, workspaceId)`
2. `DashboardInitializer.handleDashboardNavigate()` receives the call
3. DashboardInitializer sets the workspace context: `setActiveWorkspaceContext(workspaceId)`
4. DashboardInitializer hides dashboard: `setShowDashboard(false)`
5. React unmounts `DashboardView` and mounts children (`AnnotationAppShell`)
6. `useNoteWorkspaces` hook mounts in `AnnotationAppShell`
7. Hook should read context and load the correct workspace

### The Bug

The `useNoteWorkspaces` hook had a cleanup effect (lines 2533-2547) that **unconditionally cleared the workspace context to `null`** when the component unmounted:

```typescript
// BEFORE (buggy code)
useEffect(() => {
  return () => {
    setActiveWorkspaceContext(null)  // Always clears!
  }
}, [])
```

### Timeline from Debug Logs

```
02:42:02.016 - DashboardView: User clicks "test10" dropdown
02:42:02.059 - WorkspaceState: Context SET to test10 (1dcafe9b-...)
02:42:02.081 - DashboardInitializer: setShowDashboard(false) called
02:42:02.112 - NoteWorkspace: New cleanup effect mounts
02:42:03.453 - NoteWorkspace: OLD cleanup effect unmounts
02:42:03.466 - WorkspaceState: Context CLEARED (test10 → null) ← BUG!
02:42:03.614 - NoteWorkspace: initial_workspace_selected
             - pendingWorkspaceId: null (already cleared!)
             - Falls back to default: test12
```

### Why It Happened

During the React re-render triggered by `setShowDashboard(false)`:

1. The **old** `useNoteWorkspaces` instance (from a previous mount) unmounts
2. Its cleanup effect runs and clears the context to `null`
3. This destroys the context that DashboardInitializer **just set** milliseconds ago
4. The **new** `useNoteWorkspaces` instance mounts
5. It reads the context and finds `null`
6. It falls back to the default workspace (test12)

---

## The Fix

### Solution

Modified the cleanup effect to only clear the context if the unmounting instance "owns" it:

```typescript
// AFTER (fixed code) - lines 2533-2561
useEffect(() => {
  emitDebugLog({
    component: "NoteWorkspace",
    action: "cleanup_effect_mount",
    metadata: { note: "Cleanup effect mounted" },
  })
  return () => {
    // Only clear the context if this instance "owns" it
    // This prevents clearing context set by DashboardInitializer during navigation
    const currentContext = getActiveWorkspaceContext()
    const ownedWorkspaceId = currentWorkspaceIdRef.current

    emitDebugLog({
      component: "NoteWorkspace",
      action: "cleanup_effect_unmount",
      metadata: {
        currentContext,
        ownedWorkspaceId,
        willClear: currentContext === ownedWorkspaceId,
      },
    })

    // Only clear if this instance owns the current context
    // If context was changed by navigation (DashboardInitializer), don't clear it
    if (currentContext === ownedWorkspaceId) {
      setActiveWorkspaceContext(null)
    }
  }
}, [])
```

### How It Works

1. When the old instance unmounts, it checks the current context value
2. `currentContext` = `test10` (set by DashboardInitializer)
3. `ownedWorkspaceId` = `null` or previous workspace (from `currentWorkspaceIdRef`)
4. Since they don't match, the cleanup **does NOT** clear the context
5. The new instance mounts, sees `test10` context, loads correctly

### Key Insight

The workspace context is a **global singleton** (`activeWorkspaceContext` in `state.ts`). Multiple components may read and write it. The cleanup effect should only clear the context if the unmounting component was the one that set it, not if another component (like DashboardInitializer) set it for navigation purposes.

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/hooks/annotation/use-note-workspaces.ts` | Modified cleanup effect (lines 2533-2561) to conditionally clear context |
| `lib/note-workspaces/state.ts` | Added debug logging to `setActiveWorkspaceContext` and `getActiveWorkspaceContext` |
| `components/dashboard/DashboardView.tsx` | Added debug logging to `handleWorkspaceSelect` |
| `components/dashboard/DashboardInitializer.tsx` | Added debug logging to navigation flow |

---

## Verification

### Test Steps
1. Navigate to Entry Dashboard (e.g., click "test10" in Quick Links)
2. Click workspace name in dropdown (e.g., "test10")
3. Verify header shows correct workspace name ("test10", not "test12")

### Debug Log Query
```sql
SELECT component, action, metadata, created_at
FROM debug_logs
WHERE action IN (
  'dropdown_workspace_selected',
  'navigate_to_regular_workspace',
  'active_workspace_context_changed',
  'initial_workspace_selected',
  'cleanup_effect_unmount'
)
AND created_at > NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC LIMIT 30;
```

After the fix, `cleanup_effect_unmount` should show `willClear: false` when navigating.

---

## Lessons Learned

1. **Global state cleanup must be conditional**: When multiple components share global state, cleanup effects should only clear state they "own", not state set by other components.

2. **Race conditions in React re-renders**: State changes during component unmount/remount cycles can create race conditions where cleanup effects destroy state that navigation code just set.

3. **Debug logging is essential**: The comprehensive debug logging added during investigation made it possible to trace the exact sequence of events and identify the root cause.

4. **Use refs to track ownership**: Using `currentWorkspaceIdRef.current` to track which workspace this instance "owns" allows the cleanup to make intelligent decisions about whether to clear state.

---

## Related Issues

This fix is part of the Entry-Workspace Hierarchy implementation. Related fixes in this feature:

1. Quick Links navigation to Entry Dashboard (LinksNotePanel.tsx)
2. Entry context management (entry-context.ts)
3. Default workspace selection honoring pending context

---

*Document created: 2025-12-05*
