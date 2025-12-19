# Phase 0: Dirty Sources Audit

**Date:** 2025-12-18
**Status:** Complete
**Parent Plan:** `2025-12-18-unified-workspace-durability-pipeline.md`

---

## Purpose

Before unifying dirty tracking into a single `isWorkspaceDirty(workspaceId)` decision, this audit documents
every current place that can create "dirty" durable state. This prevents accidental gaps where one domain
is not represented in the unified dirty decision.

---

## Domain 1: Notes/Panels (workspace-level dirty)

### Dirty Source: `workspaceDirtyRef`

**Location:** `lib/hooks/annotation/workspace/workspace-refs.ts:58`

```typescript
workspaceDirtyRef: MutableRefObject<Map<string, number>>
```

**Type:** `Map<workspaceId, timestamp>` — timestamp indicates when the workspace became dirty.

### How Dirty Is Set

**Primary setter:** `scheduleSave()` in `use-workspace-persistence.ts:1411-1414`

```typescript
// Mark workspace as dirty
if (!workspaceDirtyRef.current.has(workspaceId)) {
  workspaceDirtyRef.current.set(workspaceId, Date.now())
}
```

**Triggers that call `scheduleSave()`:**

| Trigger | File | Line | Reason |
|---------|------|------|--------|
| `currentWorkspaceSummary` changes | `use-note-workspaces.ts` | 1559-1573 | `state_change` |
| `panelSnapshotVersion` changes | `use-note-workspaces.ts` | 1576-1580 | `components_changed` |
| Manual flush | `use-workspace-persistence.ts` | 1453 | `manual_flush` |
| Immediate save request | `use-note-workspaces.ts` | 1824 | varies |

**Dependencies for `state_change` trigger:**
- `activeNoteId`
- `currentWorkspaceSummary`
- `openNotes`
- `canvasState?.translateX/translateY/zoom`
- `panelSnapshotVersion`

### How Dirty Is Cleared

| Condition | File | Line | Notes |
|-----------|------|------|-------|
| Successful persist | `use-workspace-persistence.ts` | 995 | `workspaceDirtyRef.current.delete(targetWorkspaceId)` |
| Successful persist (active) | `use-workspace-persistence.ts` | 1244 | `workspaceDirtyRef.current.delete(workspaceId)` |
| No changes (hash match) | `use-workspace-persistence.ts` | 947 | `workspaceDirtyRef.current.delete(targetWorkspaceId)` |
| No changes (hash match, active) | `use-workspace-persistence.ts` | 1224 | `workspaceDirtyRef.current.delete(workspaceId)` |

### NOT Cleared On

- Persist failure (dirty flag retained for retry)
- Component unmount (refs persist via hook lifecycle)

---

## Domain 2: Components (store-level dirty)

### Dirty Source: `dirtyIds` Set

**Location:** `lib/workspace/workspace-component-store.ts:101`

```typescript
const dirtyIds = new Set<string>()
```

**Type:** `Set<componentId>` — tracks which individual components have unsaved changes.

### How Dirty Is Set

**Setters:** Various update methods in `workspace-component-store.ts`

| Method | Line | Description |
|--------|------|-------------|
| `updateComponentState()` | 191 | `dirtyIds.add(componentId)` |
| `updateComponentPosition()` | 209 | `dirtyIds.add(componentId)` |
| `updateComponentSize()` | 227 | `dirtyIds.add(componentId)` |
| `updateComponentZIndex()` | 242 | `dirtyIds.add(componentId)` |
| `addComponent()` | 264 | `dirtyIds.add(componentId)` |
| `removeComponent()` | 293 | `dirtyIds.add(componentId)` (marks removal for persistence) |

**Additional tracking:**

```typescript
// Lines 193-195, 211-213, etc.
if (persistState.inFlight) {
  persistState.pendingChanges.add(componentId)
}
```

This tracks changes that arrive *during* an in-flight persist, ensuring they're persisted in a follow-up.

### How Dirty Is Cleared

| Condition | File | Line | Notes |
|-----------|------|------|-------|
| Successful persist (per-component) | `workspace-component-store.ts` | 409-411 | `dirtyIds.delete(id)` for each persisted ID |
| Full clear | `workspace-component-store.ts` | 352 | `dirtyIds.clear()` (exposed as `clearDirty()`) |
| Store deletion (eviction) | `workspace-component-store.ts` | 544 | `dirtyIds.clear()` in `deleteWorkspaceComponentStore()` |

### NOT Cleared On

- Persist failure (dirty IDs retained for retry)
- Lifecycle gate block (persist skipped if `lifecycle !== 'ready'`)

---

## Domain 3: Schedulers / Flush Paths

### Notes/Panels Scheduler

**Location:** `use-workspace-persistence.ts:1393-1448` (`scheduleSave`)

**Behavior:**
- Debounced (2500ms default)
- Marks dirty immediately, persists after debounce
- `immediate: true` bypasses debounce

**Flush paths:**

