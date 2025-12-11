# Workspace State Persistence System

**Feature Slug:** `eviction_limit`
**Created:** 2025-12-10
**Updated:** 2025-12-10
**Status:** Planning (Revised v3 - Added Hot Workspace Fix)

---

## Executive Summary

Fix workspace component state loss by implementing the same pattern used by successful applications (Chrome, VS Code, Notion, Figma):

1. **Database is source of truth** - Component state always saved to DB
2. **Memory is a cache** - Only for currently active workspace
3. **Eviction becomes safe** - State survives in DB, restored on reload
4. **No arbitrary limits needed** - Memory management is optimization, not critical

---

## The Correct Mental Model

### How Successful Apps Work

| App | Pattern |
|-----|---------|
| Chrome | Tabs can be "discarded" (unloaded), but state restored when clicked |
| VS Code | Files load on demand, unsaved state auto-saved to recovery files |
| Notion | Everything persists to cloud, content loads when navigated to |
| Figma | Continuous save to cloud, large canvases virtualized |

**Common Pattern:**
```
┌─────────────────────────────────────────────────────────────┐
│                     DATABASE (Source of Truth)               │
│              Always has the state, survives everything       │
├─────────────────────────────────────────────────────────────┤
│                     MEMORY (Cache/Working State)             │
│         Fast for active work, can be cleared anytime         │
└─────────────────────────────────────────────────────────────┘

Save: Component → Memory (instant) → DB (async, throttled)
Load: DB → Memory → Component (on workspace switch)
```

### Why This Doesn't Hurt Performance

| Action | Where | Speed |
|--------|-------|-------|
| Timer ticks | Memory only | Instant |
| Save state | Async to DB (every 2 sec) | Non-blocking |
| Switch workspace | One DB read | ~50-100ms (acceptable) |
| Active work | Memory | Instant |

**The user only waits for DB on workspace switch** - which already feels like a "loading" moment.

---

## Problem Statement

### The Actual Bug

We discovered that **metadata IS being saved to DB correctly**:
```sql
-- Database HAS the state:
{"minutes": 5, "seconds": 0, "isRunning": false, "inputMinutes": "5"}
```

But **components start with default values**, not the saved values.

**Code Verification Status:**
- Timer passes `metadata: componentState` to useComponentRegistration ✅
- Calculator passes `metadata: componentState` to useComponentRegistration ✅
- StickyNote does NOT pass metadata ❌
- `componentState: component.metadata` mapping exists in runtimeComponentsToCanvasItems ✅
- ComponentPanel receives `initialState={component.componentState}` ✅
- Timer uses `state?.minutes` for initialization ✅

**Root Cause:** Despite the code appearing wired, state is not restoring. The issue is likely:
1. **Timing/race condition** - Component renders before metadata is populated
2. **Hot workspace issue** - If workspace is hot, `useState(initialState)` doesn't pick up new value
3. **Save timing** - Workspace saves before metadata is updated in runtime ledger

**Investigation Required:** Add logging to trace actual data at each step to find the exact break point.

### Secondary Issues

1. **Fixed limit is arbitrary**: `maxRuntimes: 4` regardless of device capability
2. **Poor eviction priorities**: Simple LRU doesn't protect important workspaces
3. **Default workspace vulnerability**: Always evicted first

### Evidence from Logs

```
runtime_evicted_for_capacity | {
  "evictedWorkspaceId": "6953461d...",  // DEFAULT workspace
  "evictedLastVisibleAt": 0,            // Oldest timestamp
  "evictedComponentCount": 2,           // Had components!
}
```

Database shows state IS saved (contrary to earlier belief):
```json
{"type": "timer", "metadata": {"minutes": 5, "seconds": 0, ...}}
```

---

## Pre-Implementation Investigation

### Required Verification Before Coding

> **IMPORTANT:** These investigations MUST be completed before starting Phase 1 implementation.
> Document findings in `docs/proposal/components/workspace/dashboard/eviction_limit/investigation/` folder.

**Investigation 1: Hot Workspace State Preservation** *(BLOCKING)*
- Open only 3 workspaces (under `maxRuntimes: 4`)
- Add timer to Workspace A, start it at 10:00
- Switch to Workspace B, wait 30 seconds, switch back to A
- **Expected:** Timer should show ~09:30 (no eviction occurred, React state preserved)
- **If fails:** There's another bug beyond eviction - STOP and investigate
- **Document:** Actual behavior, logs, screenshots

**Investigation 2: Entry Switch Behavior** *(BLOCKING)*
- Pin an entry with a running timer
- Switch to a different entry
- Switch back to the pinned entry
- **Expected:** Timer state should persist (pinned)
- **Document:** Actual behavior, whether state persists or resets

**Investigation 3: Identify Entry Switch Detection Point** *(BLOCKING for Phase 1.5)*
- Find where in the code entry switches are detected
- Candidates to search:
  - `components/dashboard/DashboardView.tsx`
  - `lib/navigation/navigation-context.tsx`
  - `app/(dashboard)/[entrySlug]/page.tsx`
  - `components/annotation-app-shell.tsx`
- **Document:**
  - Exact file and line number where entry ID changes
  - The variable/state that holds current entry ID
  - How to hook into entry change events
- **Output:** Update Section 1.6.6 with specific file path and code location

**Investigation 4: Verify Runtime Creation Flow** *(INFORMATIONAL)*
- Find where `createWorkspaceRuntime()` or equivalent is called
- Verify we can pass `entryId` and `isDefault` at that point
- **Document:** File path and how workspace-entry association can be established

---

## Solution Architecture

### Priority-Based Approach

```
┌─────────────────────────────────────────────────────────────┐
│           Phase 1: STATE PERSISTENCE & RESTORATION           │
│                        (CRITICAL)                            │
│                                                              │
│   The actual bug fix. Once this works, eviction is SAFE.    │
│   • Components save state to DB (throttled, async)           │
│   • Components RESTORE state from DB on mount                │
│   • State survives eviction, reload, browser refresh         │
├─────────────────────────────────────────────────────────────┤
│              Phase 2: SMART EVICTION SCORING                 │
│                      (NICE TO HAVE)                          │
│                                                              │
│   Improves UX but not critical (eviction is now safe).       │
│   • Protect default workspace from early eviction            │
│   • Protect workspaces with active timers                    │
│   • Evict empty workspaces first                             │
├─────────────────────────────────────────────────────────────┤
│              Phase 3: MEMORY MONITORING                      │
│                      (OPTIONAL)                              │
│                                                              │
│   Pure optimization - can be deferred indefinitely.          │
│   • Dynamic limits based on device capability                │
│   • Proactive eviction before browser struggles              │
│   • Memory pressure indicators for users                     │
└─────────────────────────────────────────────────────────────┘
```

### Key Insight

**Once Phase 1 works, the fixed `maxRuntimes: 4` limit becomes acceptable.**

Why? Because eviction no longer causes state loss. The limit just controls memory usage, not user experience. Users can:
- Open 5th workspace → oldest is evicted but state saved
- Switch back to evicted workspace → state restored from DB
- No data loss, no frustration

---

## Phase 1: State Persistence & Restoration Fix (CRITICAL)

### 1.1 Problem Analysis

**Issue A: State not saved to metadata** (May already be fixed)

Current Timer.tsx may not pass state to metadata:
```typescript
useComponentRegistration({
  workspaceId,
  componentId,
  componentType: 'timer',
  position,
  // metadata: componentState  ← Need to verify this exists
})
```

**Issue B: State not RESTORED on mount** (THE ACTUAL BUG)

We verified that DB HAS the correct state:
```json
{"type": "timer", "metadata": {"minutes": 5, "seconds": 0, "isRunning": false}}
```

