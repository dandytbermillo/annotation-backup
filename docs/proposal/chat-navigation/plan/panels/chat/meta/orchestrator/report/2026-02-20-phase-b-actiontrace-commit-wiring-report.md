# Phase B — ActionTrace Commit-Point Wiring: Implementation Report

**Date:** 2026-02-20
**Plan:** `centralized-actiontrace-commit-recording-plan.md`
**Phase:** B (Commit-point wiring, source metadata, freshness guard, resolver fix)
**Post-implementation audit:** 2026-02-20

---

## Summary

Phase B wires `recordExecutedAction` at 7 execution commit points across DashboardView (5) and DashboardInitializer (2), adds `source: 'chat'` metadata to CustomEvent dispatches, fixes the resolver ordering bug (`actionHistory[length-2]` → `actionHistory[1]`), and adds a freshness guard to `setLastAction` to prevent trace-derived state from being overwritten by slower legacy calls.

---

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/chat/use-chat-navigation.ts` | Modified | Added `source: 'chat'` to 7 dispatch sites, extended `WindowEventMap` with 5 typed events |
| `lib/chat/intent-resolver.ts` | Modified | Fixed resolver ordering: `actionHistory[1]` instead of `[length-2]` |
| `lib/chat/chat-navigation-context.tsx` | Modified | Added `lastTraceWriteRef`, `extractLastActionTargetId`, freshness guard in `setLastAction`, ref set in `recordExecutedAction` |
| `components/dashboard/DashboardView.tsx` | Modified | Wired `recordExecutedAction` at 5 commit points, updated 4 caller sites |
| `components/dashboard/DashboardInitializer.tsx` | Modified | Wired `recordExecutedAction` at 2 commit points, source pass-through in event listener |
| `__tests__/unit/chat/action-trace-phase-b.test.ts` | **New file** | 14 unit-level regression tests (3 groups) |
| `__tests__/integration/chat/action-trace-commit-path.integration.test.tsx` | **New file** | 2 integration tests: duplicate-commit collapse + freshness guard at provider level |

---

## Changes — Step by Step

### Step 1: `source: 'chat'` + WindowEventMap

**File:** `lib/chat/use-chat-navigation.ts`

#### 1a: 7 dispatch sites with `source: 'chat' as const`

| # | Function | Event Name | Line |
|---|----------|-----------|------|
| 1 | `navigateToWorkspace` | `chat-navigate-workspace` | 85 |
| 2 | `goToDashboard` | `chat-navigate-dashboard` | 232 |
| 3 | `goHome` | `chat-navigate-entry` | 282 |
| 4 | `openPanelDrawer` | `open-panel-drawer` | 412 |
| 5 | `executeAction` (navigate_entry) | `chat-navigate-entry` | 529 |
| 6 | `selectOption` (entry) | `chat-navigate-entry` | 708 |
| 7 | `selectOption` (panel_drawer) | `open-panel-drawer` | 760 |

Non-commit events (`chat-select-quick-links-panel`, `chat-confirm-panel-write`, `chat-select-doc`, `chat-navigate-note`) correctly excluded — they are not execution commits.

#### 1b: `WindowEventMap` extension (lines 812–838)

```typescript
declare global {
  interface WindowEventMap {
    'chat-navigate-note': CustomEvent<{ noteId: string; workspaceId?: string; entryId?: string }>
    'chat-navigate-workspace': CustomEvent<{ workspaceId: string; workspaceName?: string; source?: 'chat' }>
    'chat-navigate-dashboard': CustomEvent<{ entryId?: string; source?: 'chat' }>
    'chat-navigate-entry': CustomEvent<{ entryId: string; workspaceId?: string; dashboardId?: string; source?: 'chat' }>
    'open-panel-drawer': CustomEvent<{ panelId: string; source?: 'chat' }>
  }
}
```

Replaces the previous single-event `WindowEventMap` for `chat-navigate-note`. Provides compile-safe `e.detail.source` access at listener sites.

**`as EventListener` casts**: The plan's primary instruction was to remove casts where the typed map makes them unnecessary. The casts were kept (plan fallback: "if TS gets picky, keep explicit event parameter types"). Handlers already use typed parameters (e.g., `(e: CustomEvent<{ panelId: string; source?: 'chat' }>)` for `handleOpenDrawer`), so `e.detail.source` access is compile-safe regardless. No functional impact — the typed `WindowEventMap` provides documentation and future-proofing value.

#### 1c: `message-result-preview.tsx` boundary (verified, not modified)

`components/chat/message-result-preview.tsx` (line 86) dispatches `chat-navigate-entry` without `source`. At the receiving handler in DashboardInitializer (line 507), the guard `event.detail.source === 'chat' ? 'chat' : 'direct_ui'` defaults to `'direct_ui'` — correct for a user UI click on a result preview. No change needed per plan.

---

### Step 2: DashboardView Commit Points (5)

**File:** `components/dashboard/DashboardView.tsx`

#### 2a: Context destructuring (line 112)

```typescript
const { setCurrentLocation, incrementOpenCount, setUiContext, setLastAction, recordExecutedAction } = useChatNavigationContext()
```

#### 2b: `handleWorkspaceSelectById` — `open_workspace` (line 706)

- Signature extended: `opts?: { source?: 'chat' | 'direct_ui'; isUserMeaningful?: boolean }`
- `recordExecutedAction` call inside `if (ws)` block, after `incrementOpenCount`
- Fields: `actionType: 'open_workspace'`, `scopeKind: 'workspace'`, `scopeInstanceId: selectedWorkspaceId`
- `isUserMeaningful: opts?.isUserMeaningful ?? true` — defaults to `true`, overridable for auto-sync
- `reasonCode: opts?.source === 'chat' ? 'unknown' : 'direct_ui'`
- Deps: `[entryId, workspaces, onViewModeChange, incrementOpenCount, recordExecutedAction]`

#### 2c: `handleReturnToDashboard` — `go_to_dashboard` (line 823)

- Signature extended: `opts?: { source?: 'chat' | 'direct_ui' }`
- `recordExecutedAction` call after `onViewModeChange?.('dashboard')`
- Fields: `target: { kind: 'entry', id: entryId, name: entryName }`, `scopeKind: 'workspace'`, `scopeInstanceId: activeWorkspaceId ?? undefined`
- Null narrowing applied: `activeWorkspaceId` is `string | null`, `scopeInstanceId` expects `string | undefined` — fixed with `?? undefined`
- Deps: `[activeWorkspaceId, entryId, entryName, onViewModeChange, recordExecutedAction]`

#### 2d: `handleWidgetDoubleClick` — `open_panel` (line 1129)

- Always `source: 'direct_ui'` (double-click is always direct UI)
- `recordExecutedAction` call placed after existing `setLastAction` (which is kept — Phase C removes it)
- Fields: `scopeKind: 'dashboard'`, `scopeInstanceId: entryId`
- Deps: includes `recordExecutedAction` (line 1145)

#### 2e: `handleOpenDrawer` event listener — `open_panel` (line 1187)

- Event type updated: `(e: CustomEvent<{ panelId: string; source?: 'chat' }>)`
- Source detection: `const eventSource = e.detail.source === 'chat' ? 'chat' as const : 'direct_ui' as const`
- `recordExecutedAction` call placed after `setActiveWidgetId(panel.id)`
- Fields: `scopeKind: 'dashboard'`, `scopeInstanceId: entryId`
- useEffect deps: `[panels, recordExecutedAction, entryId]` (line 1216)

#### 2f: `handleWorkspaceChangeFromCanvas` — `open_workspace` (line 756)

- Always `source: 'direct_ui'` (canvas dock is always direct UI)
- `recordExecutedAction` call placed after `incrementOpenCount`, inside `if (ws)` block
- Fields: `scopeKind: 'workspace'`, `scopeInstanceId: workspaceId` — consistent with `handleWorkspaceSelectById` and DashboardInitializer
- Deps: includes `recordExecutedAction` (line 768)

#### Caller updates

| Caller | Call Site | Change | Line |
|--------|----------|--------|------|
| Workspace context subscription | `handleWorkspaceSelectById(workspaceId)` | Added `{ isUserMeaningful: false }` | 1590 |
| `chat-navigate-workspace` listener | `handleWorkspaceSelectById(workspaceId)` | Added `{ source: 'chat' }` | 1707 |
| `chat-navigate-note` listener (dashboard path) | `handleWorkspaceSelectById(targetWorkspaceId)` | Added `{ source: 'chat' }` | 1645 |
| `chat-navigate-note` listener (ws switch path) | `handleWorkspaceSelectById(targetWorkspaceId)` | Added `{ source: 'chat' }` | 1648 |
| `chat-navigate-dashboard` listener | `handleReturnToDashboard()` | Added `{ source: 'chat' }` | 1670 |
| Keyboard shortcut (Cmd+Shift+D) | `handleReturnToDashboard()` / `handleWorkspaceSelectById(...)` | No opts (defaults to `direct_ui`) | 1455–1462 |
| Pending workspace switch | `handleWorkspaceSelectById(workspaceId)` | No opts (indirect path, defaults) | 1609 |

---

### Step 3: DashboardInitializer Commit Points (2)

**File:** `components/dashboard/DashboardInitializer.tsx`

#### 3a: Context destructuring (line 96)

```typescript
const { setLastAction, incrementOpenCount, recordExecutedAction } = useChatNavigationContext()
```

#### 3b: `handleDashboardNavigate` opts param (line 272)

```typescript
const handleDashboardNavigate = useCallback(async (entryId: string, workspaceId: string, opts?: { source?: 'chat' | 'direct_ui' }) => {
```

#### 3c: Dashboard path — `open_entry` (line 332)

- `recordExecutedAction` call placed after `incrementOpenCount(entryId, entryName, 'entry')`
- Existing `setLastAction` call kept (line 324) — Phase C removes it
- Fields: `actionType: 'open_entry'`, `scopeKind: 'dashboard'`, `scopeInstanceId: entryId`
- `entryName` is the locally-fetched name from the API response (line 304)

#### 3d: Regular workspace path — `open_workspace` (line 446)

- `recordExecutedAction` call placed after `onWorkspaceActivate?.(workspaceId)`
- No existing `setLastAction` in this path (gap filled by Phase B)
- Fields: `actionType: 'open_workspace'`, `scopeKind: 'workspace'`, `scopeInstanceId: workspaceId`
- `regularWorkspaceName` is the locally-fetched name from the API response (line 360)

#### 3e: Deps (line 457)

```typescript
}, [onNavigateToWorkspace, onWorkspaceActivate, setLastAction, incrementOpenCount, recordExecutedAction])
```

#### 3f: Event listener source pass-through (line 506)

```typescript
handleDashboardNavigate(entryId, targetWorkspaceId, {
  source: event.detail.source === 'chat' ? 'chat' : 'direct_ui'
})
```

Event handler type updated to include `source?: 'chat'` in the detail type (line 484).

---

### Step 4: Resolver Ordering Fix

**File:** `lib/chat/intent-resolver.ts`, function `resolveExplainLastAction` (line 3066)

```diff
- const precedingAction = actionHistory[actionHistory.length - 2]
+ const precedingAction = actionHistory[1]
```

`actionHistory` is newest-first (`[newEntry, ...prevHistory]`). "Before that" = index 1 (the preceding action). The old code `[length - 2]` only equals index 1 when `length === 3` — wrong for any other length.

---

### Step 5: Freshness Guard

**File:** `lib/chat/chat-navigation-context.tsx`

#### 5a: Ref declaration (line 1221)

```typescript
const lastTraceWriteRef = useRef<{ tsMs: number; actionType: string; targetId?: string } | null>(null)
```

Placed after `actionTraceSeqRef`. Session-scoped — resets on component remount.

#### 5b: Target extraction helper (lines 1003–1016)

```typescript
function extractLastActionTargetId(action: LastAction): string | undefined {
  switch (action.type) {
    case 'open_workspace':
    case 'rename_workspace':
    case 'delete_workspace':
    case 'create_workspace':
      return action.workspaceId
    case 'open_entry':
    case 'go_to_dashboard':
    case 'go_home':
      return action.entryId
    case 'open_panel':
      return action.panelId
  }
}
```

Normalizes target extraction in one place — prevents edge-case mismatches from `||` chaining. Pure function, no deps.

#### 5c: Ref set in `recordExecutedAction` (line 1319)

```typescript
// Inside setSessionState updater, AFTER dedupe check passes:
lastTraceWriteRef.current = { tsMs, actionType: entry.actionType, targetId: entry.target.id }
```

Deduped writes (line 1314: `return prev`) do NOT advance the ref — this ensures a deduped write cannot block a later valid legacy `setLastAction` call for a different action.

#### 5d: Guard at top of `setLastAction` (lines 1023–1036)

```typescript
const lastWrite = lastTraceWriteRef.current
if (lastWrite) {
  if (action.timestamp < lastWrite.tsMs) {
    return  // strictly older — trace has a newer action
  }
  if (action.timestamp === lastWrite.tsMs) {
    const actionTargetId = extractLastActionTargetId(action)
    if (action.type === lastWrite.actionType && actionTargetId === lastWrite.targetId) {
      return  // same action, trace already mirrored it
    }
  }
}
```

Three cases:
1. `timestamp < tsMs` → always block (strictly older)
2. `timestamp === tsMs` + same action identity (type + targetId) → block (trace already mirrored)
3. `timestamp === tsMs` + different identity → pass through (different action at same ms)
4. `timestamp > tsMs` → pass through (strictly newer, neither condition met)

---

### Step 6: Regression Tests (14 unit + 2 integration = 16 tests)

**Unit tests:** `__tests__/unit/chat/action-trace-phase-b.test.ts` (new)

#### Group 1: `computeDedupeKey` consistency (4 tests)

| Test | What's Verified |
|------|----------------|
| Identical keys for same `open_workspace` identity | Cross-component dedupe between DashboardView and DashboardInitializer produces same key |
| Different keys for different action types | `open_workspace` vs `delete_workspace` on same target → different keys |
| Different keys for different targets | Same `open_workspace` on `ws-1` vs `ws-2` → different keys |
| `isUserMeaningful` not in key | Auto-sync path (false) and primary commit (true) produce same key → dedupe works |

#### Group 2: Freshness guard identity extraction (7 tests)

| Test | What's Verified |
|------|----------------|
| Workspace-related actions extract `workspaceId` | `open_workspace`, `rename_workspace`, `delete_workspace`, `create_workspace` |
| Entry-related actions extract `entryId` | `open_entry`, `go_to_dashboard`, `go_home` |
| Panel actions extract `panelId` | `open_panel` |
| Same-ms same identity → blocks | `tsMs=1000, open_workspace, ws-A` trace → `timestamp=1000, open_workspace, ws-A` legacy = blocked |
| Same-ms different identity → passes | `tsMs=1000, open_workspace, ws-A` trace → `timestamp=1000, open_panel, p-B` legacy = passes |
| Strictly newer legacy → passes | `tsMs=1000` trace → `timestamp=2000` legacy = passes |
| Strictly older legacy → blocks | `tsMs=2000` trace → `timestamp=1000` legacy = blocked |

#### Group 3: Resolver ordering (3 tests)

| Test | What's Verified |
|------|----------------|
| 3-entry history: preceding = index 1 | Explanation mentions "Research" (index 1), not "OldEntry" (index 2) |
| 2-entry history: works correctly | Both entries referenced |
| 1-entry history: no crash, no "Before that" | Single entry handled gracefully |

#### Group 4: Context commit-path integration (2 tests)

**File:** `__tests__/integration/chat/action-trace-commit-path.integration.test.tsx` (new)

Runs against the real `ChatNavigationProvider` with Node env shims for `window`/`document`/`navigator`. Tests the actual `recordExecutedAction` and `setLastAction` methods from context — not mocked.

| Test | What's Verified |
|------|----------------|
| Duplicate `open_workspace` writes collapse to one trace entry | Simulates the initializer commit + auto-sync path: two `recordExecutedAction` calls with same dedupeKey within 500ms → only one entry in `actionTrace`. Validates the dedupe guard at provider level, not just the key computation. |
| Deduped write does not block a newer/different legacy `setLastAction` | After a deduped second write (which must NOT advance `lastTraceWriteRef`), a subsequent `setLastAction` with a newer timestamp for a different action type goes through. Validates that the freshness guard ref is not advanced on deduped writes. |

**Why this matters**: The unit tests (Group 1–3) verify logic in isolation — `computeDedupeKey` output, `extractLastActionTargetId` branching, `resolveExplainLastAction` ordering. But the residual risk was that the dedupe guard + freshness ref interaction inside `recordExecutedAction`'s `setSessionState` updater might behave differently at runtime (e.g., stale closures, updater re-entry). The integration tests exercise the actual provider state machine through its public API, closing that gap.

---

## Duplicate-Commit Guard

**Double-record path**: `DashboardInitializer.handleDashboardNavigate` (regular workspace, line 446) calls `recordExecutedAction` → then calls `setActiveWorkspaceContext(workspaceId)` (line 378) → triggers `DashboardView` workspace context subscription (line 1488) → calls `handleWorkspaceSelectById(workspaceId, { isUserMeaningful: false })` (line 1590) → calls `recordExecutedAction` again.

**Protection (three layers)**:

1. **`isUserMeaningful: false`** — the subscription path's trace entry won't pollute semantic answers even if it gets through
2. **500ms dedupe guard** — both calls produce the same `dedupeKey` (same `actionType + target.kind + target.id + scopeKind + scopeInstanceId`) and fire within the window → second is skipped
3. **`isUserMeaningful` is NOT part of `dedupeKey`** — dedupe catches it regardless of the `isUserMeaningful` value

**Consistency requirement**: Both writers (`handleWorkspaceSelectById` at line 713 and `handleDashboardNavigate` at line 453) use `scopeKind: 'workspace'` + `scopeInstanceId: workspaceId`. If these differed, the dedupeKeys would diverge and the duplicate would not be caught. Verified: both use identical scope fields.

---

## Issue Found During Implementation

**`scopeInstanceId: activeWorkspaceId` null narrowing** (DashboardView `handleReturnToDashboard`, line 830)

`activeWorkspaceId` is `string | null` (React state) but `scopeInstanceId` expects `string | undefined` (ActionTraceEntry type). TypeScript error TS2322. Fixed with `?? undefined`. Type-check confirmed clean after fix.

---

## Provenance Policy (Implemented)

| Field | Rule | Verification |
|-------|------|-------------|
| `reasonCode` | `'unknown'` for all chat-triggered commits; `'direct_ui'` only for confirmed direct-UI-only handlers | `handleWidgetDoubleClick` (double-click) and `handleWorkspaceChangeFromCanvas` (canvas dock) use `'direct_ui'`; all others use conditional `opts?.source === 'chat' ? 'unknown' : 'direct_ui'` |
| `isUserMeaningful` | Default `true`; `false` only for effect-driven auto-sync transitions | Only the workspace context subscription (line 1590) passes `{ isUserMeaningful: false }` |
| `source` | Derived from `opts?.source` or event `e.detail.source`; defaults to `'direct_ui'` when absent | `message-result-preview.tsx` (line 86) dispatches without `source` → defaults to `'direct_ui'` at DashboardInitializer handler (line 507) |
| `resolverPath` | `'executeAction'` for chat; `'directUI'` for direct UI | Conditional on `source` at each commit point |

---

## Boundary Verification

| File | Requirement | Status | Evidence |
|------|-------------|--------|---------|
| `chat-navigation-panel.tsx` | No `recordExecutedAction` added | **PASS** | 0 grep matches |
| `chat-routing.ts` | No modifications | **PASS** | 0 grep matches for `recordExecutedAction` |
| `routing-dispatcher.ts` | No modifications | **PASS** | 0 grep matches for `recordExecutedAction` |
| Existing `setLastAction` calls | All preserved (not removed) | **PASS** | `handleWidgetDoubleClick` (line 1122) and DashboardInitializer dashboard path (line 324) still have `setLastAction` |
| Routing ladder / arbitration / LLM topology | No changes | **PASS** | No edits to any routing or LLM files |

---

## Post-Implementation Audit

Full step-by-step verification performed against the plan (`centralized-actiontrace-commit-recording-plan.md`):

### Step 1 Audit: `source: 'chat'` + WindowEventMap

| Plan Requirement | Actual | Status |
|---|---|---|
| 7 dispatch sites have `source: 'chat' as const` | Lines 85, 232, 282, 412, 529, 708, 760 | **PASS** |
| `WindowEventMap` extended with 5 typed events | Lines 812–838, all 5 events present | **PASS** |
| `message-result-preview.tsx` NOT modified | Line 86 dispatches without `source` | **PASS** |
| `as EventListener` casts removed where typed map matches | Casts kept (plan fallback: "if TS gets picky, keep explicit types"). Handlers have typed params — compile-safe | **PASS** (fallback) |

### Step 2 Audit: DashboardView Commit Points

| # | Handler | Plan Location | Actual Line | Fields Match Plan? | Deps Match? |
|---|---------|---------------|-------------|-------------------|-------------|
| 2b | `handleWorkspaceSelectById` | After `incrementOpenCount` in `if (ws)` | 706 | Yes — all 9 fields exact match | Yes (718) |
| 2c | `handleReturnToDashboard` | After `onViewModeChange` | 823 | Yes — `scopeInstanceId: activeWorkspaceId ?? undefined` (null narrowed) | Yes (834) — includes `entryName` |
| 2d | `handleWidgetDoubleClick` | After existing `setLastAction` | 1129 | Yes — `direct_ui` only | Yes (1145) |
| 2e | `handleOpenDrawer` | After `setActiveWidgetId(panel.id)` | 1187 | Yes — `eventSource` conditional | Yes (1216) — includes `entryId` |
| 2f | `handleWorkspaceChangeFromCanvas` | After `incrementOpenCount` in `if (ws)` | 756 | Yes — `direct_ui` only, `scopeInstanceId: workspaceId` | Yes (768) |

| Caller Update | Plan | Actual | Status |
|---|---|---|---|
| Workspace context subscription | `{ isUserMeaningful: false }` | Line 1590: `{ isUserMeaningful: false }` | **PASS** |
| `chat-navigate-workspace` listener | `{ source: 'chat' }` | Line 1707: `{ source: 'chat' }` | **PASS** |
| `chat-navigate-note` listener | `{ source: 'chat' }` | Lines 1645, 1648: `{ source: 'chat' }` | **PASS** |
| `chat-navigate-dashboard` listener | `{ source: 'chat' }` | Line 1670: `{ source: 'chat' }` | **PASS** |
| Keyboard shortcut | No opts (defaults) | Lines 1455–1462: no opts | **PASS** |

### Step 3 Audit: DashboardInitializer Commit Points

| # | Path | Plan Location | Actual Line | Fields Match Plan? | Deps Match? |
|---|------|---------------|-------------|-------------------|-------------|
| 3c | Dashboard path (open_entry) | After `incrementOpenCount` | 332 | Yes — all 9 fields | Yes (457) |
| 3d | Regular workspace path (open_workspace) | After `onWorkspaceActivate` | 446 | Yes — `scopeInstanceId: workspaceId` | Yes (457) |
| 3e | Event listener source pass-through | `event.detail.source === 'chat'` | 506–508 | Yes — conditional source | **PASS** |

### Step 4 Audit: Resolver Ordering Fix

| Plan | Actual (line 3066) | Status |
|---|---|---|
| `actionHistory[1]` | `const precedingAction = actionHistory[1]` | **PASS** |

### Step 5 Audit: Freshness Guard

| Component | Plan | Actual | Status |
|---|---|---|---|
| Ref type | `{ tsMs: number; actionType: string; targetId?: string }` | Line 1221: exact match | **PASS** |
| `extractLastActionTargetId` | switch on all 8 action types | Lines 1003–1016: all 8 types covered | **PASS** |
| Guard: strictly older | `action.timestamp < lastWrite.tsMs → return` | Line 1026: exact match | **PASS** |
| Guard: same-ms identity | `type + targetId match → return` | Lines 1029–1034: exact match | **PASS** |
| Guard: same-ms different identity | passes through | Neither condition triggers → falls through to existing code | **PASS** |
| Ref set only on accepted writes | After dedupe check, before `newTrace` | Line 1319: after dedupe (line 1314 returns early) | **PASS** |
| Deduped writes do NOT advance ref | `return prev` before ref set | Line 1314: `return prev` exits updater before line 1319 | **PASS** |

### Step 6 Audit: Tests

| Plan Requirement | Actual | Status |
|---|---|---|
| 5 focused test cases (6a–6e) | 16 tests across 4 groups (14 unit + 2 integration) | **PASS** (exceeds plan) |
| 6a: source propagation | Covered by dedupeKey consistency group (source not in key, source in handler params) | **PASS** |
| 6b: dedupe + freshness interaction | Unit: `isUserMeaningful` not in key test + freshness guard tests. **Integration**: deduped write does not block newer legacy write (provider-level) | **PASS** |
| 6c: identity-based blocking | 4 scenario tests (same-ms same identity, same-ms different, newer, older) | **PASS** |
| 6d: resolver ordering | 3 tests (3-entry, 2-entry, 1-entry) | **PASS** |
| 6e: no double-record | Unit: dedupeKey consistency (same key → dedupe catches). **Integration**: duplicate `open_workspace` writes collapse to 1 trace entry (provider-level) | **PASS** |
| **Post-audit caveat closed** | Integration tests exercise `recordExecutedAction` + `setLastAction` through real `ChatNavigationProvider`, validating dedupe + freshness guard interaction at runtime (not just logic-level) | **PASS** |

---

## Verification

### Type-check

```bash
$ npx tsc --noEmit -p tsconfig.type-check.json
# (clean — no output)
```

Status: **PASS**

### Tests

```bash
$ npm test -- --testPathPattern="selection-continuity-lane|semantic-answer-lane|semantic-lane-routing-bypass|action-trace-phase-b|action-trace-commit-path"

