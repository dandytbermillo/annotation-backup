# Scope-Cue Recovery Memory — Durability Fix

**Date:** 2026-02-07
**Feature flag:** `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=true`
**Plan file:** `/Users/dandy/.claude/plans/wiggly-juggling-haven.md`
**Parent report:** `2026-02-07-scope-cue-normalization-chat-scope-report.md`

## Summary

Added a durable, explicit-only chat recovery memory (`ScopeCueRecoveryMemory`) to fix intermittent failures where "from chat" / "in chat" scope cues found 0 recoverable options after `lastOptionsShown` expired or was cleared by known-noun navigation.

**Root cause of intermittency:** All three recoverable sources were fragile for panel_drawer selections:
- `clarificationSnapshot` — Always null (absolute snapshot policy, `chat-navigation-panel.tsx:886-894`)
- `lastOptionsShown` — 2-turn TTL (`SOFT_ACTIVE_TURN_LIMIT = 2`) + cleared by known-noun commands (`known-noun-routing.ts:508`)
- `lastClarification` — Always null (cleared by `handleSelectOption` at line 927)

**Fix:** New `ScopeCueRecoveryMemory` state with no TTL, only consumed by explicit scope cues, never by automatic ordinal routing.

## Architecture: Isolation Properties

1. **Never read by automatic ordinal routing** — post-action ordinal window, Tier 3.5 universal resolver, and stale-chat guards do NOT access this state
2. **No turn-based TTL** — stays until replaced by newer chat-origin options or hard-cleared
3. **Only consumed in the scope-cue block** (`chat-routing.ts:2263`, `getRecoverableChatOptionsWithIdentity`)
4. **Chat-origin only** — widget_option lists are excluded (`options.every(o => o.type !== 'widget_option')`)
5. **Last-resort priority** — `clarificationSnapshot > lastOptionsShown > lastClarification > scopeCueRecoveryMemory`

## Changes

### 1. `ScopeCueRecoveryMemory` Interface + State
**File:** `lib/chat/chat-navigation-context.tsx`

- Added `ScopeCueRecoveryMemory` interface (after `LastOptionsShown`)
- Added `scopeCueRecoveryMemory`, `saveScopeCueRecoveryMemory`, `clearScopeCueRecoveryMemory` to `ChatNavigationContextValue` interface
- Added state + useCallback implementations in provider
- Added to context value object

### 2. Save on Option Selection (Chat-Origin Only)
**File:** `components/chat/chat-navigation-panel.tsx`

Added guarded save inside `handleSelectOption`, before the panel_drawer/non-panel_drawer branch:
```typescript
const isChatOriginList = lastClarification.options.every(o => o.type !== 'widget_option')
if (isChatOriginList) {
  saveScopeCueRecoveryMemory(lastClarification.options, lastClarification.messageId)
}
```

### 3. Hard Clearing Boundaries
**File:** `components/chat/chat-navigation-panel.tsx`

- **Clear chat** (`clearChat`): `clearScopeCueRecoveryMemory()` alongside `clearMessages()`
- **Exit pill** (start_over/none): `clearScopeCueRecoveryMemory()` after `setPendingOptions([])`

**File:** `lib/chat/chat-routing.ts`

- **Tier 0 stop-confirmed**: `clearScopeCueRecoveryMemory()` alongside `clearFocusLatch()`

### 4. Dispatcher + Intercept Context Wiring
**File:** `lib/chat/routing-dispatcher.ts`

- Added `scopeCueRecoveryMemory` + `clearScopeCueRecoveryMemory` to `RoutingDispatcherContext`
- Passed both to `handleClarificationIntercept` call

**File:** `lib/chat/chat-routing.ts`

- Added `scopeCueRecoveryMemory` + `clearScopeCueRecoveryMemory` to `ClarificationInterceptContext`
- Destructured both in `handleClarificationIntercept`

### 5. 4th Source in Recovery Lookup
**File:** `lib/chat/chat-routing.ts`

