# Scope-Cue Normalization — Chat-Scope Phase (Deterministic)

**Date:** 2026-02-07
**Feature flag:** `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=true`
**Plan file:** `/Users/dandy/.claude/plans/wiggly-juggling-haven.md`
**Addendum plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-scope-cues-addendum-plan.md`
**Parent report:** `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-02-07-selection-intent-arbitration-widget-first-fix-report.md`

## Summary

Implemented deterministic chat-scope cue normalization to fix the bug where "open the first one in chat" and "open the first one from chat" resolved against the latched widget instead of the recoverable chat disambiguation options. This is rollout item #2 of the scope-cues addendum plan (chat-scope only; widget-scope cues and LLM fallback ship separately).

**Root cause:** `CHAT_REANCHOR_PATTERN` at `chat-routing.ts:2249` only recognized 3 phrases ("back to options", "from earlier options", "from chat options"). It did NOT recognize "in chat" or "from chat". When the focus latch was active, `isSelectionLike` detected "first" as an ordinal, and Tier 4.5 resolved against the widget — the "in chat" qualifier was ignored.

**Additional gaps fixed:**
1. The old re-anchor returned `handled: true` without resolving ordinals — "open the first one in chat" needs single-turn scope switch + selection execution.
2. The old re-anchor only restored `lastClarification`, missing full chat-active state (`setPendingOptions`, `setPendingOptionsMessageId`, `setPendingOptionsGraceCount`, `setActiveOptionSetId`).
3. The old re-anchor only fired when latch was active — "from chat" with recoverable options but no latch should still work.
4. No command/question guard — "open recent in chat" should route "open recent" as a command, not be swallowed.

## Architecture: 4-Phase Scope-Cue Flow

The new scope-cue block replaces the old `CHAT_REANCHOR_PATTERN` at `chat-routing.ts:2249-2283` with a structured 4-phase flow:

```
Phase 1: Suspend latch if active (always — respect scope intent)
    │
    ▼
Phase 2: Check for ordinal in input (isSelectionOnly, embedded mode)
    ├── Ordinal found → Single-turn execution: restore + handleSelectOption → handled: true
    │
    ▼
Phase 3: No ordinal — check command/question guard (isNewQuestionOrCommandDetected)
    ├── Command/question → Fall through to downstream tiers → handled: false
    │                      (latch suspended, but NO stale restore)
    ▼
Phase 4: Standalone re-anchor (e.g., "from chat")
    └── Restore full chat state → handled: true
