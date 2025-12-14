# Workspace State Machine - Implementation Plan

**Feature Slug:** `workspace-state-machine`
**Date:** 2025-12-14
**Status:** Planning
**Priority:** High

---

## Problem Statement

### Current Architecture (Flawed)

```
Component (Timer) ──► useComponentRegistration ──► Runtime Ledger
                 ──► useThrottledComponentState ──► onStateUpdate callback
                 ──► local useState for minutes/seconds/isRunning

Props flow: Runtime Ledger ──► useRuntimeComponents (React state copy)
                           ──► canvasItems ──► ComponentPanel ──► Timer props
```

**Issues:**
1. Multiple layers of React state introduce staleness
2. Each component has its own state management boilerplate
3. Fixing one component doesn't fix others
4. No unified view of "what's active" at workspace level
5. Eviction decisions are component-by-component

### Target Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    WORKSPACE STORE (one per workspace)            │
│                                                                   │
│  Durable State (persisted):                                       │
│    components: Map<id, {                                          │
│      type: string                                                 │
│      position: { x, y }                                           │
│      size: { width, height } | null                               │
│      state: Record<string, unknown>  // component-specific        │
│    }>                                                             │
│                                                                   │
│  Runtime State (not persisted):                                   │
│    activeIds: Set<id>         // components with background ops   │
│    dirtyIds: Set<id>          // changed since last persist       │
│    lastPersistedAt: number                                        │
│                                                                   │
│  Actions:                                                         │
│    getComponentState(id) → state                                  │
│    updateComponentState(id, patch) → marks dirty                  │
│    setActive(id, boolean) → updates activeIds                     │
│    persist() → saves dirty to DB, clears dirtyIds                 │
│    restore(payload) → populates from DB payload                   │
│                                                                   │
│  Derived (for eviction):                                          │
│    hasActiveOperations() → activeIds.size > 0                     │
│    hasDirtyState() → dirtyIds.size > 0                            │
│    getEvictionPriority() → score (lower = evict first)            │
└──────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
     ┌─────────┐        ┌─────────┐        ┌─────────┐
     │  Timer  │        │  Calc   │        │ Sticky  │
     │         │        │         │        │         │
     │ subscribe        subscribe          subscribe │
     │ (selector)       (selector)         (selector)│
     │ + dispatch       + dispatch         + dispatch│
     └─────────┘        └─────────┘        └─────────┘
```

---

## Key Design Decisions

### 1. Durable vs Ephemeral State

**Durable State (stored in workspace store, persisted to DB):**
- Timer: `minutes`, `seconds`, `isRunning`, `inputMinutes`
- Calculator: `display`, `previousValue`, `operation`, `waitingForNewValue`
- StickyNote: `text`, `color`, `fontSize`
- All: `position`, `size`, `zIndex`

**Ephemeral State (component-local, never persisted):**
- `intervalRef`, `timeoutRef` - runtime handles
- `isFocused`, `isHovered` - UI interaction state
- `isDragging`, `dragOffset` - transient drag state
- DOM refs, animation state

**Rule:** If it can't be JSON.stringify'd or doesn't make sense after reload, it's ephemeral.

### 2. Hot vs Cold Restore (Critical Distinction)

Not all restores are equal. The system must distinguish between:

**Hot Workspace (switch/hide):**
- Runtime still exists in memory, just hidden
- User switched to another workspace
- Active operations CONTINUE running in background
- Timer keeps ticking, media keeps playing
- When user switches back, they see current state

**Cold Restore (eviction/reload/crash):**
- Runtime was destroyed or page reloaded
- Loading state from DB payload
- Active operations STOP by default
- Timer shows last persisted time, paused
- User must manually resume

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RESTORE TYPE MATRIX                          │
├─────────────────────────────────────────────────────────────────────┤
│  Scenario              │  Type   │  Active Ops    │  State Source   │
├────────────────────────┼─────────┼────────────────┼─────────────────┤
│  Switch to workspace B │  HOT    │  Keep running  │  Memory         │
│  Switch back to A      │  HOT    │  Still running │  Memory         │
│  Evict workspace A     │  COLD   │  Stop          │  DB (persisted) │
│  Page reload           │  COLD   │  Stop          │  DB (persisted) │
│  Browser crash         │  COLD   │  Stop          │  DB (persisted) │
│  Close & reopen app    │  COLD   │  Stop          │  DB (persisted) │
└─────────────────────────────────────────────────────────────────────┘
```

**Why this matters:**
- Hot: Timer at 3:57 → switch away → switch back → Timer at 2:45 (kept running) ✓
- Cold: Timer at 3:57 → evict → restore → Timer at 3:57 PAUSED (safe default) ✓

### 3. Cold Restore Invariant (Workspace-Level Rule)

> **INVARIANT:** On cold restore, all active operations default to inactive
> unless a component explicitly opts into resumable behavior with a
> durable time anchor.

This is a **workspace-level rule**, not component-specific.

**Important nuance (for forward-compatibility):**
- For **known component types at supported schema versions**, the system may normalize durable state on cold
  restore (e.g., “stop running” flags).
- For **unknown component types** or **newer schema versions** that must be preserved opaque, do **not**
  mutate the payload. Treat them as inactive by default (no activeIds/headless ops), but preserve the raw
  state so a newer build can interpret it later.

**Default behavior (no opt-in):**
```typescript
// On cold restore, these flags are set to false:
isRunning → false
isPlaying → false
isActive → false
isCountingDown → false
```

**Opt-in resumable behavior (with durable time anchor):**
```typescript
// Component can opt into resumable behavior by storing:
interface ResumableState {
  startedAtTimestamp: number  // When operation started (wall clock)
  totalDurationMs: number     // How long the operation should run
  // On cold restore, system can calculate:
  // elapsed = Date.now() - startedAtTimestamp
  // remaining = totalDurationMs - elapsed
  // If remaining > 0, can optionally auto-resume
}
```

**When to use durable time anchor:**
- Pomodoro timer that MUST complete even after crash
- Scheduled alarm that should fire at specific time
- Download/upload progress that can resume

**When NOT to use (most cases):**
- Simple countdown timer (user can restart)
- Media playback (user expects pause on reload)
- Animations (should restart fresh)

**Implementation in restore:**
```typescript
restore(components: ComponentPayload[], restoreType: 'hot' | 'cold') {
  for (const comp of components) {
    let state = { ...comp.state }

	if (restoreType === 'cold') {
	      // INVARIANT (supported types): deactivate unless durable anchor exists.
	      // Unknown/newer-schema payloads should be preserved opaque (no mutation).
	      state = this.applyDeactivationInvariant(comp.type, state)
	    }

    this.components.set(comp.id, { ...comp, state })
  }
}

applyDeactivationInvariant(type: string, state: Record<string, unknown>) {
  // Check for durable time anchor (opt-in to resumable)
  if (state.startedAtTimestamp && state.totalDurationMs) {
    // Component opted into resumable behavior
    // Could calculate elapsed time and resume, or let component handle it
    return state
  }

  // Default: deactivate common operation flags
  const deactivated = { ...state }
  const activeFlags = ['isRunning', 'isPlaying', 'isActive', 'isCountingDown']
  for (const flag of activeFlags) {
    if (flag in deactivated) {
      deactivated[flag] = false
    }
  }
  return deactivated
}
```

**Benefits of this approach:**
1. **General** - Works for any current or future component
2. **Safe** - Default is always "stop" (no surprises)
3. **Flexible** - Components can opt into resumable behavior
4. **Predictable** - Clear rules for hot vs cold
5. **Testable** - One invariant to verify, not per-component logic

### 4. Eviction Strategy: Persist-Before-Evict

**Old (blocking):**
```
canEvict = !hasActive && !hasDirty  // Can deadlock if all dirty
```

**New (persist-before-evict):**
```
prepareForEviction():
  1. If hasDirty → persist() first
  2. Return eviction priority score

getEvictionPriority():
  score = 0
  score += recencyScore (0-100, older = lower)
  score += hasActive ? 500 : 0      // Prefer evicting inactive
  score += isDefault ? 300 : 0      // Prefer evicting non-default
  return score

// Eviction flow:
1. Find workspace with LOWEST priority score
2. Call prepareForEviction() → persists dirty state
3. Evict (state is safe in DB)
```

**Active operations affect PRIORITY, not SAFETY:**
- Inactive workspaces evicted first (score +0)
- Active workspaces evicted last (score +500)
- But if ALL are active, system still works - picks lowest priority active one
- State is always persisted before eviction, so nothing is lost

### 5. Subscription Model (Selector-Based)

Components subscribe to their specific slice:
```typescript
// Only re-renders when THIS component's state changes
const timerState = useWorkspaceStore(workspaceId,
  store => store.components.get(componentId)?.state
)
```

Not:
```typescript
// BAD: Re-renders on ANY component change
const allComponents = useWorkspaceStore(workspaceId, store => store.components)
```

### 6. Workspace Lifecycle States (Critical)

The store must have explicit lifecycle states to gate operations correctly:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WORKSPACE LIFECYCLE                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   UNINITIALIZED ──► RESTORING ──► READY ◄──► PERSISTING             │
│         │              │            │            │                   │
│         │              │            │            │                   │
│         └──────────────┴────────────┴────────────┘                   │
│                              │                                       │
│                              ▼                                       │
│                           ERROR                                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**State definitions:**
- `uninitialized` - Store created but no data loaded
- `restoring` - Loading state from DB (in-flight)
- `ready` - Normal operation, can accept updates and persist
- `persisting` - Persist in progress (can still accept updates, queued for next persist)
- `error` - Something failed (persist error, restore error)

**Lifecycle invariants:**
1. **No persist until ready:** Cannot call `persist()` while `restoring`
2. **No eviction until ready:** Cannot evict workspace while `restoring`
3. **Hot/cold detection:** If state is `uninitialized` → cold restore; if `ready` → hot
4. **Single restore:** Cannot call `restore()` if already `restoring` or `ready`
5. **Updates during persist:** Allowed, but mark dirty for next persist cycle

