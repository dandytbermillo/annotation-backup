# Implementation Plan: Merge Dashboard & Workspace Views

**Feature Slug:** `merge_dashboard_workspace`
**Created:** 2025-12-05
**Status:** PLANNED
**Last Verified:** 2025-12-05

---

## 1. Overview

### Goal
Unify the Entry Dashboard and Entry Workspace experiences by:
1. Replacing the custom workspace dropdown in DashboardView with the `WorkspaceToggleMenu` component
2. Embedding the workspace canvas within DashboardView instead of navigating to a separate view
3. Allowing seamless switching between Dashboard panels and Workspace canvas without leaving the entry context

### Benefits
- **Consistent UI**: Same workspace dropdown in both views
- **Faster switching**: No full page navigation/remount
- **Better context**: User always knows they're in the entry
- **Rich features**: Create, rename, delete workspaces from Dashboard
- **Unified experience**: Single view that handles both modes

---

## 2. Current Architecture

### Entry Dashboard Flow (Current)
```
DashboardInitializer
└── showDashboard = true
    └── DashboardView
        ├── Header (breadcrumb, Dashboard button, custom dropdown)
        └── Dashboard Panels (Continue, Navigator, Recent, etc.)

    showDashboard = false
    └── AnnotationAppShell
        ├── HomeNavigationButton
        ├── WorkspaceToggleMenu (NOTE WORKSPACE dropdown)
        └── AnnotationWorkspaceCanvas
```

### Components Involved
| Component | Location | Purpose |
|-----------|----------|---------|
| `DashboardView` | `components/dashboard/DashboardView.tsx` | Renders dashboard with panels |
| `DashboardInitializer` | `components/dashboard/DashboardInitializer.tsx` | Handles view switching |
| `WorkspaceToggleMenu` | `components/workspace/workspace-toggle-menu.tsx` | Rich workspace dropdown |
| `AnnotationAppShell` | `components/annotation-app-shell.tsx` | Full workspace canvas view |
| `AnnotationWorkspaceCanvas` | `components/workspace/annotation-workspace-canvas.tsx` | Canvas rendering |

---

## 3. Proposed Architecture

### Unified Entry View Flow (Proposed)
```
DashboardInitializer
└── showDashboard = true (always for entries)
    └── DashboardView (enhanced)
        ├── Header
        │   ├── Breadcrumb (Home > Entry > Dashboard/Workspace)
        │   ├── Dashboard button (toggle to dashboard mode)
        │   └── WorkspaceToggleMenu (replaces custom dropdown)
        │
        ├── viewMode = 'dashboard'
        │   └── Dashboard Panels
        │
        └── viewMode = 'workspace'
            └── EmbeddedWorkspaceCanvas (new component)
```

### New State in DashboardView
```typescript
type ViewMode = 'dashboard' | 'workspace'

interface DashboardViewState {
  viewMode: ViewMode
  activeWorkspaceId: string | null  // Selected workspace when in workspace mode
  // ... existing state
}
```

---

## 4. Implementation Phases

### Phase 1: Replace Dropdown with WorkspaceToggleMenu

**Scope:** Replace the custom dropdown in DashboardView with WorkspaceToggleMenu

**Files to Modify:**
- `components/dashboard/DashboardView.tsx`

**Changes:**
1. Import `WorkspaceToggleMenu` component
2. Remove custom dropdown implementation (lines ~460-550)
3. Add WorkspaceToggleMenu with appropriate props
4. Wire up workspace selection, creation, deletion, rename handlers

**Implementation Details:**

```typescript
// Add imports
import { WorkspaceToggleMenu } from "@/components/workspace/workspace-toggle-menu"

// Add state for menu and workspace operations
const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null)

// Handler to select workspace - NOTE: onSelectWorkspace expects (workspaceId: string), not full object
const handleWorkspaceSelectById = useCallback((workspaceId: string) => {
  const ws = workspaces.find(w => w.id === workspaceId)
  if (ws) {
    setWorkspaceMenuOpen(false)
    if (entryId && onNavigate) {
      onNavigate(entryId, ws.id)
    }
  }
}, [workspaces, entryId, onNavigate])

// Replace custom dropdown with:
<WorkspaceToggleMenu
  className="pointer-events-auto"
  labelTitle="NOTE WORKSPACE"
  statusLabel={workspaces.find(ws => ws.isDefault)?.name || "Workspace"}
  isOpen={workspaceMenuOpen}
  onToggleMenu={() => setWorkspaceMenuOpen(prev => !prev)}
  onCreateWorkspace={handleCreateWorkspace}
  disableCreate={isWorkspacesLoading}
  isListLoading={isWorkspacesLoading}
  workspaces={workspaces}  // API already returns noteCount and updatedAt
  currentWorkspaceId={null}  // No "current" workspace when viewing dashboard
  deletingWorkspaceId={deletingWorkspaceId}
  onSelectWorkspace={handleWorkspaceSelectById}  // NOTE: expects (id: string)
  onDeleteWorkspace={handleDeleteWorkspace}
  onRenameWorkspace={handleRenameWorkspace}
/>
```

**API Changes Needed:**
- ~~Modify `/api/entries/[entryId]/workspaces` to return item counts and dates~~ **NOT NEEDED**
- ✅ API already returns: `id`, `name`, `isDefault`, `updatedAt`, `noteCount`
- The response uses `noteCount` which maps to `WorkspaceSummary.noteCount`

**Acceptance Criteria:**
- [ ] WorkspaceToggleMenu renders in Dashboard header
- [ ] Shows "NOTE WORKSPACE" label
- [ ] Displays workspace list with item counts and dates
- [ ] Create workspace button works
- [ ] Rename workspace works
- [ ] Delete workspace works (with confirmation)
- [ ] Selecting workspace triggers navigation (Phase 1) or view switch (Phase 2)

---

### Phase 2: Add View Mode State

**Scope:** Add ability to switch between dashboard and workspace modes within DashboardView

