# Unified Source-Cue Signal Architecture — Implementation Report

**Date**: 2026-02-27
**Feature**: Generalized scope-cue signal with dashboard scoped resolution
**Scope**: `ScopeCueResult.sourceKind`, `scopeCueSignal` (renamed from `widgetScopeCueSignal`), dashboard 3-stage resolution, 10 integration tests
**Builds on**: widget-scope-cue (2026-02-26), scope-typo-clarifier (2026-02-26)

---

## Problem

When a user types `"open links panel d from dashboard"`, the scope-cue handler detected `scope: 'dashboard'` and returned a hard-stop message: "Dashboard-scoped selection is not yet available." This blocked all downstream routing, even though the same command without the scope cue (`"open links panel d"`) routes correctly through Tier 2c panel disambiguation.

### Root Cause

The dashboard and workspace branches in `handleScopeCuePhase` (lines 704-729) returned `{ handled: true }` with a hard-stop message, blocking all downstream routing. The widget scope already had a signal-based architecture (`widgetScopeCueSignal`) that returned `handled: false` and let the dispatcher resolve with scoped candidates. Dashboard lacked this.

---

## Solution

Generalized the existing widget signal architecture into a unified `scopeCueSignal` that handles all scope types, with **real scoped candidate isolation** for dashboard.

### Design Principles

1. **Explicit cue = scoped candidates only**: No mixed pools — dashboard scope resolves only against dashboard panels
2. **Strict-exact for deterministic execution**: Non-exact input goes through bounded LLM, never deterministic-execute
3. **Signal-based architecture**: Parser detects cue shape; dispatcher resolves against live snapshot
4. **Incremental evolution**: Renamed existing widget signal, no parallel system
5. **Hard-stop preserved for workspace**: No signal until proper filtering exists

---

## Changes

### File 1: `lib/chat/input-classifiers.ts`

Added optional `sourceKind` field to `ScopeCueResult` interface:

```typescript
sourceKind?: 'named' | 'generic' | 'none'
```

Updated all return sites in `resolveScopeCue()` (~15 sites), `detectScopeCueTypo()`, and `detectScopeTriggerUnresolved()`:
- Chat cues: `'generic'`
- Widget with `namedWidgetHint`: `'named'`
- Widget without `namedWidgetHint`: `'generic'`
- Dashboard/workspace: `'generic'`
- Typo/uncertain: `'generic'`
- None: not set (consumers read `scopeCue.sourceKind ?? 'none'`)

### File 2: `lib/chat/chat-routing-types.ts`

- Renamed `WidgetScopeSource` -> `ScopeSource`
- Renamed `widgetScopeCueSignal` -> `scopeCueSignal`
- Added `scope: 'widget' | 'dashboard' | 'workspace'` field to signal type

### File 3: `lib/chat/chat-routing-scope-cue-handler.ts`

- **Dashboard**: Replaced hard-stop with signal return (strips cue, returns `scopeCueSignal` with `scope: 'dashboard'`)
- **Workspace**: Kept hard-stop, softened message to suggest alternatives
- **Widget**: Renamed signal field to `scopeCueSignal`, added `scope: 'widget'`
- Updated import: `WidgetScopeSource` -> `ScopeSource`

### File 4: `lib/chat/routing-dispatcher.ts`

- Renamed all `widgetScopeCueSignal` references -> `scopeCueSignal`
- Restructured signal handler with scope branching: `if (scopeSignal.scope === 'widget')` / `else if (scopeSignal.scope === 'dashboard')`
- Added dashboard 3-stage scoped resolution:

**Stage A**: `handlePanelDisambiguation` — strict-exact gate + option-flow disambiguation
- Single strict-exact match: deterministic open via `openPanelDrawer`
- Non-strict-exact single match: returns `handled: false` (falls to Stage B)
- Multi-match: shows disambiguation options via `setPendingOptions`/`setLastClarification`

**Stage B**: Scoped grounding with bounded LLM
- `buildGroundingContext({ openWidgets: [], visiblePanels: dashboardWidgets })` — only dashboard panels
- Deterministic grounding match gated by `isStrictExactMatch` safety guard
- Bounded LLM with dashboard-scoped candidates only

**Stage C**: Scoped "not found" clarifier
- Lists available dashboard panels
- Always returns `handled: true` — never falls through to non-dashboard tiers

**Dashboard widget shape normalization**: Maps `rawDashboardWidgets` to canonical `{ id, title, type }` before matching, handling potential `label` vs `title` field differences.

### File 5: `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts`

Added 10 integration tests:

| # | Test | Input | Expected |
|---|---|---|---|
| 1 | Strict-exact match | `"Links Panel D from dashboard"` | Deterministic open (Stage A) |
| 2 | Non-strict-exact | `"open links panel d from dashboard"` | Stage B → LLM disabled → Stage C not found |
| 3 | Multi-match | `"links panel from dashboard"` | Stage A disambiguation options |
| 4 | No match | `"sample99 from dashboard"` | Stage C: scoped not-found with available panels |
| 5 | Empty after strip | `"from dashboard"` | Scope handler: "What would you like to find?" |
| 6 | Cross-scope collision | `"Recent Notes from dashboard"` | Resolves ONLY from dashboard panels |
| 7 | No panels visible | `"open links panel d from dashboard"` | "No panels are visible" |
| 8 | Workspace hard-stop | `"open links panel d from workspace"` | "not yet available" |
| 9 | Widget regression | `"open sample2 from active widget"` | Widget scoped grounding (unchanged) |
| 10 | Widget named regression | `"open recent from links panel d"` | Widget named cue (unchanged) |

### File 6: `__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts`

Updated 1 existing test: `"from dashboard" explicit cue` — changed from expecting hard-stop "not yet available" to expecting scoped resolution with "not found" on dashboard.

### File 7: `__tests__/unit/chat/selection-intent-arbitration.test.ts`

Updated 7 chat-cue `toEqual` assertions to include `sourceKind: 'generic'`.

---

## Safety Analysis

| Concern | Mitigation | Verified |
|---------|-----------|----------|
| Widget scope behavior change | Pure rename — all logic unchanged. `scopeSignal.scope === 'widget'` gates same code path | Type-check + 943 tests |
| Non-exact deterministic execute | `isStrictExactMatch` guard in Stage B. Non-strict returns `handled: false` → LLM path | Test 2 |
| Dashboard cross-scope leakage | All 3 stages return `handled: true`. `buildGroundingContext` gets `openWidgets: []` | Test 6 |
| Workspace unscoped execution | Workspace keeps hard-stop | Test 8 |
| `sourceKind` breaks constructors | Field is optional (`sourceKind?:`). Existing `{ scope: 'none', ... }` objects compile | Type-check |
| Dashboard widget shape variance | Normalized to `{ id, title, type }` before matching | Test 1, 6 |
| Feature flag | Entire scope-cue path gated on `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1` | Unchanged |

---

## Verification

### Type-check

```bash
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005
# No new errors from our changes
```

### Test results

```bash
$ npx jest --no-coverage __tests__/unit/chat/ __tests__/integration/chat/
# Test Suites: 37 passed, 37 total
# Tests:       943 passed, 943 total
```

All 10 new dashboard integration tests pass. All 52 selection-intent-arbitration integration tests pass. All existing tests unaffected.

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/input-classifiers.ts` | +12 | `sourceKind` field + all return sites |
| `lib/chat/chat-routing-types.ts` | +3 | Rename + `scope` field |
| `lib/chat/chat-routing-scope-cue-handler.ts` | +30 net | Dashboard signal, workspace softened, widget rename |
| `lib/chat/routing-dispatcher.ts` | +130 net | Scope branching, dashboard 3-stage resolution |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | +150 | 10 integration tests |
| `__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts` | +5 | Updated 1 dashboard test |
| `__tests__/unit/chat/selection-intent-arbitration.test.ts` | +7 | Updated 7 chat-cue assertions |

---

## Modified Scope-Cue Signal Flow

```
User input detected with scope cue
  │
  ├─ resolveScopeCue() classifies scope + sourceKind
  │
  ├─ handleScopeCuePhase() in scope-cue handler:
  │   ├─ chat → restore chat options (existing)
  │   ├─ widget → return scopeCueSignal { scope: 'widget' } (renamed)
  │   ├─ dashboard → return scopeCueSignal { scope: 'dashboard' } (NEW)
  │   ├─ workspace → hard-stop "not yet available" (softened message)
  │   └─ none → null (no cue)
  │
  └─ Dispatcher resolves scopeCueSignal:
      ├─ scope === 'widget':
      │   ├─ Named resolution via matchVisiblePanelCommand
      │   ├─ Scoped grounding (Tier 4.5)
      │   └─ Scoped safe clarifier
      │
      └─ scope === 'dashboard':
          ├─ Stage A: handlePanelDisambiguation (strict-exact + option flow)
          ├─ Stage B: Scoped grounding + bounded LLM (dashboard panels only)
          └─ Stage C: Scoped "not found" (always handled: true)
```