```typescript
type WorkspaceLifecycle =
  | 'uninitialized'
  | 'restoring'
  | 'ready'
  | 'persisting'
  | 'error'

// In store
lifecycle: WorkspaceLifecycle = 'uninitialized'

restore(...) {
  if (this.lifecycle === 'restoring') {
    throw new Error('Restore already in progress')
  }
  if (this.lifecycle === 'ready') {
    // Already restored - this is a hot re-show, not cold restore
    return
  }
  this.lifecycle = 'restoring'
  try {
    // ... restore logic
    this.lifecycle = 'ready'
  } catch (e) {
    this.lifecycle = 'error'
    throw e
  }
}

persist() {
  if (this.lifecycle !== 'ready' && this.lifecycle !== 'persisting') {
    console.warn('Cannot persist: workspace not ready')
    return
  }
  // ... persist logic
}
```

### 7. Event-Driven Persistence (Not Interval-Based)

**Problem with interval-based persistence:**
```typescript
// BAD: This recreates the "works only when running" problem
setInterval(() => {
  if (store.hasDirtyState()) {
    store.persist()
  }
}, 2000)
```
- Background tabs throttle `setInterval` to 1000ms+
- If component unmounts, interval may not run
- Creates race conditions with eviction

	**Better: Event-driven scheduling:**
	```typescript
	// GOOD: Persist on meaningful events, not time
	const debouncedPersist = debounce(() => void store.persist(), 1000)
	
	const persistScheduler = {
	  // Debounced persist on dirty changes (wait for burst of changes to settle)
	  scheduleDebounced: () => debouncedPersist(),
	  cancelDebounced: () => debouncedPersist.cancel(),
	
	  // Immediate flush on critical events (waits for any in-flight persist)
	  flushNow: async () => {
	    persistScheduler.cancelDebounced()
	    await store.persist()
	  }
	}

	// When to schedule:
	store.updateComponentState(id, patch) {
	  // ... update logic
	  this.dirtyIds.add(id)
	  persistScheduler.scheduleDebounced()  // Debounced, not immediate
	}

// When to flush immediately:
onWorkspaceSwitch() → persistScheduler.flushNow()
onEvictionTriggered() → persistScheduler.flushNow()
onBeforeUnload() → persistScheduler.flushNow()  // Browser close/refresh
onVisibilityChange('hidden') → persistScheduler.flushNow()  // Tab hidden
```

**Benefits:**
- Persists when user takes action (switch, close), not random intervals
- Works correctly in background tabs
- No "missed persist" if component unmounts
- Predictable behavior: "I switched, so it saved"

### 8. Persist Concurrency Control & Failure Policy

	**Concurrency rules:**
	```typescript
	interface PersistState {
	  inFlight: boolean                 // Is a persist currently running?
	  inFlightPromise: Promise<void> | null  // Joinable promise for flushNow/eviction
	  pendingChanges: Set<string>       // Components changed during current persist
	  revision: number                  // Monotonically increasing revision
	  lastError: string | null
	  retryCount: number
	  health: PersistHealth
	}
	
	async persist() {
	  // Lifecycle gate (Section 6)
	  if (this.lifecycle !== 'ready' && this.lifecycle !== 'persisting') return
	
	  // Rule 1: Single in-flight persist, but JOIN it (flushNow relies on this)
	  if (this.persistState.inFlightPromise) {
	    return this.persistState.inFlightPromise
	  }
	
	  if (!this.persistCallback || this.dirtyIds.size === 0) return
	
	  this.persistState.inFlight = true
	  this.lifecycle = 'persisting'
	
	  this.persistState.inFlightPromise = (async () => {
	    while (true) {
	      // Rule 2: Monotonic revision (used for DB idempotency)
	      const revision = ++this.persistState.revision
	      const dirtySnapshot = new Set(this.dirtyIds)
	      this.persistState.pendingChanges.clear()
	
	      try {
	        await this.doPersist(revision)
	        this.persistState.lastError = null
	        this.persistState.retryCount = 0
	        this.persistState.health = 'healthy'
	
	        // Clear only what we know we persisted; keep mid-flight dirties
	        for (const id of dirtySnapshot) this.dirtyIds.delete(id)
	
	        // Rule 3: Re-persist if changes accumulated during persist
	        if (this.persistState.pendingChanges.size === 0) break
	      } catch (error) {
	        this.persistState.lastError = String(error)
	        this.persistState.retryCount++
	        this.persistState.health = this.persistState.retryCount >= 5 ? 'degraded' : 'retrying'
	
	        // Exponential backoff retry
	        setTimeout(() => void this.persist(), Math.min(1000 * 2 ** this.persistState.retryCount, 30000))
	        throw error
	      }
	    }
	  })()
	
	  try {
	    await this.persistState.inFlightPromise
	  } finally {
	    this.persistState.inFlight = false
	    this.persistState.inFlightPromise = null
	    if (this.lifecycle === 'persisting') this.lifecycle = 'ready'
	  }
	}
	```
	
	**Important:** While `persist()` is in flight, state mutations must add component IDs into
	`persistState.pendingChanges` so the next loop iteration re-persists (see store example in Phase 1).

	**DB boundary ordering / idempotency (prevents out-of-order overwrites):**
	- Persist the workspace `revision` alongside the payload (workspace-level field).
	- On cold restore, seed local `revision` from the payload’s `revision` so writes after reload aren’t
	  rejected as stale.
	- On the server/DB boundary, treat writes as idempotent:
	  - If `incomingRevision` < `storedRevision`: no-op success (do not overwrite newer data).
	  - Else: accept write and store `incomingRevision`.

**Failure policy:**
```
┌─────────────────────────────────────────────────────────────────────┐
│                    PERSIST FAILURE HANDLING                          │
├─────────────────────────────────────────────────────────────────────┤
│  Scenario                │  Action                                   │
├──────────────────────────┼───────────────────────────────────────────┤
│  Network error           │  Retry with backoff (1s, 2s, 4s, ... 30s) │
│  Server error (5xx)      │  Retry with backoff                       │
│  Client error (4xx)      │  Log error, mark store as error state     │
│  Persist during eviction │  BLOCK eviction until persist succeeds    │
│  Max retries exceeded    │  Show user warning, keep trying           │
└─────────────────────────────────────────────────────────────────────┘
```

**Critical invariant:**
> **NEVER evict a workspace if you cannot make its state durable.**

If persist fails and retries are exhausted, the workspace becomes "non-evictable" until persist succeeds.
This ensures "persist-before-evict" is always true.

**Degraded mode (prevents “non-evictable forever” memory growth):**
Retry-with-backoff is correct, but prolonged outages need explicit behavior to avoid unbounded memory usage.

Track a simple persist health state (per entry or per workspace):
- `healthy` (recent success)
- `retrying` (transient failures + backoff)
- `degraded` (failure threshold exceeded by time and/or attempts)
- `recovering` (first success after degraded; flush backlog)

When `degraded`:
- Show a user-visible warning (“Saving unavailable / offline”).
- Apply backpressure to limit growth:
  - Soft-limit creation of additional dirty workspaces (warn + block after threshold).
  - Prefer pausing *new* headless operations by default (user can override).
  - Encourage pinning the most important workspaces.
- Under memory pressure, require explicit user choice rather than silent eviction.

**Optional durable fallback (recommended):**
To keep “persist-before-evict” true even when DB is unreachable, write snapshots to a local durable queue
(e.g., IndexedDB) and replay on recovery. If this is deferred, the plan must explicitly block eviction when
state cannot be made durable.

**Hard limits (guardrails):**
Define explicit caps (config-driven):
- Max open workspaces per entry
- Max total components per entry
- Max serialized bytes per workspace payload

When limits are hit, evict only **clean + inactive + non-default + non-pinned** first; otherwise block
further growth until persistence recovers or the user takes action.

```typescript
prepareForEviction(): Promise<{ canEvict: boolean; reason?: string }> {
  if (this.dirtyIds.size === 0) {
    return { canEvict: true }
  }

  try {
    await this.persist()
    return { canEvict: true }
  } catch (error) {
    // Cannot make state durable - refuse eviction
    return {
      canEvict: false,
      reason: `Persist failed: ${error.message}. Will retry.`
    }
  }
}
```

### 9. Running Component Semantics (Pause vs Continue)

**Question:** When a workspace is hot but hidden, do running components continue or pause?

**Answer:** Components **continue running** when workspace is hot but hidden.

