# Workspace Eviction & Restoration Architecture

**Date:** 2025-12-13
**Status:** Architecture Plan
**Priority:** High
**Related:** `2025-12-13-long-term-workspace-restore-hot-classification-persistence-gating-component-sync.patch`

---

## Executive Summary

This document describes the architecture for seamless workspace eviction and restoration using database persistence as the source of truth. This eliminates the need for workspace/dashboard pinning to keep components "running" in the background.

---

## Problem Statement

### Current Approach (Pinning)

Users must **pin workspaces and dashboards** to keep components (Timer, Calculator, etc.) running in the background.

**Issues with pinning:**

| Problem | Impact |
|---------|--------|
| Memory inefficient | Pinned workspaces keep React components mounted |
| Poor scalability | Memory grows with number of pinned workspaces |
| Manual management | Users must decide what to pin |
| Outdated pattern | Not how modern applications work |

### Desired Behavior

> **Whatever state the component is in when the user leaves = exactly what should be restored when they return.**

- Timer running at 5:30 → returns → Timer running (with correct elapsed time)
- Timer stopped at 3:00 → returns → Timer stopped at 3:00
- Calculator showing "123" → returns → Calculator showing "123"
- Any component, any state → Exact same state restored

---

## Architecture Overview

### Core Principle

> **Database is the source of truth, not in-memory pinned components.**

Eviction ≠ Data Loss. Eviction = move from memory to database.

### Visual Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                       MEMORY (Limited Cap)                      │
│                                                                 │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐          │
│   │ Workspace A │   │ Workspace B │   │ Workspace C │   (cap)  │
│   │   (active)  │   │   (recent)  │   │   (recent)  │          │
│   │             │   │             │   │             │          │
│   │ Timer: 5:30 │   │ Calc: "42"  │   │ Note: text  │          │
│   │ isRunning:T │   │             │   │             │          │
│   └─────────────┘   └─────────────┘   └─────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
         │                                          ▲
         │ EVICT                                    │ ACTIVATE
         │ (persist to DB)                          │ (restore from DB)
         ▼                                          │
┌─────────────────────────────────────────────────────────────────┐
│                     DATABASE (Unlimited)                        │
│                                                                 │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ...    │
│   │ Workspace D │   │ Workspace E │   │ Workspace F │          │
│   │  (evicted)  │   │  (evicted)  │   │  (evicted)  │          │
│   │             │   │             │   │             │          │
│   │ Timer: 3:00 │   │ Calc: "99"  │   │ Note: data  │          │
│   │ isRunning:F │   │             │   │             │          │
│   └─────────────┘   └─────────────┘   └─────────────┘          │
│                                                                 │
│   note_workspaces table:                                        │
│   - payload.components[].metadata = component state             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Detailed Flow

### Flow 1: Workspace Eviction

```
User has 5 workspaces open (at memory cap)
         │
         ▼
User opens 6th workspace
         │
         ▼
System identifies oldest/least-used workspace (Workspace D)
         │
         ▼
┌─────────────────────────────────────────┐
│ EVICTION PROCESS                        │
│                                         │
│ 1. Capture current component states     │
│    - Timer: { minutes: 3, seconds: 0,   │
│              isRunning: false }         │
│    - Calculator: { display: "99" }      │
│                                         │
│ 2. Persist to database                  │
│    - UPDATE note_workspaces             │
│      SET payload = {...}                │
│      WHERE id = workspace_d_id          │
│                                         │
│ 3. Remove from memory                   │
│    - Unmount React components           │
│    - Clear runtime ledger               │
│    - Free memory                        │
└─────────────────────────────────────────┘
         │
         ▼
Workspace D is now "cold" (in DB only)
6th workspace loads into memory
```

### Flow 2: Workspace Activation (Restoration)

```
User clicks on evicted Workspace D
         │
         ▼
System detects workspace is "cold" (not in memory)
         │
         ▼
┌─────────────────────────────────────────┐
│ RESTORATION PROCESS                     │
│                                         │
│ 1. Load from database                   │
│    - SELECT payload FROM note_workspaces│
│      WHERE id = workspace_d_id          │
│                                         │
│ 2. Hydrate runtime ledger               │
│    - populateRuntimeComponents()        │
│    - Restore component metadata         │
│                                         │
│ 3. Mount React components               │
│    - ComponentPanel receives state      │
│    - Timer/Calculator initialize        │
│                                         │
│ 4. Sync component state (via useEffect) │
│    - Timer syncs: minutes, seconds,     │
│      isRunning from restored state      │
│    - Calculator syncs: display value    │
│                                         │
│ 5. Mark workspace as "hydrated"         │
│    - markWorkspaceHydrated()            │
└─────────────────────────────────────────┘
         │
         ▼
Workspace D is now "hot" (in memory)
Components display exact state from when evicted
```

