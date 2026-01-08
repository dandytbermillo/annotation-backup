# Phase 3: Open Notes Source of Truth - Analysis Report

**Date:** 2026-01-08
**Feature:** Question-First Routing + Notes Context
**Phase:** 3 - Open Notes Source of Truth
**Status:** Analysis Complete - Ready for Implementation

---

## Executive Summary

Phase 3 ensures `uiContext.workspace.openNotes` reliably reflects the Open Notes dock panel state. While basic functionality already works (tested successfully), edge cases during workspace switches and hydration states can cause stale or missing data. This report documents the findings and proposes hardening fixes.

---

## Current Architecture

### Data Flow (Working Path)

```
Open Notes Dock Button (UI)
        ↓
CanvasWorkspaceContext.openNotes (useCanvasWorkspace hook)
        ↓
openNotesForContext (mapped with formatNoteLabel for titles)
        ↓
setUiContext({ workspace: { openNotes: openNotesForContext }})
        ↓
Chat API receives uiContext.workspace.openNotes
        ↓
LLM answers "Which notes are open?" correctly
```

### Key Components

| Component | File | Role |
|-----------|------|------|
| CanvasWorkspaceContext | `canvas-workspace-context.tsx` | Source of truth for `openNotes` |
| AnnotationAppShell | `annotation-app-shell.tsx` | Maps `openNotes` to `uiContext` |
| DashboardView | `DashboardView.tsx` | Also sets `uiContext` (CONFLICT) |
| NoteSwitcherPopover | `note-switcher-popover.tsx` | UI for Open Notes dock |

---

## Test Result (Basic Functionality)

**Test:** User in Workspace 6 with 2 open notes, asked "Which notes are open?"

**Result:** LLM correctly responded:
> "Notes live inside workspaces. Currently, in Workspace 6, the open notes are: 'New Note - Dec 11, 4:07 PM 1 - Dec 11, 4:07 PM' and 'New Note - Jan 8, 1:11 PM'."

**Conclusion:** Basic wiring exists and works in stable states.

---

## Edge Cases Identified

### Edge Case 1: Workspace Switch - Empty Notes Window

**Location:** `canvas-workspace-context.tsx` lines 198-232

**Issue:** When switching workspaces, `openNotes` becomes `[]` before hydration completes.

**Code:**
```typescript
// Lines 198-209 in canvas-workspace-context.tsx
const runtimeNotes = getRuntimeOpenNotes(workspaceId)
const useRuntime = runtimeNotes.length > 0

const nextSlots: OpenWorkspaceNote[] = useRuntime
  ? runtimeNotes.map(n => ({ noteId: n.noteId, ... }))
  : [] // ← Empty during transition!

setCurrentOpenNotes(nextSlots)  // ← Propagates empty array
```

**Timeline:**
1. User switches from Workspace A (3 notes) to Workspace B (2 notes)
2. `openNotes` becomes `[]` while waiting for hydration
3. User asks "Which notes are open?" → LLM says "no notes are open"
4. ~500ms later, hydration completes, notes appear

**Impact:** Brief window where LLM reports incorrect state.

---

### Edge Case 2: DashboardView Writes Workspace UIContext Without openNotes

**Location:** `DashboardView.tsx` lines 239-246

**Issue:** DashboardView sets `uiContext` for workspace mode WITHOUT `openNotes`:

```typescript
// DashboardView.tsx lines 239-246
const currentWorkspace = workspaces.find(ws => ws.id === activeWorkspaceId)
setUiContext({
  mode: 'workspace',
  workspace: {
    workspaceId: activeWorkspaceId ?? undefined,
    workspaceName: currentWorkspace?.name,
    // ❌ NO openNotes
    // ❌ NO activeNoteId
  },
})
```

**Architecture Context:**
```
DashboardView (viewMode === 'workspace')
    └── AnnotationAppShell (isHidden={false})
            └── setUiContext WITH openNotes
```

Both components run `setUiContext` effects:
1. **DashboardView** (fires first) → sets workspace uiContext WITHOUT `openNotes`
2. **AnnotationAppShell** (fires second) → sets workspace uiContext WITH `openNotes`

**Race Condition:** Brief window between effect executions where `openNotes` is undefined.

---

### Edge Case 3: No Hydration/Loading Indicator

**Location:** `annotation-app-shell.tsx` lines 1307-1327

**Issue:** `isHydrating` and `isWorkspaceLoading` are available but NOT used in the uiContext effect.

**Current Code:**
```typescript
useEffect(() => {
  if (isHidden || !isEntryActive) return  // No check for isHydrating!
  setUiContext({
    mode: 'workspace',
    workspace: { openNotes: openNotesForContext, ... },
  })
}, [...])  // isHydrating NOT in dependencies
```

**Impact:** LLM receives empty/stale data without knowing it's provisional.

---

### Edge Case 4: Mismatched Workspace ID and Notes

**Location:** Multiple effects with different dependency arrays

**Issue:** `workspaceId` can update before `openNotes` catches up.

**AnnotationAppShell effect dependencies:**
```typescript
[
  isHidden,
  isEntryActive,
  noteWorkspaceState.currentWorkspaceId,  // Updates first
  openNotesWorkspaceId,
  noteWorkspaceStatusLabel,
  openNotesForContext,                     // Updates later
  activeNoteId,
  setUiContext,
]
```

**Impact:** Brief window where `workspaceId` is "Workspace B" but `openNotes` contains Workspace A's notes.

---

## Proposed Fixes

### Fix 1: Remove DashboardView's Workspace UIContext Writing