But the restoration chain is broken:
```
DB payload.components[].metadata
     ↓
hydrateWorkspace() loads components  ✓
     ↓
populateRuntimeComponents() stores in ledger  ✓
     ↓
runtimeComponentsToCanvasItems() converts  ← Need to check mapping
     ↓
ComponentPanel receives as initialState  ← Need to verify prop name
     ↓
Timer receives as state prop  ← Need to verify it's used
     ↓
Timer useState initializes with state.minutes  ← VERIFY THIS WORKS
```

### 1.2 The Restoration Fix (CRITICAL PATH)

**This is the core fix. Everything else is secondary.**

#### 1.2.1 Trace the Data Flow

**Step 1: Verify DB has data**
```sql
SELECT payload->'components' FROM note_workspaces WHERE id = 'xxx';
-- Should show: [{"metadata": {"minutes": 5, ...}}]
```

**Step 2: Verify hydrateWorkspace loads it**
```typescript
// In use-note-workspaces.ts hydrateWorkspace()
const incomingComponents = record.payload.components ?? []
console.log('Components from DB:', incomingComponents)  // ADD THIS LOG
```

**Step 3: Verify runtimeComponentsToCanvasItems maps correctly**
```typescript
// In use-runtime-components.ts
export function runtimeComponentsToCanvasItems(components) {
  return components.map((component) => ({
    // ...
    componentState: component.metadata,  // ← VERIFY THIS EXISTS
  }))
}
```

**Step 4: Verify ComponentPanel receives and passes initialState**
```typescript
// In annotation-canvas-modern.tsx or wherever ComponentPanel is rendered
<ComponentPanel
  initialState={component.componentState}  // ← VERIFY THIS PROP
/>
```

**Step 5: Verify Timer uses the state prop**
```typescript
// In timer.tsx
export function Timer({ state, ... }) {
  const [minutes, setMinutes] = useState<number>(state?.minutes ?? 5)
  // ← Does 'state' actually have the value from DB?
}
```

#### 1.2.2 Likely Fix Locations

Based on earlier investigation, the break is likely at one of:

1. **`runtimeComponentsToCanvasItems`** - not mapping `metadata` to `componentState`
2. **Canvas rendering** - not passing `componentState` as `initialState` prop
3. **`ComponentPanel`** - not passing `initialState` to child components

#### 1.2.3 The Fix

Once we find the break point, the fix is simple - just connect the data flow:

```typescript
// Ensure metadata flows through:
DB → payload.components[].metadata
   → runtimeComponentsToCanvasItems() → componentState
   → ComponentPanel → initialState
   → Timer → state prop
   → useState(state?.minutes ?? 5)
```

#### 1.2.4 CRITICAL: Hot Workspace State Sync Fix

**Problem:** React's `useState` only uses `initialValue` on FIRST mount.

```typescript
// ComponentPanel - line 34
const [componentState, setComponentState] = useState(initialState ?? {})
```

If `initialState` changes on a subsequent render (e.g., after DB data loaded), **`useState` will NOT update `componentState`** because React ignores initial value on re-renders.

**This is why state doesn't restore even though the chain appears wired!**

**Solution A: Fix in ComponentPanel (Recommended)**

```typescript
// Add to component-panel.tsx after line 34
// Sync componentState when initialState changes (hot workspace case)
useEffect(() => {
  if (initialState && Object.keys(initialState).length > 0) {
    setComponentState(initialState)
  }
}, [initialState])
```

**Solution B: Fix in Each Component (Alternative)**

```typescript
// Add to timer.tsx after useState declarations
// Sync external state changes (for hot workspace restoration)
useEffect(() => {
  if (state?.minutes !== undefined) setMinutes(state.minutes)
  if (state?.seconds !== undefined) setSeconds(state.seconds)
  if (state?.isRunning !== undefined) setIsRunning(state.isRunning)
  if (state?.inputMinutes !== undefined) setInputMinutes(String(state.inputMinutes))
}, [state])
```

**Recommendation:** Solution A is cleaner (one fix instead of N component fixes).

**Why This Happens:**
1. ComponentPanel mounts with `initialState={}`  (DB not loaded yet)
2. `componentState` = `{}` (useState initial value)
3. DB loads, `initialState` becomes `{minutes: 8, seconds: 30, ...}`
4. ComponentPanel re-renders but **`componentState` stays `{}`** (useState ignores new initialState)
5. Timer receives `state={}`, uses defaults → **State appears lost**

**With the fix:**
1. ComponentPanel mounts with `initialState={}`
2. `componentState` = `{}`
3. DB loads, `initialState` becomes `{minutes: 8, seconds: 30, ...}`
4. useEffect triggers, **`setComponentState(initialState)`**
5. Timer receives `state={minutes: 8, ...}` → **State restored!**

### 1.3 Fix A: Components Save State to Metadata

**Challenge:** Timer state changes every second. Naive implementation would update metadata 60 times/minute.

**Solution:** Throttled metadata updates with immediate save on significant changes.

**Current Status (Verified):**
- Timer: ✅ Already passes `metadata: componentState`
- Calculator: ✅ Already passes `metadata: componentState`
- StickyNote: ❌ Missing - needs `metadata: { content, color }`

#### 1.3.1 Create Throttled State Hook (Verified: Exists)

**New File:** `lib/hooks/use-throttled-component-state.ts`

```typescript
import { useRef, useCallback, useEffect } from 'react'

interface ThrottledStateOptions<T> {
  /** State to track */
  state: T
  /** Throttle interval in ms (default: 2000ms) */
  throttleMs?: number
  /** Keys that trigger immediate update (no throttle) */
  immediateKeys?: (keyof T)[]
  /** Callback when throttled state should be persisted */
  onPersist: (state: T) => void
}

/**
 * Hook that throttles state persistence to avoid excessive updates.
 * Immediate updates for significant changes (e.g., isRunning toggled).
 * Throttled updates for continuous changes (e.g., seconds ticking).
 */
export function useThrottledComponentState<T extends Record<string, unknown>>({
  state,
  throttleMs = 2000,
  immediateKeys = [],
  onPersist,
}: ThrottledStateOptions<T>): void {
  const lastPersistedRef = useRef<T>(state)
  const lastPersistTimeRef = useRef<number>(0)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track latest state for unmount cleanup (avoids stale closure)
  const latestStateRef = useRef<T>(state)
  useEffect(() => {
    latestStateRef.current = state
  }, [state])

  // Track latest onPersist callback
  const onPersistRef = useRef(onPersist)
  useEffect(() => {
    onPersistRef.current = onPersist
  }, [onPersist])

  const persist = useCallback((newState: T) => {
    lastPersistedRef.current = newState
    lastPersistTimeRef.current = Date.now()
    onPersistRef.current(newState)
  }, [])

  useEffect(() => {
    const now = Date.now()
    const timeSinceLastPersist = now - lastPersistTimeRef.current

    // Check for immediate keys (significant changes)
    const hasImmediateChange = immediateKeys.some(
      key => state[key] !== lastPersistedRef.current[key]
    )

    if (hasImmediateChange) {
      // Clear any pending throttled update
      if (pendingRef.current) {
        clearTimeout(pendingRef.current)
        pendingRef.current = null
      }
      persist(state)
      return
    }

    // Throttle continuous changes
    if (timeSinceLastPersist >= throttleMs) {
      persist(state)
    } else if (!pendingRef.current) {
      // Schedule a throttled update
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null
        persist(latestStateRef.current)  // Use ref for latest state
      }, throttleMs - timeSinceLastPersist)
    }

    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current)
      }
    }
  }, [state, throttleMs, immediateKeys, persist])

  // Persist on unmount (workspace switch/eviction)
  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current)
      }
      // Final persist with latest state (using ref to avoid stale closure)
      onPersistRef.current(latestStateRef.current)
    }
  }, [])  // Empty deps - only on unmount, uses refs for latest values
}
```