### Flow 3: App Reload (Same as Activation)

```
User reloads browser / closes and reopens app
         │
         ▼
All workspaces are "cold" (nothing in memory)
         │
         ▼
User's last active workspace determined
         │
         ▼
RESTORATION PROCESS (same as Flow 2)
         │
         ▼
Workspace restored with exact component states
Timer resumes ticking if isRunning was true
```

---

## State Persistence Schema

### Database: `note_workspaces` table

```sql
payload JSONB = {
  "components": [
    {
      "id": "component-1234",
      "type": "timer",
      "position": { "x": 100, "y": 200 },
      "metadata": {
        "componentType": "timer",
        "minutes": 5,
        "seconds": 30,
        "isRunning": true,
        "inputMinutes": "5"
      }
    },
    {
      "id": "component-5678",
      "type": "calculator",
      "position": { "x": 300, "y": 200 },
      "metadata": {
        "componentType": "calculator",
        "display": "123",
        "previousValue": null,
        "operation": null
      }
    }
  ]
}
```

### Runtime Ledger (In-Memory)

```typescript
// lib/workspace/runtime-manager.ts

WorkspaceRuntime = {
  id: string,
  hydrationState: "unhydrated" | "hydrating" | "hydrated",
  components: Map<string, RuntimeComponent>,
  // ... other fields
}

RuntimeComponent = {
  id: string,
  componentType: string,
  metadata: Record<string, unknown>,  // Timer/Calculator state
  isActive: boolean,
}
```

---

## Component State Sync

### The Problem

Components initialize with default values before restoration completes:

```typescript
// Timer defaults
const [minutes, setMinutes] = useState(state?.minutes ?? 5)  // Default: 5
```

If `state` is undefined at mount time, Timer shows 5:00 instead of restored value.

### The Solution (Implemented in Patch)

Add useEffect to sync state when props arrive after mount:

```typescript
// components/canvas/components/timer.tsx

// Sync internal state if restored state arrives after mount
useEffect(() => {
  if (!state) return
  if (typeof state.minutes === "number") setMinutes(state.minutes)
  if (typeof state.seconds === "number") setSeconds(state.seconds)
  if (typeof state.isRunning === "boolean") setIsRunning(state.isRunning)
  if (typeof state.inputMinutes === "string") setInputMinutes(state.inputMinutes)
  else if (typeof state.minutes === "number") setInputMinutes(String(state.minutes))
}, [state?.minutes, state?.seconds, state?.isRunning, state?.inputMinutes])
```

This ensures:
- Component mounts (possibly with defaults)
- State arrives from DB restoration
- useEffect syncs internal state to restored values
- Component displays correct state

---

## Hot/Cold Classification

### Definitions

| State | Meaning |
|-------|---------|
| **Hot** | Workspace is in memory AND fully hydrated |
| **Cold** | Workspace is not in memory OR not hydrated |

### Classification Logic (Implemented in Patch)

```typescript
// lib/hooks/annotation/workspace/use-workspace-selection.ts

// BEFORE (buggy):
const targetRuntimeState = hasWorkspaceRuntime(workspaceId) ? "hot" : "cold"

// AFTER (fixed):
const targetRuntimeState = hasWorkspaceRuntime(workspaceId) && isWorkspaceHydrated(workspaceId) ? "hot" : "cold"
```

### Why This Matters

- **Hot workspace:** Skip DB fetch, use runtime state
- **Cold workspace:** Fetch from DB, hydrate, then use

If we incorrectly classify an unhydrated workspace as "hot", we skip DB fetch and lose state.

---

## Hydration State Tracking

### States

```typescript
type WorkspaceHydrationState = "unhydrated" | "hydrating" | "hydrated"
```

| State | Meaning |
|-------|---------|
| `unhydrated` | Runtime exists but no DB data loaded |
| `hydrating` | Currently loading from DB |
| `hydrated` | DB data fully loaded and applied |

### State Transitions

```
Workspace created → "unhydrated"
         │
         ▼
loadWorkspace() called → "hydrating"
         │
         ▼
Data applied successfully → "hydrated"
         │
         ▼
Error during load → restore previous state
```

### Functions (Implemented in Patch)

```typescript
// lib/workspace/runtime-manager.ts

markWorkspaceHydrating(workspaceId, source)   // Set to "hydrating"
markWorkspaceHydrated(workspaceId, source)    // Set to "hydrated"
markWorkspaceUnhydrated(workspaceId, source)  // Set to "unhydrated"
isWorkspaceHydrated(workspaceId)              // Check if "hydrated"
isWorkspaceHydrating(workspaceId)             // Check if "hydrating"
```

---

## Persistence Gating

### The Problem

If we persist during hydration, we capture default values instead of restored values.

```
Hydration starts → Timer mounts with default 5:00
                 → Persistence triggers → Saves 5:00 to DB ← WRONG!
                 → Restored state arrives (10:00) → Too late
```