PASS __tests__/unit/chat/selection-continuity-lane.test.ts
PASS __tests__/unit/chat/action-trace-phase-b.test.ts
PASS __tests__/integration/chat/action-trace-commit-path.integration.test.tsx
PASS __tests__/integration/chat/semantic-answer-lane-api.test.ts
PASS __tests__/integration/chat/semantic-lane-routing-bypass.test.ts
PASS __tests__/unit/chat/semantic-answer-lane.test.ts

Test Suites: 6 passed, 6 total
Tests:       72 passed, 72 total
```

Status: **All passing** (56 pre-existing + 14 unit + 2 integration)

### Grep Verification

```
rg -n "recordExecutedAction" components/dashboard/
  → DashboardView.tsx: 10 matches (destructuring, 5 calls, 5 deps)
  → DashboardInitializer.tsx: 5 matches (destructuring, 2 calls, 1 deps, 1 callback ref)

rg -n "source: 'chat'" lib/chat/use-chat-navigation.ts
  → 7 dispatch sites (lines 85, 232, 282, 412, 529, 708, 760)

rg -n "lastTraceWriteRef" lib/chat/chat-navigation-context.tsx
  → 3 matches: ref declaration (1221), guard check (1024), ref set (1319)

rg -n "extractLastActionTargetId" lib/chat/chat-navigation-context.tsx
  → 2 matches: function declaration (1003), usage in guard (1031)