**Files to Modify:**
- `components/dashboard/DashboardView.tsx`
- `components/dashboard/DashboardInitializer.tsx`

**Changes:**

1. Add viewMode state to DashboardView:
```typescript
type ViewMode = 'dashboard' | 'workspace'

const [viewMode, setViewMode] = useState<ViewMode>('dashboard')
const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
```

2. Update workspace selection handler:
```typescript
const handleWorkspaceSelect = useCallback((ws: WorkspaceSummary) => {
  setWorkspaceMenuOpen(false)
  setActiveWorkspaceId(ws.id)
  setViewMode('workspace')
  // Don't call onNavigate - stay in DashboardView
}, [])
```

3. Update Dashboard button to toggle mode:
```typescript
<button
  onClick={() => setViewMode('dashboard')}
  style={{
    // Highlight when viewMode === 'dashboard'
    background: viewMode === 'dashboard' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
  }}
>
  Dashboard
</button>
```

4. Conditional rendering based on viewMode:
```typescript
{viewMode === 'dashboard' ? (
  <DashboardPanelsCanvas panels={panels} ... />
) : (
  <EmbeddedWorkspaceCanvas workspaceId={activeWorkspaceId} ... />
)}
```

**Acceptance Criteria:**
- [ ] viewMode state controls which content is shown
- [ ] Dashboard button switches to dashboard mode
- [ ] Workspace selection switches to workspace mode
- [ ] Header remains visible in both modes
- [ ] Breadcrumb updates to show current mode

---

### Phase 3 Pre-requisites (MUST complete before Phase 3 implementation)

> **⛔ BLOCKER:** Phase 3 cannot begin until these pre-requisites are resolved.

#### 3.0.1 Provider Strategy Decision

Choose ONE approach and document rationale:

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **Isolated Stack** | EmbeddedWorkspaceCanvas has its own `LayerProvider` → `CanvasWorkspaceProvider` → `ConstellationProvider` stack, completely separate from AnnotationAppShell | Clean isolation, no state leakage | Duplicate providers, potential memory overhead |
| **Shared Root** | Move providers to app root (`_app.tsx` or layout), both DashboardView and AnnotationAppShell consume same context | Single source of truth, simpler state | Requires refactoring existing provider placement |
| **Conditional Mount** | Mount full `AnnotationAppShell` as child of DashboardView when `viewMode === 'workspace'` | Fastest to implement, full feature parity | May have styling conflicts, providers nested inside dashboard |

**Decision Required:** [ ] Isolated Stack / [ ] Shared Root / [x] **Conditional Mount + Preserved State (Option C)**

**Rationale:**
- Workspace canvas stays mounted (hidden) when in dashboard mode
- Preserves workspace state (camera position, open notes, editor state) across mode switches
- Fast switching - no provider teardown/reconstruction
- Runtime manager doesn't need to re-hydrate workspace
- User returns to exact canvas state when switching back
- Trade-off: Memory overhead acceptable for better UX

---

#### 3.0.2 Entry Context Alignment Checklist

The embedded workspace MUST respect entry boundaries. Verify these before implementation:

```typescript
// Entry context is set in lib/entry/entry-context.ts
import { setActiveEntryContext, getActiveEntryContext } from "@/lib/entry"
```

**Pre-implementation verification:**
- [ ] `setActiveEntryContext(entryId)` is called before rendering EmbeddedWorkspaceCanvas
- [ ] `useNoteWorkspaces` hook filters workspaces by `activeEntryContext`
- [ ] Runtime manager (`lib/workspace/runtime-manager.ts`) respects entry boundaries
- [ ] Workspace list API (`/api/entries/[entryId]/workspaces`) only returns workspaces for specified entry
- [ ] Test: Create workspace in Entry A, switch to Entry B → workspace NOT visible

**Entry context flow:**
```
DashboardView (entryId prop)
  └── setActiveEntryContext(entryId)  // MUST call before canvas
      └── EmbeddedWorkspaceCanvas
          └── useNoteWorkspaces  // Should use activeEntryContext
              └── Only shows workspaces for current entry
```

**⛔ BLOCKER CHECK:** Before starting Phase 3, run these verification tests:
```bash
# 1. Verify entry context module exists and works
test -f lib/entry/entry-context.ts && echo "EXISTS"

# 2. Check if useNoteWorkspaces uses entry context
grep -n "activeEntryContext\|getActiveEntryContext" lib/hooks/annotation/use-note-workspaces.ts

# 3. Check runtime manager entry boundaries
grep -n "entryId\|entry" lib/workspace/runtime-manager.ts

# 4. Manual test: Create workspace in Entry A, navigate to Entry B
# Expected: Entry B's dashboard should NOT show Entry A's workspaces
```

If any of these checks fail, **entry context work must be completed first**.

---

#### 3.0.3 Navigation State Specification

Define exact data stored in navigation stack for embedded mode:

```typescript
// lib/navigation/navigation-context.ts
export interface NavigationEntry {
  // Existing fields
  entryId: string
  entryName: string
  dashboardWorkspaceId: string
  workspaceId?: string
  workspaceName?: string
  timestamp: number

  // NEW: Fields for embedded workspace mode
  viewMode: 'dashboard' | 'workspace'
  activeWorkspaceId?: string  // Only set when viewMode === 'workspace'
}
```

**URL Format for Deep Linking:**
```
Dashboard mode:  /entry/[entryId]
Workspace mode:  /entry/[entryId]?view=workspace&ws=[workspaceId]
```

**Refresh/Deep Link Restoration Flow:**
```
1. Parse URL params: view, ws
2. If view === 'workspace' && ws exists:
   a. Set viewMode = 'workspace'
   b. Set activeWorkspaceId = ws
   c. Verify workspace belongs to entry (security check)
3. Else:
   a. Set viewMode = 'dashboard'
```

**State persistence decision:**
- [ ] URL params only (stateless, shareable links)
- [ ] URL + localStorage (persist across sessions)
- [ ] URL + navigation context (in-memory only)

---

#### 3.0.4 Runtime Manager Considerations