#### 1.3.2 Update Timer Component (Verified: Saving Works)

**File:** `components/canvas/components/timer.tsx`

```typescript
import { useThrottledComponentState } from '@/lib/hooks/use-throttled-component-state'

export function Timer({ componentId, workspaceId, position, state, onStateUpdate }: TimerProps) {
  const [minutes, setMinutes] = useState<number>(state?.minutes ?? 5)
  const [seconds, setSeconds] = useState<number>(state?.seconds ?? 0)
  const [isRunning, setIsRunning] = useState<boolean>(state?.isRunning ?? false)
  const [inputMinutes, setInputMinutes] = useState<string>(String(state?.inputMinutes ?? 5))

  // Combine state for persistence
  const componentState = useMemo(() => ({
    minutes,
    seconds,
    isRunning,
    inputMinutes,
  }), [minutes, seconds, isRunning, inputMinutes])

  // Throttled persistence to runtime ledger
  useThrottledComponentState({
    state: componentState,
    throttleMs: 2000, // Update at most every 2 seconds
    immediateKeys: ['isRunning'], // Immediate update when timer starts/stops
    onPersist: (newState) => {
      onStateUpdate?.(newState)
    },
  })

  // Register with runtime ledger (metadata updated via onStateUpdate → parent)
  useComponentRegistration({
    workspaceId,
    componentId,
    componentType: 'timer',
    position,
    metadata: componentState,
    isActive: isRunning, // NEW: For smart eviction
  })

  // ... rest of component unchanged
}
```

#### 1.3.3 Update Calculator Component (Verified: Saving Works)

**File:** `components/canvas/components/calculator.tsx`

```typescript
export function Calculator({ componentId, workspaceId, position, state, onStateUpdate }: CalculatorProps) {
  const [display, setDisplay] = useState<string>(state?.display ?? '0')
  const [previousValue, setPreviousValue] = useState<number | null>(state?.previousValue ?? null)
  const [operation, setOperation] = useState<string | null>(state?.operation ?? null)
  const [waitingForOperand, setWaitingForOperand] = useState<boolean>(state?.waitingForOperand ?? false)

  const componentState = useMemo(() => ({
    display,
    previousValue,
    operation,
    waitingForOperand,
  }), [display, previousValue, operation, waitingForOperand])

  // Calculator changes are user-initiated (not continuous), so direct update is fine
  useEffect(() => {
    onStateUpdate?.(componentState)
  }, [componentState, onStateUpdate])

  useComponentRegistration({
    workspaceId,
    componentId,
    componentType: 'calculator',
    position,
    metadata: componentState,
    isActive: false, // Calculator has no background operations
  })

  // ... rest of component unchanged
}
```

#### 1.3.4 Update StickyNote Component (NEEDS IMPLEMENTATION)

**File:** `components/canvas/components/sticky-note.tsx`

```typescript
// Similar pattern - debounced for text input
useComponentRegistration({
  workspaceId,
  componentId,
  componentType: 'sticky-note',
  position,
  metadata: { content, color },
  isActive: false,
})
```

### 1.4 Fix B: Map Metadata to ComponentState (Verified: Mapping Exists)

**File:** `lib/hooks/use-runtime-components.ts`

```typescript
export function runtimeComponentsToCanvasItems(
  components: RuntimeComponent[]
): Array<{
  id: string
  itemType: "component"
  componentType: string
  position: { x: number; y: number }
  zIndex?: number
  dimensions?: { width: number; height: number } | null
  metadata?: Record<string, unknown>
  componentState?: Record<string, unknown>  // ADD this field
}> {
  return components.map((component) => ({
    id: component.componentId,
    itemType: "component" as const,
    componentType: component.componentType,
    position: component.position,
    zIndex: component.zIndex,
    dimensions: component.size,
    metadata: component.metadata,
    componentState: component.metadata,  // ADD: Map for ComponentPanel
  }))
}
```

### 1.5 Add `isActive` to Runtime Ledger (Verified: Exists)

**File:** `lib/workspace/runtime-manager.ts`

#### 1.5.1 Update Types

```typescript
// Update RuntimeComponentInput
export type RuntimeComponentInput = {
  componentId: string
  componentType: string
  position: { x: number; y: number }
  size?: { width: number; height: number } | null
  metadata?: Record<string, unknown>
  zIndex?: number
  isActive?: boolean  // NEW: Indicates active background operation
}

// Update RuntimeComponent
export interface RuntimeComponent {
  componentId: string
  componentType: string
  position: { x: number; y: number }
  size?: { width: number; height: number } | null
  metadata?: Record<string, unknown>
  zIndex?: number
  lastSeenAt: number
  isActive: boolean  // NEW
}
```

#### 1.5.2 Track Active Operations

```typescript
// Add to runtime-manager.ts

/**
 * Check if a workspace has any active background operations.
 * Used by smart eviction to protect workspaces with running timers, etc.
 */
export function hasActiveBackgroundOperation(workspaceId: string): boolean {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return false

  for (const component of runtime.components.values()) {
    if (component.isActive) return true
  }
  return false
}

/**
 * Get count of active operations in a workspace.
 */
export function getActiveOperationCount(workspaceId: string): number {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return 0

  let count = 0
  for (const component of runtime.components.values()) {
    if (component.isActive) count++
  }
  return count
}
```

#### 1.5.3 Update useComponentRegistration Hook

**File:** `lib/hooks/use-component-registration.ts`

```typescript
type UseComponentRegistrationOptions = {
  workspaceId: string | null | undefined
  componentId: string
  componentType: "calculator" | "timer" | "alarm" | "widget" | string
  strict?: boolean
  position?: { x: number; y: number }
  size?: { width: number; height: number } | null
  metadata?: Record<string, unknown>
  zIndex?: number
  isActive?: boolean  // NEW
}

export function useComponentRegistration({
  workspaceId,
  componentId,
  componentType,
  strict = process.env.NODE_ENV === "development",
  position,
  size,
  metadata,
  zIndex,
  isActive = false,  // NEW: default false
}: UseComponentRegistrationOptions): void {
  // ... existing code ...

  // Update registration to include isActive
  useEffect(() => {
    if (!workspaceId || !position) return

    registerRuntimeComponent(workspaceId, {
      componentId,
      componentType,
      position,
      size,
      metadata,
      zIndex,
      isActive,  // NEW
    })
    isRuntimeRegisteredRef.current = true
  }, [workspaceId, componentId, componentType, position, size, metadata, zIndex, isActive])

  // ... rest unchanged
}
```

### 1.6 Cross-Entry State Handling

#### 1.6.1 Problem Definition

When user switches from Entry A to Entry B:
- **Pinned workspaces** from Entry A should retain state (background operations continue)
- **Non-pinned workspaces** from Entry A should clear state (no zombie timers)

Previous fix was reverted because ALL workspaces retained state across entry switches.

#### 1.6.2 Entry Switch Detection

**Investigation needed:** Where are entry switches detected?

Candidates to check:
1. `components/dashboard/DashboardView.tsx` - renders different entries
2. `lib/navigation/navigation-context.tsx` - tracks current entry
3. `app/(dashboard)/[entrySlug]/page.tsx` - route-based entry switching

**Key locations to hook into:**