**Rationale:**
- User starts a timer, switches to another workspace to do work
- Timer should keep ticking in background (that's the point of multi-workspace)
- When user returns, timer shows accurate remaining time

**Critical: Mounting vs Unmounting Hidden Workspaces**

If React **unmounts** hidden workspace components (e.g., for virtualization/performance), component-owned intervals will stop. We have two options:

```
┌─────────────────────────────────────────────────────────────────────┐
│  OPTION A: Keep hidden workspaces mounted (display: none)           │
├─────────────────────────────────────────────────────────────────────┤
│  Pros:                                                               │
│    - Simple: component intervals "just work"                        │
│    - No code changes to Timer/etc.                                  │
│  Cons:                                                               │
│    - Memory overhead (all hot workspaces in DOM)                    │
│    - May cause performance issues with many workspaces              │
│  Implementation:                                                     │
│    - Render all hot workspaces, hide with CSS (visibility/display)  │
│    - Intervals keep running in hidden components                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  OPTION B: Move headless ops to workspace runtime (RECOMMENDED)     │
├─────────────────────────────────────────────────────────────────────┤
│  Pros:                                                               │
│    - Memory efficient (only visible workspace in DOM)               │
│    - Clean separation: runtime = logic, component = UI              │
│    - Operations survive component unmount                           │
│  Cons:                                                               │
│    - More complex: timer logic lives in store, not component        │
│    - Components become purely presentational                        │
│  Implementation:                                                     │
│    - Timer interval runs in workspace store, not component          │
│    - Store updates state, triggers re-render via subscription       │
│    - Component just displays store state                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Decision: Use Option B (headless ops in runtime)**

For components with background operations (Timer, media player), the operation runs in the **workspace store**, not the React component:

```typescript
// In workspace-component-store.ts

startTimerOperation(componentId: string) {
  const state = this.getComponentState(componentId)
  if (!state || state.isRunning) return

  // Interval owned by STORE, not component
  const intervalId = setInterval(() => {
    this.updateComponentState(componentId, prev => {
      if (prev.seconds > 0) return { seconds: prev.seconds - 1 }
      if (prev.minutes > 0) return { minutes: prev.minutes - 1, seconds: 59 }
      this.stopTimerOperation(componentId)
      return { isRunning: false }
    })
  }, 1000)

  this.activeOperations.set(componentId, intervalId)
  this.updateComponentState(componentId, { isRunning: true })
  this.setActive(componentId, true)
}

stopTimerOperation(componentId: string) {
  const intervalId = this.activeOperations.get(componentId)
  if (intervalId) {
    clearInterval(intervalId)
    this.activeOperations.delete(componentId)
  }
  this.setActive(componentId, false)
}
```

```typescript
// In Timer component (purely presentational)
function Timer({ componentId, workspaceId }) {
  const state = useComponentState(workspaceId, componentId)
  const { startTimerOperation, stopTimerOperation } = useWorkspaceStoreActions(workspaceId)

  // No interval here! Just display and control buttons
  return (
    <div>
      {state.minutes}:{state.seconds}
      <button onClick={() => startTimerOperation(componentId)}>Start</button>
      <button onClick={() => stopTimerOperation(componentId)}>Stop</button>
    </div>
  )
}
```

**Benefits:**
- Timer keeps running even if component unmounts
- Store owns the interval, component just renders
- Consistent with "store is source of truth" architecture
- Solves the "hot but hidden" problem completely

**For cold restore:** Since store was destroyed, interval is gone. On restore:
- Without durable anchor: `isRunning` → `false` (user must restart)
- With durable anchor: Calculate elapsed time, optionally auto-restart

```typescript
// Behavior summary:
Hot hidden (mounted):    interval runs in store → accurate time
Hot hidden (unmounted):  interval runs in store → accurate time (same!)
Hot visible:             interval runs in store → component displays
Cold restore:            interval destroyed → isRunning=false unless durable anchor
```

### 10. Eviction Scoring: Hard Rules vs Priority

**Hard rules (non-evictable):**
```typescript
const HARD_RULES = {
  isPinned: true,           // Pinned workspaces NEVER evict
  isCurrentlyVisible: true, // Visible workspace NEVER evict
  persistFailed: true,      // Cannot evict if state not durable
}
```

**Priority scoring (among evictable workspaces):**
```typescript
function getEvictionPriority(workspaceId: string): number | 'non-evictable' {
  const store = getWorkspaceComponentStore(workspaceId)
  const runtime = getWorkspaceRuntime(workspaceId)

  // HARD RULES - non-evictable
  if (isWorkspacePinned(workspaceId)) return 'non-evictable'
  if (runtime.isVisible) return 'non-evictable'
  if (store.persistState.lastError && store.hasDirtyState()) return 'non-evictable'

  // PRIORITY SCORING - higher = less likely to evict
  let score = 0

  // Recency (0-100): older = lower score
  const age = Date.now() - runtime.lastVisibleAt
  const maxAge = 10 * 60 * 1000  // 10 minutes
  score += Math.max(0, 100 - (age / maxAge) * 100)

  // Active operations (+500): prefer evicting inactive
  if (store.hasActiveOperations()) {
    score += 500
  }

  // Default workspace (+1000): almost never evict
  if (isDefaultWorkspace(workspaceId)) {
    score += 1000
  }

  // Has components with state (+200): prefer evicting empty
  if (store.components.size > 0) {
    score += 200
  }

  return score
}
```

**Eviction selection:**
```typescript
function selectWorkspaceToEvict(): string | null {
  let bestCandidate: string | null = null
  let lowestScore = Infinity

  for (const workspaceId of listWorkspaceRuntimeIds()) {
    const priority = getEvictionPriority(workspaceId)

    if (priority === 'non-evictable') continue

    if (priority < lowestScore) {
      lowestScore = priority
      bestCandidate = workspaceId
    }
  }

  return bestCandidate
}
```

### 11. Migration Compatibility Layer

**Problem:** During Phase 5, some components use new store, others use old hooks. This creates:
- Split brain: Timer in store, Calculator in old system
- Calculator still has the stale state bug
- Inconsistent behavior

**Solution: Bridge layer that syncs old system ↔ new store**

```typescript
// lib/workspace/store-bridge.ts

/**
 * Bridge connects old useComponentRegistration/runtime-ledger to new store.
 * Used during migration Phase 5 to ensure all components work correctly.
 *
 * CRITICAL: Prevents two failure modes:
 * 1. Echo loops: A→B sync triggers B→A sync triggers A→B...
 * 2. Default overwrite: Old system reinits with defaults, overwrites restored state
 */

export function initStoreBridge(workspaceId: string) {
  const store = getWorkspaceComponentStore(workspaceId)
  const runtime = getWorkspaceRuntime(workspaceId)

  // === ECHO LOOP PREVENTION ===
  // Track which system initiated the current update
  let syncSource: 'store' | 'runtime' | null = null

  // === DEFAULT OVERWRITE PREVENTION ===
  // Track revision per component - only accept updates with higher revision
  const componentRevisions = new Map<string, number>()

  // When store restores from DB, mark components with high revision
  // so old system defaults (revision 0) can't overwrite
  const markRestoredRevisions = () => {
    for (const [id] of store.components) {
      componentRevisions.set(id, 1000)  // Restored state has high revision
    }
  }

  // OLD → NEW: When old system updates runtime.components, sync to store
  const syncOldToNew = () => {
    // Prevent echo: if store initiated the current update cycle, skip
    if (syncSource === 'store') return

    syncSource = 'runtime'
    try {
      for (const [id, comp] of runtime.components) {
        const currentRevision = componentRevisions.get(id) ?? 0
        const incomingRevision = comp._bridgeRevision ?? 0

        // OVERWRITE PREVENTION: Only accept if incoming revision >= current
        // Old system defaults have revision 0, restored state has 1000+
        if (incomingRevision < currentRevision) {
          // Skip: this is stale data (probably defaults after restore)
          continue
        }

        if (!store.components.has(id)) {
          store.addComponent(id, {
            type: comp.componentType,
            position: comp.position,
            size: comp.size,
            zIndex: comp.zIndex,
            state: comp.metadata
          })
        } else {
          store.updateComponentState(id, comp.metadata)
        }
        componentRevisions.set(id, incomingRevision)
      }
    } finally {
      syncSource = null
    }
  }

  // NEW → OLD: When store updates, sync back to runtime ledger
  store.subscribe(() => {
    // Prevent echo: if runtime initiated the current update cycle, skip
    if (syncSource === 'runtime') return

    syncSource = 'store'
    try {
      for (const [id, comp] of store.components) {
        const existing = runtime.components.get(id)
        if (existing) {
          existing.metadata = comp.state
          existing.position = comp.position
          existing.size = comp.size
          // Mark with high revision so old system won't overwrite
          existing._bridgeRevision = (componentRevisions.get(id) ?? 0) + 1
          componentRevisions.set(id, existing._bridgeRevision)
        }
      }
    } finally {
      syncSource = null
    }
  })

  // Call after store.restore() to protect restored state
  markRestoredRevisions()

  return { syncOldToNew, markRestoredRevisions }
}
```

**Bridge safety guarantees:**
1. **No echo loops:** `syncSource` flag blocks re-entrant syncs
2. **No default overwrite:** Restored state gets revision 1000, old defaults get 0
3. **Monotonic revisions:** Each sync increments revision, stale updates rejected

**Migration timeline:**
1. Phase 5 starts: Enable bridge for all workspaces
2. Migrate Timer: Timer uses store directly, bridge syncs for old readers
3. Migrate Calculator: Same pattern
4. Migrate StickyNote: Same pattern
5. Phase 6: All components migrated, disable bridge, remove old hooks

### 12. Layout Field Ownership

**Problem:** During migration, who owns `position`, `size`, `zIndex`?
- Old system: LayerManager, runtime ledger
- New system: Component store

**Single ownership rule:**
> Position/size/zIndex are owned by the **component store** from Phase 1 onwards.
> Old systems read FROM store via bridge, never write to their own copies.

**Implementation:**
```typescript
// In bridge: Old systems read from store
const getComponentPosition = (componentId: string) => {
  // NEW: Read from store (authoritative)
  return store.getComponent(componentId)?.position

  // OLD (deprecated): Don't read from LayerManager/runtime
}

// When old code tries to update position:
const handleOldPositionUpdate = (componentId: string, position: Position) => {
  // Redirect to store (single source of truth)
  store.updateComponentPosition(componentId, position)
}
```

**Why store is authoritative:**
- Store persists to DB
- Store is source for restore
- No risk of LayerManager having different position than DB

### 13. Component State Versioning & Validation (Future-Proof)

Even with only a few components today, we should make durable state evolution safe. The goal is to prevent
future “default overwrite” and “crash on restore” bugs as component payloads change shape over time.

**Durable payload additions (JSON-only, no DB column changes):**
- Add optional `schemaVersion: number` to each persisted component entry in the `components[]` array.
- If `schemaVersion` is missing, treat it as `1` (back-compat).

**Component Type Registry (data contract, not a framework):**
For each component `type`, define:
1. **current schemaVersion**
2. **validate(state)**: accept/reject (coerce where safe)
3. **migrate(fromVersion, state)**: forward-only migration to current version
4. **applyColdRestoreInvariant(state)**: normalize “preserve state, not behavior” per type if needed

**Restore rules (safety first):**
- **Unknown component type:** preserve the payload as opaque; keep layout/position; render a placeholder
  (“Component unavailable”) and allow delete. Never drop data.
- **Newer schemaVersion than supported:** preserve opaque; do not attempt partial parsing. Prevents
  accidental default-overwrite on downgrade or build mismatch.
- **Older schemaVersion:** migrate forward before writing into the store.
- **Validation failure:** keep the last-known-good state if present; quarantine the invalid payload for
  export/debug; show a non-blocking warning.

**Persist rules:**
- Persist only serializable durable state (no refs/handles/DOM).
- Enforce size limits (per-component and per-workspace). If exceeded: warn + enter degraded mode to prevent
  runaway payload growth.

### 14. Extensibility: Keep Store Core Generic

Option B (“headless ops in store”) is correct for correctness when hidden workspaces unmount, but we should
avoid the store becoming a “god object” as more component types add background behavior.

**Guideline:**
- Store core remains generic: CRUD, dirty/active tracking, lifecycle, persistence scheduling, subscriptions.
- Component-specific logic (validation/migration/cold-restore normalization and optional headless ops) lives
  behind the Component Type Registry keyed by `type`.

**Outcome:** New components plug in by adding a registry entry + UI component, not by editing store internals.

### 15. Observability (Make Future Bugs Cheap to Diagnose)

The goal is to reconstruct “what happened” from logs without adding ad-hoc debug prints.

**Standardize structured events:**
- Store lifecycle transitions (`uninitialized` → `restoring` → `ready` → `error`)
- Persist start/success/failure (include `revision`, bytes, dirty count)
- Degraded mode enter/exit (include reason)
- Eviction decisions (hard-rule block reason or score breakdown)

---

## Implementation Phases

### Phase 1: Core Store Infrastructure

**Files to create:**
- `lib/workspace/workspace-component-store.ts` - Store implementation
- `lib/workspace/workspace-store-types.ts` - Type definitions
- `lib/workspace/component-type-registry.ts` - Component Type Registry (schema/validate/migrate)

**Type Definitions:**

```typescript
// lib/workspace/workspace-store-types.ts

/** Durable component state - persisted to DB */
export interface DurableComponentState {
  type: string
  schemaVersion?: number
  position: { x: number; y: number }
  size: { width: number; height: number } | null
  zIndex: number
  state: Record<string, unknown>  // Component-specific state
}

	/** Runtime-only tracking - never persisted */
	export interface WorkspaceRuntimeState {
	  activeIds: Set<string>
	  dirtyIds: Set<string>
	  lastPersistedAt: number
	}

	/** Store lifecycle gating (see Section 6) */
	export type WorkspaceLifecycle =
	  | 'uninitialized'
	  | 'restoring'
	  | 'ready'
	  | 'persisting'
	  | 'error'

	/** Persist health (drives degraded-mode UI/backpressure) */
	export type PersistHealth = 'healthy' | 'retrying' | 'degraded' | 'recovering'

	/** Persist concurrency + health tracking (runtime-only) */
	export interface PersistState {
	  inFlight: boolean
	  inFlightPromise: Promise<void> | null
	  pendingChanges: Set<string>
	  revision: number
	  lastError: string | null
	  retryCount: number
	  health: PersistHealth
	  degradedSince: number | null
	}

	/** Debounced persistence controller */
	export interface PersistScheduler {
	  scheduleDebounced(): void
	  cancelDebounced(): void
	  flushNow(): Promise<void>
	}

	/** Full workspace store state */
	export interface WorkspaceComponentStore {
	  // Durable (persisted)
	  components: Map<string, DurableComponentState>

	  // Lifecycle gating (hot/cold classification + persistence/eviction rules)
	  readonly lifecycle: WorkspaceLifecycle

	  // Runtime (not persisted)
	  runtime: WorkspaceRuntimeState

	  // Persist state/health (not persisted)
	  readonly persistState: PersistState

	  // Debounced persistence scheduler (flush on switch/evict/unload)
	  readonly persistScheduler: PersistScheduler

	  // Subscribers (internal)
	  listeners: Set<() => void>
	}

/** State update - can be object patch OR functional update */
export type StateUpdate<T = Record<string, unknown>> =
  | Partial<T>                              // Object patch: { seconds: 5 }
  | ((prev: T) => Partial<T>)               // Functional: prev => ({ seconds: prev.seconds - 1 })

	/** Store actions */
	export interface WorkspaceStoreActions {
  // Read
  getComponentState<T = Record<string, unknown>>(componentId: string): T | null
  getComponent(componentId: string): DurableComponentState | null
  getAllComponents(): Array<{ id: string } & DurableComponentState>  // Includes ID

  // Write (supports both object patch and functional update)
  updateComponentState<T = Record<string, unknown>>(
    componentId: string,
    update: StateUpdate<T>
  ): void
  updateComponentPosition(componentId: string, position: { x: number; y: number }): void
  addComponent(componentId: string, component: DurableComponentState): void
  removeComponent(componentId: string): void

  // Active tracking
  setActive(componentId: string, active: boolean): void
  hasActiveOperations(): boolean
  getActiveIds(): string[]

  // Dirty tracking
  hasDirtyState(): boolean
  getDirtyIds(): string[]
  clearDirty(): void

	  // Persistence
	  setPersistCallback(
	    cb: (
	      components: Array<{ id: string } & DurableComponentState>,
	      meta: { revision: number }
	    ) => Promise<void>
	  ): void
	  persist(): Promise<void>
	  restore(
	    components: Array<{
	      id: string
	      type: string
	      schemaVersion?: number
	      position?: { x: number; y: number } | null
	      size?: { width: number; height: number } | null
	      zIndex?: number
	      metadata?: Record<string, unknown> | null
	    }>,
	    options?: { restoreType: 'hot' | 'cold'; baseRevision?: number }  // Defaults to cold, revision 0
	  ): void
	
	  // Eviction
	  getEvictionPriority(): number
	  prepareForEviction(): Promise<{ canEvict: boolean; reason?: string }>

  // Option B: Headless operations (intervals live in store, not components)
  startTimerOperation(componentId: string): void
  stopTimerOperation(componentId: string): void
  stopAllOperations(): void  // Called before store deletion

  // Subscriptions
  subscribe(listener: () => void): () => void
  getSnapshot(): WorkspaceComponentStore
}
```

**Store Implementation:**

```typescript
	// lib/workspace/workspace-component-store.ts
	
	import { debugLog } from '@/lib/utils/debug-logger'
	import { createPersistScheduler } from '@/lib/workspace/persist-scheduler' // Implemented in Phase 3

// Store instances per workspace
const stores = new Map<string, WorkspaceComponentStore & WorkspaceStoreActions>()

export function getWorkspaceComponentStore(workspaceId: string) {
  let store = stores.get(workspaceId)
  if (!store) {
    store = createWorkspaceComponentStore(workspaceId)
    stores.set(workspaceId, store)
  }
  return store
}

export function deleteWorkspaceComponentStore(workspaceId: string) {
  const store = stores.get(workspaceId)
  if (store) {
    // CRITICAL: Stop all active operations before deleting (Option B cleanup)
    // Without this, store-owned intervals would leak and continue running
    store.stopAllOperations()
  }
  stores.delete(workspaceId)
}

	function createWorkspaceComponentStore(workspaceId: string) {
	  // Internal state
	  const components = new Map<string, DurableComponentState>()
	  const activeIds = new Set<string>()
	  const dirtyIds = new Set<string>()
	  const listeners = new Set<() => void>()
	  let lastPersistedAt = 0
	  let lifecycle: WorkspaceLifecycle = 'uninitialized'

	  const persistState: PersistState = {
	    inFlight: false,
	    inFlightPromise: null,
	    pendingChanges: new Set<string>(),
	    revision: 0,
	    lastError: null,
	    retryCount: 0,
	    health: 'healthy',
	    degradedSince: null
	  }
	
	  let persistScheduler: PersistScheduler
	
	  // Option B: Store-owned operations (intervals, etc.) - survives component unmount
	  const activeOperations = new Map<string, ReturnType<typeof setInterval>>()

  // Notify subscribers
  const notify = () => {
    listeners.forEach(listener => listener())
  }

  // INVARIANT: On cold restore, deactivate operations unless durable anchor exists
  const applyDeactivationInvariant = (state: Record<string, unknown>): Record<string, unknown> => {
    // Check for durable time anchor (opt-in to resumable behavior)
    if (state.startedAtTimestamp && state.totalDurationMs) {
      // Component explicitly opted into resumable behavior
      // Leave state unchanged - component will handle elapsed time calculation
      return state
    }

    // Default: deactivate common operation flags
    const deactivated = { ...state }
    const activeFlags = ['isRunning', 'isPlaying', 'isActive', 'isCountingDown', 'isPaused']
    for (const flag of activeFlags) {
      if (flag in deactivated && typeof deactivated[flag] === 'boolean') {
        // Set running/playing flags to false, but isPaused might need to be true
        if (flag === 'isPaused') {
          deactivated[flag] = true  // Paused = true on cold restore
        } else {
          deactivated[flag] = false
        }
      }
    }
    return deactivated
  }

	  // Persistence callback (set externally)
	  // Type matches setPersistCallback and getAllComponents() - includes IDs
	  let persistCallback: ((
	    components: Array<{ id: string } & DurableComponentState>,
	    meta: { revision: number }
	  ) => Promise<void>) | null = null

	  const store = {
	    // === State getters ===
	    get components() { return components },
	    get lifecycle() { return lifecycle },
	    get runtime() {
	      return { activeIds, dirtyIds, lastPersistedAt }
	    },
	    get persistState() { return persistState },
	    get persistScheduler() { return persistScheduler },
	    get listeners() { return listeners },

    // === Read actions ===
    getComponentState<T>(componentId: string): T | null {
      return (components.get(componentId)?.state as T) ?? null
    },

    getComponent(componentId: string) {
      return components.get(componentId) ?? null
    },

    getAllComponents(): Array<{ id: string } & DurableComponentState> {
      // Return components WITH their IDs (needed for persistence)
      return Array.from(components.entries()).map(([id, comp]) => ({
        id,
        ...comp
      }))
    },

    // === Write actions ===
    updateComponentState<T = Record<string, unknown>>(
      componentId: string,
      update: StateUpdate<T>  // Supports both object patch and functional update
    ) {
      const component = components.get(componentId)
      if (!component) return

      // Handle functional update: (prev) => patch
      const patch = typeof update === 'function'
        ? update(component.state as T)
        : update

	      component.state = { ...component.state, ...patch }
	      dirtyIds.add(componentId)
	      if (persistState.inFlight) {
	        persistState.pendingChanges.add(componentId)
	      }
	      persistScheduler.scheduleDebounced()
	
	      notify()
	    },

    updateComponentPosition(componentId: string, position: { x: number; y: number }) {
      const component = components.get(componentId)
      if (!component) return

	      component.position = position
	      dirtyIds.add(componentId)
	      if (persistState.inFlight) {
	        persistState.pendingChanges.add(componentId)
	      }
	      persistScheduler.scheduleDebounced()
	
	      notify()
	    },

	    addComponent(componentId: string, component: DurableComponentState) {
	      components.set(componentId, component)
	      dirtyIds.add(componentId)
	      if (persistState.inFlight) {
	        persistState.pendingChanges.add(componentId)
	      }
	      persistScheduler.scheduleDebounced()

      void debugLog({
        component: 'WorkspaceComponentStore',
        action: 'component_added',
        metadata: { workspaceId, componentId, type: component.type }
      })

      notify()
    },

	    removeComponent(componentId: string) {
	      const had = components.delete(componentId)
	      activeIds.delete(componentId)
	      dirtyIds.add(componentId)  // Mark dirty so removal is persisted
	      if (persistState.inFlight) {
	        persistState.pendingChanges.add(componentId)
	      }
	      persistScheduler.scheduleDebounced()

      if (had) {
        void debugLog({
          component: 'WorkspaceComponentStore',
          action: 'component_removed',
          metadata: { workspaceId, componentId }
        })
        notify()
      }
    },

    // === Active tracking ===
    setActive(componentId: string, active: boolean) {
      const changed = active
        ? !activeIds.has(componentId) && (activeIds.add(componentId), true)
        : activeIds.delete(componentId)

      if (changed) {
        void debugLog({
          component: 'WorkspaceComponentStore',
          action: 'active_changed',
          metadata: { workspaceId, componentId, active, totalActive: activeIds.size }
        })
        notify()
      }
    },

    hasActiveOperations() {
      return activeIds.size > 0
    },

    getActiveIds() {
      return Array.from(activeIds)
    },

    // === Dirty tracking ===
    hasDirtyState() {
      return dirtyIds.size > 0
    },

    getDirtyIds() {
      return Array.from(dirtyIds)
    },

    clearDirty() {
      dirtyIds.clear()
    },

	    // === Persistence ===
	    setPersistCallback(cb: (
	      components: Array<{ id: string } & DurableComponentState>,
	      meta: { revision: number }
	    ) => Promise<void>) {
	      persistCallback = cb
	    },
	
	    async persist() {
	      // Lifecycle gate: no persist until restored/initialized
	      if (lifecycle !== 'ready' && lifecycle !== 'persisting') return
	
	      // If a persist is already in-flight, callers should await it (flushNow relies on this)
	      if (persistState.inFlightPromise) {
	        return persistState.inFlightPromise
	      }
	
	      if (!persistCallback || dirtyIds.size === 0) return
	
	      persistState.inFlight = true
	      lifecycle = 'persisting'
	
	      const runPersist = (async () => {
	        while (true) {
	          const revision = ++persistState.revision
	          const dirtySnapshot = new Set(dirtyIds)
	          persistState.pendingChanges.clear()
	
	          // Persist full snapshot (simple + safe); idempotency handled via revision (see Section 8)
	          const allComponents = store.getAllComponents()
	
	          void debugLog({
	            component: 'WorkspaceComponentStore',
	            action: 'persist_start',
	            metadata: { workspaceId, revision, dirtyCount: dirtySnapshot.size, totalCount: allComponents.length }
	          })
	
	          try {
	            await persistCallback(allComponents, { revision })
	
	            // Clear only what we know was dirty at snapshot time; preserve dirties that happened mid-flight.
	            for (const id of dirtySnapshot) dirtyIds.delete(id)
	            lastPersistedAt = Date.now()
	
	            persistState.lastError = null
	            persistState.retryCount = 0
	            persistState.health = persistState.health === 'degraded' ? 'recovering' : 'healthy'
	
	            void debugLog({
	              component: 'WorkspaceComponentStore',
	              action: 'persist_success',
	              metadata: { workspaceId, revision, persistedAt: lastPersistedAt }
	            })
	
	            if (persistState.pendingChanges.size === 0) {
	              // One successful write after degraded is enough to return to healthy.
	              if (persistState.health === 'recovering') persistState.health = 'healthy'
	              break
	            }
	          } catch (error) {
	            persistState.lastError = String(error)
	            persistState.retryCount += 1
	            persistState.health = persistState.retryCount >= 5 ? 'degraded' : 'retrying'
	            if (persistState.health === 'degraded' && persistState.degradedSince == null) {
	              persistState.degradedSince = Date.now()
	            }
	
	            void debugLog({
	              component: 'WorkspaceComponentStore',
	              action: 'persist_failed',
	              metadata: {
	                workspaceId,
	                revision,
	                error: String(error),
	                retryCount: persistState.retryCount,
	                health: persistState.health
	              }
	            })
	
	            // Best-effort retry with backoff (Section 8). Eviction must treat this workspace as protected.
	            setTimeout(() => void store.persist(), Math.min(1000 * 2 ** persistState.retryCount, 30000))
	            throw error
	          }
	        }
	      })()
	
	      persistState.inFlightPromise = runPersist
	      try {
	        await runPersist
	      } finally {
	        persistState.inFlight = false
	        persistState.inFlightPromise = null
	        if (lifecycle === 'persisting') lifecycle = 'ready'
	      }
	    },
	
	    restore(
	      restoredComponents: Array<{
	        id: string
	        type: string
	        schemaVersion?: number
	        position?: { x: number; y: number } | null
	        size?: { width: number; height: number } | null
	        zIndex?: number
	        metadata?: Record<string, unknown> | null
	      }>,
	      options: { restoreType: 'hot' | 'cold'; baseRevision?: number } = { restoreType: 'cold', baseRevision: 0 }
	    ) {
	      if (lifecycle === 'restoring') {
	        throw new Error('Restore already in progress')
	      }
	      if (lifecycle === 'ready' && options.restoreType === 'hot') {
	        // Hot restore: store already has state; do not overwrite.
	        return
	      }
	
	      lifecycle = 'restoring'
	
	      try {
	        // Seed revision from durable payload so idempotency works across reloads
	        const nextRevision = Math.max(persistState.revision, options.baseRevision ?? 0)
	
	        // Build into a temp map first; only swap in on success (avoids partial restore state)
	        const nextComponents = new Map<string, DurableComponentState>()
	
	        for (const comp of restoredComponents) {
	          const incomingSchemaVersion = comp.schemaVersion ?? 1
	          let schemaVersion = incomingSchemaVersion
	          let state = comp.metadata ?? {}
	
	          // Resolve/migrate/validate via the Component Type Registry (Section 13).
	          // Unknown or newer-schema payloads should be preserved opaque (no mutation).
	          const registry = getComponentTypeRegistryEntry(comp.type)  // Implementation detail
	          const isOpaque = !registry || incomingSchemaVersion > registry.schemaVersion
	
	          if (!isOpaque) {
	            schemaVersion = registry.schemaVersion
	            state = registry.migrate(incomingSchemaVersion, state)
	            state = registry.validate(state)
	
	            if (options.restoreType === 'cold') {
	              // Known/supported types: normalize “preserve state, not behavior”
	              state = registry.applyColdRestoreInvariant?.(state) ?? applyDeactivationInvariant(state)
	            }
	          }
	
	          nextComponents.set(comp.id, {
	            type: comp.type,
	            schemaVersion,
	            position: comp.position ?? { x: 0, y: 0 },
	            size: comp.size ?? null,
	            zIndex: comp.zIndex ?? 100,
	            state
	          })
	        }
	
	        // Apply swap-in
	        components.clear()
	        for (const [id, comp] of nextComponents) components.set(id, comp)
	        activeIds.clear()
	        dirtyIds.clear()
	        persistState.pendingChanges.clear()
	        persistState.revision = nextRevision
	        lifecycle = 'ready'
	
	        void debugLog({
	          component: 'WorkspaceComponentStore',
	          action: 'restore_complete',
	          metadata: {
	            workspaceId,
	            restoredCount: restoredComponents.length,
	            restoreType: options.restoreType,
	            baseRevision: nextRevision
	          }
	        })
	
	        notify()
	      } catch (error) {
	        lifecycle = 'error'
	        persistState.lastError = String(error)
	        void debugLog({
	          component: 'WorkspaceComponentStore',
	          action: 'restore_failed',
	          metadata: { workspaceId, error: String(error) }
	        })
	        notify()
	        throw error
	      }
	    },

    // === Eviction ===
    getEvictionPriority() {
      // Higher score = less likely to evict
      let score = 0

      // Active operations get high protection
      if (activeIds.size > 0) {
        score += 500
      }

      // Components with state get some protection
      if (components.size > 0) {
        score += 100
      }

      // Recency factored in externally (runtime-manager has lastVisibleAt)

      return score
    },

	    async prepareForEviction() {
	      if (lifecycle !== 'ready' && lifecycle !== 'persisting') {
	        return { canEvict: false, reason: `workspace_not_ready:${lifecycle}` }
	      }
	
	      const hadDirty = dirtyIds.size > 0
	
	      // Must be durable before eviction (persist-before-evict)
	      if (!persistCallback && hadDirty) {
	        return { canEvict: false, reason: 'persist_callback_not_set' }
	      }
	
	      try {
	        // Flush any in-flight/debounced persist so eviction doesn't race state durability.
	        await persistScheduler.flushNow()
	      } catch (error) {
	        return { canEvict: false, reason: `persist_failed:${String(error)}` }
	      }
	
	      void debugLog({
	        component: 'WorkspaceComponentStore',
	        action: 'prepared_for_eviction',
	        metadata: {
	          workspaceId,
	          hadDirty,
	          activeCount: activeIds.size,
	          persistHealth: persistState.health
	        }
	      })
	
	      return { canEvict: true }
	    },

    // === Option B: Headless Operations (intervals live in store, not components) ===

    startTimerOperation(componentId: string) {
      const compState = components.get(componentId)
      if (!compState || compState.state.isRunning) return

      // Interval owned by STORE - survives component unmount
      const intervalId = setInterval(() => {
        store.updateComponentState(componentId, (prev: Record<string, unknown>) => {
          const secs = (prev.seconds as number) ?? 0
          const mins = (prev.minutes as number) ?? 0
          if (secs > 0) return { seconds: secs - 1 }
          if (mins > 0) return { minutes: mins - 1, seconds: 59 }
          store.stopTimerOperation(componentId)
          return { isRunning: false }
        })
      }, 1000)

      activeOperations.set(componentId, intervalId)
      store.updateComponentState(componentId, { isRunning: true })
      store.setActive(componentId, true)
    },

    stopTimerOperation(componentId: string) {
      const intervalId = activeOperations.get(componentId)
      if (intervalId) {
        clearInterval(intervalId)
        activeOperations.delete(componentId)
      }
      store.updateComponentState(componentId, { isRunning: false })
      store.setActive(componentId, false)
    },

    stopAllOperations() {
      // CRITICAL: Called by deleteWorkspaceComponentStore before deletion
      // Prevents interval leaks when workspace is evicted
      for (const [componentId, intervalId] of activeOperations) {
        clearInterval(intervalId)
        void debugLog({
          component: 'WorkspaceComponentStore',
          action: 'stopped_operation_on_delete',
          metadata: { workspaceId, componentId }
        })
      }
      activeOperations.clear()
      activeIds.clear()
    },

    // === Subscriptions ===
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    getSnapshot() {
      return store
    }
	  }
	
	  // Debounced persistence scheduler (Section 7 / Phase 3)
	  persistScheduler = createPersistScheduler(store)
	
	  return store
	}
```

**Tasks:**
- [ ] Create `lib/workspace/workspace-store-types.ts`
- [ ] Create `lib/workspace/workspace-component-store.ts`
- [ ] Add Component Type Registry (schema, validation, migrations, cold-restore normalization)
- [ ] Add `schemaVersion` handling in restore + persistence payload mapping
- [ ] Add unit tests for store operations
- [ ] Add unit tests for dirty tracking
- [ ] Add unit tests for active tracking
- [ ] Add unit tests for schema migration + unknown type preservation

---

### Phase 2: React Hooks for Components

**Files to create:**
- `lib/hooks/use-workspace-component-store.ts` - React bindings

**Hook Implementation:**

```typescript
// lib/hooks/use-workspace-component-store.ts

import { useSyncExternalStore, useCallback } from 'react'
import { getWorkspaceComponentStore } from '@/lib/workspace/workspace-component-store'

/**
 * Subscribe to workspace component store with selector.
 * Only re-renders when selected value changes.
 */
export function useWorkspaceComponentStore<T>(
  workspaceId: string | null | undefined,
  selector: (store: WorkspaceComponentStore) => T
): T | null {
  const store = workspaceId ? getWorkspaceComponentStore(workspaceId) : null

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!store) return () => {}
      return store.subscribe(onStoreChange)
    },
    [store]
  )

  const getSnapshot = useCallback(() => {
    if (!store) return null
    return selector(store.getSnapshot())
  }, [store, selector])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Get component state from workspace store.
 * Convenience wrapper for common use case.
 */