```

**Key precedence rule:** Phase 2 (ordinal detection) runs BEFORE Phase 3 (command guard). This ensures "open the first one in chat" (command + ordinal) single-turn executes (ordinal wins), while "open recent in chat" (command, no ordinal) falls through to known-noun routing.

## Changes

### 1. Scope-Cue Parser
**File:** `lib/chat/input-classifiers.ts` (lines 334-374)

Added `ScopeCueResult` interface and `resolveScopeCue()` function:
- Chat cue pattern: `/\b(back to options|from earlier options|from chat options?|from the chat|from chat|in chat)\b/i`
- Longest match first to avoid partial matches
- Word boundary (`\b`) prevents false positives ("chatbot", "chatter", "chatroom")
- Widget cues deferred to phase 2

### 2. Extended ClarificationInterceptContext
**File:** `lib/chat/chat-routing.ts` (lines 1161-1164)

Added two new fields to the interface:
- `clearWidgetSelectionContext: () => void` — source separation when switching from widget to chat scope
- `setActiveOptionSetId: (id: string | null) => void` — option-set identity for shorthand matching

### 3. Dispatcher Passthrough
**File:** `lib/chat/routing-dispatcher.ts` (lines 1028-1029)

Passed both new callbacks from `RoutingDispatcherContext` to the intercept call:
```typescript
clearWidgetSelectionContext: ctx.clearWidgetSelectionContext,
setActiveOptionSetId: ctx.setActiveOptionSetId,
```

### 4. Scope-Cue Flow (replaces CHAT_REANCHOR_PATTERN)
**File:** `lib/chat/chat-routing.ts` (lines 2249-2378)

Replaced the 36-line `CHAT_REANCHOR_PATTERN` block with ~130 lines implementing:

**Feature-flag gate (line 2256):**
```typescript
const scopeCue = isLatchEnabled ? resolveScopeCue(trimmedInput) : { scope: 'none' as const, ... }
```
When flag is off, scope is forced to `'none'`, short-circuiting the entire block.

**`getRecoverableChatOptionsWithIdentity()` (lines 2266-2289):**
- Enhanced version of `getRecoverableChatOptions` that returns `{ options, messageId, source }`
- Uses original `messageId` from `lastOptionsShown` and `lastClarification` to preserve option-set linkage
- For `ClarificationSnapshot` (which loses messageId during save), synthesizes `snapshot-${timestamp}`
- Source priority: `clarificationSnapshot > lastOptionsShown > lastClarification`

**`restoreFullChatState()` (lines 2292-2312):**
- Produces `PendingOptionState[]` with all required fields: `index` (1-based), `id`, `label`, `sublabel`, `type`, `data` (via `reconstructSnapshotData`)
- Calls all 5 setters: `setPendingOptions`, `setPendingOptionsMessageId`, `setPendingOptionsGraceCount`, `setActiveOptionSetId`, `setLastClarification`

**Phase 1 — Latch suspension (lines 2316-2323):**
- If latch active: `suspendFocusLatch()` + `clearWidgetSelectionContext()` (unconditional, not `?.()`)
- If no latch: debug log only (scope cue still processes)

**Phase 2 — Single-turn execution (lines 2328-2348):**
- `isSelectionOnly(trimmedInput, count, labels, 'embedded')` extracts ordinals from anywhere in input
- "in chat" doesn't interfere because it contains no ordinal words
- On match: `restoreFullChatState` + `handleSelectOption` + `return handled: true`

**Phase 3 — Command/question guard (lines 2350-2358):**
- Checks `isNewQuestionOrCommandDetected` (defined at line 1310, in scope)
- Returns `handled: false` — latch is suspended but NO stale chat state is restored
- Options stay dormant in their original stores for future explicit re-anchor

**Phase 4 — Standalone re-anchor (lines 2360-2362):**
- `restoreFullChatState` + `return handled: true`

### 5. Observability
Added 4 new debug log actions:
- `scope_cue_applied_chat` — scope=chat with active latch (includes latchId, optionCount, source)
- `scope_cue_applied_chat_no_latch` — scope=chat without latch
- `scope_cue_chat_single_turn_select` — Phase 2 single-turn execution (includes index, label)
- `scope_cue_chat_command_fallthrough` — Phase 3 command guard fired

## Files Modified (5 files)

| File | Lines Changed | Changes |
|------|--------------|---------|
| `lib/chat/input-classifiers.ts` | +41 | `ScopeCueResult` interface + `resolveScopeCue()` function |
| `lib/chat/chat-routing.ts` | +116, -16 | `clearWidgetSelectionContext` + `setActiveOptionSetId` on `ClarificationInterceptContext`; `resolveScopeCue` import; replaced `CHAT_REANCHOR_PATTERN` block with 4-phase scope-cue flow including `getRecoverableChatOptionsWithIdentity`, `restoreFullChatState`, command guard |
| `lib/chat/routing-dispatcher.ts` | +2 | Pass `clearWidgetSelectionContext` + `setActiveOptionSetId` to intercept call |
| `__tests__/unit/chat/selection-intent-arbitration.test.ts` | +143 | 23 new tests: `resolveScopeCue` unit tests (14) + command precedence interaction tests (9) |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | +131 | 5 new dispatcher-level tests (Tests 5-9) |

**Total: +433 lines, -16 lines**

## Test Results

### Unit Tests: `resolveScopeCue` (14 tests)
- 7 chat cue detection tests: "in chat", "from chat", "from chat" in longer phrase, "back to options", "from earlier options", "from chat options", "from the chat"
- 4 non-chat tests: ordinal-only, commands, plain selection, questions
- 4 word boundary edge cases: "chatbot", empty string, "chatter", "chatroom"

### Unit Tests: Command Precedence Interaction (9 tests)
- 2 selection-wins tests: "open the first one in chat" (ordinal=0), "show the second one in chat" (ordinal=1)
- 1 command-wins test: "open recent in chat" (no ordinal → isSelectionOnly false)
- 1 fuzzy edge case: "what is this in chat" → "this" fuzzy-matches "third" (levenshtein=2) — pre-existing embedded parser behavior, documented
- 1 question without ordinal: "how does it work in chat" → isSelectionOnly false
- 1 question with ordinal: "what is the first one in chat" → ordinal takes priority (matches existing latch bypass behavior)
- 2 standalone scope cues: "from chat", "back to options" → not selections

### Dispatcher-Level Tests: Scope-Cue (5 tests)
- **Test 5:** Resolved latch + "in chat" + ordinal → chat option #1 (NOT widget). Verifies `handleSelectOption` called with `label: 'Links Panels'`, `suspendFocusLatch` called, `clearWidgetSelectionContext` called, no `groundingAction`.
- **Test 6:** Resolved latch + "from chat" + no ordinal → restore only. Verifies `handleSelectOption` NOT called, `setLastClarification` called with restored options, `setPendingOptions` called, `setActiveOptionSetId` called.
- **Test 7:** Resolved latch + "from chat" + no recoverable → "No earlier options available." message.
- **Test 8:** No latch + "in chat" + ordinal + recoverable → chat option #1. Verifies `suspendFocusLatch` NOT called (no latch).
- **Test 9:** Resolved latch + "open recent in chat" (command) → falls through without restore. Verifies `suspendFocusLatch` called, `setPendingOptions` NOT called, `setActiveOptionSetId` NOT called, known-noun routes.

### Verification Output

```
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005
# No new errors introduced.