```typescript
// Option A: In DashboardView when entry changes
useEffect(() => {
  if (previousEntryId && previousEntryId !== currentEntryId) {
    onEntryDeactivated(previousEntryId)
  }
}, [currentEntryId])

// Option B: In navigation context
function navigateToEntry(newEntryId: string) {
  const oldEntryId = currentEntryId
  setCurrentEntryId(newEntryId)
  if (oldEntryId && oldEntryId !== newEntryId) {
    onEntryDeactivated(oldEntryId)
  }
}
```

#### 1.6.3 Getting Workspaces for an Entry

**Problem:** Runtime manager doesn't track entry-workspace associations.

**Solution A: Query from note_workspaces table**
```typescript
// API endpoint or direct query
async function getWorkspaceIdsForEntry(entryId: string): Promise<string[]> {
  const workspaces = await db.query(
    'SELECT id FROM note_workspaces WHERE item_id = $1',
    [entryId]
  )
  return workspaces.map(w => w.id)
}
```

**Solution B: Track in runtime manager**
```typescript
// Add entryId to runtime creation
const workspaceEntryMap = new Map<string, string>()

export function createWorkspaceRuntime(
  workspaceId: string,
  entryId: string,  // NEW
  options?: RuntimeOptions
): void {
  workspaceEntryMap.set(workspaceId, entryId)
  // ... existing creation logic
}

export function getWorkspacesForEntry(entryId: string): string[] {
  const workspaceIds: string[] = []
  for (const [wsId, eId] of workspaceEntryMap.entries()) {
    if (eId === entryId) workspaceIds.push(wsId)
  }
  return workspaceIds
}
```

**Recommendation:** Solution B is faster (no DB query) and more reliable.

#### 1.6.4 Runtime Cleanup on Destruction

**Problem:** When a workspace runtime is destroyed (evicted), we must clean up tracking maps.

**File:** `lib/workspace/runtime-manager.ts`

```typescript
/**
 * Clean up all tracking data when a workspace runtime is destroyed.
 * Called during eviction or explicit destruction.
 */
export function cleanupWorkspaceTracking(workspaceId: string): void {
  workspaceEntryMap.delete(workspaceId)
  defaultWorkspaceIds.delete(workspaceId)

  void debugLog({
    component: 'WorkspaceRuntime',
    action: 'workspace_tracking_cleaned',
    metadata: { workspaceId },
  })
}

// Update existing eviction logic to call cleanup
function evictWorkspace(workspaceId: string): void {
  // ... existing eviction logic ...

  // Clean up tracking data
  cleanupWorkspaceTracking(workspaceId)

  // ... rest of eviction ...
}
```

**Edge Case:** Multiple `createWorkspaceRuntime()` calls for same workspace

```typescript
export function createWorkspaceRuntime(
  workspaceId: string,
  entryId: string,
  options?: { isDefault?: boolean }
): void {
  // Check if runtime already exists
  if (runtimes.has(workspaceId)) {
    // Update existing runtime's entry association if different
    const existingEntryId = workspaceEntryMap.get(workspaceId)
    if (existingEntryId !== entryId) {
      workspaceEntryMap.set(workspaceId, entryId)
      void debugLog({
        component: 'WorkspaceRuntime',
        action: 'workspace_entry_updated',
        metadata: { workspaceId, oldEntryId: existingEntryId, newEntryId: entryId },
      })
    }
    return  // Don't recreate, just update association
  }

  // ... existing creation logic ...

  if (options?.isDefault) {
    markWorkspaceAsDefault(workspaceId)
  }

  workspaceEntryMap.set(workspaceId, entryId)
}
```

#### 1.6.5 Entry Deactivation Handler

**File:** `lib/workspace/runtime-manager.ts`

```typescript
/**
 * Called when user switches away from an entry.
 * Clears component metadata for non-pinned workspaces to prevent
 * zombie background operations.
 */
export function onEntryDeactivated(entryId: string): void {
  const workspaceIds = getWorkspacesForEntry(entryId)

  for (const workspaceId of workspaceIds) {
    // Skip pinned workspaces - they should retain state
    if (pinnedWorkspaceIds.has(workspaceId)) {
      void debugLog({
        component: 'WorkspaceRuntime',
        action: 'entry_deactivated_skip_pinned',
        metadata: { entryId, workspaceId },
      })
      continue
    }

    // Clear component metadata for non-pinned workspaces
    clearRuntimeComponentMetadata(workspaceId)

    void debugLog({
      component: 'WorkspaceRuntime',
      action: 'entry_deactivated_cleared_metadata',
      metadata: { entryId, workspaceId },
    })
  }
}

/**
 * Clear all component metadata for a workspace.
 * Components will re-initialize with defaults on next mount.
 */
export function clearRuntimeComponentMetadata(workspaceId: string): void {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return

  for (const component of runtime.components.values()) {
    component.metadata = {}
    component.isActive = false
  }
}
```

#### 1.6.6 Hook Entry Deactivation into Navigation

**File:** `components/dashboard/DashboardView.tsx` (or appropriate location)

```typescript
const previousEntryIdRef = useRef<string | null>(null)

useEffect(() => {
  const previousEntryId = previousEntryIdRef.current

  if (previousEntryId && previousEntryId !== currentEntryId) {
    // User switched entries - clear non-pinned workspace state
    onEntryDeactivated(previousEntryId)
  }

  previousEntryIdRef.current = currentEntryId
}, [currentEntryId])
```

### 1.7 Phase 1 Implementation Tasks

#### Pre-Implementation (BLOCKING)
- [ ] **1.7.0a** Complete Investigation 1: Hot workspace state preservation
- [ ] **1.7.0b** Complete Investigation 2: Entry switch behavior
- [ ] **1.7.0c** Complete Investigation 3: Identify entry switch detection point
- [ ] **1.7.0d** Complete Investigation 4: Verify runtime creation flow

#### State Restoration Core (THE ACTUAL FIX - Section 1.2.4)
- [ ] **1.7.0e** Add hot workspace state sync to ComponentPanel (useEffect to sync initialState)
- [ ] **1.7.0f** Verify fix: Timer shows restored state after workspace switch
- [ ] **1.7.0g** Verify fix: State survives eviction and restoration from DB

#### State Persistence Core
- [ ] **1.7.1** Create `lib/hooks/use-throttled-component-state.ts`
- [ ] **1.7.2** Update Timer to pass throttled state as metadata + `isActive`
- [ ] **1.7.3** Update Calculator to pass state as metadata
- [ ] **1.7.4** Update StickyNote to pass state as metadata
- [ ] **1.7.5** Add `componentState` mapping in `runtimeComponentsToCanvasItems`

#### Runtime Ledger Updates
- [ ] **1.7.6** Add `isActive` field to `RuntimeComponent` type
- [ ] **1.7.7** Add `hasActiveBackgroundOperation()` function
- [ ] **1.7.8** Update `useComponentRegistration` to accept `isActive`

#### Entry-Workspace Tracking
- [ ] **1.7.9** Add `workspaceEntryMap` to runtime manager
- [ ] **1.7.10** Add `entryId` parameter to runtime creation
- [ ] **1.7.11** Add `cleanupWorkspaceTracking()` function
- [ ] **1.7.12** Update eviction logic to call cleanup

#### Cross-Entry State Handling
- [ ] **1.7.13** Implement `onEntryDeactivated()` handler
- [ ] **1.7.14** Implement `clearRuntimeComponentMetadata()` function
- [ ] **1.7.15** Hook entry deactivation into navigation (based on Investigation 3)

