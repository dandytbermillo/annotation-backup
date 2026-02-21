# Phase A — Centralized ActionTrace Foundation: Implementation Report

**Date:** 2026-02-20
**Plan:** `centralized-actiontrace-commit-recording-plan.md`
**Phase:** A (Additive Foundation — no behavior removal, no commit-point wiring)

---

## Summary

Phase A adds the centralized ActionTrace foundation: enriched session-level trace types, a deduplicated recorder (`recordExecutedAction`), legacy-compatible converters, and full persistence pipeline coverage — all without modifying existing `setLastAction` behavior or routing ladder rules.

This phase exists to establish the recording infrastructure that Phase B will wire to execution commit points, and Phase C will use to retire legacy `setLastAction` calls.

---

## Files Changed

| File | Change Type | Lines Changed |
|------|-------------|---------------|
| `lib/chat/action-trace.ts` | **New file** | +134 |
| `lib/chat/intent-prompt.ts` | Modified | +2 |
| `lib/chat/chat-navigation-context.tsx` | Modified | +160 / -9 |
| `lib/chat/routing-dispatcher.ts` | Modified | +1 / -1 |
| `__tests__/unit/chat/selection-continuity-lane.test.ts` | Modified | +2 / -2 |

**Total:** 4 modified files + 1 new file, ~307 diff lines.

---

## Changes — Step by Step

### Step 1: Create `lib/chat/action-trace.ts`

New file with session-level trace types, constants, and helpers.

**Zero imports from `chat-navigation-context.tsx` or `intent-prompt.ts`** — converters live in the context provider to avoid circular dependencies.

Contents:
- **`ActionType`** — 12-value union: `open_workspace | open_entry | open_panel | rename_workspace | delete_workspace | create_workspace | go_to_dashboard | go_home | select_option | execute_widget_item | add_link | remove_link`
- **`TargetRefKind`** — `entry | panel | workspace | widget_item | none`
- **`TargetRef`** — `{ kind, id?, name? }`
- **`SourceKind`** — `chat | widget | direct_ui`
- **`ReasonCode`** — 9 values including `explicit_label_match`, `ordinal`, `llm_select_validated`, `scope_cue`, `grounding_resolved`, etc.
- **`ResolverPath`** — 6 values: `handleSelectOption | executeAction | handleGroundingSet | handleClarificationIntercept | directUI | unknown`
- **`ActionOutcome`** — `success | failed`
- **`ActionTraceEntry`** — enriched 15-field interface (`traceId`, `tsMs`, `seq`, `actionType`, `target`, `source`, `resolverPath`, `reasonCode`, `scopeKind`, `scopeInstanceId?`, `dedupeKey`, `parentTraceId?`, `isUserMeaningful`, `outcome`, `intentTag?`)
- **`ACTION_TRACE_MAX_SIZE = 50`**
- **`ACTION_TRACE_DEDUPE_WINDOW_MS = 500`**
- **`computeDedupeKey(entry)`** — deterministic key from `actionType + target.kind + target.id + scopeKind + scopeInstanceId`
- **`generateTraceId()`** — prefers `crypto.randomUUID()` when available, falls back to `tr_${Date.now()}_${random6chars}`

### Step 2: Add `actionTrace` to `SessionState`

**File:** `lib/chat/intent-prompt.ts:551`

```typescript
actionTrace?: import('./action-trace').ActionTraceEntry[]
```

Added after `actionHistory` field. No logic changes.

### Step 3: Rename existing selection trace type

**File:** `lib/chat/chat-navigation-context.tsx`

The pre-existing simplified `ActionTraceEntry` (6 fields, used by `SelectionContinuityState`) was renamed to `SelectionActionTrace` to avoid collision with the enriched session-level type.

- `ActionTraceEntry` → `SelectionActionTrace` (line 291)
- Deprecated re-export alias kept for short-term import compatibility (line 300-301)
- `SelectionContinuityState` fields updated (lines 316-317)
- `recordAcceptedChoice` signature updated (lines 512, 1556)

**Consumer renames (no logic changes):**
- `routing-dispatcher.ts:237` — `DispatchContext.recordAcceptedChoice` uses `SelectionActionTrace`
- `selection-continuity-lane.test.ts:81,128` — import + `makeActionTrace` return type

### Step 4: Add `recordExecutedAction` to context

#### 4a. Imports (line 276-282)

```typescript
import {
  type ActionTraceEntry as SessionActionTraceEntry,
  computeDedupeKey, generateTraceId,
  ACTION_TRACE_MAX_SIZE, ACTION_TRACE_DEDUPE_WINDOW_MS,
} from './action-trace'
```

Uses `SessionActionTraceEntry` alias throughout context to disambiguate from `SelectionActionTrace`.

