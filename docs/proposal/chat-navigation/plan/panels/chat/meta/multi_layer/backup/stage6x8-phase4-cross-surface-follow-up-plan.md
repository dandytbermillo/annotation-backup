# Plan: Stage 6x.8 Phase 4 — Cross-Surface Follow-Up Continuity

**Parent**: `stage6x8-cross-surface-semantic-routing-plan.md`
**Depends on**: Phase 3 (a+b+c) complete — note families migrated, recent-turn context working, immediate metadata available

---

## Context

Phase 3 migrated `note:read_content` and `note:state_info` through the cross-surface arbiter. Follow-up turns like "read it" and "summarize that again" now resolve on the first try.

Phase 4 extends the same architecture to non-note surfaces:

- `panel_widget:state_info` — "what panel is open?", "which widgets are visible?"
- `workspace:state_info` — "which workspace am I in?"
- `dashboard:state_info` — "what's on the dashboard?"

Navigation (`navigate`) remains deferred until the `/api/chat/navigate` convergence strategy is locked.

---

## Goal

Make `state_info` queries about panels, widgets, workspaces, and the dashboard route through the cross-surface arbiter with deterministic resolvers, so they work consistently regardless of wrapper language or follow-up phrasing.

---

## Non-goals

- No navigation migration (deferred)
- No mutation execution
- No `read_content` for non-note surfaces (no content reader exists)
- No change to Stage 6 content pipeline
- No change to `/api/chat/navigate`

---

## What Changes

### 1. Broaden arbiter entry condition

Phase 3 entry:
```
isNoteRelated && !classifierMatch && !isArbiterHardExcluded
```

Phase 4 entry:
```
hasSurfaceContext && !classifierMatch && !isArbiterHardExcluded && !isLikelyNavigateCommand
```

Where:
- `hasSurfaceContext` = `activeNoteId || noteReferenceDetected || hasVisiblePanels || hasActiveWorkspace || isDashboardActive`
- `isDashboardActive` = `uiContext?.mode === 'dashboard'` — ensures dashboard-only context (no widgets, no workspace) still qualifies
- `isLikelyNavigateCommand` = input matches explicit navigation verb forms (`open`, `go to`, `switch to`, `navigate to`) targeting a non-note surface — these are deferred to existing `/api/chat/navigate` and must NOT enter the arbiter in Phase 4

This broadens entry to non-note surfaces for `state_info` queries while preventing deferred `navigate` turns from hitting the arbiter and then falling through to legacy routing (double-LLM risk).

**New LLM calls**: Phase 4 does introduce new arbiter calls for non-note uncertain turns. The latency rule still applies — one arbiter call replaces (not stacks on) the uncertainty arbitration for migrated families.

### 2. Expand migrated-family gate

Phase 3:
```typescript
const MIGRATED_PAIRS = new Set(['note:read_content', 'note:state_info'])
```

Phase 4:
```typescript
const MIGRATED_PAIRS = new Set([
  'note:read_content',
  'note:state_info',
  'panel_widget:state_info',
  'workspace:state_info',
  'dashboard:state_info',
])
```

### 3. Add state-info resolvers for non-note surfaces

All deterministic. No LLM. Pure functions reading from `uiContext`.

#### `panel_widget:state_info`

**Question scope**: "what panel is open?", "which widgets are visible?", "how many panels are there?"
**Source**: `uiContext.dashboard.visibleWidgets` — the list of currently visible widget instances with `id`, `title`, `type`
**Distinction from dashboard**: panel_widget answers about specific panels/widgets. Dashboard answers about the overall dashboard container.

```typescript
export function resolvePanelWidgetStateInfo(uiContext: UIContext): string {
  const widgets = uiContext?.dashboard?.visibleWidgets ?? []
  if (widgets.length === 0) return 'No panels are currently visible.'
  const names = widgets.map(w => w.title).join(', ')
  return `The visible panels are: ${names}.`
}
```

#### `workspace:state_info`

**Question scope**: "which workspace am I in?", "what workspace is this?"
**Source**: `uiContext.workspace.workspaceName` — the current workspace name from workspace state

```typescript
export function resolveWorkspaceStateInfo(uiContext: UIContext): string {
  const name = uiContext?.workspace?.workspaceName
  if (!name) return 'No workspace is currently active.'
  return `You are in workspace ${name}.`
}
```

#### `dashboard:state_info`

**Question scope**: "what's on the dashboard?", "how many widgets are there?"
**Source**: `uiContext.dashboard.entryName` (the entry this dashboard belongs to) + `uiContext.dashboard.visibleWidgets.length` (widget count)
**Distinction from panel_widget**: dashboard answers about the container-level view (which entry, how many widgets). Panel_widget answers about specific widget instances (names, types).

```typescript
export function resolveDashboardStateInfo(uiContext: UIContext): string {
  const widgets = uiContext?.dashboard?.visibleWidgets ?? []
  const entryName = uiContext?.dashboard?.entryName
  if (widgets.length === 0) return entryName ? `The dashboard for ${entryName} is empty.` : 'The dashboard is empty.'
  return `The dashboard${entryName ? ` for ${entryName}` : ''} has ${widgets.length} widget${widgets.length === 1 ? '' : 's'}.`
}
```

### 4. Wire new resolvers in dispatcher

After the existing `note:state_info` path, add:

```typescript
} else if (isMigrated && rawDecision!.intentFamily === 'state_info' && rawDecision!.surface === 'panel_widget') {
  const answer = resolvePanelWidgetStateInfo(ctx.uiContext ?? {})
  // ... same addMessage + early return pattern as note state_info
} else if (isMigrated && rawDecision!.intentFamily === 'state_info' && rawDecision!.surface === 'workspace') {
  const answer = resolveWorkspaceStateInfo(ctx.uiContext ?? {})
  // ...
} else if (isMigrated && rawDecision!.intentFamily === 'state_info' && rawDecision!.surface === 'dashboard') {
  const answer = resolveDashboardStateInfo(ctx.uiContext ?? {})
  // ...
}
```

### 5. Update arbiter prompt context

The arbiter prompt currently only includes active note context. Phase 4 adds:

```
- Visible panels: {panelList or "none"}
- Current workspace: {workspaceName or "none"}
- Current entry: {entryName or "none"}
```

This gives the arbiter enough context to classify panel/workspace/dashboard queries.

### 6. Update clarifier copy for cross-surface

Phase 3 clarifier: "Do you want me to explain the current note, or navigate somewhere else?"

Phase 4 clarifier: should be surface-aware. When prior context is panel/workspace-scoped, the clarifier should reference that surface, not notes.

Simplest approach: keep one generic clarifier that doesn't assume a specific surface:
"I'm not sure what you're referring to. Could you be more specific?"

### 7. Update `previousRoutingMetadata` mappings

Add new tier labels for non-note state_info:

```typescript
if (tl === 'arbiter_panel_widget_state_info') {
  meta.surface = 'panel_widget'; meta.intentFamily = 'state_info'; meta.turnOutcome = 'state_info_answered'
} else if (tl === 'arbiter_workspace_state_info') {
  meta.surface = 'workspace'; meta.intentFamily = 'state_info'; meta.turnOutcome = 'state_info_answered'
} else if (tl === 'arbiter_dashboard_state_info') {
  meta.surface = 'dashboard'; meta.intentFamily = 'state_info'; meta.turnOutcome = 'state_info_answered'
}
```

### 8. Non-note `read_content` policy

If the arbiter returns `panel_widget:read_content`, `workspace:read_content`, or `dashboard:read_content`:
- Do NOT route into Stage 6 (Stage 6 is note-only)
- Return: "Reading content is currently available for notes only."
- Never fall through silently

---

## Files to change

| File | Change |
|------|--------|
| `lib/chat/state-info-resolvers.ts` | Add `resolvePanelWidgetStateInfo`, `resolveWorkspaceStateInfo`, `resolveDashboardStateInfo` |
| `lib/chat/routing-dispatcher.ts` | Broaden entry condition; expand migrated-family gate; add resolver paths; update clarifier |
| `app/api/chat/cross-surface-arbiter/route.ts` | Add panel/workspace/entry context to prompt |
| `lib/chat/chat-navigation-context.tsx` | Add new tier label mappings to `buildPreviousRoutingMetadataFromTierLabel` |
| `__tests__/unit/chat/state-info-resolvers.test.ts` | **NEW** — resolver unit tests |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | Add panel/workspace/dashboard state_info integration tests |
| `__tests__/unit/chat/routing-metadata-timing.test.ts` | Add new tier label mapping tests |

---

## Tests

### Resolver unit tests

| Test | Verifies |
|------|----------|
| Panels visible → lists them | "The visible panels are: Links, Recent." |
| No panels → "No panels are currently visible." | Empty state |
| Workspace active → name shown | "You are in workspace budget100." |
| No workspace → "No workspace is currently active." | Empty state |
| Dashboard with widgets → count shown | "The dashboard has 3 widgets." |
| Dashboard empty → "The dashboard is empty." | Empty state |

### Integration tests

| Test | Verifies |
|------|----------|
| Arbiter returns `panel_widget:state_info` → deterministic answer | Resolver response in message |
| Arbiter returns `workspace:state_info` → deterministic answer | Resolver response |
| Arbiter returns `dashboard:state_info` → deterministic answer | Resolver response |
| Arbiter returns `panel_widget:read_content` → not-supported message | Does not enter Stage 6 |
| Arbiter returns `workspace:read_content` → not-supported message | Does not enter Stage 6 |
| Arbiter returns `dashboard:read_content` → not-supported message | Does not enter Stage 6 |
| "hi what panel is open?" → arbiter → panel state_info answer | Greeting-prefixed cross-surface query works |
| Follow-up after panel state → "how many are there?" → uses recent-turn context | Cross-surface state_info follow-up |

---

## Verification

1. `npm run type-check`
2. `npx jest --testPathPattern state-info-resolvers` — new resolver tests pass
3. `npx jest --testPathPattern content-intent-dispatcher` — existing + new integration tests pass
4. `npx jest --testPathPattern routing-metadata-timing` — new tier label mappings pass
5. Manual: "what panel is open?" → panel state answer
6. Manual: "which workspace am I in?" → workspace state answer
7. Manual: "hi which widgets are visible?" → greeting-prefixed panel query works

---

## Success Criteria

- Panel/widget, workspace, and dashboard state_info queries route through the arbiter
- Greeting-prefixed cross-surface queries work consistently
- Follow-up turns across surfaces use recent-turn context
- Non-note `read_content` returns bounded not-supported message (not Stage 6)
- Navigation remains deferred to existing `/api/chat/navigate` path