The `lib/workspace/runtime-manager.ts` uses LRU eviction with capacity limits:

```typescript
const DESKTOP_RUNTIME_CAP = 4
const TOUCH_RUNTIME_CAP = 2
```

**Embedded mode concerns:**
- [ ] When user switches entries in embedded mode, does LRU correctly track?
- [ ] Can LRU evict the currently-viewed embedded workspace? (Should NOT)
- [ ] Does `setRuntimeVisible()` get called correctly for embedded canvas?

**Required behavior:**
- Current embedded workspace should be marked as "hot" and protected from eviction
- Entry switch should trigger cleanup of previous entry's workspace state
- Mode switch (dashboard ↔ workspace) should NOT trigger full runtime teardown

---

#### 3.0.5 Hidden Shell Side Effects (CRITICAL)

When `AnnotationAppShell` is hidden via `display: none`, these issues may occur:

**Problem 1: React Portals bypass display:none**
```typescript
// Portals render at document.body level, NOT inside the hidden div
// These will STILL BE VISIBLE when shell is "hidden":
- FloatingToolbar (uses createPortal)
- Dropdown menus
- Modal dialogs
- Toast notifications
- Overlay popups
```

**Solution:** Pass `isHidden` prop to shell, conditionally disable portal rendering:
```typescript
// In AnnotationAppShell
{!isHidden && (
  <FloatingToolbar ... />
)}
```

**Problem 2: Keyboard shortcuts fire when hidden**
```typescript
// Event listeners don't know about display:none
// Cmd+Shift+H, Cmd+K, etc. will still trigger
```

**Solution:** Disable shortcuts when hidden:
```typescript
useEffect(() => {
  if (isHidden) return // Skip registering shortcuts

  const handleKeyDown = (e) => { ... }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [isHidden])
```

**Problem 3: Focus management**
```typescript
// Hidden elements shouldn't receive focus
// Tab navigation might jump into hidden shell
```

**Solution:** Add `inert` attribute or `tabIndex={-1}` when hidden:
```typescript
<div style={{ display: isHidden ? 'none' : 'block' }} inert={isHidden}>
  <AnnotationAppShell ... />
</div>
```

**Problem 4: Duplicate UI controls**
```typescript
// Both DashboardView header AND AnnotationAppShell have:
- Home button
- Workspace dropdown
- Navigation controls
```

**Solution:** Props to hide duplicate controls:
```typescript
<AnnotationAppShell
  hideHomeButton={true}
  hideWorkspaceToggle={true}  // Dashboard has its own
  isEmbedded={true}           // General "embedded mode" flag
/>
```

**Implementation checklist:**
- [ ] Add `isHidden` prop to AnnotationAppShell
- [ ] Conditionally render portals based on `isHidden`
- [ ] Disable keyboard shortcuts when hidden
- [ ] Add `inert` attribute to hidden container
- [ ] Add `hideHomeButton` prop (already in plan)
- [ ] Add `hideWorkspaceToggle` prop
- [ ] Audit all `createPortal` usage in shell components

---

#### 3.0.6 Memory & Performance Budget

**Memory estimation per mounted workspace:**

| Component | Estimated Size |
|-----------|----------------|
| TipTap editor instances (2-3 notes) | 2-5 MB |
| Canvas state & transforms | ~1 MB |
| React component tree | ~500 KB |
| Runtime manager state | ~200 KB |
| **Total per workspace** | **~5-10 MB** |

**Maximum memory with Option C:**

```
LRU cap (desktop): 4 workspaces
+ 1 always-mounted embedded shell
= 5 workspaces max

Memory range: 25-50 MB for workspace state
```

**Performance considerations:**
- [ ] Verify 50MB workspace budget is acceptable for target devices
- [ ] Consider reducing LRU cap if embedded mode is active: `EMBEDDED_RUNTIME_CAP = 3`
- [ ] Monitor memory in dev tools during testing
- [ ] Add memory warning if exceeding budget

**Idle cleanup (optional optimization):**
```typescript
// If user stays on dashboard for 5+ minutes, consider unmounting workspace
const IDLE_UNMOUNT_DELAY = 5 * 60 * 1000 // 5 minutes

useEffect(() => {
  if (viewMode === 'dashboard' && hasVisitedWorkspace) {
    const timeout = setTimeout(() => {
      setHasVisitedWorkspace(false) // Unmount to free memory
    }, IDLE_UNMOUNT_DELAY)
    return () => clearTimeout(timeout)
  }
}, [viewMode, hasVisitedWorkspace])
```

---

### Phase 3: Create Layered Dashboard/Workspace View (Option C)

**Scope:** Implement the layered approach where workspace canvas stays mounted but hidden when in dashboard mode.

**⚠️ COMPLEXITY WARNING:** This is the most complex phase. `AnnotationAppShell` uses 20+ specialized hooks and requires multiple context providers.

**Architecture: Option C - Layered/Preserved State**

```
DashboardView (enhanced)
├── Layer 1: Dashboard Panels
│   └── Visible when viewMode === 'dashboard'
│   └── Standard React components, no infinite canvas
│
└── Layer 2: Workspace Canvas (AnnotationAppShell)
    └── Always mounted after first workspace selection
    └── Hidden (display: none) when viewMode === 'dashboard'
    └── Visible when viewMode === 'workspace'
    └── State preserved across mode switches
```

**Benefits of This Approach:**
- ✅ Workspace state preserved in memory (camera, notes, editors)
- ✅ Fast mode switching (no remount)
- ✅ Full feature parity with standalone workspace
- ✅ No provider teardown/reconstruction
- ✅ **Existing persistence preserved** (see below)
- ⚠️ Trade-off: Memory overhead (acceptable)

---

**Preserving Existing Workspace Persistence:**

The existing `AnnotationAppShell` already persists workspace state correctly. Option C preserves this behavior:

| Scenario | Persistence Behavior | Notes |
|----------|---------------------|-------|
| Dashboard ↔ Workspace (same entry) | **In-memory** (no DB write needed) | `display: none` keeps React tree intact |
| Switch workspace A → B (same entry) | **Existing persistence** | `useNoteWorkspaces` saves A, loads B |
| Switch Entry A → Entry B | **Existing persistence** | `AnnotationAppShell` unmounts, cleanup effects persist |
| Browser close/refresh | **Existing persistence** | Normal unmount triggers save |

**Key principle:** Option C only adds a fast path for same-entry dashboard↔workspace switching. All other scenarios use the existing, already-working persistence mechanism.

```typescript
// Existing persistence hooks (DO NOT MODIFY):
// - useNoteWorkspaces: saves workspace state on switch/unmount
// - useWorkspaceOverlayPersistence: saves panel positions
// - useWorkspaceCanvasState: saves camera state
// - TipTap editors: auto-save content

// Option C only changes:
// - Same-entry mode switch uses display:none (no unmount = no persistence needed)
// - Everything else triggers normal unmount → existing persistence works
```

---

**Files to Modify:**
- `components/dashboard/DashboardView.tsx`

**Files NOT Created:**
- ~~`components/dashboard/EmbeddedWorkspaceCanvas.tsx`~~ - Not needed, use `AnnotationAppShell` directly

---

**Implementation Design:**

```typescript
// components/dashboard/DashboardView.tsx

interface DashboardViewProps {
  workspaceId: string
  onNavigate?: (entryId: string, workspaceId: string) => void
  entryId?: string
  entryName?: string
  homeEntryId?: string
  className?: string
}

export function DashboardView({
  workspaceId,
  onNavigate,
  entryId,
  entryName,
  homeEntryId,
  className,
}: DashboardViewProps) {
  // View mode state
  const [viewMode, setViewMode] = useState<'dashboard' | 'workspace'>('dashboard')
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

  // Track if workspace has been visited (for lazy mounting)
  const [hasVisitedWorkspace, setHasVisitedWorkspace] = useState(false)

  // Handle workspace selection
  const handleWorkspaceSelect = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId)
    setViewMode('workspace')
    setHasVisitedWorkspace(true)

    // Update active workspace context for the shell
    setActiveWorkspaceContext(workspaceId)
  }, [])

  // Handle return to dashboard
  const handleReturnToDashboard = useCallback(() => {
    setViewMode('dashboard')
    // Note: Don't clear activeWorkspaceId - preserve for quick return
  }, [])

  return (
    <div className={cn("relative w-full h-full", className)}>
      {/* Layer 1: Dashboard Panels */}
      <div
        style={{
          display: viewMode === 'dashboard' ? 'block' : 'none',
          position: 'absolute',
          inset: 0,
        }}
      >
        {/* Dashboard Header */}
        <DashboardHeader
          entryName={entryName}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          // ... other props
        />

        {/* Dashboard Panels Canvas */}
        <DashboardPanelsCanvas
          panels={panels}
          onNavigate={onNavigate}
          // ... other props
        />
      </div>

      {/* Layer 2: Workspace Canvas - Mounted after first visit, hidden when dashboard */}
      {hasVisitedWorkspace && activeWorkspaceId && (
        <div
          style={{
            display: viewMode === 'workspace' ? 'block' : 'none',
            position: 'absolute',
            inset: 0,
          }}
        >
          <AnnotationAppShell
            // Pass workspace context
            initialWorkspaceId={activeWorkspaceId}
            // Callback to return to dashboard
            onReturnToDashboard={handleReturnToDashboard}
            // Hide the shell's own home button (we have our own header)
            hideHomeButton={true}
            // Entry context
            entryId={entryId}
          />
        </div>
      )}
    </div>
  )
}
```

---

**Key Implementation Details:**

#### 1. Lazy Mounting
```typescript
// Only mount workspace after first selection
{hasVisitedWorkspace && activeWorkspaceId && (
  <AnnotationAppShell ... />
)}
```
- Avoids memory overhead until user actually visits a workspace
- Once mounted, stays mounted for fast switching

#### 2. Display Toggle (Not Conditional Render)
```typescript
// Use display: none, NOT conditional rendering
style={{ display: viewMode === 'workspace' ? 'block' : 'none' }}
```
- Keeps React tree intact
- Preserves all state (camera, editors, selections)
- Canvas doesn't re-render on mode switch

#### 3. Workspace Context Sync
```typescript
// When selecting workspace, update global context
setActiveWorkspaceContext(workspaceId)
```
- `AnnotationAppShell` reads from this context
- Ensures correct workspace loads

#### 4. Memory Management (Optional Enhancement)
```typescript
// If user hasn't touched workspace in 5 minutes while on dashboard,
// consider unmounting to free memory
useEffect(() => {
  if (viewMode === 'dashboard' && hasVisitedWorkspace) {
    const timeout = setTimeout(() => {
      // Optional: unmount workspace after idle period
      // setHasVisitedWorkspace(false)
    }, 5 * 60 * 1000) // 5 minutes
    return () => clearTimeout(timeout)
  }
}, [viewMode, hasVisitedWorkspace])
```

---

**AnnotationAppShell Modifications Required:**

```typescript
// components/annotation-app-shell.tsx

interface AnnotationAppShellProps {
  // NEW: Props for embedded mode
  initialWorkspaceId?: string
  onReturnToDashboard?: () => void
  hideHomeButton?: boolean
  entryId?: string
}

export function AnnotationAppShell({
  initialWorkspaceId,
  onReturnToDashboard,
  hideHomeButton = false,
  entryId,
}: AnnotationAppShellProps) {
  // If initialWorkspaceId provided, use it instead of reading from context
  const workspaceId = initialWorkspaceId ?? getActiveWorkspaceContext()

  // ... rest of implementation

  // Conditionally render home button
  {!hideHomeButton && (
    <HomeNavigationButton ... />
  )}
}
```

---