export function useComponentState<T = Record<string, unknown>>(
  workspaceId: string | null | undefined,
  componentId: string
): T | null {
  return useWorkspaceComponentStore(
    workspaceId,
    useCallback(store => store.getComponentState<T>(componentId), [componentId])
  )
}

/**
 * Get workspace store actions.
 * Actions are stable references (don't cause re-renders).
 */
export function useWorkspaceStoreActions(workspaceId: string | null | undefined) {
  const store = workspaceId ? getWorkspaceComponentStore(workspaceId) : null

  return {
    updateComponentState: useCallback(
      (componentId: string, patch: Record<string, unknown>) => {
        store?.updateComponentState(componentId, patch)
      },
      [store]
    ),

    updateComponentPosition: useCallback(
      (componentId: string, position: { x: number; y: number }) => {
        store?.updateComponentPosition(componentId, position)
      },
      [store]
    ),

    setActive: useCallback(
      (componentId: string, active: boolean) => {
        store?.setActive(componentId, active)
      },
      [store]
    ),

    addComponent: useCallback(
      (componentId: string, component: DurableComponentState) => {
        store?.addComponent(componentId, component)
      },
      [store]
    ),

    removeComponent: useCallback(
      (componentId: string) => {
        store?.removeComponent(componentId)
      },
      [store]
    ),
  }
}

