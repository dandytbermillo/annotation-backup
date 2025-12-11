# Refactoring Plan: `use-note-workspaces.ts`

**Date:** 2025-12-11
**Current Size:** 4,744 lines (~52K tokens)
**Target:** Break into ~10-15 focused modules, each < 500 lines

---

## Problem Statement

The `use-note-workspaces.ts` file has grown to be unmaintainable:
- **4,744 lines** - Too large to read in one context window
- **30+ useCallback functions** - Mixed concerns
- **25+ useRef declarations** - Shared mutable state
- **Circular dependencies** between internal functions
- **Difficult to test** - Everything coupled together
- **Slow IDE performance** - TypeScript struggles with file this size

---

## Proposed Architecture

```
lib/hooks/annotation/
├── use-note-workspaces.ts          # Main orchestrator (~300 lines)
│
├── workspace/
│   ├── index.ts                    # Re-exports
│   │
│   ├── use-workspace-crud.ts       # Create/Delete/Rename (~200 lines)
│   ├── use-workspace-selection.ts  # Select/Switch logic (~400 lines)
│   ├── use-workspace-hydration.ts  # DB → Memory loading (~300 lines)
│   │
│   ├── use-workspace-persistence.ts    # Memory → DB saving (~500 lines)
│   ├── use-workspace-snapshot.ts       # Capture/Apply snapshots (~600 lines)
│   ├── use-workspace-panel-snapshots.ts # Panel-specific snapshot logic (~400 lines)
│   │
│   ├── use-workspace-membership.ts # Note membership tracking (~200 lines)
│   ├── use-workspace-open-notes.ts # Open notes management (~200 lines)
│   │
│   ├── use-workspace-debug.ts      # Debug logging (~100 lines)
│   ├── use-workspace-effects.ts    # Side effects/subscriptions (~300 lines)
│   │
│   ├── workspace-refs.ts           # Shared refs context (~150 lines)
│   ├── workspace-utils.ts          # Pure utility functions (~200 lines)
│   └── workspace-types.ts          # Types and interfaces (~100 lines)
```

---

## Module Breakdown

### 1. `workspace-types.ts` (~100 lines)
**Purpose:** All type definitions in one place

```typescript
// Types currently scattered throughout the file
export interface WorkspaceSnapshotCache { ... }
export interface PanelSnapshotState { ... }
export interface WorkspacePersistOptions { ... }
export type WorkspaceDebugAction = '...' | '...'
```

### 2. `workspace-utils.ts` (~200 lines)
**Purpose:** Pure utility functions (no hooks, no state)

```typescript
// Move these functions:
- serializeWorkspacePayload()      // Line 127-203
- serializePanelSnapshots()        // Line 205-250
- normalizePoint()                 // Line 102-109
- normalizeSize()                  // Line 111-118
- roundNumber()                    // Line 120-125
- detectRuntimeCapacity()          // Line 88-100
```

### 3. `workspace-refs.ts` (~150 lines)
**Purpose:** Shared refs as a context provider

```typescript
// Create a context for shared refs
export interface WorkspaceRefsContextValue {
  panelSnapshotsRef: MutableRefObject<Map<string, NoteWorkspacePanelSnapshot[]>>
  workspaceSnapshotsRef: MutableRefObject<Map<string, WorkspaceSnapshotCache>>
  workspaceOpenNotesRef: MutableRefObject<Map<string, NoteWorkspaceSlot[]>>
  workspaceNoteMembershipRef: MutableRefObject<Map<string, Set<string>>>
  // ... 20+ more refs
}

export const WorkspaceRefsContext = createContext<WorkspaceRefsContextValue | null>(null)

export function WorkspaceRefsProvider({ children }) {
  // Initialize all refs here
  const panelSnapshotsRef = useRef<Map<string, NoteWorkspacePanelSnapshot[]>>(new Map())
  // ...

  return (
    <WorkspaceRefsContext.Provider value={{ panelSnapshotsRef, ... }}>
      {children}
    </WorkspaceRefsContext.Provider>
  )
}

export function useWorkspaceRefs() {
  const ctx = useContext(WorkspaceRefsContext)
  if (!ctx) throw new Error('useWorkspaceRefs must be within WorkspaceRefsProvider')
  return ctx
}
```