#### 4b. Provider-owned sequence ref (line 1185)

```typescript
const actionTraceSeqRef = useRef(0)
```

Session-scoped monotonic sequencing. Not a module-global counter (unsafe for HMR/session semantics).

#### 4c. Bridge converters (lines 1191-1249)

**`traceToLegacyLastAction(entry: SessionActionTraceEntry): LastAction | null`** (line 1191)
- Maps enriched trace → flat `LastAction` shape
- Returns `null` for unmappable types (`select_option`, `execute_widget_item`, `add_link`, `remove_link`)
- When `null`: legacy `lastAction` field is NOT touched — preserves existing value

**`traceToLegacyHistoryEntry(entry: SessionActionTraceEntry): ActionHistoryEntry | null`** (line 1225)
- Maps enriched trace → `ActionHistoryEntry`
- Returns `null` for unmappable types (`select_option`, `execute_widget_item`)
- `add_link` and `remove_link` ARE mappable to history (broader union than `LastAction.type`)
- `TargetRefKind` → `targetType`: `workspace→'workspace'`, `entry→'entry'`, `panel→'panel'`, `widget_item→'panel'`, `none→'entry'`

#### 4d. Persistence pipeline extension

All three persistence layers accept `actionTrace`:

| Layer | Line | Field Added |
|-------|------|-------------|
| `fetchSessionState` return type | 641 | `actionTrace?: SessionState['actionTrace']` |
| `persistSessionState` parameter | 660 | `actionTrace?: SessionState['actionTrace']` |
| `pendingSessionStateRef` type | 749 | `actionTrace?: SessionState['actionTrace']` |
| `debouncedPersistSessionState` parameter | 770 | `actionTrace?: SessionState['actionTrace']` |
| Session init `setSessionState` spread | 817 | `actionTrace: ssData.actionTrace ?? undefined` |

Full round-trip coverage: write → debounce → flush → PATCH → DB → fetch → init → state.

The `sendBeacon` unload path (line 849) serializes `pendingSessionStateRef.current` directly, which includes `actionTrace` in its type — no additional change needed.

#### 4e. `recordExecutedAction` implementation (lines 1256-1305)

```typescript
const recordExecutedAction = useCallback((
  input: Omit<SessionActionTraceEntry, 'traceId' | 'seq' | 'dedupeKey' | 'tsMs'> & { tsMs?: number }
) => {
  // Auto-fills: tsMs, seq (monotonic), traceId (crypto.randomUUID), dedupeKey
  // Computes legacy mirrors (may be null for unmappable types)
  // Single setSessionState call with:
  //   - Dedupe guard (same dedupeKey within 500ms window → skip)
  //   - actionTrace always updated (newest-first, bounded to 50)
  //   - lastAction conditionally updated (only when mappable)
  //   - actionHistory conditionally appended (only when mappable)
  //   - Persistence called inside updater (same pattern as setLastAction line 1059)
}, [conversationId, debouncedPersistSessionState, traceToLegacyLastAction, traceToLegacyHistoryEntry])
```

Key design decisions:
- **Single `setSessionState` call** — cleaner than `setLastAction`'s two calls, no intermediate state
- **Side-effect-in-updater persistence** — same pattern as existing `setLastAction` (line 1059). Works because `debouncedPersistSessionState` just writes to a ref and sets a timeout.
- **Conditional legacy mirror** — when converters return `null`, the corresponding legacy field is NOT touched, preserving the existing value
- **`actionTrace` is ALWAYS updated** — the new trace is source of truth; legacy fields are conditionally synced

#### 4f. Provider value (line 1609)

`recordExecutedAction` exposed in context value object.

Interface declaration at line 441:
```typescript
recordExecutedAction: (entry: Omit<SessionActionTraceEntry, 'traceId' | 'seq' | 'dedupeKey' | 'tsMs'> & { tsMs?: number }) => void
```

### Step 5: Legacy behavior intact

- `setLastAction` (lines 1003-1085): **NOT modified**. Two `setSessionState` calls remain as-is.
- No edits to `chat-navigation-panel.tsx` (16 scattered `setLastAction` calls untouched)
- No edits to `chat-routing.ts`
- No edits to routing ladder, arbitration gates, or LLM topology
- The two systems (`setLastAction` legacy + `recordExecutedAction` new) coexist independently

---

## Verification

### Code Verification

Files modified: `action-trace.ts` (new), `intent-prompt.ts`, `chat-navigation-context.tsx`, `routing-dispatcher.ts`, `selection-continuity-lane.test.ts`

Verification performed:
- [x] Read complete files with Read tool — all 5 files read in full
- [x] Verified line numbers match (imports, converters, recorder, provider value, persistence pipeline)
- [x] Ran type-check: PASS (clean, no output)
- [x] Ran tests: PASS (56/56, 4 suites)
- [x] Checked git status: `action-trace.ts` untracked; other 4 files modified