/**
 * Check if workspace has active operations.
 * Used for eviction decisions.
 */
export function useWorkspaceHasActiveOperations(
  workspaceId: string | null | undefined
): boolean {
  return useWorkspaceComponentStore(
    workspaceId,
    useCallback(store => store.hasActiveOperations(), [])
  ) ?? false
}
```

**Tasks:**
- [ ] Create `lib/hooks/use-workspace-component-store.ts`
- [ ] Add tests for selector-based subscriptions
- [ ] Verify minimal re-renders with React DevTools

---

### Phase 3: Persistence Integration

**Files to modify/create:**
- `lib/hooks/annotation/workspace/use-workspace-persistence.ts`
- `lib/hooks/annotation/workspace/use-workspace-snapshot.ts`
- `lib/workspace/persist-scheduler.ts` (new helper attached to store)

**Connect store to existing persistence:**

```typescript
// In workspace initialization (use-workspace-snapshot.ts or similar)

// When workspace is created/selected:
const store = getWorkspaceComponentStore(workspaceId)
store.setPersistCallback(async (componentsWithIds, meta) => {
  // componentsWithIds is Array<{ id: string } & DurableComponentState>
  // (store includes the ID when calling persist callback)
  await persistWorkspacePayload(workspaceId, {
    ...existingPayload,
    // Persist monotonic revision to prevent out-of-order overwrites
    revision: meta.revision,
    components: componentsWithIds.map(c => ({
      id: c.id,           // ID included by store
      type: c.type,
      schemaVersion: c.schemaVersion ?? 1,
      position: c.position,
      size: c.size,
      zIndex: c.zIndex,
      metadata: c.state   // Durable state → metadata in DB
    }))
  })
})