### 4. `use-workspace-debug.ts` (~100 lines)
**Purpose:** Debug logging hook

```typescript
// Move from lines 809-836
export function useWorkspaceDebug() {
  const emitDebugLog = useCallback((payload: DebugPayload) => {
    if (!NOTE_WORKSPACE_DEBUG_ENABLED) return
    void debugLog({ ... })
  }, [])

  return { emitDebugLog }
}
```

### 5. `use-workspace-membership.ts` (~200 lines)
**Purpose:** Track which notes belong to which workspace

```typescript
// Move from lines 442-602
export function useWorkspaceMembership(refs: WorkspaceRefsContextValue) {
  const setWorkspaceNoteMembership = useCallback(...)  // Line 442
  const getWorkspaceNoteMembership = useCallback(...)  // Line 548

  return { setWorkspaceNoteMembership, getWorkspaceNoteMembership }
}
```

### 6. `use-workspace-open-notes.ts` (~200 lines)
**Purpose:** Manage open notes per workspace

```typescript
// Move from lines 604-765
export function useWorkspaceOpenNotes(refs: WorkspaceRefsContextValue) {
  const commitWorkspaceOpenNotes = useCallback(...)    // Line 604
  const getWorkspaceOpenNotes = useCallback(...)       // Line 678
  const pruneWorkspaceEntries = useCallback(...)       // Line 851
  const getProviderOpenNoteIds = useCallback(...)      // Line 838

  return { commitWorkspaceOpenNotes, getWorkspaceOpenNotes, ... }
}
```

### 7. `use-workspace-panel-snapshots.ts` (~400 lines)
**Purpose:** Panel snapshot collection and management

```typescript
// Move from lines 931-1451
export function useWorkspacePanelSnapshots(refs, debug) {
  const collectPanelSnapshotsFromDataStore = useCallback(...)  // Line 931
  const getAllPanelSnapshots = useCallback(...)                // Line 1039
  const updatePanelSnapshotMap = useCallback(...)              // Line 1072
  const waitForPanelSnapshotReadiness = useCallback(...)       // Line 1333

  return { collectPanelSnapshotsFromDataStore, getAllPanelSnapshots, ... }
}
```

### 8. `use-workspace-snapshot.ts` (~600 lines)
**Purpose:** Capture and apply workspace snapshots

```typescript
// Move from lines 1452-2251
export function useWorkspaceSnapshot(refs, debug, panelSnapshots) {
  const applyPanelSnapshots = useCallback(...)           // Line 1452
  const captureCurrentWorkspaceSnapshot = useCallback(...) // Line 1723
  const buildPayloadFromSnapshot = useCallback(...)      // Line 2139
  const rehydratePanelsForNote = useCallback(...)        // Line 2252
  const previewWorkspaceFromSnapshot = useCallback(...)  // Line 2270

  return { applyPanelSnapshots, captureCurrentWorkspaceSnapshot, ... }
}
```

### 9. `use-workspace-persistence.ts` (~500 lines)
**Purpose:** Save workspace state to database

```typescript
// Move from lines 2667-3553
export function useWorkspacePersistence(refs, debug, snapshot) {
  const buildPayload = useCallback(...)          // Line 2684
  const persistWorkspaceById = useCallback(...)  // Line 2989
  const persistWorkspaceNow = useCallback(...)   // Line 3256
  const persistWorkspaceSnapshot = useCallback(...) // Line 2171
  const scheduleSave = useCallback(...)          // Line 3469
  const flushPendingSave = useCallback(...)      // Line 3514

  return { buildPayload, persistWorkspaceById, scheduleSave, ... }
}
```

### 10. `use-workspace-hydration.ts` (~300 lines)
**Purpose:** Load workspace state from database

```typescript
// Move from lines 3597-3798
export function useWorkspaceHydration(refs, debug, snapshot) {
  const hydrateWorkspace = useCallback(...)  // Line 3597

  // List/refresh logic
  const listWorkspaces = useCallback(...)
  const refreshWorkspaceList = useCallback(...)

  return { hydrateWorkspace, listWorkspaces, ... }
}
```

### 11. `use-workspace-crud.ts` (~200 lines)
**Purpose:** Create, delete, rename workspaces

