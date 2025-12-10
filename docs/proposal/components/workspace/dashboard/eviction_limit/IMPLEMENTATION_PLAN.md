# Memory-Aware Workspace Eviction System

**Feature Slug:** `eviction_limit`
**Created:** 2025-12-10
**Updated:** 2025-12-10
**Status:** Planning (Revised)

---

## Executive Summary

Replace the fixed `maxRuntimes: 4` limit with a dynamic, memory-aware eviction system that:
1. Fixes the component state persistence issue that causes state loss on eviction
2. Uses smart eviction priorities (protect active operations, default workspace)
3. Adapts to device capabilities (more hot workspaces on powerful machines)

---

## Problem Statement

### Current Issues

1. **Fixed limit is arbitrary**: `maxRuntimes: 4` regardless of device capability
   - 32GB desktop gets same limit as 8GB laptop
   - Users with capable machines suffer unnecessary evictions

2. **State loss on eviction**: When workspaces are evicted and restored:
   - Component state (Timer time, Calculator value) is lost
   - Root cause A: Components don't save state to `metadata`
   - Root cause B: `metadata` field doesn't map to `componentState` on restoration

3. **Poor eviction priorities**: Simple LRU doesn't consider:
   - Active background operations (running timer)
   - Workspace importance (default, pinned, has content)
   - User intent

4. **Default workspace vulnerability**: Always has oldest `lastVisibleAt`, evicted first

### Evidence from Logs

```
runtime_evicted_for_capacity | {
  "evictedWorkspaceId": "6953461d...",  // DEFAULT workspace
  "evictedLastVisibleAt": 0,            // Oldest timestamp
  "evictedComponentCount": 2,           // Had components!
}
```

Database shows empty metadata:
```json
{"type": "timer", "metadata": {}, ...}  // No state saved!
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
- **Output:** Update Section 1.5.6 with specific file path and code location

**Investigation 4: Verify Runtime Creation Flow** *(INFORMATIONAL)*
- Find where `createWorkspaceRuntime()` or equivalent is called
- Verify we can pass `entryId` and `isDefault` at that point
- **Document:** File path and how workspace-entry association can be established

---

## Solution Architecture

### Three-Layer Approach

```
┌─────────────────────────────────────────────────────────────┐
│                    Layer 1: Memory Monitor                   │
│         Tracks memory usage, determines safe limits          │
│                    (Phase 3 - Optional)                      │
├─────────────────────────────────────────────────────────────┤
│                  Layer 2: Smart Eviction                     │
│      Weighted priorities, protects important workspaces      │
│                    (Phase 2 - Important)                     │
├─────────────────────────────────────────────────────────────┤
│                Layer 3: State Persistence                    │
│       Components save state, proper restoration flow         │
│                    (Phase 1 - Critical)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: State Persistence Fix (CRITICAL)

### 1.1 Problem Analysis

**Issue A: State not saved to metadata**

Current Timer.tsx:
```typescript
useComponentRegistration({
  workspaceId,
  componentId,
  componentType: 'timer',
  position,
  // NO metadata - state not saved!
})
```

**Issue B: Field name mismatch on restoration**

```
Runtime Ledger → runtimeComponentsToCanvasItems → canvasItems → ComponentPanel
     ↓                      ↓                          ↓              ↓
  metadata              metadata                   metadata      initialState={componentState}
                                                                        ↓
                                                                   UNDEFINED!
```

### 1.2 Fix A: Components Save State to Metadata

**Challenge:** Timer state changes every second. Naive implementation would update metadata 60 times/minute.

**Solution:** Throttled metadata updates with immediate save on significant changes.

#### 1.2.1 Create Throttled State Hook

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

#### 1.2.2 Update Timer Component

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

#### 1.2.3 Update Calculator Component

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

#### 1.2.4 Update StickyNote Component

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

### 1.3 Fix B: Map Metadata to ComponentState

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

### 1.4 Add `isActive` to Runtime Ledger

**File:** `lib/workspace/runtime-manager.ts`

#### 1.4.1 Update Types

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

#### 1.4.2 Track Active Operations

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

#### 1.4.3 Update useComponentRegistration Hook

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

### 1.5 Cross-Entry State Handling

#### 1.5.1 Problem Definition

When user switches from Entry A to Entry B:
- **Pinned workspaces** from Entry A should retain state (background operations continue)
- **Non-pinned workspaces** from Entry A should clear state (no zombie timers)

Previous fix was reverted because ALL workspaces retained state across entry switches.

#### 1.5.2 Entry Switch Detection

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

#### 1.5.3 Getting Workspaces for an Entry

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

#### 1.5.4 Runtime Cleanup on Destruction

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

#### 1.5.5 Entry Deactivation Handler

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

#### 1.5.5 Hook Entry Deactivation into Navigation

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

## Phase 3: Memory Monitor (OPTIONAL/FUTURE)

### 3.1 Overview

This phase adds device-aware dynamic limits. Can be deferred as it's an optimization, not a bug fix.

### 3.2 Memory Service Interface