// When workspace payload is loaded from DB:
const store = getWorkspaceComponentStore(workspaceId)
// Cold restore: loaded from DB after eviction/reload
store.restore(payload.components ?? [], { restoreType: 'cold', baseRevision: payload.revision ?? 0 })
```

**Event-driven persistence (NOT interval-based):**

See Section 7 for full rationale. Summary:

```typescript
// lib/workspace/persist-scheduler.ts

import { debounce } from 'lodash'

	export function createPersistScheduler(store: WorkspaceComponentStore) {
	  // Debounced persist (waits for burst of changes to settle)
	  const debouncedPersist = debounce(() => {
	    void store.persist()
	  }, 1000)
	
	  const scheduleDebounced = () => debouncedPersist()
	  const cancelDebounced = () => debouncedPersist.cancel()
	
	  // Immediate flush (cancels debounce, persists now)
	  const flushNow = async () => {
	    cancelDebounced()
	    await store.persist()
	  }
	
	  return { scheduleDebounced, cancelDebounced, flushNow }
	}

// Usage in store - called automatically on dirty:
updateComponentState(id, patch) {
  // ... update logic
  this.dirtyIds.add(id)
  this.persistScheduler.scheduleDebounced()  // Auto-scheduled
}

// Usage in app - flush on critical events:
onWorkspaceSwitch(fromId, toId) {
  const store = getWorkspaceComponentStore(fromId)
  await store.persistScheduler.flushNow()  // Immediate
}

onBeforeUnload() {
  // Flush all dirty stores
  for (const store of getAllWorkspaceStores()) {
    store.persistScheduler.flushNow()  // Best effort
  }
}
```

**Why NOT interval:**
- Intervals throttled in background tabs (1000ms+)
- Intervals can miss if component unmounts
- Creates "works only when running" symptom we're fixing

**Tasks:**
- [ ] Connect store to persistence layer
- [ ] Implement event-driven persist scheduler (debounce + flush)
- [ ] Wire flushNow to workspace switch, eviction, beforeunload
- [ ] Implement revision idempotency at DB boundary (reject stale writes)
- [ ] Track persist health (`healthy|retrying|degraded|recovering`) and surface a UI indicator
- [ ] Add backpressure hooks (limits) for prolonged persist failure
- [ ] Optional: local durable queue for snapshots (replay on recovery)
- [ ] Test restore from DB payload
- [ ] Test persist to DB

---

### Phase 4: Eviction Integration

**Files to modify:**
- `lib/workspace/runtime-manager.ts`
- `lib/hooks/annotation/use-note-workspace-runtime-manager.ts` (current eviction entry point)
- `lib/hooks/annotation/workspace/use-workspace-hydration.ts`
- `lib/hooks/annotation/workspace/use-workspace-selection.ts`
- `lib/hooks/annotation/workspace/use-workspace-snapshot.ts`

**Integration with existing hooks (eliminating hot/cold misclassification):**

The current bug ("timer shows 5:00 instead of actual time") happens because:
1. Workspace switches → hydration hook runs
2. Hook checks if runtime exists → YES (hot path)
3. Hook reads component state from `useRuntimeComponents` → STALE React state
4. Stale state overwrites correct store state

**Fix: Store is authoritative, hooks coordinate through it:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    INTEGRATION COORDINATION                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  HOOK                        BEFORE (bug)         AFTER (fixed)      │
│  ─────────────────────────────────────────────────────────────────  │
│  use-workspace-hydration     Reads from runtime   Reads from store   │
│                              ledger (stale)       (authoritative)    │
│                                                                      │
│  use-workspace-selection     Sets visible flag    Also flushes store │
│                              on runtime           persist on switch  │
│                                                                      │
│  use-workspace-snapshot      Captures from React  Captures from      │
│                              state (stale)        store directly     │
│                                                                      │
│  use-workspace-persistence   Writes payload with  Calls store        │
│                              snapshot data        persist() method   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Key integration changes:**

```typescript
// use-workspace-selection.ts - BEFORE switch away
const handleWorkspaceSwitch = async (fromId: string, toId: string) => {
  // NEW: Flush store before switching (persist-before-switch)
  const store = getWorkspaceComponentStore(fromId)
  await store.persistScheduler.flushNow()

  // Existing: Update visibility flags
  setWorkspaceVisible(fromId, false)
  setWorkspaceVisible(toId, true)
}