```typescript
// Move from lines 4255-4373
export function useWorkspaceCrud(refs, debug, persistence) {
  const handleCreateWorkspace = useCallback(...)  // Line 4255
  const handleDeleteWorkspace = useCallback(...)  // Line 4300
  const handleRenameWorkspace = useCallback(...)  // Line 4337

  return { createWorkspace: handleCreateWorkspace, ... }
}
```

### 12. `use-workspace-selection.ts` (~400 lines)
**Purpose:** Workspace switching (hot/cold)

```typescript
// Move from lines 4374-4587
export function useWorkspaceSelection(refs, debug, snapshot, hydration) {
  const handleSelectWorkspace = useCallback(...)  // Line 4374
  const handleEntryChange = useCallback(...)      // Line 3554

  return { selectWorkspace: handleSelectWorkspace, ... }
}
```

### 13. `use-workspace-effects.ts` (~300 lines)
**Purpose:** All useEffect/useLayoutEffect hooks

```typescript
// Move from lines 4589-4724
export function useWorkspaceEffects(
  refs,
  currentWorkspaceId,
  // ... other deps
) {
  // Panel rehydration effect (line 4589-4628)
  useLayoutEffect(() => { ... }, [...])

  // Preview snapshot effect (line 4630-4635)
  useEffect(() => { ... }, [...])

  // Runtime preparation effects (line 4637-4649)
  useEffect(() => { ... }, [...])

  // Visibility tracking effect (line 4651-4678)
  useEffect(() => { ... }, [...])

  // Active note panel check effect (line 4680-4724)
  useEffect(() => { ... }, [...])
}
```

### 14. `use-note-workspaces.ts` (~300 lines) - ORCHESTRATOR
**Purpose:** Main hook that composes all sub-hooks

```typescript
export function useNoteWorkspaces({ ... }) {
  // Feature flags
  const featureEnabled = isNoteWorkspaceEnabled()
  const v2Enabled = isNoteWorkspaceV2Enabled()
  const liveStateEnabled = isNoteWorkspaceLiveStateEnabled()

  // Core state
  const [workspaces, setWorkspaces] = useState<NoteWorkspaceSummary[]>([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // ...

  // Compose sub-hooks
  const refs = useWorkspaceRefs()
  const { emitDebugLog } = useWorkspaceDebug()
  const membership = useWorkspaceMembership(refs)
  const openNotes = useWorkspaceOpenNotes(refs)
  const panelSnapshots = useWorkspacePanelSnapshots(refs, emitDebugLog)
  const snapshot = useWorkspaceSnapshot(refs, emitDebugLog, panelSnapshots)
  const persistence = useWorkspacePersistence(refs, emitDebugLog, snapshot)
  const hydration = useWorkspaceHydration(refs, emitDebugLog, snapshot)
  const crud = useWorkspaceCrud(refs, emitDebugLog, persistence)
  const selection = useWorkspaceSelection(refs, emitDebugLog, snapshot, hydration)

  // Run effects
  useWorkspaceEffects(refs, currentWorkspaceId, ...)

  // Return public API
  return {
    featureEnabled,
    workspaces,
    currentWorkspaceId,
    selectWorkspace: selection.selectWorkspace,
    createWorkspace: crud.createWorkspace,
    deleteWorkspace: crud.deleteWorkspace,
    renameWorkspace: crud.renameWorkspace,
    // ...
  }
}
```

---

## Dependency Graph

```
                    use-note-workspaces (orchestrator)
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
   use-workspace-       use-workspace-        use-workspace-
   selection            crud                  effects
        │                     │                     │
        └──────────┬──────────┘                     │
                   │                                │
                   ▼                                │
          use-workspace-hydration ◄────────────────┘
                   │
                   ▼
          use-workspace-persistence
                   │
                   ▼
          use-workspace-snapshot
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
use-workspace-          use-workspace-
panel-snapshots         membership
        │                     │
        └──────────┬──────────┘
                   │
                   ▼
            use-workspace-
            open-notes
                   │
                   ▼
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
  workspace-refs        use-workspace-debug
        │
        ▼
  workspace-utils
  workspace-types
```

---

## Implementation Strategy

### Phase 1: Extract Pure Functions (Low Risk)
1. Create `workspace-types.ts` - extract all type definitions
2. Create `workspace-utils.ts` - extract pure utility functions
3. **Test:** Run existing tests, verify no regressions