**File:** `lib/workspace/memory-monitor.ts`

```typescript
interface MemoryStatus {
  heapUsedMB: number
  heapTotalMB: number
  percentUsed: number
  pressure: 'low' | 'normal' | 'high' | 'critical'
  source: 'electron' | 'chrome' | 'estimated'
}

interface DynamicLimits {
  maxRuntimes: number
  evictionUrgency: 'none' | 'lazy' | 'immediate'
}
```

### 3.3 Memory Thresholds

| Memory Pressure | Heap Usage | maxRuntimes | Behavior |
|-----------------|------------|-------------|----------|
| Low | < 40% | 12 | Generous |
| Normal | 40-60% | 8 | Comfortable |
| High | 60-80% | 4 | Conservative (current) |
| Critical | > 80% | 2 | Aggressive eviction |

### 3.4 Platform-Specific Measurement

**Electron:**
- Use IPC to get `process.memoryUsage()` from main process
- Most accurate measurement

**Browser (Chrome):**
- Use `performance.memory` (non-standard)
- Less accurate but available

**Browser (Other):**
- Estimate based on workspace count and component count
- Fallback to fixed limits

### 3.5 Phase 3 Implementation Tasks

- [ ] **3.5.1** Create `lib/workspace/memory-monitor.ts`
- [ ] **3.5.2** Implement Electron IPC for memory measurement
- [ ] **3.5.3** Implement Chrome memory measurement
- [ ] **3.5.4** Implement estimation fallback
- [ ] **3.5.5** Add `getDynamicLimits()` function
- [ ] **3.5.6** Integrate with eviction system
- [ ] **3.5.7** Add memory status logging
- [ ] **3.5.8** Add feature flag `NEXT_PUBLIC_MEMORY_AWARE_EVICTION`
- [ ] **3.5.9** Test on low-memory device

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
Phase 1: State Persistence Fix (CRITICAL)
├── 1.1 Create throttled state hook
├── 1.2 Update Timer with throttled metadata + isActive
├── 1.3 Update Calculator with metadata
├── 1.4 Update StickyNote with metadata
├── 1.5 Add isActive to runtime ledger types
├── 1.6 Add componentState mapping
├── 1.7 Add entry-workspace tracking
├── 1.8 Implement entry deactivation handler
└── 1.9 Test state persistence scenarios

Phase 2: Smart Eviction (IMPORTANT)
├── 2.1 Add default workspace tracking
├── 2.2 Implement eviction scoring
├── 2.3 Replace LRU with smart eviction
└── 2.4 Test eviction priorities

Phase 3: Memory Monitor (OPTIONAL)
├── 3.1 Implement memory measurement
├── 3.2 Add dynamic limits
└── 3.3 Integrate with eviction

Phase 4: Integration & Testing
├── 4.1 Add feature flags
├── 4.2 Write tests
└── 4.3 Documentation
```

---

## Files to Modify

### New Files
- `lib/hooks/use-throttled-component-state.ts`
- `lib/flags/eviction.ts`
- `lib/workspace/memory-monitor.ts` (Phase 3)
- `__tests__/unit/throttled-component-state.test.ts`
- `__tests__/unit/smart-eviction.test.ts`
- `__tests__/integration/workspace-state-persistence.test.ts`

### Modified Files
- `lib/workspace/runtime-manager.ts`
  - Add `isActive` to RuntimeComponent
  - Add `defaultWorkspaceIds` tracking
  - Add `workspaceEntryMap` tracking
  - Add `hasActiveBackgroundOperation()`
  - Add `calculateEvictionScore()`
  - Add `getWorkspaceToEvict()`
  - Add `onEntryDeactivated()`
  - Add `clearRuntimeComponentMetadata()`

- `lib/hooks/use-component-registration.ts`
  - Add `isActive` parameter

- `lib/hooks/use-runtime-components.ts`
  - Add `componentState` mapping

- `components/canvas/components/timer.tsx`
  - Use throttled state hook
  - Pass metadata and isActive

- `components/canvas/components/calculator.tsx`
  - Pass metadata

- `components/canvas/components/sticky-note.tsx`
  - Pass metadata

- `components/dashboard/DashboardView.tsx` (or navigation handler)
  - Hook entry deactivation

---

## Success Criteria

### Must Have (Phase 1)
- [ ] Timer state (time remaining) persists when switching workspaces within same entry
- [ ] Calculator state (display value) persists when switching workspaces within same entry
- [ ] Non-pinned workspace state clears when switching entries
- [ ] Pinned workspace state persists when switching entries
- [ ] No performance degradation from throttled updates

### Should Have (Phase 2)
- [ ] Default workspace not evicted first
- [ ] Workspaces with active timers protected from eviction
- [ ] Empty workspaces evicted before workspaces with content
- [ ] Eviction decisions logged for debugging

### Nice to Have (Phase 3)
- [ ] Memory-aware dynamic limits
- [ ] More hot workspaces on capable devices
- [ ] Graceful degradation on low-memory devices

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
