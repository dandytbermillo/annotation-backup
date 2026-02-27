# Scope-Typo Clarifier + One-Turn Replay — Consolidated Implementation Report

**Date**: 2026-02-26
**Feature**: scope-cues-addendum-plan.md §typoScopeCueGate
**Commit**: `14c03d07`
**Scope**: 6-stage plan implementation + post-implementation investigation + test quality fix

---

## Summary

Implemented the full 6-stage Scope-Typo Clarifier + One-Turn Replay plan, then conducted a post-implementation safety audit that discovered and fixed two production-blocking issues and one test quality issue.

### Bugs Fixed (Original Plan)

- "from active widgets" (plural) no longer triggers typo clarifier — matched as exact scope cue
- "yes from active widget" after typo clarifier now replays the original intent instead of treating "yes" as a search query
- Pure "yes" after typo clarifier shows a clarifier asking for specific scope (not search)

### Issues Found & Fixed (Post-Implementation Investigation)

- **CRITICAL**: `chat-navigation-panel.tsx` missing `pendingScopeTypoClarifier` wiring — entire feature non-functional in production
- **Dead code**: `routing-dispatcher.ts` hardcoded `const currentReplayDepth = 0` — depth guard always evaluating to false
- **Vacuous assertions**: Two latch-vs-active integration tests had conditional `if` guards that always evaluated to false, making assertions unreachable

---

## Stage 1: Reduce False Typo Triggers

**File**: `lib/chat/input-classifiers.ts` (line 444)

Added `widgets?`/`panels?` (optional plural) to all widget/panel alternatives in `WIDGET_CUE_PATTERN`. Updated negative lookahead guards for bare `from active`/`from current`:

```
from active widgets?|from current widgets?|from active panels?|from current panels?|...
from active(?!\s+(?:widgets?|panels?|dashboard|workspace))
from current(?!\s+(?:widgets?|panels?|dashboard|workspace))
```

**Result**: "from active widgets" → `scope: 'widget'`, `confidence: 'high'` (not `low_typo`).

---

## Stage 2: Pending Clarifier State

**Files**: `lib/chat/chat-navigation-context.tsx`, `lib/chat/chat-routing-types.ts`

Added cross-turn state type and lifecycle hooks:

```typescript
export interface PendingScopeTypoClarifier {
  originalInputWithoutScopeCue: string  // "open summary144" (pre-stripped)
  suggestedScopes: string[]             // ["from active widget", "from active panel", "from chat"]
  detectedScope: 'chat' | 'widget' | 'dashboard' | 'workspace' | 'none'
  createdAtTurnCount: number            // deterministic turn counter
  snapshotFingerprint: string           // activeSnapshotWidgetId + sorted open widget IDs
  messageId: string                     // clarifier message ID
}
export const SCOPE_TYPO_CLARIFIER_TTL = 1  // one-turn only
```

Wired into `ClarificationInterceptContext` (read/write) and `RoutingDispatcherContext` (read/write + `_replayDepth?: 0 | 1`).

---

## Stage 3: Typo Gate State Save

**File**: `lib/chat/chat-routing-scope-cue-handler.ts`

Extended `ScopeCuePhaseParams` with `snapshotFingerprint` and `currentTurnCount`. The `low_typo` gate now:
1. Pre-strips the typo scope cue from original input (avoids malformed replay reconstruction)
2. Computes suggested scopes based on detected scope type
3. Saves `PendingScopeTypoClarifier` with stripped input, fingerprint, turn count
4. Shows "Did you mean?" clarifier with suggested scopes
5. Returns `handled: true`

---

## Stage 4: Affirmation Strip + Confirmation Resolver

### 4a. `stripLeadingAffirmation()` — `lib/chat/query-patterns.ts`

Extracted `AFFIRMATION_TOKENS` as single source of truth for affirmation vocabulary. Both `AFFIRMATION_PATTERN` and `stripLeadingAffirmation` derive from this constant:

```typescript
export const AFFIRMATION_TOKENS = [
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'k', 'ya', 'ye', 'yea',
  'mhm', 'uh huh', 'go ahead', 'do it', 'proceed', 'correct', 'right', 'exactly',
  'confirm', 'confirmed',
] as const
```

`stripLeadingAffirmation(input)` returns `{ affirmed: boolean; remainder: string }`:
- Sorts tokens by length descending (prevents "ye" from matching before "yeah")
- Requires word boundary after token to prevent partial matches
- Handles "please" suffix (pure "yes please" → affirmed, empty remainder)

### 4b. Confirmation Resolver — `lib/chat/chat-routing-clarification-intercept.ts`

Added early check **before ordinal binding** (line 207-272). Six exit paths, all calling `clearPendingScopeTypoClarifier()`:

| Path | Condition | Action |
|------|-----------|--------|
| 1. TTL expired | `currentTurnCount !== pending.createdAtTurnCount + 1` | Clear + fall through |
| 2. Drift | `snapshotFingerprint !== pending.snapshotFingerprint` | Clear + fall through |
| 3. Unrelated input | New command detected + not affirmed | Clear + fall through |
| 4. Affirmed + exact scope | "yes from active widget" → high-confidence scope cue | Clear + return `replaySignal` |
| 5. Ambiguous "yes" | Affirmed + no remainder (pure "yes") | Clear + ask which scope |
| 6. Non-confirmation | Doesn't match any pattern above | Clear + fall through |

---

## Stage 5: Replay Signal in Dispatcher

**File**: `lib/chat/routing-dispatcher.ts`

Added `computeSnapshotFingerprint()` utility:
```typescript
function computeSnapshotFingerprint(turnSnapshot): string {
  const widgetIds = turnSnapshot.openWidgets.map(w => w.id).sort().join(',')
  return `${turnSnapshot.activeSnapshotWidgetId ?? 'null'}|${widgetIds}`
}
```

Replay signal handler (after receiving `clarificationResult`):
1. Reads `ctx._replayDepth ?? 0` — if >= 1, blocks recursion with safe clarifier
2. Re-runs `handleClarificationIntercept` with rewritten input (`_replayDepth: 1`, `pendingScopeTypoClarifier: null`)
3. Full safety ladder applies — no shortcut execution
4. If replay produces `widgetScopeCueSignal`, falls through to normal widget signal handler

---

## Stage 6: Tests

### Unit Tests

**`__tests__/unit/chat/selection-intent-arbitration.test.ts`** — 8 new tests:
- "from active widgets" (plural) → `scope: 'widget'`, `confidence: 'high'`
- "from active panels" (plural) → `scope: 'widget'`, `confidence: 'high'`
- "in active widgets" / "in current panels" / "from current widgets" — all high confidence
- Negative lookahead regression: "from active workspace" → `scope: 'workspace'` (not widget)
- Negative lookahead regression: "from active dashboard" → `scope: 'dashboard'` (not widget)

**`__tests__/unit/chat/strip-leading-affirmation.test.ts`** — 14 tests (new file):
- Affirmed with remainder: "yes from active widget", "okay, from chat", "yep please from active", etc.
- Pure affirmation: "yes", "yes please", "ok"
- Not affirmed: "open panel d", "from active widget", "show me the first one"
- Token precedence: "yeah from active" matches "yeah" (not "ye" + "ah from active")
- `AFFIRMATION_TOKENS` → `AFFIRMATION_PATTERN` consistency check

### Integration Tests

**`__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts`** — 8 new tests:
- "from active widgets" (plural) → exact scope, no typo clarifier
- "from active panels" (plural) → exact scope, no typo clarifier
- "from activ" typo → saves `PendingScopeTypoClarifier`, shows clarifier
- "yes from active widget" after typo → replay succeeds, opens correct item
- Expired TTL → pending cleared, normal routing
- Drift detected → pending cleared, normal routing
- Unrelated input ("open panel d") → pending cleared, normal routing
- Pure "yes" → ambiguous, asks for scope

---

## Post-Implementation Fixes

### Fix 1 (CRITICAL): Production Wiring — `components/chat/chat-navigation-panel.tsx`

**Problem**: `chat-navigation-panel.tsx` (the real production call site for `dispatchRouting()`) was NOT updated to destructure and pass `pendingScopeTypoClarifier`, `setPendingScopeTypoClarifier`, `clearPendingScopeTypoClarifier` from the context hook.

**Impact**: In production, these fields would be `undefined`:
- `setPendingScopeTypoClarifier` calls in the typo gate silently fail (truthiness guard)
- `clearPendingScopeTypoClarifier()` calls in the confirmation resolver throw TypeError
- Entire one-turn replay feature non-functional

**Root cause**: Integration tests construct mock contexts directly, bypassing the real component. The wiring gap only manifests in the production call path.

**Fix**: Added the three fields to both the context destructure (line 527-537) and the `dispatchRouting()` call (line 1522-1531).

### Fix 2: Dead Code — `lib/chat/routing-dispatcher.ts`

**Problem**: Line 1225 had `const currentReplayDepth = 0` (hardcoded), making the `if (currentReplayDepth >= 1)` depth guard always false. The plan required `ctx._replayDepth ?? 0` and `_replayDepth` on `RoutingDispatcherContext`.

**Fix**:
1. Added `_replayDepth?: 0 | 1` to `RoutingDispatcherContext` interface (line 251)
2. Changed to `const currentReplayDepth = ctx._replayDepth ?? 0` (line 1228)

### Fix 3: Vacuous Test Assertions — `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts`

**Problem**: Two latch-vs-active precedence tests (lines 795, 830) had conditional assertions wrapped in `if` guards:
```typescript
// Both always evaluate to false — assertions never run
if (ctx.handleSelectOption.mock.calls.length > 0) { ... }  // handleSelectOption: 0 calls
if (ctx.addMessage.mock.calls.length > 0) {                 // true, but...
  if (lastMsg.options?.length) { ... }                       // false: no options in msg
}
```

