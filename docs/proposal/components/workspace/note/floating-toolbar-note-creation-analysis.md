# Floating Toolbar "+ Note" Button - Working Implementation Analysis

**Date**: 2024-12-09
**Status**: Working Implementation Documentation
**Purpose**: Document how the floating toolbar's "+ Note" button successfully creates notes on empty workspaces

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Component Hierarchy](#component-hierarchy)
3. [The Working Flow](#the-working-flow)
4. [Key Code Implementations](#key-code-implementations)
5. [Why It Works on Empty Workspaces](#why-it-works-on-empty-workspaces)
6. [Design Decisions](#design-decisions)

---

## Architecture Overview

The floating toolbar system has **two instances** that work together:

| Instance | Location | Rendering Method | Purpose |
|----------|----------|------------------|---------|
| `WorkspaceFloatingToolbar` | View level | Direct DOM sibling | Primary toolbar, appears above canvas |
| `CanvasAwareFloatingToolbar` | Canvas child | Portal to `document.body` | Context-connected for canvas operations |

### Workspace ID Sources

| Component | Workspace ID Source | Persistence | Scope |
|-----------|---------------------|-------------|-------|
| Floating Toolbar | `knowledgeBaseWorkspaceId` | localStorage (`kb-workspace-id`) | Global |
| Workspace Toolbar | `currentWorkspaceId` | React state | Per-entry |

---

## Component Hierarchy

```
AnnotationWorkspaceView
├── WorkspaceSidebar
├── WorkspaceToolbarStrip
├── Main Area (flex-1)
│   ├── WorkspaceCanvasArea
│   │   └── WorkspaceCanvasContent
│   │       ├── Canvas (visibility: hidden when no notes)
│   │       └── Welcome Overlay (when no notes)
│   ├── WorkspaceOverlay
│   ├── SidebarPreviewPopups
│   ├── WorkspacePreviewPortal
│   ├── WorkspaceFloatingToolbar  ← Rendered AFTER canvas (on top)
│   └── WorkspaceConstellationLayer
```

---

## The Working Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User clicks "+ Note" button                                  │
│    └─> handleCreateNewNote() @ floating-toolbar.tsx:1647        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Check for knowledgeBaseWorkspaceId                           │
│    └─> If null, call waitForWorkspaceId(8000) @ line 1659       │
│        This polls for up to 8 seconds with exponential backoff  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. waitForWorkspaceId() @ floating-toolbar.tsx:346              │
│    ├─> Check if knowledgeBaseWorkspaceId exists → return it     │
│    ├─> Call ensureKnowledgeBaseWorkspaceReady()                 │
│    │   └─> Fetches /api/items?parentId=null                     │
│    │   └─> Returns workspaceId from response                    │
│    └─> Retry with delays: 250ms, 500ms, 750ms, 1000ms...        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. createNote({ workspaceId: targetWorkspaceId })               │
│    @ note-creator.ts:105                                        │
│    └─> POST /api/items with workspace ID                        │
│    └─> Returns { success: true, noteId: "..." }                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. onSelectNote(noteId, { source: 'toolbar-create' })           │
│    └─> handleNoteSelect() @ use-workspace-note-selection.ts     │
│    └─> Opens the note in the workspace                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Code Implementations

### 1. Main Click Handler (`floating-toolbar.tsx:1646-1704`)

```typescript
// Handle creating a new note using shared utility (same as notes-explorer)
const handleCreateNewNote = async () => {
  if (isCreatingNote) return // Prevent double-clicks

  setIsCreatingNote(true)
  let targetWorkspaceId = knowledgeBaseWorkspaceId ?? null
  try {
    debugLog({
      component: "FloatingToolbar",
      action: "create_note_click",
      metadata: { hasWorkspaceId: Boolean(knowledgeBaseWorkspaceId), workspaceId: knowledgeBaseWorkspaceId ?? null, workspaceName },
    })

    // KEY: If no workspace ID available, wait for it with retry logic
    if (!targetWorkspaceId) {
      targetWorkspaceId = await waitForWorkspaceId(8000)
    }

    // If still no workspace after waiting, show error
    if (!targetWorkspaceId) {
      throw new Error("WORKSPACE_UNAVAILABLE")
    }

    const result = await createNote({
      workspaceId: targetWorkspaceId ?? undefined,
    })

    if (result.success && result.noteId) {
      debugLog({
        component: "FloatingToolbar",
        action: "create_note_success",
        metadata: { noteId: result.noteId, workspaceId: targetWorkspaceId, workspaceName },
      })
      // Open the newly created note
      onSelectNote?.(result.noteId, {
        source: 'toolbar-create'
      })
      // Close the toolbar
      onClose()
    } else {
      throw new Error(result.error || 'Failed to create note')
    }
  } catch (error) {
    if (error instanceof Error && error.message === "WORKSPACE_UNAVAILABLE") {
      alert('Workspace is still loading. Please try again in a moment.')
      debugLog({
        component: "FloatingToolbar",
        action: "create_note_workspace_unavailable",
        metadata: { workspaceId: targetWorkspaceId ?? null, workspaceName },
      })
    } else {
      console.error('[FloatingToolbar] Failed to create note:', error)
      alert('Failed to create note. Please try again.')
      debugLog({
        component: "FloatingToolbar",
        action: "create_note_error",
        metadata: { error: error instanceof Error ? error.message : String(error), workspaceId: knowledgeBaseWorkspaceId ?? null, workspaceName },
      })
    }
  } finally {
    setIsCreatingNote(false)
  }
}
```

### 2. Workspace ID Wait Function (`floating-toolbar.tsx:346-380`)

```typescript
const waitForWorkspaceId = useCallback(
  async (timeoutMs = 5000): Promise<string | null> => {
    const start = Date.now()
    let attempt = 0
    debugLog({
      component: "FloatingToolbar",
      action: "workspace_wait_start",
      metadata: { timeoutMs },
    })

    // Poll until timeout
    while (Date.now() - start < timeoutMs) {
      // Return immediately if workspace ID is available
      if (knowledgeBaseWorkspaceId) {
        return knowledgeBaseWorkspaceId
      }

      // Try to resolve workspace ID via API
      const resolved = await ensureKnowledgeBaseWorkspaceReady()
      if (resolved) {
        return resolved
      }

      // Exponential backoff: 250ms, 500ms, 750ms, 1000ms (max)
      attempt += 1
      const delay = Math.min(1000, 250 * attempt)
      await new Promise((resolve) => setTimeout(resolve, delay))
      debugLog({
        component: "FloatingToolbar",
        action: "workspace_wait_retry",
        metadata: { attempt, delay },
      })
    }

    debugLog({
      component: "FloatingToolbar",
      action: "workspace_wait_timeout",
      metadata: { elapsedMs: Date.now() - start },
    })
    return knowledgeBaseWorkspaceId ?? null
  },
  [ensureKnowledgeBaseWorkspaceReady, knowledgeBaseWorkspaceId],
)
```

### 3. Workspace Discovery (`floating-toolbar.tsx:274-338`)

```typescript
const ensureKnowledgeBaseWorkspaceReady = useCallback(async (): Promise<string | null> => {
  // Return cached ID if available
  if (knowledgeBaseWorkspaceId) {
    debugLog({
      component: "FloatingToolbar",
      action: "workspace_ready_cached",
      metadata: { source: "state", workspaceId: knowledgeBaseWorkspaceId },
    })
    return knowledgeBaseWorkspaceId
  }

  // Join existing discovery promise if one is in progress
  if (workspaceDiscoveryPromiseRef.current) {
    debugLog({
      component: "FloatingToolbar",
      action: "workspace_discovery_join",
    })
    return workspaceDiscoveryPromiseRef.current
  }

  debugLog({
    component: "FloatingToolbar",
    action: "workspace_discovery_start",
    metadata: { endpoint: "/api/items?parentId=null" },
  })

  // Start new discovery
  workspaceDiscoveryPromiseRef.current = (async () => {
    try {
      const rootUrl = appendKnowledgeBaseWorkspaceParam("/api/items?parentId=null", null)
      const response = await fetchWithKnowledgeBase(rootUrl)
      if (!response.ok) {
        debugLog({
          component: "FloatingToolbar",
          action: "workspace_discovery_failed",
          metadata: { status: response.status },
        })
        return null
      }
      const data = await response.json().catch(() => null)
      const items: any[] = Array.isArray(data?.items) ? data.items : []
      const knowledgeBase = items.find(
        (item: any) => typeof item?.name === "string" && item.name.toLowerCase() === "knowledge base",
      )
      const resolvedId = knowledgeBase?.workspaceId ?? data?.workspaceId ?? null
      if (resolvedId) {
        debugLog({
          component: "FloatingToolbar",
          action: "workspace_discovery_success",
          metadata: { workspaceId: resolvedId },
        })
        knowledgeBaseWorkspace.resolveWorkspaceId(resolvedId)
      }
      return resolvedId
    } catch (error) {
      debugLog({
        component: "FloatingToolbar",
        action: "workspace_discovery_error",
        metadata: { error: error instanceof Error ? error.message : String(error) },
      })
      return null
    } finally {
      workspaceDiscoveryPromiseRef.current = null
    }
  })()

  return workspaceDiscoveryPromiseRef.current
}, [appendKnowledgeBaseWorkspaceParam, fetchWithKnowledgeBase, knowledgeBaseWorkspace, knowledgeBaseWorkspaceId])
```

### 4. Knowledge Base Workspace Hook (`use-knowledge-base-workspace.ts`)

```typescript
export function useKnowledgeBaseWorkspace(
  options: KnowledgeBaseWorkspaceHookOptions = {},
): KnowledgeBaseWorkspaceApi {
  const { initialWorkspaceId = null, fetcher = fetch } = options
  const STORAGE_KEY = "kb-workspace-id"

  // Initialize from localStorage cache
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => {
    if (initialWorkspaceId) return initialWorkspaceId
    if (typeof window === "undefined") return null
    try {
      const cached = window.localStorage.getItem(STORAGE_KEY)
      if (cached && cached.trim().length > 0) {
        return cached
      }
    } catch {
      // ignore
    }
    return null
  })
  const discoveryRef = useRef<Promise<string | null> | null>(null)

  // Auto-discover workspace if not cached
  useEffect(() => {
    if (workspaceId) return
    if (discoveryRef.current) return

    let cancelled = false

    const discoverWorkspace = async () => {
      try {
        const response = await fetcher("/api/items?parentId=null", { cache: "no-store" })
        if (!response.ok) return null
        const data = await response.json().catch(() => null)
        const nextWorkspaceId =
          data && typeof data.workspaceId === "string" && data.workspaceId.length > 0
            ? data.workspaceId
            : null
        if (!cancelled && nextWorkspaceId) {
          setWorkspaceId(nextWorkspaceId)
        }
        return nextWorkspaceId
      } catch (error) {
        console.warn("[useKnowledgeBaseWorkspace] Failed to auto-resolve workspace", error)
        return null
      } finally {
        discoveryRef.current = null
      }
    }

    discoveryRef.current = discoverWorkspace()

    return () => {
      cancelled = true
    }
  }, [fetcher, workspaceId])

  // Persist to localStorage when workspace ID changes
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!workspaceId) return
    try {
      window.localStorage.setItem(STORAGE_KEY, workspaceId)
    } catch {
      // ignore storage errors
    }
  }, [workspaceId])

  return useMemo(
    () =>
      createKnowledgeBaseWorkspaceApi({
        getWorkspaceId: () => workspaceId,
        setWorkspaceId,
        fetcher,
      }),
    [fetcher, workspaceId],
  )
}
```

### 5. Note Creator Utility (`note-creator.ts:105-120`)

```typescript
export async function createNote(options: CreateNoteOptions = {}): Promise<CreateNoteResult> {
  try {
    const { name, parentId = null, metadata = {}, initialPosition = null } = options
    debugLog({
      component: "createNote",
      action: "start",
      metadata: {
        providedWorkspaceId: options.workspaceId ?? null,
        hasParentId: parentId != null,
      },
    })

    // Use provided workspace ID, fall back to cached, then resolve via API
    let targetWorkspaceId = options.workspaceId ?? cachedWorkspaceId
    if (!targetWorkspaceId) {
      targetWorkspaceId = await resolveDefaultWorkspaceId()
    }

    // ... rest of note creation logic
  }
}
```

### 6. View-Level Toolbar Rendering (`annotation-workspace-view.tsx:72-76`)

```typescript
{/* Floating toolbar rendered AFTER canvas - appears on top in DOM order */}
{floatingToolbar
  ? floatingToolbar
  : floatingToolbarProps
  ? <WorkspaceFloatingToolbar {...floatingToolbarProps} />
  : null}
```

### 7. Canvas Content with Welcome Overlay (`workspace-canvas-content.tsx`)

```typescript
export function WorkspaceCanvasContent({ hasOpenNotes, canvas }: WorkspaceCanvasContentProps) {
  return (
    <div className="relative h-full w-full">
      {/* Canvas layer - hidden when no notes */}
      <div
        className="absolute inset-0"
        style={{
          visibility: hasOpenNotes ? "visible" : "hidden",
          pointerEvents: hasOpenNotes ? "auto" : "none",
        }}
      >
        {canvas}
      </div>

      {/* Welcome message overlay - shown when no notes are open */}
      {/* Floating toolbar is rendered AFTER this in DOM, so it appears on top */}
      {!hasOpenNotes && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
          <div className="text-center">
            <h2 className="mb-4 text-3xl font-bold text-gray-600">Welcome to Annotation Canvas</h2>
            <p className="mb-6 text-gray-500">Right-click anywhere to open Notes Explorer and create a new note</p>
          </div>
        </div>
      )}
    </div>
  )
}
```

---

## Why It Works on Empty Workspaces

### 1. Global Workspace ID

The floating toolbar uses `knowledgeBaseWorkspaceId` which is:
- **Globally scoped** - not tied to any specific entry or workspace
- **Persisted in localStorage** - survives page refreshes and entry switches
- **Auto-discovered on mount** - fetches from `/api/items?parentId=null` if not cached

### 2. Retry Mechanism

The `waitForWorkspaceId` function provides resilience:
- Polls for up to 8 seconds
- Uses exponential backoff (250ms → 500ms → 750ms → 1000ms)
- Handles race conditions during initial page load
- Shows user-friendly error if timeout occurs

### 3. DOM Ordering

The `WorkspaceFloatingToolbar` is rendered AFTER the canvas content in the DOM:
```
<WorkspaceCanvasContent>  ← Contains welcome overlay
<WorkspaceFloatingToolbar>  ← Rendered after, appears on top
```

This ensures the floating toolbar is clickable even when the welcome overlay is visible.

### 4. Comparison with Workspace Toolbar

| Aspect | Floating Toolbar | Workspace Toolbar |
|--------|------------------|-------------------|
| Workspace ID | `knowledgeBaseWorkspaceId` (global) | `currentWorkspaceId` (entry-scoped) |
| Source | `useKnowledgeBaseWorkspace()` hook | `noteWorkspaceState` |
| Retry Logic | Yes (8 sec timeout) | No |
| Works on Empty? | Yes | Depends on state |

---

## Design Decisions

### Why Use a Global Workspace ID?

The Knowledge Base workspace is a **singleton** - there's only one per user. Using a global, cached ID means:
1. Notes created from floating toolbar always go to the Knowledge Base
2. No dependency on current entry/workspace state
3. Works consistently regardless of navigation state

### Why the 8-Second Timeout?

Initial page load may have race conditions:
1. Floating toolbar mounts before workspace discovery completes
2. User might click "+ Note" before API response returns
3. 8 seconds provides enough buffer for slow networks while still failing fast enough for user feedback

### Why Exponential Backoff?

Prevents hammering the server while still being responsive:
- First retry: 250ms (quick check)
- Second retry: 500ms
- Third retry: 750ms
- Fourth+ retries: 1000ms (max)

---

## Files Referenced

| File | Purpose |
|------|---------|
| `components/floating-toolbar.tsx` | Main floating toolbar component |
| `components/workspace/workspace-floating-toolbar.tsx` | Wrapper that controls visibility |
| `components/annotation-workspace-view.tsx` | View layout with DOM ordering |
| `components/workspace/workspace-canvas-content.tsx` | Canvas + welcome overlay |
| `lib/hooks/annotation/use-knowledge-base-workspace.ts` | Global workspace ID management |
| `lib/utils/note-creator.ts` | Note creation utility |
| `lib/hooks/annotation/use-workspace-floating-toolbar.ts` | Floating toolbar props/visibility |