| Path | Trigger | Marks Dirty First? |
|------|---------|-------------------|
| `scheduleSave({ immediate: true })` | Manual immediate save | Yes |
| `flushPendingSave()` | `beforeunload`, `visibility_hidden` | No (persists existing dirty) |
| `persistWorkspaceById()` | Direct persist call | No (assumes already dirty or skip-if-clean) |

### Components Scheduler

**Location:** `lib/workspace/persist-scheduler.ts`

**Behavior:**
- Debounced (separate from notes/panels scheduler)
- Each mutation calls `persistScheduler.scheduleDebounced()`
- `dirtyIds.add()` happens synchronously before scheduling

**Flush paths:**

| Path | Trigger | Marks Dirty First? |
|------|---------|-------------------|
| `store.persist()` | Direct call | No (reads from `dirtyIds`) |
| `flushWorkspaceState()` | Pre-eviction callback | No (calls `store.persist()`) |
| `preEvictionPersistCallback()` | Runtime manager eviction | No (calls `flushWorkspaceState()`) |

---

## Gap Analysis: What Could Be Missed?

### Gap 1: Two Independent Dirty Checks

**Problem:** Eviction currently checks only one domain at a time.

- `workspaceDirtyRef.current.get(workspaceId)` — Notes/panels dirty
- `store.hasDirtyState()` via `workspaceHasDirtyState()` — Components dirty

If eviction logic checks only notes/panels dirty, components may be lost. If it checks only components,
notes/panels may be lost.

**Current state:** The runtime manager's `evictWorkspaceRuntime()` uses `workspaceDirtyRef` from the hook,
and separately fires `preEvictionPersistCallback()` which flushes component state. These are not unified.

### Gap 2: Scheduler Timing Divergence

**Problem:** Notes/panels use a 2500ms debounce via `scheduleSave()`. Components use a separate scheduler
in `persist-scheduler.ts`. These can fire at different times, creating windows where one domain is persisted
but not the other.

### Gap 3: Lifecycle State Divergence

**Problem:** Component store has explicit lifecycle gates (`lifecycle !== 'ready'` blocks persist).
Notes/panels uses `isHydratingRef` and `replayingWorkspaceRef` as guards. These are not synchronized.

A workspace could be:
- Notes/panels: "ready to persist" (hydration complete)
- Components: "restoring" (lifecycle not yet `ready`)

Or vice versa.

### Gap 4: False Dirty on Entry Re-entry

**Problem:** When user switches away and back (annotation → home → annotation), the component remounts.
The `useEffect` with `currentWorkspaceSummary` dependency fires, calling `scheduleSave()`, which sets
`workspaceDirtyRef` — even though nothing actually changed.

This creates a "false dirty" window where:
1. Dirty flag is set
2. Revision is not yet loaded (empty string)
3. Eviction triggers persist
4. Persist fails with REVISION_MISMATCH
5. User sees spurious error toast

---

## Unified Dirty Decision (Recommendation)

To implement Phase 4 of the unified pipeline, create:

```typescript
/**
 * Unified dirty check for workspace durability.
 * Returns true if ANY durable domain has unsaved changes.
 */
function isWorkspaceDirty(workspaceId: string): boolean {
  // Domain 1: Notes/Panels
  const notesPanelsDirty = workspaceDirtyRef.current.has(workspaceId)

  // Domain 2: Components
  const componentsDirty = workspaceHasDirtyState(workspaceId)

  return notesPanelsDirty || componentsDirty
}
```

This function should be:
- Used by hard-safe eviction gating
- Used by persistence scheduler decisions
- Used by degraded-mode heuristics

---

## Clearing Conditions Summary

| Domain | Dirty Set By | Cleared By |
|--------|-------------|------------|
| Notes/Panels | `scheduleSave()` | Successful persist OR no-changes hash match |
| Components | Any mutation method (`updateComponentState`, etc.) | Successful persist (per-component) OR store deletion |

**Important:** Neither domain clears dirty on failure. This is correct behavior — it ensures retry.

---

## Files Referenced

- `lib/hooks/annotation/workspace/workspace-refs.ts` — `workspaceDirtyRef` definition
- `lib/hooks/annotation/workspace/use-workspace-persistence.ts` — `scheduleSave`, `persistWorkspaceById`
- `lib/hooks/annotation/use-note-workspaces.ts` — `scheduleSave` triggers
- `lib/workspace/workspace-component-store.ts` — `dirtyIds`, mutation methods, `persist()`
- `lib/workspace/persist-scheduler.ts` — Component persist scheduler
- `lib/workspace/store-runtime-bridge.ts` — `workspaceHasDirtyState()`, `flushWorkspaceState()`

---

## Acceptance Criteria

- [x] Documented list of dirty sources for Notes/Panels domain
- [x] Documented list of dirty sources for Components domain
- [x] Documented clearing conditions for each source
- [x] Identified schedulers/flush paths
- [x] Gap analysis for unified dirty implementation

---

## Next Step

Proceed to **Phase 1: Define the Workspace Durability Boundary** — create the unified snapshot contract
that combines notes/panels and components into a single durable payload.
