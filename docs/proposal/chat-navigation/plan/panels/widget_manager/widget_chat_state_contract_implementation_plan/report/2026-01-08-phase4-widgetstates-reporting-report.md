# Phase 4: Dashboard/Workspace State Reporting (WidgetStates) Implementation Report

**Date:** 2026-01-08
**Feature:** Question-First Routing + Notes Context
**Phase:** 4 - Dashboard/Workspace State Reporting via WidgetStates
**Status:** Completed

---

## Summary

Implemented Dashboard and Workspace state reporting via the `widgetStates` system. Both dashboard and workspace now report their state using `upsertWidgetState()` with unique instance IDs (`dashboard-{entryId}` and `workspace-{workspaceId}`), making them the single source of truth for "what's visible/open" questions. This replaces the previous dual-source approach that caused race conditions and stale data leaks.

---

## Problem Statement

### Original Issues

1. **Race condition on workspace→dashboard switch:** When switching from workspace to dashboard, `DashboardView` and `AnnotationAppShell` both set `uiContext`. The workspace's open notes data persisted after switching to dashboard.

2. **LLM answered with wrong context:** On dashboard, "Which notes are open?" returned workspace notes like "testing chat, tesing note" instead of the correct "Notes live inside workspaces..." clarification.

3. **Multiple sources of truth:** Workspace data leaked through:
   - `uiContext.workspace` (not mode-guarded)
   - `sessionState.currentWorkspaceName` (not mode-guarded)
   - `widgetStates` (included workspace-* states on dashboard)

4. **Clarification loop:** After notes-scope clarification was triggered, subsequent questions got stuck in "I didn't quite catch that" loop because the clarification intercept caught ALL input.

### Root Causes

1. **`handleWidgetDoubleClick` bug:** Line 1039 called `getAllWidgetStates()` without filtering workspace states when opening a drawer.

2. **Missing mode guards:** `intent-prompt.ts` included workspace data regardless of current mode.

3. **Clarification intercept too aggressive:** Any input while clarification was active went through clarification handler, even new questions/commands.

---

## Solution

### Multi-Layer Defense Strategy

1. **WidgetStates filtering:** Dashboard mode filters out `workspace-*` states from `widgetStates`
2. **Ref-based cleanup:** Workspace uses ref to track last workspace ID for guaranteed cleanup
3. **Mode guards in prompt:** Only include workspace data in LLM context when `mode === 'workspace'`
4. **Clarification exit on new intent:** Detect new questions/commands and exit clarification mode

---

## Implementation Details

### Files Modified

#### 1. `components/dashboard/DashboardView.tsx`

**Change 1: Main effect workspace filtering (lines 209-215)**

```typescript
// Phase 4: Filter out workspace-* widgetStates when on dashboard
// This prevents stale workspace data from being sent to the LLM
// The LLM prefers widgetStates, so we must exclude workspace states in dashboard mode
const allWidgetStates = getAllWidgetStates()
const dashboardWidgetStates = Object.fromEntries(
  Object.entries(allWidgetStates).filter(([instanceId]) => !instanceId.startsWith('workspace-'))
)
```

**Change 2: Dashboard widgetState reporting (lines 262-310)**

```typescript
// Phase 4: Dashboard state reporting via widgetStates
// Reports dashboard state for LLM context (same contract as widgets)
useEffect(() => {
  // Only report in dashboard mode when entry is active
  if (viewMode !== 'dashboard' || !isEntryActive) {
    // Clean up when leaving dashboard mode
    removeWidgetState(`dashboard-${entryId}`)
    return
  }

  const openDrawerTitle = drawerPanel?.title ?? drawerPanel?.panelType ?? null
  const widgetCount = visibleWidgets.length
  const summary = openDrawerTitle
    ? `${entryName} dashboard with ${widgetCount} widgets, "${openDrawerTitle}" drawer open`
    : `${entryName} dashboard with ${widgetCount} widgets`

  upsertWidgetState({
    _version: 1,
    widgetId: 'dashboard',
    instanceId: `dashboard-${entryId}`,
    title: `${entryName} Dashboard`,
    view: openDrawerTitle ? 'drawer' : 'main',
    selection: openDrawerTitle ? { id: drawerPanel?.id ?? '', label: openDrawerTitle } : null,
    summary,
    updatedAt: Date.now(),
    counts: { widgets: widgetCount },
    contextTags: ['entry-dashboard', `entry-${entryId}`],
  })

  return () => { removeWidgetState(`dashboard-${entryId}`) }
}, [viewMode, entryId, entryName, visibleWidgets, drawerPanel, isEntryActive])
```