**Investigation method**: Created a temporary diagnostic test that logged actual mock call counts and message content. Discovered both tests take the `scope_cue_widget_grounding_miss` path, producing a safe clarifier message `"I couldn't find "open sample2" in Recent..."` with no options.

**Fix**: Replaced vacuous conditional assertions with concrete unconditional assertions:
```typescript
expect(result.handled).toBe(true)
expect(ctx.handleSelectOption).not.toHaveBeenCalled()
expect(ctx.addMessage).toHaveBeenCalledTimes(1)
const msg = ctx.addMessage.mock.calls[0][0]
expect(msg.content).toContain('Recent')            // Proves scoping to active widget
expect(msg.content).not.toContain('Links Panel D') // Proves stale latch ignored
```

---

## All Files Modified

| File | Changes |
|------|---------|
| `lib/chat/input-classifiers.ts` | `WIDGET_CUE_PATTERN`: `widgets?`/`panels?` in all widget/panel alternatives + negative lookahead guards |
| `lib/chat/query-patterns.ts` | `AFFIRMATION_TOKENS` shared constant, rebuilt `AFFIRMATION_PATTERN`, `stripLeadingAffirmation()` helper |
| `lib/chat/chat-navigation-context.tsx` | `PendingScopeTypoClarifier` interface, `SCOPE_TYPO_CLARIFIER_TTL`, state + lifecycle hooks in provider |
| `lib/chat/chat-routing-types.ts` | `replaySignal` on `ClarificationInterceptResult`, `_replayDepth`/`snapshotFingerprint`/`currentTurnCount`/`pendingScopeTypoClarifier` on `ClarificationInterceptContext` |
| `lib/chat/chat-routing-scope-cue-handler.ts` | `ScopeCuePhaseParams` extended with `snapshotFingerprint`/`currentTurnCount`, typo gate saves `PendingScopeTypoClarifier` |
| `lib/chat/chat-routing-clarification-intercept.ts` | Confirmation resolver (before ordinal binding): TTL, drift, unrelated-input, affirmation strip, scope-cue resolution, ambiguous "yes" |
| `lib/chat/routing-dispatcher.ts` | `computeSnapshotFingerprint()`, `_replayDepth` on `RoutingDispatcherContext`, `pendingScopeTypoClarifier` wiring, replay signal handler with depth guard |
| `components/chat/chat-navigation-panel.tsx` | `pendingScopeTypoClarifier`/`setPendingScopeTypoClarifier`/`clearPendingScopeTypoClarifier` context destructure + `dispatchRouting()` wiring |
| `__tests__/unit/chat/selection-intent-arbitration.test.ts` | 8 new tests: plural forms + negative lookahead regression |
| `__tests__/unit/chat/strip-leading-affirmation.test.ts` | New file: 14 tests for `stripLeadingAffirmation` + `AFFIRMATION_TOKENS` consistency |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | 8 new tests (replay suite) + 2 fixed vacuous assertions (latch-vs-active) |

---

## Verification

```
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1)

$ npx jest --no-coverage __tests__/unit/chat/ __tests__/integration/chat/
# Test Suites: 37 passed, 37 total
# Tests: 912 passed, 912 total
# Time: 1.123s
```

---

## Safety Invariants

| Invariant | Status |
|-----------|--------|
| `low_typo` confidence is never executable — always shows safe clarifier | Verified |
| Every path through confirmation resolver calls `clearPendingScopeTypoClarifier()` — no stale state bleed | Verified (6/6 paths) |
| `_replayDepth: 0 \| 1` properly read from context — prevents recursive replay loops | Verified (was dead code, now fixed) |
| `pendingScopeTypoClarifier: null` in replay call provides primary recursion prevention | Verified |
| Snapshot fingerprint drift detection prevents stale replay after UI changes | Verified |
| Strict one-turn TTL (`createdAtTurnCount + 1`) prevents late replay | Verified |
| Confirmation resolver runs before ordinal binding — "yes" never captured as query | Verified |
| Production call site (`chat-navigation-panel.tsx`) wires all new context fields | Verified (was missing, now fixed) |
| Latch-vs-active integration tests have non-vacuous assertions | Verified (was vacuous, now fixed) |

---

## Known Minor Issues (Not Fixed — Harmless)

- `chat-routing-scope-cue-handler.ts:132`: `if (ctx.setPendingScopeTypoClarifier)` truthiness guard is redundant since field is now required on `ClarificationInterceptContext`. Defensive coding, no behavioral impact.
- `AFFIRMATION_PATTERN` now has `i` flag where old version relied on `toLowerCase()` in `isAffirmationPhrase`. Harmless since both approaches are case-insensitive.

---

## Risks / Limitations

- Integration tests mock LLM calls (`isGroundingLLMEnabled: false`). Real LLM fallback paths are not covered by the scope-typo replay tests.
- `computeSnapshotFingerprint` uses widget IDs only. If two different UI states have the same widget IDs but different content, drift won't be detected. Acceptable given one-turn TTL constraint.