**Rationale:** Single owner principle - AnnotationAppShell should exclusively own workspace `uiContext`.

**Change in `DashboardView.tsx`:**

```typescript
// BEFORE (lines 197-258)
useEffect(() => {
  if (!isEntryActive) {
    setUiContext(null)
    return
  }
  if (viewMode === 'dashboard') {
    setUiContext({ mode: 'dashboard', dashboard: { ... } })
    return
  }
  // This writes workspace without openNotes - REMOVE
  setUiContext({
    mode: 'workspace',
    workspace: { workspaceId, workspaceName },
  })
}, [...])

// AFTER
useEffect(() => {
  if (!isEntryActive) {
    setUiContext(null)
    return
  }
  if (viewMode === 'dashboard') {
    setUiContext({ mode: 'dashboard', dashboard: { ... } })
    return
  }
  // Workspace mode: Don't set uiContext here
  // AnnotationAppShell owns workspace mode uiContext exclusively
}, [...])
```

---

### Fix 2: Add `isStale` Flag to UIContext

**Rationale:** Allow LLM to respond appropriately during transitions.

**Change in `lib/chat/intent-prompt.ts`:**

```typescript
// Extend UIContext type
export interface UIContext {
  mode: 'dashboard' | 'workspace'
  dashboard?: { ... }
  workspace?: {
    workspaceId?: string
    workspaceName?: string
    openNotes?: Array<{ id: string; title: string; active?: boolean }>
    activeNoteId?: string | null
    isStale?: boolean  // NEW: indicates data may be provisional
  }
}
```

---

### Fix 3: Guard UIContext Update During Transitions

**Change in `annotation-app-shell.tsx`:**

```typescript
// BEFORE (lines 1307-1327)
useEffect(() => {
  if (isHidden || !isEntryActive) return
  setUiContext({
    mode: 'workspace',
    workspace: {
      workspaceId: ...,
      workspaceName: ...,
      openNotes: openNotesForContext,
      activeNoteId,
    },
  })
}, [/* existing deps */])

// AFTER
useEffect(() => {
  if (isHidden || !isEntryActive) return

  // Flag provisional state during transitions
  const isTransitioning = isHydrating || isWorkspaceLoading

  setUiContext({
    mode: 'workspace',
    workspace: {
      workspaceId: noteWorkspaceState.currentWorkspaceId ?? openNotesWorkspaceId ?? undefined,
      workspaceName: noteWorkspaceStatusLabel,
      openNotes: openNotesForContext,
      activeNoteId,
      isStale: isTransitioning,  // NEW
    },
  })
}, [
  // ... existing deps
  isHydrating,        // NEW
  isWorkspaceLoading, // NEW
])
```

---

### Fix 4: LLM Prompt Update for Stale State

**Change in LLM prompt:**

```
If uiContext.workspace.isStale is true, the workspace is currently loading.
Inform the user: "The workspace is loading. Please try again in a moment."
Do not report empty or partial open notes during this state.
```

---

## Implementation Priority

| Fix | Priority | Effort | Impact |
|-----|----------|--------|--------|
| Fix 1: Remove DashboardView workspace uiContext | HIGH | Low | Eliminates race condition |
| Fix 2: Add `isStale` flag | MEDIUM | Low | Enables graceful degradation |
| Fix 3: Guard during transitions | MEDIUM | Low | Accurate stale flagging |
| Fix 4: LLM prompt update | LOW | Low | Better UX during loading |

**Recommended Order:** Fix 1 → Fix 3 → Fix 2 → Fix 4

---

## Files to Modify

| File | Changes |
|------|---------|
| `components/dashboard/DashboardView.tsx` | Remove workspace mode uiContext writing (lines 239-246) |
| `components/annotation-app-shell.tsx` | Add `isStale` flag and transition guards (lines 1307-1327) |
| `lib/chat/intent-prompt.ts` | Add `isStale` to UIContext type (line ~544) |
| `lib/chat/intent-resolver.ts` | Handle `isStale` in answer_from_context responses |

---

## Acceptance Criteria

| Scenario | Expected Behavior |
|----------|-------------------|
| Stable workspace, ask "Which notes are open?" | Correct list of open notes |
| During workspace switch, ask "Which notes are open?" | "Workspace is loading..." OR correct list (no stale data) |
| After workspace switch completes | Correct list of open notes immediately |
| Open/close note via dock | uiContext updates on next query |
| Multiple rapid workspace switches | No stale data leakage between workspaces |

---

## Verification Plan

1. **Manual Test - Stable State:**
   - Open workspace with 2+ notes
   - Ask "Which notes are open?"
   - Verify correct response

2. **Manual Test - Workspace Switch:**
   - Open Workspace A with notes
   - Switch to Workspace B
   - Immediately ask "Which notes are open?"
   - Verify response is either loading message OR correct Workspace B notes

3. **Manual Test - Note Open/Close:**
   - In workspace, open a new note via dock
   - Ask "Which notes are open?"
   - Verify new note appears in response

4. **Automated Test:**
   - Add integration test for uiContext during workspace transitions

---

## Related Documents

- Plan: `question-first-routing-notes-context-plan.md`
- Phase 2b Report: `2026-01-07-phase2b-verb-ordinal-selection-report.md`

---

## Next Steps

1. Implement Fix 1 (remove DashboardView workspace uiContext)
2. Implement Fix 2 + Fix 3 (isStale flag + transition guards)
3. Test edge cases
4. Update LLM prompt if needed (Fix 4)
5. Write implementation report