**Change 3: handleWidgetDoubleClick filtering (lines 1027-1044)**

```typescript
const handleWidgetDoubleClick = useCallback((panel: WorkspacePanel) => {
  setDrawerPanel(panel)
  if (isEntryActive) {
    // Phase 4: Filter out workspace-* widgetStates when on dashboard (same as main effect)
    const allWidgetStates = getAllWidgetStates()
    const dashboardWidgetStates = Object.fromEntries(
      Object.entries(allWidgetStates).filter(([instanceId]) => !instanceId.startsWith('workspace-'))
    )
    setUiContext({
      mode: 'dashboard',
      dashboard: {
        // ...
        widgetStates: dashboardWidgetStates,  // Was: getAllWidgetStates()
      },
    })
  }
  // ...
})
```

#### 2. `components/annotation-app-shell.tsx`

**Change 1: Ref for guaranteed cleanup (line 1348)**

```typescript
// Phase 4: Ref to track last workspace ID for guaranteed cleanup
// When switching to dashboard, currentWorkspaceId may become null before cleanup runs
// This ref ensures we can always clean up the correct workspace state
const lastWorkspaceIdRef = useRef<string | null>(null)
```

**Change 2: Workspace widgetState reporting (lines 1350-1420)**

```typescript
// Phase 4: Workspace state reporting via widgetStates
// Reports workspace state for LLM context (same contract as widgets)
useEffect(() => {
  const currentWorkspaceId = noteWorkspaceState.currentWorkspaceId ?? openNotesWorkspaceId

  // Clean up when leaving workspace mode (isHidden) or inactive
  // Use the ref to ensure cleanup even if currentWorkspaceId is null
  if (isHidden || !isEntryActive) {
    if (lastWorkspaceIdRef.current) {
      void debugLog({
        component: 'AnnotationAppShell',
        action: 'cleanup_workspace_widgetState',
        metadata: { lastWorkspaceId: lastWorkspaceIdRef.current, isHidden, isEntryActive },
      })
      removeWidgetState(`workspace-${lastWorkspaceIdRef.current}`)
      lastWorkspaceIdRef.current = null
    }
    return
  }

  if (!currentWorkspaceId) return

  // Track the workspace ID when active (for cleanup)
  lastWorkspaceIdRef.current = currentWorkspaceId

  const noteCount = openNotesForContext.length
  const activeNoteName = openNotesForContext.find(n => n.active)?.title ?? null
  const isLoading = isHydrating || isWorkspaceLoading
  const summary = isLoading
    ? `${noteWorkspaceStatusLabel} loading...`
    : noteCount === 0
      ? `${noteWorkspaceStatusLabel} with no open notes`
      : activeNoteName
        ? `${noteWorkspaceStatusLabel} with ${noteCount} open note${noteCount !== 1 ? 's' : ''}, active: "${activeNoteName}"`
        : `${noteWorkspaceStatusLabel} with ${noteCount} open note${noteCount !== 1 ? 's' : ''}`

  upsertWidgetState({
    _version: 1,
    widgetId: 'workspace',
    instanceId: `workspace-${currentWorkspaceId}`,
    title: noteWorkspaceStatusLabel,
    view: isLoading ? 'loading' : 'canvas',
    selection: activeNoteName ? { id: activeNoteId ?? '', label: activeNoteName } : null,
    summary,
    updatedAt: Date.now(),
    counts: { openNotes: noteCount },
    contextTags: ['entry-workspace', `workspace-${currentWorkspaceId}`],
  })

  return () => { removeWidgetState(`workspace-${currentWorkspaceId}`) }
}, [isHidden, isEntryActive, noteWorkspaceState.currentWorkspaceId, openNotesWorkspaceId, ...])
```