### Type-check

```bash
$ npx tsc --noEmit -p tsconfig.type-check.json
# (clean — no output)
```

Status: **PASS**

### Tests

```bash
$ npm test -- --testPathPattern="selection-continuity-lane|semantic-answer-lane|semantic-lane-routing-bypass"

PASS __tests__/unit/chat/selection-continuity-lane.test.ts
PASS __tests__/integration/chat/semantic-answer-lane-api.test.ts
PASS __tests__/integration/chat/semantic-lane-routing-bypass.test.ts
PASS __tests__/unit/chat/semantic-answer-lane.test.ts

Test Suites: 4 passed, 4 total
Tests:       56 passed, 56 total
```

Status: **All passing**

### Grep verification

```
rg -n "recordExecutedAction" lib/chat/chat-navigation-context.tsx
  441: interface declaration
  1256: implementation
  1609: provider value

rg -n "actionTrace\?" lib/chat/intent-prompt.ts
  551: actionTrace?: import('./action-trace').ActionTraceEntry[]

rg -n "SelectionActionTrace" lib/chat/
  chat-navigation-context.tsx:291,300,316,317,512,1556
  routing-dispatcher.ts:237
```

### Boundary verification

- No edits to `setLastAction` body
- No edits to `chat-navigation-panel.tsx`
- No edits to `chat-routing.ts`
- No edits to routing ladder, arbitration gates, or LLM topology
- No routing behavior changes

---

## Issue Found During Verification

**`fetchSessionState` return type + session init missing `actionTrace`**

The write path (`persistSessionState`, `pendingSessionStateRef`, `debouncedPersistSessionState`) all correctly included `actionTrace`, but the read path did not:

1. `fetchSessionState` return type (line 636-642) — did not include `actionTrace`
2. Session init `setSessionState` spread (line 811-818) — did not spread `actionTrace`

This meant `actionTrace` would persist to the database but silently drop on session reload.

**Fix applied:**
- Added `actionTrace?: SessionState['actionTrace']` to `fetchSessionState` return type (line 641)
- Added `actionTrace: ssData.actionTrace ?? undefined` to session init spread (line 817)

Type-check and tests confirmed clean after fix.

---

## Persistence Pipeline — Full Round-Trip

| Stage | Direction | `actionTrace` Covered | Location |
|-------|-----------|----------------------|----------|
| `recordExecutedAction` | Write | Yes | context:1256 |
| `setSessionState` updater | State | Yes | context:1270 |
| `debouncedPersistSessionState` | Debounce | Yes | context:770 |
| `pendingSessionStateRef` | Buffer | Yes | context:749 |
| `flushSessionState` | Flush | Yes | context:754 |
| `persistSessionState` | PATCH | Yes | context:660 |
| API endpoint JSONB merge | DB write | Yes | No allowlist, `\|\|` merge |
| `sendBeacon` on unload | Beacon | Yes | context:849 (serializes ref) |
| `fetchSessionState` return | DB read | Yes | context:641 (fixed) |
| Session init spread | State load | Yes | context:817 (fixed) |

---

## What Phase A Does NOT Do (Deferred)

| Item | Deferred To |
|------|-------------|
| Wire `recordExecutedAction` at commit points | Phase B |
| Add freshness guard to `setLastAction` | Phase B |
| Fix resolver ordering bug (`actionHistory[length-2]` → `[1]`) | Phase B |
| Propagate source metadata through CustomEvents | Phase B |
| Remove legacy `setLastAction` calls | Phase C |

---

## Exit Criteria — Status

| Criterion | Status |
|-----------|--------|
| Builds and tests pass | **PASS** — type-check clean, 56/56 tests |
| `recordExecutedAction` exposed in context value | **PASS** — interface (line 441), impl (line 1256), value (line 1609) |
| Implements dedupe + legacy mirror | **PASS** — `computeDedupeKey` + 500ms window + conditional converters |
| Persistence pipeline carries `actionTrace` through debounce → flush → PATCH | **PASS** — all 10 pipeline stages covered |
| Session reload restores `actionTrace` | **PASS** — `fetchSessionState` + init spread (fixed during verification) |
| No behavior regressions in selection continuity or semantic lane | **PASS** — 56/56 tests |
| No ladder-rule surface changed | **PASS** — no edits to routing, arbitration, or LLM topology |

---

## Next Steps

- **Phase B**: Wire `recordExecutedAction` at execution commit points (`DashboardView`, `DashboardInitializer`), add freshness guard, fix resolver ordering bug, build commit coverage matrix.
- **Phase C**: Remove legacy `setLastAction` calls from `chat-navigation-panel.tsx` for types with confirmed commit-point parity.