#### Logging & Testing
- [ ] **1.7.16** Add debug logging for all state persistence events
- [ ] **1.7.17** Test: State persists within same entry (< 4 workspaces)
- [ ] **1.7.18** Test: State persists within same entry (> 4 workspaces, after eviction)
- [ ] **1.7.19** Test: State clears when switching entries (non-pinned)
- [ ] **1.7.20** Test: State persists when switching entries (pinned)

---

## Phase 2: Smart Eviction System (IMPORTANT)

### 2.1 Current Eviction Logic

**File:** `lib/workspace/runtime-manager.ts:799-838`

Current `getLeastRecentlyVisibleRuntimeId()`:
- Simple LRU based on `lastVisibleAt`
- Only skips pinned workspaces
- No consideration for content, default status, or active operations

### 2.2 Enhanced Eviction with Scores

#### 2.2.1 Eviction Score Interface

```typescript
interface EvictionCandidate {
  workspaceId: string
  score: number  // Lower = evict first
  factors: {
    isPinned: boolean           // Infinity (never evict)
    isDefault: boolean          // +200
    hasActiveOperation: boolean // +500
    hasComponents: boolean      // +100
    componentCount: number      // +10 per component
    recencyScore: number        // 0-100 based on lastVisibleAt
  }
}
```

#### 2.2.2 Score Calculation

```typescript
/**
 * Calculate eviction score for a workspace.
 * Higher score = more protected from eviction.
 */
function calculateEvictionScore(
  workspaceId: string,
  runtime: WorkspaceRuntime
): EvictionCandidate {
  const factors = {
    isPinned: pinnedWorkspaceIds.has(workspaceId),
    isDefault: defaultWorkspaceIds.has(workspaceId),
    hasActiveOperation: hasActiveBackgroundOperation(workspaceId),
    hasComponents: runtime.components.size > 0,
    componentCount: runtime.components.size,
    recencyScore: calculateRecencyScore(runtime.lastVisibleAt),
  }

  // Pinned = never evict
  if (factors.isPinned) {
    return { workspaceId, score: Infinity, factors }
  }

  let score = 0

  // Active operations get high protection
  if (factors.hasActiveOperation) score += 500

  // Default workspace gets medium protection
  if (factors.isDefault) score += 200

  // Components add value
  if (factors.hasComponents) score += 100
  score += factors.componentCount * 10

  // Recency bonus (0-100)
  score += factors.recencyScore

  return { workspaceId, score, factors }
}

/**
 * Calculate recency score (0-100).
 * More recent = higher score.
 */
function calculateRecencyScore(lastVisibleAt: number): number {
  if (lastVisibleAt === 0) return 0  // Never visible

  const now = Date.now()
  const ageMs = now - lastVisibleAt
  const maxAgeMs = 30 * 60 * 1000  // 30 minutes

  if (ageMs >= maxAgeMs) return 0
  return Math.round((1 - ageMs / maxAgeMs) * 100)
}
```

#### 2.2.3 Track Default Workspaces

```typescript
// Add to runtime-manager.ts
const defaultWorkspaceIds = new Set<string>()

export function markWorkspaceAsDefault(workspaceId: string): void {
  defaultWorkspaceIds.add(workspaceId)
}

export function unmarkWorkspaceAsDefault(workspaceId: string): void {
  defaultWorkspaceIds.delete(workspaceId)
}

export function isDefaultWorkspace(workspaceId: string): boolean {
  return defaultWorkspaceIds.has(workspaceId)
}
```

#### 2.2.4 Enhanced Eviction Selection

```typescript
/**
 * Get the workspace to evict based on smart scoring.
 * Returns null if no suitable candidate (all pinned/protected).
 */
export function getWorkspaceToEvict(): string | null {
  const candidates: EvictionCandidate[] = []

  for (const [workspaceId, runtime] of runtimes.entries()) {
    // Skip currently visible
    if (runtime.isVisible) continue

    // Skip shared workspace
    if (workspaceId === SHARED_WORKSPACE_ID_INTERNAL) continue

    const candidate = calculateEvictionScore(workspaceId, runtime)

    // Skip pinned (score = Infinity)
    if (candidate.score === Infinity) continue

    candidates.push(candidate)
  }

  if (candidates.length === 0) {
    void debugLog({
      component: 'SmartEviction',
      action: 'no_eviction_candidates',
      metadata: { totalRuntimes: runtimes.size },
    })
    return null
  }

  // Sort by score (lowest first = evict first)
  candidates.sort((a, b) => a.score - b.score)

  const selected = candidates[0]

  void debugLog({
    component: 'SmartEviction',
    action: 'eviction_candidate_selected',
    metadata: {
      selectedWorkspaceId: selected.workspaceId,
      selectedScore: selected.score,
      selectedFactors: selected.factors,
      candidateCount: candidates.length,
      allScores: candidates.slice(0, 5).map(c => ({
        workspaceId: c.workspaceId,
        score: c.score,
      })),
    },
  })

  return selected.workspaceId
}
```

### 2.3 Default Workspace Detection

**Problem:** How to know if a workspace is the default?

**Solution:** Pass `is_default` when creating workspace runtime.

**File:** Where workspace runtimes are created (likely in `useNoteWorkspaces` or similar)

```typescript
// When creating runtime for a workspace
createWorkspaceRuntime(workspaceId, entryId, {
  isDefault: workspace.is_default,  // From database
})

// In runtime-manager.ts
export function createWorkspaceRuntime(
  workspaceId: string,
  entryId: string,
  options?: { isDefault?: boolean }
): void {
  // ... existing creation logic

  if (options?.isDefault) {
    markWorkspaceAsDefault(workspaceId)
  }

  workspaceEntryMap.set(workspaceId, entryId)
}
```

### 2.4 Phase 2 Implementation Tasks

- [ ] **2.4.1** Add `defaultWorkspaceIds` Set and helper functions
- [ ] **2.4.2** Implement `calculateEvictionScore()` function
- [ ] **2.4.3** Implement `calculateRecencyScore()` function
- [ ] **2.4.4** Implement `getWorkspaceToEvict()` with scoring
- [ ] **2.4.5** Update runtime creation to pass `isDefault` flag
- [ ] **2.4.6** Replace `getLeastRecentlyVisibleRuntimeId()` with `getWorkspaceToEvict()`
- [ ] **2.4.7** Add comprehensive eviction decision logging
- [ ] **2.4.8** Test: Empty workspaces evicted before workspaces with content
- [ ] **2.4.9** Test: Default workspace protected from early eviction
- [ ] **2.4.10** Test: Workspaces with active timers evicted last

---

## Phase 3: Memory-Based Eviction Trigger (OPTIONAL - Future Enhancement)

### 3.1 Overview

**Optionally replace the hard-coded `maxRuntimes: 4` with memory-based eviction triggers.**

This phase is OPTIONAL and can be deferred indefinitely. Once Phase 1 works, eviction is safe (state survives in DB), so the fixed limit becomes acceptable.

**IMPORTANT: This phase requires robust fallbacks for non-Chromium browsers.**

### 3.2 Design Principles

1. **No fixed count limit** - Remove `maxRuntimes: 4`
2. **Memory triggers eviction** - Evict when memory pressure is high
3. **Graduated response** - Warn → soft limit → evict → block
4. **Multiple fallbacks** - Chrome API → estimation → emergency count limit
5. **Keep smart eviction** - Phase 2 scoring determines WHAT to evict, Phase 3 determines WHEN

### 3.3 Memory Monitor Interface

**File:** `lib/workspace/memory-monitor.ts`