#### 3. `lib/chat/intent-prompt.ts`

**Change 1: Mode guard for uiContext.workspace (lines 721-739)**

```typescript
// Phase 4: Only include workspace info when mode is 'workspace'
// This prevents stale workspace data from confusing the LLM on dashboard
if (uc.mode === 'workspace' && uc.workspace) {
  contextBlock += `  workspace:\n`
  if (uc.workspace.workspaceName) {
    contextBlock += `    workspaceName: "${uc.workspace.workspaceName}"\n`
  }
  if (uc.workspace.openNotes && uc.workspace.openNotes.length > 0) {
    contextBlock += `    openNotes:\n`
    uc.workspace.openNotes.forEach((note) => {
      const activeLabel = note.active ? ' [active]' : ''
      contextBlock += `      - "${note.title}"${activeLabel}\n`
    })
  }
  // Phase 3: Include isStale flag so LLM knows data may be provisional
  if (uc.workspace.isStale) {
    contextBlock += `    isStale: true (workspace is loading, data may be provisional)\n`
  }
}
```

**Change 2: Mode guard for sessionState.currentWorkspaceName (lines 750-754)**

```typescript
// Phase 4: Only include currentWorkspaceName when in workspace mode
// Prevents LLM from inferring workspace info when on dashboard
if (ss.currentViewMode === 'workspace' && ss.currentWorkspaceName) {
  contextBlock += `  currentWorkspaceName: "${ss.currentWorkspaceName}"\n`
}
```

**Change 3: Prompt rules update (lines 223-233)**

```
- PHASE 4 PRIORITY: For "what's visible/open" questions, prefer widgetStates summaries:
  - Look for widgetStates with instanceIds like "dashboard-{entryId}" or "workspace-{workspaceId}"
  - Dashboard state: use summary from dashboard widgetState (e.g., "Home dashboard with 7 widgets")
  - Workspace state: use summary from workspace widgetState (e.g., "Workspace 6 with 3 open notes")
  - If widgetStates missing or stale, fall back to uiContext
```

#### 4. `components/chat/chat-navigation-panel.tsx`

**Change: Clarification exit on new intent (lines 1639-1657)**

```typescript
// Phase 4 Fix: Detect new questions/commands that should exit clarification mode
// If user asks a new question (not a reply to clarification), clear clarification and route normally
const QUESTION_START_PATTERN = /^(what|which|where|when|how|why|who|is|are|do|does|did|can|could|should|would)\b/i
const COMMAND_START_PATTERN = /^(open|show|go|list|create|close|delete|rename|back|home)\b/i
const isNewQuestionOrCommand =
  QUESTION_START_PATTERN.test(trimmedInput) ||
  COMMAND_START_PATTERN.test(trimmedInput) ||
  trimmedInput.endsWith('?')

// Phase 4 Fix: If user asks new question/command while clarification is active, exit clarification mode
if (lastClarification?.nextAction && isNewQuestionOrCommand) {
  void debugLog({
    component: 'ChatNavigation',
    action: 'clarification_exit_new_intent',
    metadata: { userInput: trimmedInput, wasNextAction: lastClarification.nextAction },
  })
  setLastClarification(null)
  // Fall through to normal routing below
}
```

---

## Design Decisions

### Why Ref-Based Cleanup?

When switching from workspace to dashboard:
1. `viewMode` changes to 'dashboard'
2. `isHidden` becomes true in AnnotationAppShell
3. `currentWorkspaceId` may become null before cleanup runs

The ref ensures we always have the last valid workspace ID to clean up, even if the state has already transitioned.

### Why Filter on Dashboard Instead of Cleanup Only?

