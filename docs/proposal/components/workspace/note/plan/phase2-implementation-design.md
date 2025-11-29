# Phase 2: Multi-Runtime Hide/Show Implementation Design

**Date**: 2025-11-28
**Status**: Planning
**Goal**: Replace "wipe and replay" with true hide/show for workspace switching

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  annotation-app-shell.tsx                   │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Single AnnotationWorkspaceCanvas                      │ │
│  │  - workspaceId = currentWorkspaceId                    │ │
│  │  - noteIds = openNotes from current workspace          │ │
│  │  - Props updated on every workspace switch             │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

On workspace switch:
1. captureCurrentWorkspaceSnapshot()     ← Save state to DB
2. previewWorkspaceFromSnapshot()        ← WIPE canvas state
   - closeWorkspaceNote() for all notes
   - applyPanelSnapshots()               ← Clear/write DataStore
   - openWorkspaceNote() for snapshot notes
3. Update props on single canvas
```

---

## Target Architecture (Phase 2)

```
┌─────────────────────────────────────────────────────────────┐
│                  annotation-app-shell.tsx                   │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  MultiWorkspaceCanvasContainer                         │ │
│  │                                                        │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐     │ │
│  │  │ Canvas A            │  │ Canvas B            │     │ │
│  │  │ workspaceId="ws-1"  │  │ workspaceId="ws-2"  │     │ │
│  │  │ visibility: visible │  │ visibility: hidden  │     │ │
│  │  │ DataStore: dsA      │  │ DataStore: dsB      │     │ │
│  │  └─────────────────────┘  └─────────────────────┘     │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

On workspace switch (hot runtime):
1. Set Canvas A visibility: hidden
2. Set Canvas B visibility: visible
3. (No wipe, no replay, no snapshot)

On workspace switch (cold runtime):
1. Set Canvas A visibility: hidden
2. Create Canvas B with snapshot replay (current behavior)
3. Set Canvas B visibility: visible
```

---

## Implementation Plan

### Step 1: Add Visibility State to Runtime

**File**: `lib/workspace/runtime-manager.ts`

```typescript
export type WorkspaceRuntime = {
  // ... existing fields ...
  isVisible: boolean              // NEW: visibility state
  lastVisibleAt: number           // NEW: for LRU eviction
}

export const setRuntimeVisible = (workspaceId: string, visible: boolean) => {
  const runtime = getWorkspaceRuntime(workspaceId)
  runtime.isVisible = visible
  if (visible) {
    runtime.lastVisibleAt = Date.now()
  }
}

export const getVisibleRuntimeId = (): string | null => {
  for (const [id, runtime] of runtimes.entries()) {
    if (runtime.isVisible) return id
  }
  return null
}

export const listHotRuntimes = (): string[] => {
  return Array.from(runtimes.keys())
}
```

### Step 2: Create MultiWorkspaceCanvasContainer

**File**: `components/workspace/multi-workspace-canvas-container.tsx` (NEW)

```typescript
type MultiWorkspaceCanvasContainerProps = {
  activeWorkspaceId: string
  hotRuntimes: WorkspaceRuntimeInfo[]
  // Props that apply to the visible canvas
  onCanvasStateChange: ...
  // etc.
}