```typescript
export type MemoryPressure = 'low' | 'normal' | 'elevated' | 'high' | 'critical'
export type MemorySource = 'chrome_api' | 'electron_ipc' | 'estimation' | 'fallback_count'

export interface MemoryStatus {
  /** Memory pressure level */
  pressure: MemoryPressure
  /** Heap used in MB (0 if unavailable) */
  usedMB: number
  /** Heap limit in MB (0 if unavailable) */
  limitMB: number
  /** Usage percentage (0-1, or estimated) */
  usagePercent: number
  /** How we measured memory */
  source: MemorySource
  /** Current number of hot runtimes */
  runtimeCount: number
  /** Human-readable status */
  message: string
}

export interface EvictionDecision {
  /** Should we evict a workspace? */
  shouldEvict: boolean
  /** Should we block new workspace creation? */
  shouldBlock: boolean
  /** Should we warn the user? */
  shouldWarn: boolean
  /** Reason for the decision */
  reason: string
  /** Memory status that led to this decision */
  memoryStatus: MemoryStatus
}
```

### 3.4 Memory Pressure Thresholds

| Pressure | Trigger | Action | User Feedback |
|----------|---------|--------|---------------|
| **Low** | < 50% heap OR < 8 runtimes | None | None |
| **Normal** | 50-65% heap OR 8-12 runtimes | None | Memory indicator (optional) |
| **Elevated** | 65-75% heap OR 12-16 runtimes | Warn user | Yellow indicator, suggestion to close some |
| **High** | 75-85% heap OR 16-20 runtimes | Evict (smart) | Orange indicator, eviction happening |
| **Critical** | > 85% heap OR > 20 runtimes | Block new + aggressive evict | Red indicator, must close workspaces |

### 3.5 Multi-Layer Measurement Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                  Layer 1: Chrome Memory API                  │
│     performance.memory.usedJSHeapSize / jsHeapSizeLimit     │
│                 (Best accuracy, Chrome only)                 │
├─────────────────────────────────────────────────────────────┤
│                  Layer 2: Electron IPC                       │
│              process.memoryUsage() from main                 │
│               (Accurate, Electron only)                      │
├─────────────────────────────────────────────────────────────┤
│               Layer 3: Runtime Estimation                    │
│   Estimate based on: runtimes × avgSize + components × size │
│             (Works everywhere, less accurate)                │
├─────────────────────────────────────────────────────────────┤
│              Layer 4: Emergency Count Limit                  │
│        Hard limit at 25 runtimes (absolute safety net)       │
│              (Fallback if all else fails)                    │
└─────────────────────────────────────────────────────────────┘
```

### 3.6 Implementation

#### 3.6.1 Memory Measurement Functions

```typescript
// lib/workspace/memory-monitor.ts

const ESTIMATED_RUNTIME_SIZE_MB = 15  // Base size per runtime
const ESTIMATED_COMPONENT_SIZE_MB = 5  // Per component (timer, calc, etc.)
const EMERGENCY_RUNTIME_LIMIT = 25    // Absolute safety net

/**
 * Get memory status using best available method.
 */
export function getMemoryStatus(runtimeCount: number, componentCount: number): MemoryStatus {
  // Try Chrome API first
  const chromeStatus = getChromeMemoryStatus(runtimeCount)
  if (chromeStatus) return chromeStatus

  // Try Electron IPC (if available)
  const electronStatus = getElectronMemoryStatus(runtimeCount)
  if (electronStatus) return electronStatus

  // Fall back to estimation
  return getEstimatedMemoryStatus(runtimeCount, componentCount)
}

/**
 * Chrome's performance.memory API
 */
function getChromeMemoryStatus(runtimeCount: number): MemoryStatus | null {
  if (typeof performance === 'undefined') return null
  const memory = (performance as any).memory
  if (!memory?.usedJSHeapSize || !memory?.jsHeapSizeLimit) return null

  const usedMB = memory.usedJSHeapSize / (1024 * 1024)
  const limitMB = memory.jsHeapSizeLimit / (1024 * 1024)
  const usagePercent = usedMB / limitMB

  return {
    pressure: calculatePressure(usagePercent, runtimeCount),
    usedMB,
    limitMB,
    usagePercent,
    source: 'chrome_api',
    runtimeCount,
    message: `${usedMB.toFixed(0)}MB / ${limitMB.toFixed(0)}MB (${(usagePercent * 100).toFixed(0)}%)`,
  }
}

/**
 * Estimation based on workspace/component count.
 * Used when memory API is unavailable (Firefox, Safari).
 */
function getEstimatedMemoryStatus(runtimeCount: number, componentCount: number): MemoryStatus {
  // Estimate: each runtime ~15MB, each component ~5MB
  const estimatedUsedMB = (runtimeCount * ESTIMATED_RUNTIME_SIZE_MB) +
                          (componentCount * ESTIMATED_COMPONENT_SIZE_MB) +
                          100  // Base app overhead

  // Assume 2GB heap limit for estimation
  const assumedLimitMB = 2048
  const usagePercent = estimatedUsedMB / assumedLimitMB

  return {
    pressure: calculatePressureFromCount(runtimeCount),
    usedMB: estimatedUsedMB,
    limitMB: assumedLimitMB,
    usagePercent,
    source: 'estimation',
    runtimeCount,
    message: `~${estimatedUsedMB.toFixed(0)}MB estimated (${runtimeCount} workspaces)`,
  }
}

/**
 * Calculate pressure from actual memory percentage.
 */
function calculatePressure(usagePercent: number, runtimeCount: number): MemoryPressure {
  // Always respect emergency count limit
  if (runtimeCount >= EMERGENCY_RUNTIME_LIMIT) return 'critical'

  if (usagePercent >= 0.85) return 'critical'
  if (usagePercent >= 0.75) return 'high'
  if (usagePercent >= 0.65) return 'elevated'
  if (usagePercent >= 0.50) return 'normal'
  return 'low'
}

/**
 * Calculate pressure from count alone (when memory API unavailable).
 * More conservative since we can't see actual memory.
 */
function calculatePressureFromCount(runtimeCount: number): MemoryPressure {
  if (runtimeCount >= EMERGENCY_RUNTIME_LIMIT) return 'critical'
  if (runtimeCount >= 20) return 'high'
  if (runtimeCount >= 16) return 'elevated'
  if (runtimeCount >= 12) return 'normal'
  return 'low'
}
```

#### 3.6.2 Eviction Decision Logic

```typescript
/**
 * Determine if eviction/blocking is needed based on memory status.
 */
export function getEvictionDecision(status: MemoryStatus): EvictionDecision {
  switch (status.pressure) {
    case 'critical':
      return {
        shouldEvict: true,
        shouldBlock: true,
        shouldWarn: true,
        reason: `Critical memory pressure: ${status.message}. New workspaces blocked.`,
        memoryStatus: status,
      }

    case 'high':
      return {
        shouldEvict: true,
        shouldBlock: false,
        shouldWarn: true,
        reason: `High memory pressure: ${status.message}. Evicting least important workspace.`,
        memoryStatus: status,
      }

    case 'elevated':
      return {
        shouldEvict: false,
        shouldBlock: false,
        shouldWarn: true,
        reason: `Elevated memory usage: ${status.message}. Consider closing some workspaces.`,
        memoryStatus: status,
      }

    case 'normal':
    case 'low':
    default:
      return {
        shouldEvict: false,
        shouldBlock: false,
        shouldWarn: false,
        reason: 'Memory OK',
        memoryStatus: status,
      }
  }
}
```

#### 3.6.3 Integration with Runtime Manager

**File:** `lib/workspace/runtime-manager.ts`

```typescript
import { getMemoryStatus, getEvictionDecision, type EvictionDecision } from './memory-monitor'

// Remove old fixed limit constants
// DELETE: export const MAX_LIVE_WORKSPACES = { desktop: 4, tablet: 2 }
// DELETE: const getMaxLiveRuntimes = () => ...