// use-workspace-hydration.ts - ON restore
const hydrateWorkspace = (workspaceId: string, payload: WorkspacePayload) => {
  const store = getWorkspaceComponentStore(workspaceId)

  // NEW: Determine restore type
  const restoreType = store.lifecycle === 'ready' ? 'hot' : 'cold'

  if (restoreType === 'hot') {
    // Store already has current state - DO NOT overwrite
    // Just mark workspace as visible
    return
  }

	  // Cold restore: Load from DB payload
	  store.restore(payload.components ?? [], { restoreType: 'cold', baseRevision: payload.revision ?? 0 })
	}

// use-workspace-snapshot.ts - buildPayloadFromSnapshot
const buildPayloadFromSnapshot = (workspaceId: string) => {
  // NEW: Read components from store (authoritative), not React state
  const store = getWorkspaceComponentStore(workspaceId)
  const components = store.getAllComponents()

  return {
    // ... other payload fields
    components: components.map(c => ({
      id: c.id,
      type: c.type,
      schemaVersion: c.schemaVersion ?? 1,
      position: c.position,
      size: c.size,
      zIndex: c.zIndex,
      metadata: c.state
    }))
  }
}
```

**Hot/Cold classification is now correct:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CLASSIFICATION FIX                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  BEFORE (bug):                                                       │
│    Runtime exists? → "hot" → Read from useRuntimeComponents (stale)  │
│                                                                      │
│  AFTER (fixed):                                                      │
│    Store.lifecycle === 'ready'? → "hot" → DON'T overwrite store     │
│    Store.lifecycle === 'uninitialized'? → "cold" → Load from DB     │
│                                                                      │
│  The store's lifecycle state is the SINGLE source of truth for      │
│  hot vs cold classification, not runtime existence.                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Update eviction logic (using hard rules + scoring from Section 10):**

```typescript
// In runtime-manager.ts

import { getWorkspaceComponentStore, deleteWorkspaceComponentStore } from './workspace-component-store'

// HARD RULES + SCORING (implements Section 10)
// Returns 'non-evictable' for workspaces that must NEVER be evicted
// Returns numeric score for evictable workspaces (lower = evict first)
function getEvictionPriority(workspaceId: string): number | 'non-evictable' {
  const store = getWorkspaceComponentStore(workspaceId)
  const runtime = getWorkspaceRuntime(workspaceId)

  // === HARD RULES - non-evictable ===
  if (isWorkspacePinned(workspaceId)) return 'non-evictable'
  if (runtime.isVisible) return 'non-evictable'
  // Cannot evict if persist failed and we have dirty state (would lose data)
  if (store.persistState?.lastError && store.hasDirtyState()) return 'non-evictable'

  // === PRIORITY SCORING - higher = less likely to evict ===
  let score = 0

  // Recency (0-100): older = lower score = evict first
  const age = Date.now() - runtime.lastVisibleAt
  const maxAge = 10 * 60 * 1000  // 10 minutes
  score += Math.max(0, 100 - (age / maxAge) * 100)

  // Active operations (+500): prefer evicting inactive
  if (store.hasActiveOperations()) {
    score += 500
  }

  // Default workspace (+1000): almost never evict
  if (defaultWorkspaceIds.has(workspaceId)) {
    score += 1000
  }

  // Has components with state (+200): prefer evicting empty
  if (store.components.size > 0) {
    score += 200
  }

  return score
}

// Select best candidate for eviction (respects hard rules)
function selectWorkspaceToEvict(): string | null {
  let bestCandidate: string | null = null
  let lowestScore = Infinity

  for (const workspaceId of listWorkspaceRuntimeIds()) {
    const priority = getEvictionPriority(workspaceId)

    // Skip non-evictable workspaces (hard rules)
    if (priority === 'non-evictable') continue

    // Find lowest score (most evictable)
    if (priority < lowestScore) {
      lowestScore = priority
      bestCandidate = workspaceId
    }
  }

  return bestCandidate
}

// Eviction flow: hard rules + persist-before-evict
// NOTE: This replaces the old evictLRURuntimeAsync which just used LRU
export const evictWorkspaceAsync = async (): Promise<string | null> => {
  // Use selectWorkspaceToEvict (NOT getLeastRecentlyVisibleRuntimeId)
  // This respects hard rules: pinned, visible, persist-failed are non-evictable
  const targetId = selectWorkspaceToEvict()
  if (!targetId) {
    // All workspaces are non-evictable - cannot evict anything
    void debugLog({
      component: 'RuntimeManager',
      action: 'eviction_blocked',
      metadata: { reason: 'all_workspaces_non_evictable' }
    })
    return null
  }

	  // Prepare store for eviction (persists dirty state)
	  const store = getWorkspaceComponentStore(targetId)
	  const prep = await store.prepareForEviction()
	  if (!prep.canEvict) {
	    void debugLog({
	      component: 'RuntimeManager',
	      action: 'eviction_blocked',
	      metadata: { workspaceId: targetId, reason: prep.reason ?? 'prepare_for_eviction_failed' }
	    })
	    return null
	  }

  // Then remove runtime
  await removeWorkspaceRuntimeAsync(targetId, 'eviction_capacity')

  // Clean up store (stops all headless operations)
  deleteWorkspaceComponentStore(targetId)

  return targetId
}
```

**Refactoring `use-note-workspace-runtime-manager.ts`:**

The current eviction entry point is in `use-note-workspace-runtime-manager.ts`. This hook currently:
1. Monitors workspace count
2. Calls `evictLRURuntimeAsync()` when over capacity

**After Phase 4, it should:**
1. Call `evictWorkspaceAsync()` instead (uses hard rules + scoring)
2. Handle the `null` return case (all workspaces non-evictable)

```typescript
// In use-note-workspace-runtime-manager.ts

// BEFORE (bug-prone):
if (workspaceCount > MAX_WORKSPACES) {
  await evictLRURuntimeAsync()  // Just LRU, no hard rules
}

// AFTER (respects hard rules):
if (workspaceCount > MAX_WORKSPACES) {
  const evictedId = await evictWorkspaceAsync()  // Hard rules + scoring
  if (!evictedId) {
    // All workspaces are non-evictable (pinned, visible, or persist-failed)
    // Options: warn user, increase capacity temporarily, or wait
    console.warn('Cannot evict: all workspaces are protected')
  }
}
```

**Tasks:**
- [ ] Implement `getEvictionPriority()` with hard rules (Section 10)
- [ ] Implement `selectWorkspaceToEvict()` that respects non-evictable
- [ ] Replace `evictLRURuntimeAsync` with `evictWorkspaceAsync` (hard rules + scoring)
- [ ] Refactor `use-note-workspace-runtime-manager.ts` to call `evictWorkspaceAsync`
- [ ] Implement persist-before-evict in eviction flow
- [ ] Apply degraded-mode policy (no silent eviction; enforce limits/backpressure under outage)
- [ ] Clean up component store when runtime is destroyed (calls `stopAllOperations`)
- [ ] Update `use-workspace-hydration.ts` to read from store and use `store.lifecycle` for hot/cold
- [ ] Update `use-workspace-selection.ts` to flush store on workspace switch
- [ ] Update `use-workspace-snapshot.ts` to read components from store (not React state)
- [ ] Remove hot/cold classification based on "runtime exists" (use store.lifecycle instead)
- [ ] Test eviction with active components (should evict inactive first)
- [ ] Test eviction with dirty state (should persist before evict)
- [ ] Test eviction when all workspaces non-evictable (returns null, logs warning)
- [ ] Test hot restore (switch away and back) preserves running timer
- [ ] Test cold restore (evict and reload) stops timer correctly

---

### Phase 5: Migrate Components

**Files to modify:**
- `components/canvas/components/timer.tsx`
- `components/canvas/components/calculator.tsx`
- `components/canvas/components/sticky-note.tsx`

**Timer Migration (example - Option B: headless ops in store):**

```typescript
// components/canvas/components/timer.tsx

"use client"

import React from 'react'
import { Timer as TimerIcon, Play, Pause, RotateCcw } from 'lucide-react'
import { useComponentState, useWorkspaceStoreActions } from '@/lib/hooks/use-workspace-component-store'

interface TimerProps {
  componentId: string
  workspaceId: string
}

interface TimerState {
  minutes: number
  seconds: number
  isRunning: boolean
  inputMinutes: string
}

const DEFAULT_STATE: TimerState = {
  minutes: 5,
  seconds: 0,
  isRunning: false,
  inputMinutes: '5'
}

