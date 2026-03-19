# Stage 6x.8 Phase 5 V2 — Broad Known-Navigation Fallback Implementation Report

**Date:** 2026-03-19
**Status:** Implemented and runtime-verified

## Summary

Extended Phase 5 from `history_info + go_home` to broader known navigation families (`open_entry`, `open_panel`, `open_workspace`). The core fix replaced the arbiter bypass patchwork (three separate regex-based checks) with a single `isActionNavigationCommand` function that detects imperative action commands and lets them bypass the cross-surface arbiter to reach the navigate API's bounded LLM.

**Design doc:** `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-v2-broad-known-navigation-fallback-addendum.md`

## Problem

Before V2:
- "open budget100" → worked (bypassed arbiter via `isLikelyNavigateCommand`)
- "hey can please open the budget" → Safe Clarifier (arbiter intercepted it)
- "hi there open the budget100" → Safe Clarifier (arbiter intercepted it)

The arbiter caught noisy action commands because three separate bypass checks (`isLikelyNavigateCommand`, `ACTION_VERB_PREFIX`, `phase5ScopeExcluded`) each maintained their own wrapper-word lists, and any wrapper not in all three lists would fail.

## Changes

### 1. `isActionNavigationCommand` replaces bypass patchwork (`routing-dispatcher.ts`)

One function that detects imperative action commands containing `open`, `show`, `go to`, `switch to` — with a state-info guard that protects questions like "which panel is open?" where "open" is an adjective, not an imperative verb.

```typescript
function isActionNavigationCommand(input: string): boolean {
  // Guard: state-info queries must NOT be treated as action commands
  // "which panel is open?" / "is any panel open?" — "open" is a state adjective
  if (STATE_INFO_GUARD.test(lower) || YN_STATE_GUARD.test(lower) || ...) {
    return false
  }
  // Action verb detection
  return /\b(open|show|go\s+to|switch\s+to)\b/i.test(lower)
}
```

State-info guard patterns:
- `WH_STATE`: "which/what {surface} is/are {state}" (e.g., "which panel is open?")
- `YN_STATE`: "is/are {any/the} {surface} {state}" (e.g., "is any panel open?")
- `WORKSPACE_STATE`: "what workspace am I in?"
- `DASHBOARD_STATE`: "what's on the dashboard?", "how many widgets?"

### 2. Arbiter entry condition simplified (`routing-dispatcher.ts`)

Before (three checks):
```typescript
!isLikelyNavigateCommand(...) && !phase5ScopeExcluded && !ACTION_VERB_PREFIX.test(...)
```

After (one check):
```typescript
!isActionNavigationCommand(ctx.trimmedInput) && detectHintScope(...) !== 'history_info'
```

Removed:
- `ACTION_VERB_PREFIX` regex
- `phase5ScopeExcluded` variable
- `isLikelyNavigateCommand` from arbiter entry (stays exported for other uses)

### 3. Broadened `detectHintScope` (`routing-dispatcher.ts`)

V2 patterns for Phase 5 scope detection:
- Home navigation (existing): `go home`, `take me home`, `return home`, `back home`
- Broad known navigation (V2): requires BOTH `BROAD_NAV_ACTION` (`open|show|go to|switch to`) AND `TARGET_FAMILY` (`panel|workspace|entry|budget\w*|links panel|navigator|quick capture`)

`detectHintScope` controls Phase 5 hinting and pre-tier-chain override. `isActionNavigationCommand` controls arbiter bypass. They are separate checks for separate purposes.

### 4. Expanded override + rescue intent sets

`PHASE5_OVERRIDE_INTENTS`: added `open_entry`, `open_panel`, `open_workspace`
`PHASE5_RESCUE_INTENTS`: added same three intents. Rescue only remaps intent classification — resolver still handles target resolution and ambiguity.

### 5. Curated seed cleanup