### Phase 2: Extract Debug Hook (Low Risk)
1. Create `use-workspace-debug.ts`
2. Update main file to use new hook
3. **Test:** Verify debug logs still work

### Phase 3: Create Refs Context (Medium Risk)
1. Create `workspace-refs.ts` with context provider
2. Wrap app with `WorkspaceRefsProvider`
3. Update main file to use `useWorkspaceRefs()`
4. **Test:** Full integration test

### Phase 4: Extract Membership & Open Notes (Medium Risk)
1. Create `use-workspace-membership.ts`
2. Create `use-workspace-open-notes.ts`
3. Update dependencies in main file
4. **Test:** Workspace note tracking works

### Phase 5: Extract Panel Snapshots (Medium Risk)
1. Create `use-workspace-panel-snapshots.ts`
2. Update dependencies
3. **Test:** Panel positions persist correctly

### Phase 6: Extract Snapshot Management (High Risk)
1. Create `use-workspace-snapshot.ts`
2. This is critical path - test thoroughly
3. **Test:** Capture/apply snapshots work, hot/cold switching works

### Phase 7: Extract Persistence (High Risk)
1. Create `use-workspace-persistence.ts`
2. **Test:** Save to DB works, throttling works, no data loss

### Phase 8: Extract Hydration (Medium Risk)
1. Create `use-workspace-hydration.ts`
2. **Test:** Load from DB works, initial hydration works

### Phase 9: Extract CRUD & Selection (Medium Risk)
1. Create `use-workspace-crud.ts`
2. Create `use-workspace-selection.ts`
3. **Test:** Create/delete/rename/switch all work

### Phase 10: Extract Effects (Low Risk)
1. Create `use-workspace-effects.ts`
2. Move all useEffect/useLayoutEffect
3. **Test:** All side effects trigger correctly

### Phase 11: Final Cleanup
1. Main file should now be ~300 lines
2. Remove dead code
3. Update imports throughout codebase
4. **Test:** Full regression test

---

## Testing Strategy

### Unit Tests (New)
- Each extracted module should have its own test file
- Mock dependencies using the refs context

### Integration Tests (Existing)
- Run all existing workspace tests after each phase
- Add new tests for edge cases discovered

### Manual Tests
After each phase:
1. Create workspace with timer/calculator
2. Set timer to specific value
3. Switch workspaces (hot switch)
4. Switch workspaces (cold switch / eviction)
5. Verify state persists
6. Refresh page, verify state loads from DB

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking circular dependencies | High | Map dependencies first, extract bottom-up |
| Ref timing issues | High | Keep refs in shared context |
| Performance regression | Medium | Profile before/after each phase |
| Missing edge cases | Medium | Comprehensive manual testing |
| Context provider overhead | Low | Refs are stable, no re-render issues |

---

## Success Criteria

1. **No file > 600 lines**
2. **Each module has single responsibility**
3. **All existing tests pass**
4. **No performance regression**
5. **Timer/Calculator state persists** (the original bug we're fixing)
6. **IDE performance improves** (TypeScript completion faster)

---

## Timeline Estimate

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1-2 | 1-2 hours | Low |
| Phase 3 | 2-3 hours | Medium |
| Phase 4-5 | 3-4 hours | Medium |
| Phase 6-7 | 4-6 hours | High |
| Phase 8-10 | 3-4 hours | Medium |
| Phase 11 | 1-2 hours | Low |
| **Total** | **14-21 hours** | |

---

## Alternative: Incremental Extraction

If full refactor is too risky, we can do incremental extraction:

1. Extract `workspace-utils.ts` (pure functions) - **Do this first**
2. Extract `workspace-types.ts` (types) - **Easy win**
3. Keep rest in main file but organize with `// region` comments
4. Extract more modules as we touch them for bug fixes

This approach is lower risk but takes longer to see full benefits.

---

## Decision Required

**Options:**
1. **Full Refactor** - 2-3 days, comprehensive, higher risk
2. **Incremental** - Ongoing, lower risk, longer timeline
3. **Hybrid** - Extract low-risk modules now, defer high-risk to later

**Recommendation:** Start with **Hybrid** approach:
- Phase 1-2 now (types, utils, debug)
- Phase 6-7 later (snapshot, persistence) when fixing the eviction bug
- This gives us quick wins while reducing risk