**Acceptance Criteria:**
- [ ] Dashboard panels visible when `viewMode === 'dashboard'`
- [ ] Workspace canvas visible when `viewMode === 'workspace'`
- [ ] Workspace NOT mounted until first workspace selection
- [ ] Workspace stays mounted when switching back to dashboard
- [ ] Canvas state preserved (camera position, zoom, open notes)
- [ ] Editor state preserved (cursor position, selections)
- [ ] Fast mode switching (< 100ms visual transition)
- [ ] No memory leaks from keeping workspace mounted
- [ ] Floating toolbar appears in workspace mode
- [ ] All canvas interactions work (pan, zoom, select, edit)
- [ ] Notes can be opened/closed
- [ ] Changes are persisted
- [ ] Switching workspaces loads correct content

**Persistence Acceptance Criteria (MUST NOT REGRESS):**
- [ ] Existing workspace-to-workspace persistence works unchanged
- [ ] Entry-to-entry navigation triggers proper save
- [ ] Browser refresh restores last workspace state
- [ ] TipTap editor content auto-saves as before
- [ ] Panel positions persist across sessions
- [ ] Camera state (zoom/pan) persists across sessions

---

### Phase 4: Update Navigation & State Management

**Scope:** Ensure navigation and state management work correctly with embedded workspace

**Files to Modify:**
- `components/dashboard/DashboardInitializer.tsx`
- `lib/navigation/navigation-context.ts`
- `components/navigation/HomeNavigationButton.tsx`

**Changes:**

#### 4.1 Update NavigationEntry Interface

```typescript
// lib/navigation/navigation-context.ts
export interface NavigationEntry {
  // Existing fields
  entryId: string
  entryName: string
  dashboardWorkspaceId: string
  workspaceId?: string
  workspaceName?: string
  timestamp: number

  // NEW: Embedded workspace mode tracking
  viewMode: 'dashboard' | 'workspace'
  activeWorkspaceId?: string  // Workspace ID when viewMode === 'workspace'
}
```

**⚠️ Type Safety: Breaking Change Mitigation**

Adding `viewMode` to `NavigationEntry` may break existing consumers. To ensure backward compatibility:

```typescript
// Option A: Make viewMode optional with default
viewMode?: 'dashboard' | 'workspace'  // Optional, defaults to 'dashboard'

// Then in consumers:
const mode = entry.viewMode ?? 'dashboard'

// Option B: Migration helper
export function getViewMode(entry: NavigationEntry): 'dashboard' | 'workspace' {
  return entry.viewMode ?? 'dashboard'
}
```

**Files to audit for NavigationEntry usage:**
```bash
# Find all files that use NavigationEntry
grep -rn "NavigationEntry" --include="*.ts" --include="*.tsx" lib/ components/
```

**Checklist:**
- [ ] Search for destructuring patterns: `const { entryId, entryName } = entry`
- [ ] Verify spread operators won't break: `{ ...entry, newField }`
- [ ] Update any switch/case statements on entry properties
- [ ] Add default value handling for `viewMode` in all consumers

#### 4.2 Add Navigation Helper Functions

```typescript
// lib/navigation/navigation-context.ts

/**
 * Update the current entry's view mode (dashboard ↔ workspace)
 */
export function updateViewMode(
  viewMode: 'dashboard' | 'workspace',
  activeWorkspaceId?: string
) {
  if (navigationStack.length === 0) return

  const current = navigationStack[navigationStack.length - 1]
  current.viewMode = viewMode
  current.activeWorkspaceId = viewMode === 'workspace' ? activeWorkspaceId : undefined
  current.timestamp = Date.now()

  notifyListeners()
}

/**
 * Get current view mode for the active entry
 */
export function getCurrentViewMode(): { viewMode: 'dashboard' | 'workspace'; activeWorkspaceId?: string } | null {
  const current = getCurrentNavigationEntry()
  if (!current) return null
  return {
    viewMode: current.viewMode || 'dashboard',
    activeWorkspaceId: current.activeWorkspaceId,
  }
}
```

#### 4.3 Update DashboardInitializer

```typescript
// components/dashboard/DashboardInitializer.tsx

// When rendering DashboardView, pass viewMode callbacks
<DashboardView
  workspaceId={currentDashboardWorkspaceId}
  onNavigate={handleDashboardNavigate}
  entryId={currentEntryInfo?.entryId}
  entryName={currentEntryInfo?.entryName}
  homeEntryId={dashboardInfo?.homeEntryId}
  // NEW: View mode management
  onViewModeChange={(mode, wsId) => {
    updateViewMode(mode, wsId)
    // Update URL if using URL-based state
    if (mode === 'workspace' && wsId) {
      window.history.replaceState({}, '', `?view=workspace&ws=${wsId}`)
    } else {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }}
  initialViewMode={/* parse from URL */}
  initialActiveWorkspaceId={/* parse from URL */}
/>
```

#### 4.4 Update HomeNavigationButton Behavior

```typescript
// components/navigation/HomeNavigationButton.tsx

const handleHomeClick = useCallback(() => {
  const currentViewMode = getCurrentViewMode()

  if (currentViewMode?.viewMode === 'workspace') {
    // In embedded workspace → go to dashboard (same entry)
    if (onViewModeChange) {
      onViewModeChange('dashboard')
      return
    }
  }

  // On dashboard → show navigation popup or go to Home entry
  if (currentEntry && onNavigate) {
    if (isOnDashboard) {
      setIsPopupOpen(prev => !prev)
    } else {
      onNavigate(currentEntry.entryId, currentEntry.dashboardWorkspaceId)
    }
  }
}, [currentEntry, onNavigate, isOnDashboard, onViewModeChange])
```

#### 4.5 URL-Based State Restoration

```typescript
// In DashboardInitializer or DashboardView initialization

useEffect(() => {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view')
  const ws = params.get('ws')

  if (view === 'workspace' && ws) {
    // Verify workspace belongs to current entry before setting
    verifyWorkspaceBelongsToEntry(ws, entryId).then(valid => {
      if (valid) {
        setViewMode('workspace')
        setActiveWorkspaceId(ws)
      } else {
        // Invalid workspace ID, fall back to dashboard
        setViewMode('dashboard')
        window.history.replaceState({}, '', window.location.pathname)
      }
    })
  }
}, [entryId])
```