export function Timer({ componentId, workspaceId }: TimerProps) {
  // Subscribe to this component's state from workspace store
  const state = useComponentState<TimerState>(workspaceId, componentId) ?? DEFAULT_STATE
  const { minutes, seconds, isRunning, inputMinutes } = state

  // Get stable action references - includes headless timer operations
  // OPTION B: Interval runs in STORE, not component - survives unmount
  const {
    updateComponentState,
    startTimerOperation,   // Store-owned interval (see Section 9)
    stopTimerOperation,    // Clears store-owned interval
  } = useWorkspaceStoreActions(workspaceId)

  // NO intervalRef here! NO useEffect for interval!
  // Option B: Timer tick logic lives in workspace-component-store.ts
  // via startTimerOperation() - see Section 9 for implementation

  const handleStart = () => {
    if (minutes === 0 && seconds === 0) {
      const mins = parseInt(inputMinutes) || 5
      updateComponentState(componentId, { minutes: mins, seconds: 0 })
    }
    // Start interval in STORE (not component) - survives unmount/virtualization
    startTimerOperation(componentId)
  }

  const handlePause = () => {
    // Stop interval in STORE
    stopTimerOperation(componentId)
  }

  const handleReset = () => {
    const mins = parseInt(inputMinutes) || 5
    stopTimerOperation(componentId)
    updateComponentState(componentId, { minutes: mins, seconds: 0 })
  }

  const formatTime = (mins: number, secs: number) => {
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  // PURELY PRESENTATIONAL - just displays store state
  // Timer ticks happen in workspace-component-store.ts
  // This component can unmount/remount without affecting the timer
  // ... rest of render unchanged
}
```

**Key changes per component:**
1. Remove `useState` for persisted state
2. Remove `useComponentRegistration`
3. Remove `useThrottledComponentState`
4. Use `useComponentState` to read from store
5. Use `useWorkspaceStoreActions` to write to store
6. Call `setActive` for background operations
7. Keep ephemeral state (refs, focus) as local

**Tasks:**
- [ ] Migrate Timer component
- [ ] Migrate Calculator component
- [ ] Migrate StickyNote component
- [ ] Test each component in isolation
- [ ] Test persistence round-trip (add → reload → verify state)
- [ ] Test eviction protection (active timer prevents low-priority eviction)

---

### Phase 6: Remove Legacy Code

**Files to modify/remove:**
- Remove `useComponentRegistration` from migrated components
- Remove `useThrottledComponentState` from migrated components
- Simplify `use-runtime-components.ts` (may become unnecessary)
- Update `annotation-canvas-modern.tsx` to read from component store

**Tasks:**
- [ ] Remove deprecated hook usages from components
- [ ] Update canvas to read components from store
- [ ] Remove or deprecate old hooks
- [ ] Update tests
- [ ] Clean up imports

---

## Migration Strategy

### Incremental Rollout

1. **Phase 1-2**: Build store infrastructure (no user-facing changes)
2. **Phase 3**: Connect persistence (hidden behind feature flag)
3. **Phase 4**: Update eviction (can coexist with old system)
4. **Phase 5**: Migrate one component at a time (Timer first as it has the bug)
5. **Phase 6**: Clean up after all components migrated

### Feature Flag

```typescript
// In environment or config
NEXT_PUBLIC_WORKSPACE_STATE_MACHINE=true

// In components
const useNewStore = process.env.NEXT_PUBLIC_WORKSPACE_STATE_MACHINE === 'true'

if (useNewStore) {
  // New store-based implementation
} else {
  // Old implementation (temporary)
}
```

### Rollback Plan

1. Feature flag allows instant rollback
2. Old hooks remain until Phase 6
3. DB schema unchanged (same `components` array in payload; adds optional `schemaVersion` per component and `revision` at workspace payload level)

---

## Acceptance Criteria

### Functional
- [ ] Timer state persists correctly across workspace switches
- [ ] Calculator state persists correctly across workspace switches
- [ ] StickyNote state persists correctly across workspace switches
- [ ] Active timer protects workspace from low-priority eviction
- [ ] Dirty state is persisted before eviction
- [ ] Components only re-render when their state changes

### Hot vs Cold Restore
- [ ] **Hot switch:** Timer running → switch workspace → switch back → Timer still running (continued)
- [ ] **Hot switch:** Timer at 3:57 → switch away 30s → switch back → Timer at 3:27 (kept ticking)
- [ ] **Cold restore (eviction):** Timer running → evict → restore → Timer PAUSED at last persisted time
- [ ] **Cold restore (reload):** Timer running → page reload → Timer PAUSED at last persisted time
- [ ] **Cold restore invariant:** isRunning=true in DB → cold restore → isRunning=false in component
- [ ] **Durable anchor opt-in:** Component with startedAtTimestamp can resume after cold restore (future)

### Performance
- [ ] No unnecessary re-renders (verify with React DevTools)
- [ ] Persist operations batched (not per-keystroke)
- [ ] Store operations are O(1) for single component access
- [ ] Scale sanity: 50+ components in one workspace remains responsive

### Reliability
- [ ] No stale state bugs (the original issue)
- [ ] Eviction never loses unsaved state
- [ ] System doesn't deadlock when all workspaces active
- [ ] Degraded mode is user-visible when persistence is failing
- [ ] No silent eviction when state cannot be made durable (DB or local durable queue)

### Exact Failing Case (Must Pass)

This is the specific bug that triggered this entire architecture redesign. It MUST pass:

```
┌─────────────────────────────────────────────────────────────────────┐
│  TEST: Default workspace state survives 5+ notes-only workspaces    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Setup:                                                              │
│    1. Open default workspace (Workspace 1)                           │
│    2. Add Timer component, start it (e.g., 5:00 → running)          │
│    3. Add Calculator component, enter value (e.g., "42")            │
│    4. Add Note with some text                                        │
│    5. Timer is now at ~4:30 (still running)                         │
│                                                                      │
│  Action:                                                             │
│    6. Create Workspace 2 (notes only, no components)                │
│    7. Create Workspace 3 (notes only)                                │
│    8. Create Workspace 4 (notes only)                                │
│    9. Create Workspace 5 (notes only)                                │
│    10. Create Workspace 6 (notes only)                               │
│    11. Switch back to Workspace 1 (default)                          │
│                                                                      │
│  Expected (MUST ALL PASS):                                           │
│    - [ ] Timer shows accurate time (~3:00 if 1.5min elapsed)        │
│    - [ ] Timer is still running (not reset to 5:00, not paused)     │
│    - [ ] Calculator displays "42" (not reset to "0")                │
│    - [ ] Note text is preserved                                      │
│    - [ ] All component positions unchanged                           │
│                                                                      │
│  Why this failed before:                                             │
│    - Creating 5+ workspaces triggered eviction                       │
│    - Default workspace was evicted despite having active timer      │
│    - On restore, stale state from React hook was used               │
│    - Timer showed 5:00 (default) instead of actual time             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Variations to also test:**
- [ ] Same scenario but with workspace eviction (force evict default, then restore)
- [ ] Same scenario but with page reload after step 5
- [ ] Same scenario but switching rapidly between workspaces
- [ ] Same scenario but with persist failing (network error) - should NOT lose state

### No Running Components Variant (Also Must Pass)

This variant tests state preservation when **nothing is actively running**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  TEST: State preserved with NO active/running components            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Setup:                                                              │
│    1. Open default workspace (Workspace 1)                           │
│    2. Add Timer component, set to 3:00, but DO NOT start it         │
│    3. Add Calculator component, enter "42"                          │
│    4. Add Note with text "Important note"                            │
│    5. (No background operations running - all components idle)       │
│                                                                      │
│  Action:                                                             │
│    6. Create Workspace 2 (notes only)                                │
│    7. Create Workspace 3 (notes only)                                │
│    8. Create Workspace 4 (notes only)                                │
│    9. Create Workspace 5 (notes only)                                │
│    10. Create Workspace 6 (notes only)                               │
│    11. Switch back to Workspace 1                                    │
│                                                                      │
│  Expected (MUST ALL PASS):                                           │
│    - [ ] Timer shows 3:00 (not reset to default 5:00)               │
│    - [ ] Timer is NOT running (stayed stopped)                       │
│    - [ ] Calculator displays "42" (not reset to "0")                │
│    - [ ] Note text shows "Important note"                            │
│    - [ ] All component positions unchanged                           │
│                                                                      │
│  Why this matters:                                                   │
│    - No activeIds protection (nothing running)                       │
│    - Workspace may have lower eviction priority                      │
│    - Pure state persistence test without runtime complexity          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Edge Cases

- [ ] **Persist during restore:** If persist is triggered while restore is in progress, it should wait
- [ ] **Eviction during persist:** If eviction is triggered while persist is running, eviction should wait
- [ ] **Multiple rapid updates:** Timer ticking every second should not create 60 persists/minute
- [ ] **Component deleted then restored:** Deleted component should NOT reappear on restore
- [ ] **Empty workspace eviction:** Workspace with no components should evict cleanly
- [ ] **Bridge sync during migration:** Old and new systems should stay in sync
- [ ] **Unknown component type:** Preserve payload and layout; render placeholder; never drop data
- [ ] **Schema evolution:** Older schema migrates forward; newer schema stays opaque (no overwrite)
- [ ] **Prolonged persist failure:** Degraded mode applies backpressure; memory growth is bounded by limits

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing components | Feature flag + incremental migration |
| Performance regression | Selector-based subscriptions + profiling |
| Persist outage causes unbounded memory | Degraded mode + backpressure + hard limits; optional local durable queue |
| Schema migration bugs | Forward-only migrations + fixtures for old payloads + feature flag |
| Unknown/new component types | Opaque preservation + placeholder UI; never drop data |
| Store complexity growth | Component Type Registry keeps store core generic |
| Data loss during migration | Same DB schema, no migration needed |
| Complex rollback | Keep old code until fully validated |

---

## Timeline Estimate

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1 | Core store | Foundation work |
| Phase 2 | React hooks | Build on Phase 1 |
| Phase 3 | Persistence | Integration work |
| Phase 4 | Eviction | Integration work |
| Phase 5 | Component migration | Per-component |
| Phase 6 | Cleanup | After validation |

---

## Files Summary

**New files:**
- `lib/workspace/workspace-store-types.ts`
- `lib/workspace/workspace-component-store.ts`
- `lib/workspace/component-type-registry.ts`
- `lib/workspace/persist-scheduler.ts`
- `lib/workspace/store-bridge.ts` (migration compatibility layer)
- `lib/hooks/use-workspace-component-store.ts`

**Modified files:**
- `lib/workspace/runtime-manager.ts`
- `lib/hooks/annotation/workspace/use-workspace-persistence.ts`
- `lib/hooks/annotation/workspace/use-workspace-snapshot.ts`
- `components/canvas/components/timer.tsx`
- `components/canvas/components/calculator.tsx`
- `components/canvas/components/sticky-note.tsx`
- `components/annotation-canvas-modern.tsx`

**Potentially deprecated:**
- `lib/hooks/use-component-registration.ts`
- `lib/hooks/use-throttled-component-state.ts`
- `lib/hooks/use-runtime-components.ts` (simplified or removed)