### The Solution (Implemented in Patch)

Gate persistence during hydration:

```typescript
// lib/hooks/annotation/workspace/use-workspace-persistence.ts

const runtimeHydrating = liveStateEnabled && isWorkspaceHydrating(targetWorkspaceId)
if (runtimeHydrating || isHydratingRef.current || replayingWorkspaceRef.current > 0) {
  // Skip persistence - we're still loading
  return false
}
```

---

## Time-Elapsed Accuracy (Future Enhancement)

### Current Behavior

Timer freezes while workspace is evicted:
- Leave at 5:30 running → return after 2 min → shows 5:30

### Enhanced Behavior (Timestamp-Based)

Timer accounts for real elapsed time:
- Leave at 5:30 running → return after 2 min → shows 3:30

### Implementation Approach

```typescript
// Instead of storing remaining time:
{ minutes: 5, seconds: 30, isRunning: true }

// Store end timestamp:
{
  endTimestamp: 1702486800000,  // When timer should reach 0
  isRunning: true,
  pausedRemaining: null         // Only set when paused
}

// On restore:
if (isRunning) {
  const remaining = endTimestamp - Date.now()
  if (remaining <= 0) {
    // Timer finished while away
    setMinutes(0)
    setSeconds(0)
    setIsRunning(false)
    // Optionally trigger completion notification
  } else {
    setMinutes(Math.floor(remaining / 60000))
    setSeconds(Math.floor((remaining % 60000) / 1000))
  }
}
```

**Status:** Not yet implemented. Current patch provides freeze/restore behavior.

---

## Benefits of This Architecture

| Benefit | Description |
|---------|-------------|
| **Memory efficient** | Only active workspaces in memory |
| **Scalable** | Unlimited workspaces (DB is the limit) |
| **No manual management** | No pinning required |
| **Seamless UX** | User doesn't notice eviction/restoration |
| **Reliable** | DB persistence survives crashes/reloads |
| **Modern pattern** | Follows virtual memory / paging concepts |

---

## Implementation Status

### Implemented (via Patch)

- [x] ComponentState extraction from LayerManager fallback
- [x] Hydration state tracking (`unhydrated` → `hydrating` → `hydrated`)
- [x] Hot/cold classification fix
- [x] Persistence gating during hydration
- [x] Component sync useEffects (Timer, Calculator, StickyNote)
- [x] Runtime components sync on snapshot revision

### Not Yet Implemented

- [ ] Timestamp-based timer for real elapsed time
- [ ] Automatic eviction based on memory cap
- [ ] LRU (Least Recently Used) eviction policy

---

## Files Modified (by Patch)

| File | Change |
|------|--------|
| `components/annotation-canvas-modern.tsx` | componentState extraction, workspaceSnapshotRevision |
| `components/canvas/component-panel.tsx` | initialState sync effect |
| `components/canvas/components/timer.tsx` | State sync useEffect |
| `components/canvas/components/calculator.tsx` | State sync useEffect |
| `components/canvas/components/sticky-note.tsx` | State sync useEffect |
| `lib/workspace/runtime-manager.ts` | WorkspaceHydrationState, hydration functions |
| `lib/hooks/annotation/workspace/use-workspace-selection.ts` | Hot/cold fix |
| `lib/hooks/annotation/workspace/use-workspace-persistence.ts` | Persistence gating |
| `lib/hooks/annotation/workspace/use-workspace-hydration.ts` | Hydration state tracking |
| `lib/hooks/annotation/workspace/use-workspace-snapshot.ts` | Hydration state tracking |
| `lib/hooks/use-runtime-components.ts` | workspaceSnapshotRevision dependency |

---

## Testing Checklist

### Basic Persistence

- [ ] Timer set to 10:00 → switch workspace → return → shows 10:00
- [ ] Calculator shows "123" → switch workspace → return → shows "123"
- [ ] Running timer → switch → return → timer still running
- [ ] Stopped timer → switch → return → timer still stopped

### Eviction Scenario

- [ ] Create 5+ workspaces with components
- [ ] Switch between them (triggering eviction)
- [ ] Return to evicted workspace → state preserved

### App Reload

- [ ] Set timer to 10:00 running → reload app → timer resumes at ~10:00
- [ ] Set calculator to "456" → reload app → shows "456"

### Edge Cases

- [ ] Rapid workspace switching → no state loss
- [ ] Create workspace with only notes → switch → return → notes preserved
- [ ] Multiple components in one workspace → all states preserved

---

## Conclusion

This architecture eliminates the need for workspace pinning by treating the database as the authoritative source of truth. Workspaces can be freely evicted from memory and restored on-demand, with components resuming their exact state.

The implemented patch provides the foundation for this architecture. Future enhancements (timestamp-based timers, automatic eviction policies) can build on this foundation.