**Acceptance Criteria:**
- [ ] Navigation stack correctly tracks view mode
- [ ] `updateViewMode()` function works correctly
- [ ] Home button behavior changes based on embedded mode
- [ ] URL updates when switching modes
- [ ] Refreshing page restores correct viewMode and activeWorkspaceId
- [ ] Deep link with invalid workspace ID falls back to dashboard
- [ ] Browser back/forward work as expected

---

### Phase 5: Polish & Edge Cases

**Scope:** Handle edge cases and polish the implementation

**Tasks:**
1. **Loading states**: Show loading indicator when switching modes
2. **Error handling**: Handle workspace load failures gracefully
3. **Empty states**: Handle case when workspace has no notes
4. **Keyboard shortcuts**: Cmd+Shift+D to toggle dashboard mode
5. **URL updates**: Update URL to reflect current mode (optional)
6. **Animations**: Smooth transitions between modes (optional)

**Edge Cases to Handle:**
- Workspace deleted while viewing it
- Workspace renamed while viewing it
- Network failure during mode switch
- Rapid mode switching
- Deep linking to specific workspace mode

---

## 5. File Change Summary

| File | Phase | Changes |
|------|-------|---------|
| `components/dashboard/DashboardView.tsx` | 1-3 | Major refactor - add WorkspaceToggleMenu, viewMode, layered canvas |
| `components/annotation-app-shell.tsx` | 3 | Add embedded mode props (see below) |
| `components/dashboard/DashboardInitializer.tsx` | 4 | Update navigation handling, URL state |
| `lib/navigation/navigation-context.ts` | 4 | Add `viewMode`, `activeWorkspaceId` to NavigationEntry (with backward compat) |
| `components/navigation/HomeNavigationButton.tsx` | 4 | Update for embedded mode |
| ~~`components/dashboard/EmbeddedWorkspaceCanvas.tsx`~~ | ~~3~~ | ~~New file~~ **NOT NEEDED - Using AnnotationAppShell directly** |
| ~~`app/api/entries/[entryId]/workspaces/route.ts`~~ | ~~1~~ | ~~Add item counts~~ **NOT NEEDED - Already returns them** |

**AnnotationAppShell New Props (Phase 3):**

```typescript
interface AnnotationAppShellProps {
  // Existing props...

  // NEW: Embedded mode props
  initialWorkspaceId?: string      // Override workspace context
  onReturnToDashboard?: () => void // Callback for "back to dashboard"
  hideHomeButton?: boolean         // Hide duplicate home button
  hideWorkspaceToggle?: boolean    // Hide duplicate workspace dropdown
  isEmbedded?: boolean             // General embedded mode flag
  isHidden?: boolean               // For portal/shortcut suppression
  entryId?: string                 // Entry context override
}
```

**Components requiring portal/shortcut audit:**
- `CanvasAwareFloatingToolbar` - uses portal
- `WorkspaceToggleMenu` - dropdown portal
- Keyboard shortcut handlers in shell

---

## 6. API Changes

### ✅ No API Changes Required

The existing endpoint already provides all necessary data:

**`GET /api/entries/[entryId]/workspaces`**

Current response (verified 2025-12-05):
```json
{
  "entry": {
    "id": "...",
    "name": "Entry Name",
    "isSystem": false
  },
  "workspaces": [
    {
      "id": "...",
      "name": "test11",
      "entryId": "...",
      "entryName": "Entry Name",
      "isDefault": true,
      "updatedAt": "2025-12-04T19:00:18Z",
      "noteCount": 3
    }
  ]
}
```

This matches `WorkspaceSummary` type expected by `WorkspaceToggleMenu`:
- `id` ✅
- `name` ✅
- `noteCount` ✅ (maps to `popupCount` or `noteCount`)
- `updatedAt` ✅
- `isDefault` ✅

---

## 7. Testing Plan

### Unit Tests
- [ ] DashboardView renders WorkspaceToggleMenu correctly
- [ ] viewMode state changes correctly on interactions
- [ ] EmbeddedWorkspaceCanvas loads workspace data
- [ ] Navigation context `updateViewMode()` works correctly
- [ ] URL params are parsed correctly on initialization

### Integration Tests
- [ ] Switching between dashboard and workspace modes
- [ ] Workspace CRUD operations from dashboard
- [ ] Navigation stack updates correctly
- [ ] State persistence across mode switches
- [ ] Entry context is set correctly before canvas render

### Manual Testing Checklist
- [ ] Open Entry Dashboard
- [ ] Verify WorkspaceToggleMenu shows workspaces with details
- [ ] Create new workspace from dropdown
- [ ] Select workspace - verify canvas loads
- [ ] Click Dashboard button - verify panels show
- [ ] Rename workspace
- [ ] Delete workspace
- [ ] Click Home button - verify correct navigation
- [ ] Refresh page - verify state restored
- [ ] Test with multiple entries

---

### Regression Test Matrix

> **Critical:** These tests ensure existing functionality continues to work after the merge.

#### Legacy Flow Tests (Workspace-Only Mode)

| Test ID | Scenario | Expected Behavior | Status |
|---------|----------|-------------------|--------|
| REG-01 | Direct navigation to AnnotationAppShell (bypass dashboard) | Works exactly as before, no regressions | [ ] |
| REG-02 | Legacy workspace URL without entry context | Loads workspace, entry context derived from workspace | [ ] |
| REG-03 | WorkspaceToggleMenu in AnnotationAppShell | Continues to work independently of dashboard | [ ] |
| REG-04 | Home button in legacy workspace mode | Navigates to entry dashboard | [ ] |

#### Entry Switching Tests