Per approved seed policy:
- **Removed**: `open budget100`, `open budget300`, `open workspace budget100` (user-specific targets)
- **Kept**: `go home`, `take me home`, `return home`, `open links panel b`, `open navigator`, history/verify seeds (stable command families)

User-specific targets are learned from successful real usage via the writeback pipeline.

## Test Results

```
$ npx jest --testPathPattern "phase5-|content-intent-dispatcher|state-info-resolvers|routing-log/semantic-lookup"
Test Suites: 8 passed, 8 total
Tests:       186 passed, 186 total
```

Key automated tests:
- "which panel is open?" → arbiter runs, state_info answer ✅
- "hey can please open the budget" → arbiter NOT called, `handled: false` → navigate API ✅

Type-check: clean.

## Runtime Verification (Smoke Test — 2026-03-19)

| Input | Result | Status |
|-------|--------|--------|
| "again pls return home" | "You're already on the Home dashboard." | ✅ |
| "open links panel b. thank you sir" | "Opening Links Panel B..." Auto-Executed | ✅ |
| "hi there i want you to pls now open budget" | "Found 3 entries matching 'budget'. Which one?" LLM-Clarifier | ✅ |
| "hi there i want you to pls now open budget. thank you very much" | Same LLM-Clarifier with options | ✅ |
| "open recent widget" | "Opening Recent..." Auto-Executed | ✅ |
| "hey can please open the budget100" | Opening entry "budget100 B" Auto-Executed | ✅ |
| "hey can please open the links panel b" | "Opening Links Panel B..." Auto-Executed | ✅ |
| "pls pls take me home" | "You're already on the Home dashboard." | ✅ |
| "which panel is open?" | State-info answer (arbiter) | ✅ |

All noisy conversational navigation variants now resolve correctly without dedicated wrapper patterns or user-specific seeds.

## Files Modified

| File | Change |
|------|--------|
| `lib/chat/routing-dispatcher.ts` | Added `isActionNavigationCommand`, `shouldRunCrossSurfaceArbiter` state-info guards; broadened `detectHintScope`; expanded `PHASE5_OVERRIDE_INTENTS`; replaced arbiter entry patchwork |
| `app/api/chat/navigate/route.ts` | Expanded `PHASE5_RESCUE_INTENTS` to V2 navigation families |
| `scripts/seed-phase5-curated-exemplars.ts` | Removed user-specific seeds; kept stable command-family seeds only |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | Added arbiter regression tests for state-info and action-nav bypass |
| `__tests__/unit/chat/phase5-semantic-hints.test.ts` | Updated `detectHintScope` tests for V2 broad navigation |

## Known Limitations

1. **`isLikelyNavigateCommand` still exists** in `content-intent-classifier.ts` — no longer used for arbiter entry but stays exported for other uses. Could be cleaned up later.
2. **State-info guard is pattern-based** — relies on detecting surface nouns (panel, note, workspace, dashboard) + state adjectives (open, active, visible). Novel state-info phrasings without these patterns may bypass the guard.
3. **Provenance badge issue** — panel/workspace/dashboard state_info answers show "Content Answer" badge instead of a state-info badge. Separate labeling fix needed.
4. **`budget\w*` in TARGET_FAMILY** — project-level naming convention for entries. If entry naming conventions change, this pattern needs updating. Over time, learned exemplars from writeback should reduce dependence on this pattern.

## Architecture

The V2 routing decision is now:

```
Input → isActionNavigationCommand?
  YES → bypass arbiter → Phase 5 hint retrieval → navigate API (LLM + resolver)
  NO  → is history_info?
    YES → bypass arbiter → Phase 5 history/info path
    NO  → arbiter classifies (state_info, read_content, navigate, mutate, ambiguous)
```

No wrapper-word lists. No per-phrasing regex expansion. Action commands reach the LLM naturally. State-info questions reach the arbiter naturally. Resolvers/validators remain the execution authority.