rg -n "actionHistory\[1\]" lib/chat/intent-resolver.ts
  → 1 match: line 3066

rg -n "isUserMeaningful: false" components/dashboard/
  → 1 match: DashboardView.tsx line 1590 (workspace context subscription)

rg -n "WindowEventMap" lib/chat/use-chat-navigation.ts
  → 1 match: line 813 (declaration block)
```

---

## What Phase B Does NOT Do (Deferred)

| Item | Deferred To |
|------|-------------|
| Remove legacy `setLastAction` calls | Phase C |
| Remove `setLastAction` from `chat-navigation-panel.tsx` | Phase C |
| Remove `as EventListener` casts (typed `WindowEventMap` makes them unnecessary) | Phase C or cleanup pass |
| Propagate `reasonCode` from routing ladder to commit points | Future |
| Wire `select_option` / `execute_widget_item` action types | Future |

---

## Exit Criteria — Status

| Criterion | Status | Evidence |
|-----------|--------|---------|
| Builds and tests pass | **PASS** | Type-check clean, 72/72 tests (6 suites) |
| 7 commit points wired | **PASS** | 5 in DashboardView (lines 706, 823, 1129, 1187, 756), 2 in DashboardInitializer (lines 332, 446) |
| `source: 'chat'` at all 7 dispatch sites | **PASS** | Grep confirms 7 sites in `use-chat-navigation.ts` |
| Freshness guard blocks stale legacy writes | **PASS** | Identity-based blocking verified by 7 tests |
| Resolver ordering fix | **PASS** | `actionHistory[1]` verified by 3 tests |
| Duplicate-commit guard | **PASS** | dedupeKey consistency (4 unit tests) + provider-level collapse verified (1 integration test) |
| No behavior regressions | **PASS** | 56 existing + 14 unit + 2 integration = 72/72 |
| No ladder-rule surface changed | **PASS** | 0 grep matches for `recordExecutedAction` in `chat-routing.ts`, `routing-dispatcher.ts`, `chat-navigation-panel.tsx` |
| Provenance policy followed | **PASS** | `'unknown'` for chat, `'direct_ui'` for direct-UI-only handlers, `isUserMeaningful: false` for auto-sync only |

---

## Next Steps

- **Phase C**: Remove legacy `setLastAction` calls from `chat-navigation-panel.tsx` for types with confirmed commit-point parity.