export function MultiWorkspaceCanvasContainer({
  activeWorkspaceId,
  hotRuntimes,
  ...canvasProps
}: MultiWorkspaceCanvasContainerProps) {
  return (
    <div className="multi-workspace-container">
      {hotRuntimes.map(runtime => (
        <div
          key={runtime.workspaceId}
          className="workspace-canvas-wrapper"
          style={{
            visibility: runtime.workspaceId === activeWorkspaceId ? 'visible' : 'hidden',
            position: 'absolute',
            inset: 0,
          }}
        >
          <AnnotationWorkspaceCanvas
            workspaceId={runtime.workspaceId}
            noteIds={runtime.openNotes.map(n => n.noteId)}
            {...(runtime.workspaceId === activeWorkspaceId ? canvasProps : {})}
          />
        </div>
      ))}
    </div>
  )
}
```

### Step 3: Modify handleSelectWorkspace

**File**: `lib/hooks/annotation/use-note-workspaces.ts`

```typescript
const handleSelectWorkspace = useCallback(async (workspaceId: string) => {
  const previousWorkspaceId = currentWorkspaceIdRef.current

  // Check if target workspace has hot runtime
  const targetRuntimeState = hasWorkspaceRuntime(workspaceId) ? "hot" : "cold"

  if (targetRuntimeState === "hot") {
    // HOT SWITCH: Just toggle visibility, no wipe/replay
    emitDebugLog({ action: "workspace_switch_hot", metadata: { workspaceId } })

    // Hide current runtime
    if (previousWorkspaceId) {
      setRuntimeVisible(previousWorkspaceId, false)
      emitDebugLog({ action: "workspace_runtime_hidden", metadata: { workspaceId: previousWorkspaceId } })
    }

    // Show target runtime
    setRuntimeVisible(workspaceId, true)
    emitDebugLog({ action: "workspace_runtime_visible", metadata: { workspaceId } })

    // Update context
    setActiveWorkspaceContext(workspaceId)
    setCurrentWorkspaceId(workspaceId)

  } else {
    // COLD SWITCH: Current behavior with snapshot replay
    emitDebugLog({ action: "workspace_switch_cold", metadata: { workspaceId } })

    // Capture current workspace (if exists)
    if (previousWorkspaceId) {
      await captureCurrentWorkspaceSnapshot()
      setRuntimeVisible(previousWorkspaceId, false)
    }

    // Load and replay snapshot for cold workspace
    const snapshot = await loadWorkspaceSnapshot(workspaceId)
    await previewWorkspaceFromSnapshot(workspaceId, snapshot)

    // Show new runtime
    setRuntimeVisible(workspaceId, true)
    setCurrentWorkspaceId(workspaceId)
  }
}, [...])
```

### Step 4: Scope Snapshot Functions to Runtime

**File**: `lib/hooks/annotation/use-note-workspaces.ts`

Functions that need runtime scoping:
- `collectPanelSnapshotsFromDataStore(runtime)` - Use runtime's DataStore
- `captureCurrentWorkspaceSnapshot(workspaceId)` - Scope to specific workspace
- `applyPanelSnapshots(runtime, panels)` - Apply to runtime's DataStore

```typescript
// BEFORE: Uses shared/current DataStore
const collectPanelSnapshotsFromDataStore = () => {
  const dataStore = workspace.dataStore  // Current workspace
  // ...
}

// AFTER: Uses runtime-specific DataStore
const collectPanelSnapshotsFromDataStore = (workspaceId: string) => {
  const runtime = getWorkspaceRuntime(workspaceId)
  const dataStore = runtime.dataStore  // Specific runtime's DataStore
  // ...
}
```

### Step 5: Add Visibility Telemetry

**Events to emit**:
- `workspace_runtime_visible` - When a runtime becomes visible
- `workspace_runtime_hidden` - When a runtime is hidden (but kept alive)
- `workspace_switch_hot` - Hot switch (no replay)
- `workspace_switch_cold` - Cold switch (with replay)

```typescript
emitDebugLog({
  component: "NoteWorkspace",
  action: "workspace_runtime_visible",
  metadata: {
    workspaceId,
    wasCold: !wasHotRuntime,
    runtimeCount: listHotRuntimes().length,
  },
})
```

---

## Files to Modify

| File | Change |
|------|--------|
| `lib/workspace/runtime-manager.ts` | Add `isVisible`, `lastVisibleAt`, visibility functions |
| `components/workspace/multi-workspace-canvas-container.tsx` | NEW: Multi-canvas wrapper |
| `components/annotation-app-shell.tsx` | Use `MultiWorkspaceCanvasContainer` |
| `lib/hooks/annotation/use-note-workspaces.ts` | Modify `handleSelectWorkspace`, scope snapshot functions |

---

## Implementation Order

1. **Add visibility state to runtime** (runtime-manager.ts)
2. **Create multi-canvas container** (new file)
3. **Wire up in annotation-app-shell** (replace single canvas)
4. **Modify handleSelectWorkspace** (hot vs cold branching)
5. **Scope snapshot functions** (runtime-specific DataStore)
6. **Add telemetry** (visibility events)
7. **Test hot switching** (verify no wipe/replay)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Memory usage with multiple canvases | Enforce MAX_HOT_RUNTIMES = 4, LRU eviction |
| Hidden canvas still rendering | Pause RAF/render loops when hidden |
| Props leak between canvases | Only pass event handlers to visible canvas |
| Backward compatibility | Keep cold path identical to current behavior |

---

## Success Criteria

- [ ] Hot workspace switch < 50ms (no snapshot replay)
- [ ] Components (calculator, alarm) keep running when hidden
- [ ] No data loss during rapid switching
- [ ] Memory stays within budget (≤250MB per runtime)
- [ ] Telemetry shows `workspace_runtime_visible/hidden` events