| Test ID | Scenario | Expected Behavior | Status |
|---------|----------|-------------------|--------|
| ENT-01 | Switch entry while in embedded workspace mode | Resets to dashboard, loads new entry's dashboard | [ ] |
| ENT-02 | Switch entry while in dashboard mode | Loads new entry's dashboard | [ ] |
| ENT-03 | Navigate Entry A → Entry B → Back to Entry A | Navigation stack preserved, correct state restored | [ ] |
| ENT-04 | Entry with no workspaces (only Dashboard) | Shows dashboard, workspace dropdown shows "No workspaces" | [ ] |

#### Runtime Manager & LRU Tests

| Test ID | Scenario | Expected Behavior | Status |
|---------|----------|-------------------|--------|
| LRU-01 | Open 5+ workspaces across entries in embedded mode | LRU evicts oldest, current workspace protected | [ ] |
| LRU-02 | Switch from embedded workspace to dashboard | Runtime NOT torn down, workspace stays "hot" | [ ] |
| LRU-03 | Close embedded workspace (switch to dashboard) | Canvas unmounted but runtime can be restored quickly | [ ] |
| LRU-04 | Rapid mode switching (dashboard ↔ workspace) | No state corruption, no memory leaks | [ ] |

#### Keyboard Shortcut Tests

| Test ID | Scenario | Expected Behavior | Status |
|---------|----------|-------------------|--------|
| KEY-01 | `Cmd+Shift+D` in embedded workspace | Toggles to dashboard mode | [ ] |
| KEY-02 | `Cmd+Shift+D` in dashboard mode | No action or toggles to last workspace | [ ] |
| KEY-03 | `Cmd+Shift+H` in embedded workspace | Goes to Home entry dashboard | [ ] |
| KEY-04 | Standard canvas shortcuts in embedded mode | All work (pan, zoom, select, etc.) | [ ] |

#### Deep Link & Refresh Tests

| Test ID | Scenario | Expected Behavior | Status |
|---------|----------|-------------------|--------|
| DL-01 | Deep link: `/entry/123?view=workspace&ws=456` | Opens Entry 123 in workspace mode with workspace 456 | [ ] |
| DL-02 | Deep link with invalid workspace ID | Falls back to dashboard mode | [ ] |
| DL-03 | Deep link with workspace from different entry | Security: Falls back to dashboard, shows error | [ ] |
| DL-04 | Refresh in embedded workspace mode | Restores exact state (viewMode + activeWorkspaceId) | [ ] |
| DL-05 | Refresh in dashboard mode | Stays in dashboard mode | [ ] |

#### Persistence Regression Tests (CRITICAL)

> These tests verify existing persistence behavior is NOT broken by Option C.

| Test ID | Scenario | Expected Behavior | Status |
|---------|----------|-------------------|--------|
| PERS-01 | Edit note in workspace → switch to dashboard → switch back | Edits preserved (in-memory, no DB round-trip) | [ ] |
| PERS-02 | Edit note in workspace A → switch to workspace B → back to A | Edits in A persisted to DB, restored on return | [ ] |
| PERS-03 | Edit note → navigate to different entry → return | Edits persisted to DB via unmount cleanup | [ ] |
| PERS-04 | Edit note → browser refresh | Edits restored from DB | [ ] |
| PERS-05 | Move panel position → switch to dashboard → back | Position preserved (in-memory) | [ ] |
| PERS-06 | Change camera zoom/pan → switch to dashboard → back | Camera state preserved (in-memory) | [ ] |
| PERS-07 | Open multiple notes → switch entry → return | Open notes list persisted and restored | [ ] |
| PERS-08 | Edit note → close browser tab → reopen | Edits saved via beforeunload/cleanup | [ ] |

#### Edge Case Tests

| Test ID | Scenario | Expected Behavior | Status |
|---------|----------|-------------------|--------|
| EDGE-01 | Delete workspace while viewing it (embedded) | Switch to dashboard, show toast notification | [ ] |
| EDGE-02 | Rename workspace while viewing it (embedded) | Header updates, no disruption | [ ] |
| EDGE-03 | Network failure during mode switch | Error state shown, can retry | [ ] |
| EDGE-04 | Create workspace from dashboard, immediately open | New workspace loads correctly in embedded mode | [ ] |

---

## 8. Rollout Plan

### Phase Readiness Summary

| Phase | Status | Blocker |
|-------|--------|---------|
| Phase 1 | ✅ **Ready** | None |
| Phase 2 | ✅ **Ready** | None |
| Phase 3 Pre-req | ⛔ **Blocked** | Requires decisions on 3.0.1-3.0.4 |
| Phase 3 | ⛔ **Blocked** | Depends on pre-requisites |
| Phase 4 | ⚠️ **Partially Ready** | Spec complete, depends on Phase 3 |
| Phase 5 | ✅ **Ready** | Depends on Phase 3-4 |

---

### Detailed Rollout

1. **Phase 1** (1-2 hours): Replace dropdown with WorkspaceToggleMenu
   - ✅ Ready to implement
   - Low risk, high value
   - Can ship independently
   - ✅ No API changes needed (already verified)

2. **Phase 2** (1 hour): Add viewMode state
   - ✅ Ready to implement
   - Preparation for embedded canvas
   - No user-facing changes yet

3. **Phase 3 Pre-requisites** (1-2 hours): Architectural decisions
   - ⛔ **Must complete before Phase 3**
   - [ ] Provider strategy decision (3.0.1)
   - [ ] Entry context verification (3.0.2)
   - [ ] Navigation state spec finalization (3.0.3)
   - [ ] Runtime manager review (3.0.4)

4. **Phase 3** (2-4 hours): Implement Layered Dashboard/Workspace (Option C)
   - ⛔ Blocked on pre-requisites
   - **Simplified by Option C** - No new EmbeddedWorkspaceCanvas needed
   - Use `AnnotationAppShell` directly with `display: none` layering
   - Add props to `AnnotationAppShell` for embedded mode

5. **Phase 4** (1-2 hours): Update navigation
   - ⚠️ Partially ready (spec now complete)
   - Wire everything together
   - Handle edge cases

