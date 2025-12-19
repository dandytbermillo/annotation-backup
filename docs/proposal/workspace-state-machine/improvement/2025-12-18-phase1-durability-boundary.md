# Phase 1: Define the Workspace Durability Boundary

**Date:** 2025-12-18
**Status:** Complete
**Parent Plan:** `2025-12-18-unified-workspace-durability-pipeline.md`

---

## Summary

This phase establishes the unified durability boundary — a single contract and entry point for all
workspace save/restore operations. Notes/panels and components now have shared type definitions,
a unified snapshot builder, and consistent guard policies.

---

## Files Created

### `lib/workspace/durability/types.ts`

Defines the unified type contracts:

| Type | Purpose |
|------|---------|
| `WorkspaceDurabilityLifecycle` | Lifecycle states: `uninitialized`, `restoring`, `ready`, `persisting`, `degraded` |
| `WorkspaceLifecycleState` | Lifecycle with metadata (timestamps, failure counts) |
| `WorkspaceDurableSnapshot` | Complete durable state (openNotes + panels + camera + components) |
| `SnapshotCaptureResult` | Result of snapshot capture with source tracking |
| `SnapshotSkipReason` | Why capture was skipped/deferred |
| `GuardCheckResult` | Result of guard check before persistence |
| `WorkspaceDirtyState` | Unified dirty state aggregating both domains |
| `UnifiedPersistResult` | Result of persistence operation |

**Key utilities:**
- `isSnapshotInconsistent()` — Detects transient mismatch states
- `toNoteWorkspacePayload()` / `fromNoteWorkspacePayload()` — Convert between formats
- `createEmptySnapshot()` — Initialize empty snapshot

### `lib/workspace/durability/snapshot-builder.ts`

Single entry point for building durable snapshots:

```typescript
function buildUnifiedSnapshot(options: BuildSnapshotOptions): SnapshotCaptureResult
```

**Source priority for components:**
1. Component store (via `getComponentsForPersistence`)
2. Runtime ledger (legacy fallback)
3. Last cached snapshot (emergency fallback)

**Source priority for notes/panels:**
1. Direct snapshot (from capture)
2. Runtime open notes + cached panels
3. Last non-empty snapshot (emergency fallback)

**Features:**
- Tracks source of each domain for debugging
- Detects inconsistent states before returning
- Logs all decisions via `debugLog`

### `lib/workspace/durability/guards.ts`

Unified guard policy for persistence:

```typescript
function checkPersistGuards(options: GuardCheckOptions): GuardCheckResult
```

**Guards implemented:**

| Guard | Condition | Action |
|-------|-----------|--------|
| Lifecycle | `lifecycle === 'restoring' \|\| 'uninitialized'` | Block persist |
| Revision | `!revisionKnown` | Block persist |
| Transient Mismatch | `panels > 0 && openNotes === 0` | Block persist |
| Empty After Load | `isEmpty && recentlyHydrated` | Block persist |

**Helper functions:**
- `shouldRetryPersist()` — Determines if failure is retriable
- `shouldEnterDegradedMode()` — Determines if failure should trigger degraded mode
- `createRuntimeInfo()` — Helper for constructing guard options

### `lib/workspace/durability/index.ts`

Public API exports for the durability module.

---

## Type Contract: `WorkspaceDurableSnapshot`

```typescript
interface WorkspaceDurableSnapshot {
  schemaVersion: '1.1.0'

  // Notes/Panels Domain
  openNotes: DurableOpenNote[]
  activeNoteId: string | null
  panels: NoteWorkspacePanelSnapshot[]
  camera: NoteWorkspaceCamera

  // Components Domain
  components: NoteWorkspaceComponentSnapshot[]
}
```

This is the **single source of truth** for what gets persisted. Both domains are included in every
snapshot, ensuring they cannot diverge during save/restore.

---

## Integration Points

The new durability module is designed to integrate with existing code incrementally:

### Current: `buildPayloadFromSnapshot()` in `use-workspace-snapshot.ts`

Can be updated to call `buildUnifiedSnapshot()` internally, or both can coexist during migration.

### Current: `persistWorkspaceById()` in `use-workspace-persistence.ts`

Can call `checkPersistGuards()` before attempting persistence.

### Current: `evictWorkspaceRuntime()` in `use-note-workspace-runtime-manager.ts`

Can use the guard policy to determine if eviction is safe.

---

## Acceptance Criteria

- [x] Unified type contract defined (`WorkspaceDurableSnapshot`)
- [x] Single snapshot builder entry point (`buildUnifiedSnapshot`)
- [x] Component sourcing unified (store → runtime → cache priority)
- [x] Guards prevent inconsistent snapshots
- [x] Type-check passes

---

## What This Enables (Future Phases)

### Phase 2: Unified Guards

The `checkPersistGuards()` function is ready to be called from all persistence paths.

### Phase 3: Unified Restore

The `WorkspaceDurabilityLifecycle` states enable proper hot/cold classification.

### Phase 4: Unified Dirty

The `WorkspaceDirtyState` type is ready to aggregate both domains.

### Phase 5: Persistence Scheduling

All persistence reasons can now route through `checkPersistGuards()`.

---

## Migration Path

1. **Phase 1 (current):** Types and modules created, no behavior change
2. **Next:** Update `persistWorkspaceById` to call `checkPersistGuards()`
3. **Next:** Update `buildPayloadFromSnapshot` to use `buildUnifiedSnapshot`
4. **Next:** Wire lifecycle state to existing hydration flags

---

## Testing Notes

The new module has no side effects — it's pure functions and types. Integration testing will
happen as existing code paths are updated to use the new boundary.

For now, verify:
```bash
npm run type-check  # Should pass
```