Multiple layers of defense:
1. **Cleanup:** Removes workspace widgetState when leaving workspace mode
2. **Filter:** Excludes any lingering workspace states from dashboard context
3. **Mode guards:** Prevents workspace data in LLM prompt when mode is dashboard

This belt-and-suspenders approach handles edge cases like:
- Multiple entries with different workspaces
- Race conditions during fast switches
- Stale data from previous sessions

### Why Exit Clarification on New Intent?

The clarification intercept was designed to catch "yes/please do" responses. But when users ask a NEW question like "Which notes are open?" again, that's not a reply to "Would you like to open a workspace?" - it's a new intent that should be routed normally.

Pattern detection:
- Question words: what/which/where/when/how/why/who/is/are/do/does/did/can/could/should/would
- Command verbs: open/show/go/list/create/close/delete/rename/back/home
- Ends with "?"

---

## User Flow

### Before (Broken)

```
User: "Which notes are open?" (on dashboard)
Bot: "In Workspace 2, the open note is 'New Note'. In Workspace 6, there are several notes open."
     ❌ Wrong! Should clarify that notes live in workspaces

User: "Which notes are open?" (asks again)
Bot: "I didn't quite catch that. Would you like to open a workspace to see your notes?"
     ❌ Stuck in clarification loop

User: "where am i?"
Bot: "I didn't quite catch that. Would you like to open a workspace to see your notes?"
     ❌ New question caught by clarification intercept
```

### After (Fixed)

```
User: "Which notes are open?" (on dashboard)
Bot: "Notes live inside workspaces. Would you like to open a workspace to see your notes?"
     ✅ Correct clarification

User: "yes"
Bot: "Sure — which workspace?" + [Workspace 6] [Sprint 66] pills
     ✅ Workspace picker shown

User: [selects Workspace 6]
Bot: Navigates to workspace, shows open notes
     ✅ Flow completes

--- Alternative: New question breaks clarification ---

User: "Which notes are open?" (on dashboard)
Bot: "Notes live inside workspaces. Would you like to open a workspace to see your notes?"
     ✅ Clarification shown

User: "where am i?"
Bot: "You are on the summary14 C dashboard."
     ✅ New question handled normally (clarification cleared)
```

---

## Acceptance Criteria

Per `question-first-routing-notes-context-plan.md` Phase 4:

| Criterion | Status |
|-----------|--------|
| Dashboard reports state via `upsertWidgetState` with `dashboard-{entryId}` | ✅ |
| Workspace reports state via `upsertWidgetState` with `workspace-{workspaceId}` | ✅ |
| "What widgets are visible?" uses dashboard widgetState summary | ✅ |
| "What panel is open?" matches open drawer + dashboard summary | ✅ |
| "Which notes are open?" matches workspace widgetState + openNotes list | ✅ |
| After reload, "What widgets are visible?" responds correctly | ✅ |
| On-mount reporting so chat works immediately | ✅ |
| On-change reporting for drawer/notes/active changes | ✅ |
| Dashboard mode filters out workspace-* widgetStates | ✅ |
| Mode guards prevent workspace data leaking to dashboard | ✅ |
| Clarification loop prevented (new questions exit clarification) | ✅ |

---

## Type Check

```bash
$ npm run type-check
> tsc --noEmit -p tsconfig.type-check.json
# No errors
```

---

## Testing Checklist

### Manual Tests (Verified)

**Dashboard Mode:**
- [x] "Which notes are open?" → "Notes live inside workspaces..."
- [x] "What widgets are visible?" → Lists dashboard widgets
- [x] "What panel is open?" → Reports open drawer or "no panel drawer is open"
- [x] "where am i?" → Reports current dashboard location

**Workspace Mode:**
- [x] "Which notes are open?" → Lists open notes with titles
- [x] Switch workspaces → Notes list updates correctly
- [x] Active note change → Summary updates

**Mode Switching:**
- [x] Dashboard → Workspace → Dashboard: No stale workspace data
- [x] Rapid switching: Correct context maintained
- [x] Workspace widgetState cleaned up on dashboard switch