/**
 * Check memory before creating a new workspace runtime.
 * Returns decision on whether to proceed.
 */
export function checkMemoryBeforeCreation(): EvictionDecision {
  const componentCount = getTotalComponentCount()
  const status = getMemoryStatus(runtimes.size, componentCount)
  return getEvictionDecision(status)
}

/**
 * Get total component count across all runtimes (for estimation).
 */
function getTotalComponentCount(): number {
  let count = 0
  for (const runtime of runtimes.values()) {
    count += runtime.components.size
  }
  return count
}

// Update getWorkspaceRuntime to use memory-based eviction
export const getWorkspaceRuntime = (workspaceId: string): WorkspaceRuntime => {
  // ... validation code ...

  const existing = runtimes.get(workspaceId)
  if (existing) {
    return existing
  }

  // CHANGED: Memory-based eviction instead of fixed count
  const decision = checkMemoryBeforeCreation()

  if (decision.shouldBlock) {
    // Critical memory - cannot create new runtime
    void debugLog({
      component: 'WorkspaceRuntime',
      action: 'runtime_creation_blocked',
      metadata: {
        workspaceId,
        reason: decision.reason,
        pressure: decision.memoryStatus.pressure,
        runtimeCount: decision.memoryStatus.runtimeCount,
      },
    })
    // Return a minimal/shared runtime or throw
    throw new Error(`Cannot create workspace: ${decision.reason}`)
  }

  if (decision.shouldEvict) {
    // High memory - evict before creating
    const evictId = getWorkspaceToEvict()  // From Phase 2 smart eviction
    if (evictId) {
      void debugLog({
        component: 'WorkspaceRuntime',
        action: 'runtime_evicted_memory_pressure',
        metadata: {
          evictedWorkspaceId: evictId,
          newWorkspaceId: workspaceId,
          reason: decision.reason,
          pressure: decision.memoryStatus.pressure,
        },
      })
      removeWorkspaceRuntime(evictId)
    }
  }

  // Create the new runtime
  // ... existing creation code ...
}
```

### 3.7 User Feedback Integration

#### 3.7.1 Memory Status Hook

**File:** `lib/hooks/use-memory-status.ts`

```typescript
import { useState, useEffect } from 'react'
import { getMemoryStatus, type MemoryStatus, type MemoryPressure } from '@/lib/workspace/memory-monitor'
import { getRuntimeCount, getTotalComponentCount } from '@/lib/workspace/runtime-manager'

/**
 * Hook to monitor memory status for UI feedback.
 * Updates every 5 seconds.
 */
export function useMemoryStatus(): MemoryStatus | null {
  const [status, setStatus] = useState<MemoryStatus | null>(null)

  useEffect(() => {
    const update = () => {
      const newStatus = getMemoryStatus(getRuntimeCount(), getTotalComponentCount())
      setStatus(newStatus)
    }

    update()  // Initial
    const interval = setInterval(update, 5000)  // Every 5 seconds

    return () => clearInterval(interval)
  }, [])

  return status
}

/**
 * Get color for pressure level.
 */
export function getPressureColor(pressure: MemoryPressure): string {
  switch (pressure) {
    case 'critical': return 'red'
    case 'high': return 'orange'
    case 'elevated': return 'yellow'
    case 'normal': return 'blue'
    case 'low': return 'green'
  }
}
```

#### 3.7.2 Memory Indicator Component

**File:** `components/dashboard/MemoryIndicator.tsx`

```typescript
import { useMemoryStatus, getPressureColor } from '@/lib/hooks/use-memory-status'

export function MemoryIndicator() {
  const status = useMemoryStatus()

  if (!status || status.pressure === 'low') {
    return null  // Don't show when everything is fine
  }

  return (
    <div className={`memory-indicator bg-${getPressureColor(status.pressure)}-100`}>
      <span>{status.message}</span>
      {status.pressure === 'elevated' && (
        <span className="text-sm">Consider closing some workspaces</span>
      )}
      {status.pressure === 'high' && (
        <span className="text-sm">Workspaces being optimized</span>
      )}
      {status.pressure === 'critical' && (
        <span className="text-sm font-bold">Close workspaces to continue</span>
      )}
    </div>
  )
}
```

### 3.8 Error Handling for Blocked Creation

**File:** `lib/hooks/annotation/use-note-workspaces.ts`

```typescript
const switchToWorkspace = async (workspaceId: string) => {
  try {
    // This may throw if memory is critical
    const runtime = getWorkspaceRuntime(workspaceId)
    // ... rest of switch logic
  } catch (error) {
    if (error.message.includes('Cannot create workspace')) {
      // Show user-friendly error
      toast.error('Memory Full', {
        description: 'Close some workspaces before opening new ones.',
        action: {
          label: 'Manage Workspaces',
          onClick: () => openWorkspaceManager(),
        },
      })
      return { success: false, reason: 'memory_full' }
    }
    throw error
  }
}
```

### 3.9 Phase 3 Implementation Tasks

#### Memory Monitor Core
- [ ] **3.9.1** Create `lib/workspace/memory-monitor.ts`
- [ ] **3.9.2** Implement `getChromeMemoryStatus()`
- [ ] **3.9.3** Implement `getEstimatedMemoryStatus()` fallback
- [ ] **3.9.4** Implement `calculatePressure()` and `calculatePressureFromCount()`
- [ ] **3.9.5** Implement `getEvictionDecision()`
- [ ] **3.9.6** Add Electron IPC support (optional, for Electron builds)

#### Runtime Manager Integration
- [ ] **3.9.7** Remove `MAX_LIVE_WORKSPACES` constant
- [ ] **3.9.8** Remove `getMaxLiveRuntimes()` function
- [ ] **3.9.9** Add `checkMemoryBeforeCreation()` function
- [ ] **3.9.10** Update `getWorkspaceRuntime()` to use memory-based eviction
- [ ] **3.9.11** Add `getRuntimeCount()` and `getTotalComponentCount()` exports

#### User Feedback
- [ ] **3.9.12** Create `lib/hooks/use-memory-status.ts`
- [ ] **3.9.13** Create `components/dashboard/MemoryIndicator.tsx`
- [ ] **3.9.14** Add memory indicator to dashboard header
- [ ] **3.9.15** Handle blocked creation with toast/dialog

#### Error Handling
- [ ] **3.9.16** Update `switchToWorkspace()` to handle creation errors
- [ ] **3.9.17** Create workspace manager UI for closing workspaces
- [ ] **3.9.18** Add debug logging for all memory decisions

#### Testing
- [ ] **3.9.19** Test with Chrome memory API available
- [ ] **3.9.20** Test with Firefox (estimation fallback)
- [ ] **3.9.21** Test emergency count limit (25 workspaces)
- [ ] **3.9.22** Test memory indicator at each pressure level
- [ ] **3.9.23** Test blocked creation error handling

---

## Phase 4: Integration & Testing

### 4.1 Feature Flags

```typescript
// lib/flags/eviction.ts

/** Smart eviction with weighted priorities */
export function isSmartEvictionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SMART_EVICTION !== 'false'  // Default ON
}