Updated `getRecoverableChatOptionsWithIdentity` with 4th source (last priority):
```typescript
if (scopeCueRecoveryMemory?.options?.length) {
  return {
    options: scopeCueRecoveryMemory.options,
    messageId: scopeCueRecoveryMemory.messageId,
    source: 'recoveryMemory',
  }
}
```

Updated `RecoverableResult.source` type to include `'recoveryMemory'`.

## Files Modified (5 files)

| File | Lines Changed | Changes |
|------|--------------|---------|
| `lib/chat/chat-navigation-context.tsx` | +25 | `ScopeCueRecoveryMemory` interface + state + save/clear methods + context value |
| `components/chat/chat-navigation-panel.tsx` | +14 | Save (chat-origin guard), clear (exit pill + clearChat), pass to `dispatchRouting` |
| `lib/chat/routing-dispatcher.ts` | +6 | `RoutingDispatcherContext` fields + intercept passthrough |
| `lib/chat/chat-routing.ts` | +13 | `ClarificationInterceptContext` fields + destructure + 4th source + Tier 0 clear |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | +131 | Tests 10-14 (5 new tests) |

**Total: +189 lines**

## Test Results

### Verification Output

```
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005
# No new errors introduced.

$ npx jest __tests__/unit/chat/ __tests__/integration/chat/ --no-coverage --runInBand
# 6 suites, 229 tests, 0 failures
#   - selection-intent-arbitration-dispatcher.test.ts: 14 tests (9 existing + 5 new)
#   - selection-intent-arbitration.test.ts: 51 tests (existing)
#   - selection-intent-arbitration-race.test.ts: 20 tests (existing)
#   - clarification-offmenu.test.ts: existing
#   - clarification-llm-fallback.test.ts: existing
#   - panel-command-matcher.test.ts: existing
```

### New Tests

**Test 10:** Resolved latch + "in chat" + ordinal + ONLY recoveryMemory → chat option #1
- Verifies `handleSelectOption` called with `label: 'Links Panels'`, `suspendFocusLatch` called, pending options cleared

**Test 11:** Resolved latch + "from chat" + ONLY recoveryMemory → standalone restore
- Verifies `setPendingOptions` called with 3 restored options, `setActiveOptionSetId` called with `'recovery-456'`

**Test 12 (Blocker):** Plain "open the second one" must NEVER read recovery memory
- Verifies no scope cue → recovery memory never accessed, widget latch handles instead

**Test 13 (Blocker):** "from chat" after known-noun clear + TTL expiry → restores from recovery memory
- Verifies recovery memory survives known-noun clearing + TTL expiry (the intermittent failure case)

**Test 14 (Blocker):** "from chat" after session reset → "No earlier options available."
- Verifies `scopeCueRecoveryMemory = null` → no stale options restored

## Clearing Policy

| Cleared by | Cleared? | Reason |
|-----------|----------|--------|
| Known-noun navigation | NO | That's the point of this fix |
| Turn-based TTL | NO | No TTL — durable by design |
| `handleSelectOption` | NO | Only clears `lastClarification` |
| Grounding clarifier paths | NO | Only clear `lastOptionsShown` |
| New chat-origin selection | REPLACED | Fresh options naturally replace old |
| Clear chat button | YES | Session boundary |
| Exit pill (start_over/none) | YES | Session boundary |
| Tier 0 stop-confirmed | YES | Session boundary |

## Acceptance Checks

1. [x] "from chat" after known-noun clear + TTL expiry restores from recovery memory (Test 13)
2. [x] "open the first one in chat" with only recovery memory resolves chat option #1 (Test 10)
3. [x] "from chat" with only recovery memory restores full chat state (Test 11)
4. [x] Plain "open the second one" never reads recovery memory (Test 12)
5. [x] "from chat" after session reset returns "No earlier options available" (Test 14)
6. [x] Widget_option lists are excluded from save (chat-origin guard: `every(o => o.type !== 'widget_option')`)
7. [x] Recovery memory cleared on exit pill, clear chat, stop-confirmed
8. [x] Recovery memory is last-resort priority (snapshot > lastOptionsShown > lastClarification > recoveryMemory)