6. **Phase 5** (1 hour): Polish
   - ✅ Ready (depends on 3-4)
   - Loading states, animations
   - Final testing + regression matrix

**Total estimated time:** 7-11 hours (reduced by Option C - no new component needed)

---

### Recommended Implementation Order

```
Week 1:
├── Day 1: Phase 1 (ship independently) ✅
├── Day 1: Phase 2 (no user-facing changes) ✅
└── Day 2: Phase 3 Pre-requisites (decisions + verification)

Week 2 (after pre-req sign-off):
├── Day 1-2: Phase 3 (EmbeddedWorkspaceCanvas)
├── Day 2: Phase 4 (navigation)
└── Day 3: Phase 5 (polish) + Regression testing
```

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| State conflicts between embedded canvas and dashboard | High | Isolate state, use separate contexts |
| Performance degradation from keeping canvas mounted | Medium | Lazy load canvas, unmount when not visible |
| Complex navigation state | Medium | Thorough testing, clear state machine |
| WorkspaceToggleMenu prop incompatibility | Low | Check component interface, adapt as needed |

---

## 10. Future Enhancements

After this implementation, potential future work:
1. **Split view**: Show dashboard panels alongside workspace canvas
2. **Floating panels**: Dashboard panels as floating widgets over canvas
3. **Workspace tabs**: Multiple workspaces open as tabs
4. **Quick workspace preview**: Hover to preview workspace content

---

## 11. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-12-05 | Use WorkspaceToggleMenu in Dashboard | Consistency, feature parity |
| 2025-12-05 | Embed canvas in DashboardView | Better UX, faster switching |
| 2025-12-05 | **Option C: Layered/Preserved State** | Workspace stays mounted (hidden) when on dashboard; preserves state across mode switches; fast switching; uses `display: none` not conditional render |
| 2025-12-05 | No API changes needed | Verified: `/api/entries/[entryId]/workspaces` already returns `noteCount` and `updatedAt` |
| 2025-12-05 | Add Phase 3 Pre-requisites gate | Plan review identified missing architectural decisions; must resolve before Phase 3 |
| 2025-12-05 | URL-based state for viewMode | Enables deep linking and refresh restoration; shareable links |
| 2025-12-05 | Comprehensive regression test matrix | Ensure legacy flows (bypass dashboard) continue working |
| 2025-12-05 | Add hidden shell side effects handling (3.0.5) | Portals, shortcuts, focus bypass `display:none`; need `isHidden` prop |
| 2025-12-05 | Add memory budget (3.0.6) | 25-50MB max for 5 workspaces; optional idle cleanup |
| 2025-12-05 | NavigationEntry backward compat | Make `viewMode` optional with default to avoid breaking consumers |

---

## 12. Verification Notes (2025-12-05)

### Verified Against Codebase

| Item | Status | Notes |
|------|--------|-------|
| DashboardView custom dropdown | ✅ | Lines 473-565 confirmed |
| WorkspaceToggleMenu component | ✅ | Props verified, requires ID-based callback |
| API response format | ✅ | Already includes `noteCount`, `updatedAt` |
| AnnotationAppShell complexity | ⚠️ | 20+ hooks, requires 3 context providers |
| EmbeddedWorkspaceCanvas | ~~⏳~~ | **NOT NEEDED** - Option C uses AnnotationAppShell directly |
| Option C: Layered approach | ✅ | Selected - workspace stays mounted, hidden via `display: none` |
| Entry context module | ✅ | `lib/entry/entry-context.ts` exists |
| Runtime manager | ✅ | `lib/workspace/runtime-manager.ts` - LRU caps verified |
| Navigation context | ✅ | `lib/navigation/navigation-context.ts` - needs `viewMode` field |

### Props Compatibility Notes

`WorkspaceToggleMenu` expects `onSelectWorkspace(workspaceId: string)` (just the ID).
The implementation must adapt the handler from the existing `handleWorkspaceSelect(ws: WorkspaceSummary)` pattern.

### Review Feedback Incorporated (2025-12-05)

Based on plan review, the following additions were made:

1. **Phase 3 Pre-requisites** - New section added with:
   - Provider strategy decision framework
   - Entry context alignment checklist
   - Navigation state specification
   - Runtime manager considerations

2. **Phase 4 Enhancements** - Detailed specifications for:
   - NavigationEntry interface updates
   - Helper functions (`updateViewMode`, `getCurrentViewMode`)
   - URL-based state restoration flow
   - HomeNavigationButton behavior changes

3. **Regression Test Matrix** - New comprehensive test matrix covering:
   - Legacy flow tests (bypass dashboard scenarios)
   - Entry switching tests
   - LRU eviction tests
   - Keyboard shortcut tests
   - Deep link and refresh tests
   - Edge case tests

4. **Readiness Status** - Updated to reflect:
   - Phase 1-2: Ready
   - Phase 3: Blocked on pre-requisites
   - Phase 4: Partially ready (spec complete)

5. **Option C Selected** (Layered/Preserved State):
   - Workspace canvas stays mounted, hidden via `display: none`
   - State preserved across mode switches
   - No new `EmbeddedWorkspaceCanvas` component needed
   - Use `AnnotationAppShell` directly with new props
   - Lazy mounting: only mount after first workspace visit

6. **Hidden Shell Side Effects** (added after second review):
   - React portals bypass `display: none` - need `isHidden` prop
   - Keyboard shortcuts fire when hidden - need conditional registration
   - Focus management - add `inert` attribute to hidden container
   - Duplicate UI controls - need additional hide props

7. **Memory & Performance** (added after second review):
   - Estimated 5-10MB per workspace
   - Max 25-50MB with LRU cap + embedded shell
   - Optional idle cleanup after 5 minutes on dashboard

8. **Type Safety** (added after second review):
   - `NavigationEntry.viewMode` should be optional for backward compat
   - Audit existing consumers for destructuring patterns

---

*Document created: 2025-12-05*
*Last updated: 2025-12-05*
*Last verified: 2025-12-05*
*Review feedback incorporated: 2025-12-05*