/** Memory-aware dynamic limits */
export function isMemoryAwareEvictionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MEMORY_AWARE_EVICTION === 'true'  // Default OFF
}
```

### 4.2 Rollout Strategy

| Phase | Feature | Flag | Default |
|-------|---------|------|---------|
| 1 | State persistence fix | Always on | N/A |
| 2 | Smart eviction | `SMART_EVICTION` | true (on) |
| 3 | Memory-aware limits | `MEMORY_AWARE_EVICTION` | false (off) |

### 4.3 Testing Matrix

#### Unit Tests

- [ ] Throttled state hook respects throttle interval
- [ ] Throttled state hook fires immediately for immediate keys
- [ ] Eviction score calculation is correct for various scenarios
- [ ] Recency score calculation is correct
- [ ] Active operation detection works
- [ ] Entry-workspace association tracking works
- [ ] Entry deactivation clears correct workspaces

#### Integration Tests

- [ ] Timer state persists when switching workspaces (same entry)
- [ ] Calculator state persists when switching workspaces (same entry)
- [ ] State clears when switching entries (non-pinned)
- [ ] Pinned workspaces retain state across entries
- [ ] Smart eviction respects priorities
- [ ] Default workspace not evicted first
- [ ] Active timer workspace not evicted before empty workspace

#### Manual Tests

- [ ] Open 5+ workspaces, verify smart eviction order
- [ ] Start timer at 10:00, switch workspaces, verify time preserved
- [ ] Pin entry, switch entries, switch back, verify timer state
- [ ] Unpin entry, switch entries, switch back, verify timer reset
- [ ] Verify no performance degradation with throttled updates

### 4.4 Debug Logging Checklist

All these log actions should be implemented:

- [ ] `component_state_throttled_persist`
- [ ] `component_state_immediate_persist`
- [ ] `component_active_state_changed`
- [ ] `entry_deactivated_skip_pinned`
- [ ] `entry_deactivated_cleared_metadata`
- [ ] `eviction_score_calculated`
- [ ] `eviction_candidate_selected`
- [ ] `no_eviction_candidates`

---

## Implementation Order

### Recommended Sequence

```
Phase 1: State Persistence & RESTORATION Fix (CRITICAL - DO THIS FIRST)
├── 1.0 INVESTIGATE: Run Investigation 1 (hot workspace state preservation)
├── 1.1 TRACE: Add logging to trace data flow from DB to Timer
├── 1.2 FIND: Identify where metadata gets lost in the chain
├── 1.3 FIX: Add hot workspace state sync (Section 1.2.4) ← THE KEY FIX
│   └── Add useEffect in ComponentPanel to sync initialState changes
├── 1.4 VERIFY: Timer shows saved minutes/seconds after workspace switch
├── 1.5 Ensure components save state (throttled, async)
├── 1.6 Test: eviction → switch back → state restored from DB
└── 1.7 Test: browser refresh → state restored from DB

Phase 2: Smart Eviction Scoring (NICE TO HAVE - After Phase 1 works)
├── 2.1 Add default workspace tracking
├── 2.2 Implement eviction scoring
├── 2.3 Implement getWorkspaceToEvict() with scoring
└── 2.4 Test eviction priorities

Phase 3: Memory Monitoring (OPTIONAL - Can defer indefinitely)
├── 3.1 Create memory-monitor.ts
├── 3.2 Implement memory measurement
├── 3.3 Dynamic limits based on device
└── 3.4 Memory pressure UI indicators
```

### Key Insight

**Phase 1 is the only critical phase.**

Once restoration works:
- Eviction becomes safe (state survives in DB)
- The fixed `maxRuntimes: 4` limit is acceptable
- Phases 2 and 3 are just optimizations

### Why This Order

| Phase | Without It | With It |
|-------|------------|---------|
| **Phase 1** | State lost on eviction = broken | State restored = working |
| Phase 2 | Empty workspaces evicted same as full | Better eviction choices |
| Phase 3 | Fixed limit (4) on all devices | Dynamic limits |

**Phase 1 fixes the bug. Phases 2-3 improve the experience.**

---

## Files to Modify

### Phase 1: Restoration Fix (CRITICAL PATH)

**THE KEY FIX (Section 1.2.4):**

1. **`components/canvas/component-panel.tsx`** ← **PRIMARY FIX LOCATION**
   - Add `useEffect` to sync `componentState` when `initialState` changes
   - This fixes the hot workspace issue where `useState` ignores prop changes
   ```typescript
   useEffect(() => {
     if (initialState && Object.keys(initialState).length > 0) {
       setComponentState(initialState)
     }
   }, [initialState])
   ```

**Files to investigate (for verification):**

2. **`lib/hooks/annotation/use-note-workspaces.ts`** - `hydrateWorkspace()`
   - Verify components are loaded from DB payload
   - Add logging to trace data flow

3. **`lib/hooks/use-runtime-components.ts`** - `runtimeComponentsToCanvasItems()`
   - Verified: `componentState: component.metadata` mapping exists (line 88)

4. **`components/annotation-canvas-modern.tsx`** - Where `ComponentPanel` is rendered
   - Verified: `initialState={component.componentState}` passed (line 1131)

5. **`components/canvas/components/timer.tsx`**
   - Verified: `useState(state?.minutes ?? 5)` uses the `state` prop (line 24)

### New Files (If Needed)
- `lib/hooks/use-throttled-component-state.ts` - Throttled saves (may already exist)

### Phase 2: Smart Eviction (Nice to Have)
- `lib/workspace/runtime-manager.ts` - Eviction scoring

### Phase 3: Memory Monitoring (Optional)
- `lib/workspace/memory-monitor.ts`
- `components/dashboard/MemoryIndicator.tsx`

---

## Success Criteria

### Must Have (Phase 1 - State Restoration - THE CORE FIX)
- [ ] **Hot workspace state sync implemented** (Section 1.2.4 - useEffect in ComponentPanel)
- [ ] **Timer state RESTORED from DB** when switching back to evicted workspace
- [ ] **Calculator state RESTORED from DB** when switching back to evicted workspace
- [ ] State survives browser refresh (loaded from DB on page load)
- [ ] State survives eviction (DB has state, restored when workspace reopens)
- [ ] State restored when switching workspaces WITHOUT eviction (hot workspace case)
- [ ] Throttled saves don't cause performance degradation
- [ ] Data flow traced and documented: DB → Component

### Nice to Have (Phase 2 - Smart Eviction)
- [ ] Default workspace not evicted first
- [ ] Workspaces with active timers protected from eviction
- [ ] Empty workspaces evicted before workspaces with content
- [ ] Eviction decisions logged for debugging

### Optional (Phase 3 - Memory Monitoring)
- [ ] Dynamic limits based on device memory
- [ ] Memory pressure UI indicators
- [ ] Proactive eviction before browser struggles

### The Key Test

```
1. Open Workspace A
2. Add Timer, start at 10:00
3. Wait until Timer shows 08:00
4. Open 4 more workspaces (triggers eviction of A)
5. Switch back to Workspace A
6. Timer should show ~08:00 (restored from DB)
   NOT 10:00 (default) or 05:00 (default)
```

**If this test passes, Phase 1 is complete and the bug is fixed.**

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Throttled updates miss final state | State loss on quick switches | Persist on unmount (cleanup function) |
| Entry detection fires incorrectly | Wrong state cleared | Comprehensive logging, manual testing |
| Score calculation too complex | Performance impact | Cache scores, only recalculate on changes |
| Default workspace detection fails | Default still evicted first | Fallback to `lastVisibleAt: 0` check |
| Cross-entry handling breaks pinning | Pinned state lost | Explicit pinned check before clearing |

---

## References

- Previous fix attempt (reverted): Cross-entry persistence issue
- Current eviction: `lib/workspace/runtime-manager.ts:799-838`
- Eviction logs: `runtime_evicted_for_capacity`, `eviction_skipped_pinned`
- Related: `docs/proposal/components/entry_dashboard/pin/PINNED_WORKSPACE_PERSISTENCE_PLAN.md`
- Runtime types: `lib/workspace/runtime-manager.ts`