$ npx jest __tests__/unit/chat/ __tests__/integration/chat/ --no-coverage --runInBand
# 6 suites, 224 tests, 0 failures
#   - selection-intent-arbitration.test.ts: 51 tests (28 existing + 23 new)
#   - selection-intent-arbitration-dispatcher.test.ts: 9 tests (4 existing + 5 new)
#   - selection-intent-arbitration-race.test.ts: 20 tests (existing)
#   - clarification-offmenu.test.ts: existing
#   - clarification-llm-fallback.test.ts: existing
#   - panel-command-matcher.test.ts: existing
```

## Design Decisions

### 1. Feature-flag gated
`resolveScopeCue` only runs when `isLatchEnabled` is true. When flag is off, scope is forced to `{ scope: 'none' }`, preserving existing behavior.

### 2. Scope cue not latch-gated
The outer guard `if (scopeCue.scope === 'chat')` fires regardless of latch state — only the feature flag matters. Latch suspension happens inside only when `isLatchActive`. This handles the no-latch case (Test 8).

### 3. Original message identity preserved
`getRecoverableChatOptionsWithIdentity` returns the original `messageId` from the recoverable source. `lastOptionsShown.messageId` and `lastClarification.messageId` carry their original IDs. `ClarificationSnapshot` loses messageId during `saveClarificationSnapshot` (chat-navigation-context.tsx:1146-1155), so we synthesize `snapshot-${timestamp}`. This prevents option-set linkage drift.

### 4. No stale restore on command fallthrough
Phase 3 (command guard) does NOT call `restoreFullChatState`. Restoring stale chat context is unnecessary when the user is issuing a command — the options stay dormant in their original stores for a future explicit "from chat" re-anchor.

### 5. Selection before command (precedence proof)
`isSelectionOnly` runs before the `isNewQuestionOrCommandDetected` guard. "open the first one in chat" triggers `isNewQuestionOrCommandDetected = true` (because "open" matches `COMMAND_START_PATTERN`), but ordinal detection at Phase 2 catches it first. The command guard only fires when there's NO ordinal.

### 6. PendingOptionState shape correctness
`restoreFullChatState` builds `PendingOptionState[]` with all required fields: `index` (1-based via `idx + 1`), `id`, `label`, `sublabel`, `type`, `data` (via `reconstructSnapshotData`). `ClarificationOption` lacks `data`, so `reconstructSnapshotData` (chat-routing.ts:1183-1217) rebuilds it from `id/label/type` — same canonical path used by 11+ existing call sites.

## Acceptance Checks

1. [x] `"open the first one in chat"` with active latch resolves chat option #1 in single turn
   - Verified: Test 5 passes — `handleSelectOption` called with `label: 'Links Panels'`
2. [x] `"open the first one from chat"` with active latch resolves chat option #1 in single turn
   - Verified: `resolveScopeCue` detects "from chat" → same Phase 2 path as "in chat"
3. [x] `"open the second one"` (no scope cue) with active latch resolves widget item #2
   - Verified: Tests 1-2 (existing) still pass — no scope cue → existing latch behavior unchanged
4. [x] `"from chat"` standalone suspends latch and restores full chat-active state without selection
   - Verified: Test 6 passes — `setPendingOptions`, `setActiveOptionSetId`, `setLastClarification` all called
5. [x] Feature flag off → `resolveScopeCue` is skipped (forced to `scope='none'`)
   - Verified: line 2256 — `isLatchEnabled ? resolveScopeCue(trimmedInput) : { scope: 'none' ... }`
6. [x] Existing re-anchor phrases ("back to options", "from earlier options") still work
   - Verified: `CHAT_CUE_PATTERN` includes all 3 original phrases + new "in chat"/"from chat"
7. [x] `"open the first one in chat"` with no latch but recoverable options resolves chat option #1
   - Verified: Test 8 passes — no latch to suspend, selection still executes
8. [x] `"open recent in chat"` with active latch → latch suspended, NO stale restore, command routes
   - Verified: Test 9 passes — `setPendingOptions` NOT called, known-noun handles
9. [x] Full state restore shape: `PendingOptionState` with index, id, label, sublabel, type, data
   - Verified: `restoreFullChatState` at line 2293 builds with `idx + 1`, `reconstructSnapshotData`
10. [x] `"show the second one in chat"` → selection wins (ordinal found)
    - Verified: Unit test passes — `isSelectionOnly` returns `{ isSelection: true, index: 1 }`
11. [x] Original messageId from recoverable source used (not always `reanchor-${Date.now()}`)
    - Verified: `getRecoverableChatOptionsWithIdentity` returns `lastOptionsShown.messageId` or `lastClarification.messageId`

## Known Edge Cases

1. **"this" → "third" fuzzy match** — Embedded mode's levenshtein normalization matches "this" to "third" (distance 2). This means "what is this in chat" resolves as chat option #3 (not a question). Pre-existing behavior in `isSelectionOnlyEmbedded`, not scope-cue specific. Documented in unit test.

2. **ClarificationSnapshot messageId loss** — `saveClarificationSnapshot` (chat-navigation-context.tsx:1146-1155) does not preserve the original `LastClarificationState.messageId`. The scope-cue flow synthesizes `snapshot-${timestamp}` as a deterministic fallback. If strict messageId continuity is needed for snapshot-sourced recovery, the snapshot interface would need a `messageId` field (out of scope for this phase).

## Rollout

1. Gated behind `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1` (same flag as widget-first latch fix).
2. Chat-scope cue support ships in this phase (deterministic only).
3. Widget-scope cues ("from links panel d") require passing widget labels to the intercept context — deferred to phase 2 per addendum plan.
4. Constrained LLM source arbitration ships separately per addendum plan §Step C.

## Next Steps

- [ ] Manual testing with real chat sessions (disambiguation → panel open → "open the first one in chat")
- [ ] Widget-scope cues (phase 2): pass `widgetLabels` to `ClarificationInterceptContext`, extend `resolveScopeCue` with named widget matching
- [ ] Constrained LLM source arbitration (phase 3): Tier 3.6 fallback for unresolved scope + selection-like input
- [ ] Consider adding `messageId` to `ClarificationSnapshot` interface for strict identity continuity