**Clarification Flow:**
- [x] Notes question on dashboard triggers clarification
- [x] "yes" shows workspace picker
- [x] New question during clarification exits clarification
- [x] "no" cancels clarification

### Edge Cases
- [x] Multiple entries with different workspaces (only current entry's workspace shown)
- [x] Drawer open on dashboard (widgetStates still filtered correctly)
- [x] Fast mode switches (no race conditions)

---

## Architecture

### WidgetState Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Widget State Store                        │
│  (lib/widgets/widget-state-store.ts)                        │
├─────────────────────────────────────────────────────────────┤
│  dashboard-entry123: { summary: "Home with 7 widgets" }     │
│  workspace-ws456: { summary: "Workspace 6 with 3 notes" }   │
│  quick-links-a: { summary: "Quick Links A with 5 items" }   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              DashboardView (dashboard mode)                  │
├─────────────────────────────────────────────────────────────┤
│  1. getAllWidgetStates()                                    │
│  2. Filter: exclude workspace-*                             │
│  3. setUiContext({ widgetStates: filteredStates })          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              API: /api/chat/navigate                         │
├─────────────────────────────────────────────────────────────┤
│  Receives context.uiContext with filtered widgetStates      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              intent-prompt.ts                                │
├─────────────────────────────────────────────────────────────┤
│  Mode guards:                                               │
│  - Only include uiContext.workspace when mode='workspace'   │
│  - Only include currentWorkspaceName when mode='workspace'  │
│  - Include filtered widgetStates in context                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              LLM (OpenAI)                                    │
├─────────────────────────────────────────────────────────────┤
│  Sees only dashboard-relevant state                         │
│  Returns answer_from_context with correct scope             │
└─────────────────────────────────────────────────────────────┘
```

### Cleanup Flow

```
Workspace Mode Active
        │
        │ User switches to dashboard
        ▼
┌─────────────────────────────────────────┐
│ DashboardView: viewMode → 'dashboard'   │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│ AnnotationAppShell: isHidden → true     │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│ Cleanup effect runs:                    │
│ - lastWorkspaceIdRef.current exists     │
│ - removeWidgetState(`workspace-${id}`)  │
│ - lastWorkspaceIdRef.current = null     │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│ Widget State Store:                     │
│ - workspace-* removed                   │
│ - Only dashboard-* and widget states    │
└─────────────────────────────────────────┘
```

---

## Risks & Limitations

1. **Stale widgetStates from other sources:** If widgets don't clean up their own states, they could persist. Dashboard filtering only handles `workspace-*` pattern.

2. **Multiple browser tabs:** Each tab has its own widget state store. Tab A's workspace state won't affect Tab B's dashboard.

3. **Pattern-based filtering:** `workspace-` prefix pattern must be consistent. If a widget used `workspace-` prefix for non-workspace state, it would be filtered.

4. **Clarification exit patterns:** New intent detection uses pattern matching. Unusual phrasings might not trigger exit (e.g., "tell me where am i").

---

## Related Documents

- Plan: `question-first-routing-notes-context-plan.md`
- Phase 2a Report: `2026-01-07-phase2a-clarification-yes-handling-report.md`
- Phase 2b Report: `2026-01-07-phase2b-verb-ordinal-selection-report.md`
- Patch (reference): `codex/patches/2026-01-07-phase4-widgetstates-solid.patch`

---

## Next Steps

- Monitor for edge cases in production
- Consider adding telemetry for mode switches and clarification exits
- Phase 3 cleanup: Remove any redundant uiContext workspace handling

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-01-08 | Initial Phase 4 implementation (dashboard/workspace widgetState reporting) |
| 2026-01-08 | Added ref-based cleanup for guaranteed workspace state removal |
| 2026-01-08 | Added mode guards in intent-prompt.ts |
| 2026-01-08 | Fixed handleWidgetDoubleClick filtering bug |
| 2026-01-08 | Fixed clarification loop with new intent detection |
| 2026-01-08 | All acceptance criteria verified |
