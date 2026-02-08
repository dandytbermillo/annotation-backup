# Scope-Cue Normalization — Chat-Scope Phase (Deterministic)

## Context

After implementing the widget-first latch fix (Steps 1-7, all complete), a gap remains: when a user says **"open the first one in chat"** or **"open the first one from chat"**, the "in chat" / "from chat" qualifier is ignored. The latch stays active, `isSelectionLike` detects "first" as an ordinal, and Tier 4.5 resolves against the widget instead of the chat disambiguation list.

**Root cause:** `CHAT_REANCHOR_PATTERN` at `chat-routing.ts:2249` only recognizes 3 phrases ("back to options", "from earlier options", "from chat options"). It does NOT recognize "in chat" or "from chat".

**Additional gaps:**
1. The current re-anchor returns `handled: true` without resolving any ordinal from the input. "back to options" is a standalone re-anchor command, but "open the first one in chat" contains both a scope cue AND a selection — it must execute in a single turn.
2. The current re-anchor only restores `lastClarification`, missing the full chat-active state (`setPendingOptions`, `setPendingOptionsMessageId`, `setPendingOptionsGraceCount`, `setActiveOptionSetId`).
3. The current re-anchor only fires when latch is active. A user saying "from chat" with recoverable options but NO active latch should still work.
4. No command/question guard — "open recent in chat" should route "open recent" as a command, not be swallowed as a standalone re-anchor.

**Addendum plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-scope-cues-addendum-plan.md`

**Rollout phase:** This plan covers **rollout item #2 only** (deterministic chat-scope cue support). Widget-scope cues and constrained LLM fallback ship separately.

---

## Implementation

### Step 1: Add `resolveScopeCue()` parser

**File:** `lib/chat/input-classifiers.ts`

Add a new exported function following the pattern of `isExplicitCommand` and `isSelectionOnly`:

```typescript
export interface ScopeCueResult {
  scope: 'chat' | 'widget' | 'none'
  cueText: string | null        // The matched cue phrase (for stripping)
  confidence: 'high' | 'none'   // Phase 1: always 'high' or 'none'
}

export function resolveScopeCue(input: string): ScopeCueResult {
  const normalized = input.toLowerCase().trim()

  // Chat cues — order: longest match first to avoid partial matches
  const CHAT_CUE_PATTERN = /\b(back to options|from earlier options|from chat options?|from the chat|from chat|in chat)\b/i
  const chatMatch = normalized.match(CHAT_CUE_PATTERN)
  if (chatMatch) {
    return { scope: 'chat', cueText: chatMatch[0], confidence: 'high' }
  }

  // Widget cues — deferred to phase 2
  // (would need widget labels passed in for "from <widget label>" matching)

  return { scope: 'none', cueText: null, confidence: 'none' }
}
```

**Why `input-classifiers.ts`:** Follows the established pattern — `isExplicitCommand`, `isSelectionOnly`, `normalizeOrdinalTypos` are all here. No circular dependency risk.

### Step 2: Extend `ClarificationInterceptContext` with missing callbacks

**File:** `lib/chat/chat-routing.ts` — `ClarificationInterceptContext` at line ~1160

Add two new fields to the interface:

```typescript
// Add to ClarificationInterceptContext:
setActiveOptionSetId: (id: string | null) => void
clearWidgetSelectionContext: () => void
```

**Why both are required:**
- `setActiveOptionSetId` — needed for full chat-active state restore (addendum plan §Step B line 132). Currently only on `RoutingDispatcherContext` (line 164) and `known-noun-routing`. Without this, restored options aren't recognized by shorthand matching on subsequent turns.
- `clearWidgetSelectionContext` — needed for source separation when switching from widget to chat scope (addendum plan §Step B line 134). Currently NOT in the interface. Eliminates the inconsistency of calling `?.()` on an undefined callback.

**File:** `lib/chat/routing-dispatcher.ts` — intercept call site at line ~998-1039

Pass both new fields from the dispatcher context:

```typescript
// Add to the handleClarificationIntercept call:
setActiveOptionSetId: ctx.setActiveOptionSetId,
clearWidgetSelectionContext: ctx.clearWidgetSelectionContext,
```

### Step 3: Replace `CHAT_REANCHOR_PATTERN` with scope-cue resolver + full restore + guards

**File:** `lib/chat/chat-routing.ts`

Replace the block at **lines 2243-2279** (the current `CHAT_REANCHOR_PATTERN` + re-anchor logic).

**Import:** Add `resolveScopeCue` to the existing import from `@/lib/chat/input-classifiers`.

**New logic** (replaces lines 2249-2279):

```typescript
// ==========================================================================
// FOCUS LATCH — Scope-Cue Normalization (per scope-cues-addendum-plan.md)
// Explicit scope cues override latch default. Runs before latch bypass.
// Gated on isLatchEnabled (feature flag), NOT on isLatchActive.
// "from chat" works even when no latch is active, as long as the flag is on.
// ==========================================================================
const isLatchActive = focusLatch && !focusLatch.suspended
const scopeCue = isLatchEnabled ? resolveScopeCue(trimmedInput) : { scope: 'none' as const, cueText: null, confidence: 'none' as const }

if (scopeCue.scope === 'chat') {
  const recoverable = getRecoverableChatOptionsWithIdentity({ clarificationSnapshot, lastOptionsShown, lastClarification })

  // --- Phase 1: Suspend latch if active (respect scope intent) ---
  if (isLatchActive) {
    suspendFocusLatch()
    clearWidgetSelectionContext()
    void debugLog({ component: 'ChatNavigation', action: 'scope_cue_applied_chat', metadata: { cueText: scopeCue.cueText, latchId: getLatchId(focusLatch), optionCount: recoverable?.options.length ?? 0, source: recoverable?.source } })
  } else {
    void debugLog({ component: 'ChatNavigation', action: 'scope_cue_applied_chat_no_latch', metadata: { cueText: scopeCue.cueText, optionCount: recoverable?.options.length ?? 0, source: recoverable?.source } })
  }

  if (recoverable) {
    const { options: recoverableOptions, messageId: originalMessageId } = recoverable

    // --- Phase 2: Check for selection in input ---
    const optionLabels = recoverableOptions.map(o => o.label)
    const selectionResult = isSelectionOnly(trimmedInput, recoverableOptions.length, optionLabels, 'embedded')

    if (selectionResult.isSelection && selectionResult.index !== undefined) {
      // Single-turn execution: scope cue + ordinal → execute against chat options
      restoreFullChatState(recoverableOptions, originalMessageId)

      const selectedOption = recoverableOptions[selectionResult.index]
      const optionToSelect: SelectionOption = {
        type: selectedOption.type as SelectionOption['type'],
        id: selectedOption.id,
        label: selectedOption.label,
        sublabel: selectedOption.sublabel,
        data: reconstructSnapshotData(selectedOption),
      }
      void debugLog({ component: 'ChatNavigation', action: 'scope_cue_chat_single_turn_select', metadata: { index: selectionResult.index, label: selectedOption.label } })
      setIsLoading(false)
      handleSelectOption(optionToSelect)
      return { handled: true, clarificationCleared: true, isNewQuestionOrCommandDetected }
    }

    // --- Phase 3: No selection detected — check command/question guard ---
    if (isNewQuestionOrCommandDetected) {
      // Input like "open recent in chat" — scope cue intent is respected (latch
      // already suspended above), but the command portion must fall through to
      // downstream routing (Tier 2/4 known-noun). Do NOT restore full chat state
      // here — restoring stale context is unnecessary when the user is issuing a
      // command. The recoverable options stay dormant in their original stores
      // for a future explicit "from chat" re-anchor.
      void debugLog({ component: 'ChatNavigation', action: 'scope_cue_chat_command_fallthrough', metadata: { cueText: scopeCue.cueText } })
      return { handled: false, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }

    // --- Phase 4: Standalone re-anchor (e.g., "from chat") ---
    restoreFullChatState(recoverableOptions, originalMessageId)
    return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
  } else {
    // No recoverable options
    if (isNewQuestionOrCommandDetected) {
      // "open recent in chat" with no chat options — just fall through
      return { handled: false, clarificationCleared: false, isNewQuestionOrCommandDetected }
    }
    addMessage({
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: 'No earlier options available.',
      timestamp: new Date(),
      isError: false,
    })
    setIsLoading(false)
    return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
  }
}
```

**Helper functions** (add above the scope-cue block, ~line 2240):

```typescript
/** Recoverable result with original message identity for option-set linkage. */
interface RecoverableResult {
  options: ClarificationOption[]
  messageId: string
  source: 'snapshot' | 'lastOptionsShown' | 'lastClarification'
}

/**
 * Like getRecoverableChatOptions but returns { options, messageId, source }.
 * Uses original messageId from the recoverable source to preserve option-set linkage.
 *
 * Source priority: clarificationSnapshot > lastOptionsShown > lastClarification
 *
 * Note: ClarificationSnapshot does not store messageId (lost during saveClarificationSnapshot
 * at chat-navigation-context.tsx:1146-1155). For snapshot recovery, messageId is synthesized
 * from snapshot.originalIntent + timestamp. lastOptionsShown and lastClarification preserve
 * their original messageIds.
 */
function getRecoverableChatOptionsWithIdentity(ctx: {
  clarificationSnapshot: ClarificationSnapshot | null
  lastOptionsShown: LastOptionsShown | null
  lastClarification: LastClarificationState | null
}): RecoverableResult | null {
  if (ctx.clarificationSnapshot?.options?.length) {
    return {
      options: ctx.clarificationSnapshot.options,
      messageId: `snapshot-${ctx.clarificationSnapshot.timestamp}`,
      source: 'snapshot',
    }
  }
  if (ctx.lastOptionsShown?.options?.length) {
    return {
      options: ctx.lastOptionsShown.options,
      messageId: ctx.lastOptionsShown.messageId,
      source: 'lastOptionsShown',
    }
  }
  if (ctx.lastClarification?.options?.length) {
    return {
      options: ctx.lastClarification.options,
      messageId: ctx.lastClarification.messageId,
      source: 'lastClarification',
    }
  }
  return null
}

/**
 * Restore full chat-active state so subsequent ordinal turns execute against chat options.
 *
 * PendingOptionState requires: index (1-based), label, sublabel, type, id, data.
 * ClarificationOption only has: id, label, sublabel?, type.
 * `data` is reconstructed via reconstructSnapshotData() — the same function used by
 * 11+ existing call sites for snapshot-based option execution (chat-routing.ts:1183-1217).
 *
 * Source fidelity note: all 3 recoverable sources (clarificationSnapshot, lastOptionsShown,
 * lastClarification) return ClarificationOption[] with the same fields. None stores raw `data`.
 * reconstructSnapshotData handles panel_drawer, doc, note, workspace, entry types and falls
 * back to doc data for unknown types. This is the canonical reconstruction path.
 */
function restoreFullChatState(options: ClarificationOption[], messageId: string) {
  const pendingOptions: PendingOptionState[] = options.map((o, idx) => ({
    index: idx + 1,
    id: o.id,
    label: o.label,
    sublabel: o.sublabel,
    type: o.type,
    data: reconstructSnapshotData(o),
  }))
  setPendingOptions(pendingOptions)
  setPendingOptionsMessageId(messageId)
  setPendingOptionsGraceCount(0)
  setActiveOptionSetId(messageId)
  setLastClarification({
    type: 'option_selection',
    originalIntent: trimmedInput,
    messageId,
    timestamp: Date.now(),
    options,
  })
}
```

**Key design decisions:**

1. **Feature-flag gated** — `resolveScopeCue` only runs when `isLatchEnabled` is true. When flag is off, `scopeCue` is forced to `{ scope: 'none' }`, preserving existing behavior. This ensures scope-cue normalization is controlled by `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1`.

2. **Scope cue not latch-gated (but flag-gated)** — `if (scopeCue.scope === 'chat')` fires regardless of latch state (only `isLatchEnabled` matters). Latch suspension happens inside only when `isLatchActive`. This handles the case where user says "from chat" with recoverable options but no active latch.

3. **Full state restore with correct PendingOptionState shape** — `restoreFullChatState` produces `PendingOptionState[]` with all required fields: `index` (1-based), `id`, `label`, `sublabel`, `type`, `data` (via `reconstructSnapshotData`). Calls all 5 setters. This ensures UI shows options, shorthand matching works, and subsequent pill selection has executable data.

4. **Original message identity preserved** — `getRecoverableChatOptionsWithIdentity` returns `{ options, messageId, source }`. `lastOptionsShown.messageId` and `lastClarification.messageId` carry the original IDs. `ClarificationSnapshot` loses messageId during save (chat-navigation-context.tsx:1146-1155), so we synthesize `snapshot-${timestamp}`. This prevents option-set linkage drift from always generating `reanchor-${Date.now()}`.

5. **Source fidelity via `reconstructSnapshotData`** — All 3 recoverable sources return `ClarificationOption[]` which lacks the `data` field. `reconstructSnapshotData` (chat-routing.ts:1183-1217) is the canonical reconstruction path, handling `panel_drawer`, `doc`, `note`, `workspace`, `entry` types. Same function used by 11+ existing call sites.

6. **Command/question guard — no stale restore** — After `isSelectionOnly` fails (no ordinal), checks `isNewQuestionOrCommandDetected` (defined at line 1310, in scope). If true, returns `handled: false` so "open recent in chat" falls through to Tier 2/4 known-noun routing. The latch is suspended (if active), but **full chat state is NOT restored** — restoring stale context is unnecessary when the user is issuing a command. Options stay dormant in their original stores for a future explicit "from chat" re-anchor.

7. **Selection check before command guard (precedence proof)** — `isSelectionOnly` is checked BEFORE the command guard. This is critical: "open the first one in chat" triggers `isNewQuestionOrCommandDetected = true` (because "open" matches `COMMAND_START_PATTERN`), but `isSelectionOnly` detects "first" → index 0 and single-turn executes. The command guard only fires when there's NO selection. Edge case precedence table:
   - `"open the first one in chat"` → ordinal found → Phase 2 (selection wins)
   - `"open recent in chat"` → no ordinal → Phase 3 (command falls through, no state restore)
   - `"what is this in chat"` → no ordinal → Phase 3 (question falls through, no state restore)
   - `"show the second one in chat"` → ordinal found → Phase 2 (selection wins)
   - `"what is the first one in chat"` → ordinal found → Phase 2 (selection wins — known edge case where question with ordinal is treated as selection; matches existing latch bypass behavior)
   - `"from chat"` → no ordinal, not command → Phase 4 (standalone restore with original messageId)

8. **`clearWidgetSelectionContext`** — called unconditionally when latch is active (not `?.()` optional chain). Step 2 ensures the callback is always present in the intercept context.

9. **`isSelectionOnly` in embedded mode** — "open the first one in chat" → `extractOrdinalFromPhrase` finds "first" → index 0. The "in chat" text doesn't interfere because it contains no ordinal words.

### Step 4: Unit tests for `resolveScopeCue`

**File:** `__tests__/unit/chat/selection-intent-arbitration.test.ts` (existing, add new describe block)

```
describe('resolveScopeCue', () => {
  // Chat cues (scope: 'chat')
  - "open the first one in chat" → { scope: 'chat', cueText: 'in chat' }
  - "from chat" → { scope: 'chat', cueText: 'from chat' }
  - "open the first one from chat" → { scope: 'chat', cueText: 'from chat' }
  - "back to options" → { scope: 'chat', cueText: 'back to options' }
  - "from earlier options" → { scope: 'chat', cueText: 'from earlier options' }
  - "from chat options" → { scope: 'chat', cueText: 'from chat options' }
  - "from the chat" → { scope: 'chat', cueText: 'from the chat' }

  // Non-chat (scope: 'none')
  - "open the second one" → { scope: 'none' }
  - "open recent" → { scope: 'none' }
  - "second one pls" → { scope: 'none' }
  - "what is this" → { scope: 'none' }

  // Edge cases — word boundary and false positives
  - "chatbot help" → { scope: 'none' } (word boundary: "chat" is part of "chatbot")
  - "" → { scope: 'none' }
  - "from chatter" → { scope: 'none' } (word boundary: "chat" is part of "chatter")
  - "podcast in chatroom" → { scope: 'none' } (word boundary)
})

describe('scope-cue + isSelectionOnly interaction (command precedence)', () => {
  // Selection wins over command when ordinal is present
  - "open the first one in chat" → scope='chat', isSelectionOnly → index 0 (selection wins)
  - "show the second one in chat" → scope='chat', isSelectionOnly → index 1 (selection wins)

  // Command wins when no ordinal
  - "open recent in chat" → scope='chat', isSelectionOnly → false, isNewQuestionOrCommand → true
  - "what is this in chat" → scope='chat', isSelectionOnly → false (NOTE: embedded mode fuzzy-matches "this" → "third", pre-existing behavior)

  // Question without ordinal
  - "how does it work in chat" → scope='chat', isSelectionOnly → false, isNewQuestionOrCommand → true

  // Question with ordinal — edge case (selection wins, matches existing behavior)
  - "what is the first one in chat" → scope='chat', isSelectionOnly → index 0 (ordinal takes priority)

  // Standalone scope cue — not command, not selection
  - "from chat" → scope='chat', isSelectionOnly → false, isNewQuestionOrCommand → false
  - "back to options" → scope='chat', isSelectionOnly → false, isNewQuestionOrCommand → false
})
```

### Step 5: Dispatcher-level tests for scope-cue chat resolution

**File:** `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` (existing, add new tests)

**Test 5: Resolved latch + "in chat" scope cue + ordinal → chat option (NOT widget)**
- Context: `focusLatch = makeResolvedLatch()`, `clarificationSnapshot` with 3 stale disambiguation options, input = `"open the first one in chat"`
- Expected: `result.handled === true`, `ctx.handleSelectOption` called with `label: 'Links Panels'` (chat option #1)
- Verify: `result.groundingAction` is undefined, `ctx.suspendFocusLatch` was called, `ctx.clearWidgetSelectionContext` was called

**Test 6: Resolved latch + "from chat" scope cue + no ordinal → restore only (no selection)**
- Context: same latch and snapshot, input = `"from chat"`
- Expected: `result.handled === true`, `ctx.handleSelectOption` NOT called, `ctx.suspendFocusLatch` called, `ctx.setLastClarification` called with restored options, `ctx.setPendingOptions` called, `ctx.setActiveOptionSetId` called

**Test 7: Resolved latch + "from chat" + no recoverable options → "No earlier options" message**
- Context: latch active, `clarificationSnapshot = null`, `lastOptionsShown = null`, `lastClarification = null`, input = `"from chat"`
- Expected: `result.handled === true`, `ctx.addMessage` called with content containing 'No earlier options'

**Test 8: No latch + "in chat" scope cue + ordinal + recoverable options → chat option**
- Context: `focusLatch = null`, `clarificationSnapshot` with 3 options, input = `"open the first one in chat"`
- Expected: `result.handled === true`, `ctx.handleSelectOption` called with `label: 'Links Panels'`, `ctx.suspendFocusLatch` NOT called (no latch to suspend)

**Test 9: Resolved latch + "open recent in chat" (command + scope cue) → falls through without restore**
- Context: `focusLatch = makeResolvedLatch()`, `clarificationSnapshot` with 3 options, input = `"open recent in chat"`, `mockHandleKnownNounRouting` returns `{ handled: true }`
- Expected: `ctx.suspendFocusLatch` called, `ctx.clearWidgetSelectionContext` called, `ctx.handleSelectOption` NOT called, `ctx.setPendingOptions` NOT called (no stale restore on command), `ctx.setActiveOptionSetId` NOT called. Result handled by known-noun routing.

---

## Files Modified (3 files + 2 test files)

| File | Changes |
|------|---------|
| `lib/chat/input-classifiers.ts` | Add `resolveScopeCue()` + `ScopeCueResult` type |
| `lib/chat/chat-routing.ts` | Add `setActiveOptionSetId` + `clearWidgetSelectionContext` to `ClarificationInterceptContext`; replace `CHAT_REANCHOR_PATTERN` block (lines 2249-2279) with scope-cue resolver + full state restore + command guard + single-turn execution |
| `lib/chat/routing-dispatcher.ts` | Pass `setActiveOptionSetId` + `clearWidgetSelectionContext` to intercept call (~line 1027) |
| `__tests__/unit/chat/selection-intent-arbitration.test.ts` | Add `resolveScopeCue` unit tests (~14 tests) + command precedence interaction tests (~9 tests) |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | Add Tests 5-9 (scope-cue dispatcher tests) |

---

## Verification

```bash
npx tsc --noEmit
# Only pre-existing error at use-panel-close-handler.test.tsx:87

npx jest __tests__/unit/chat/ __tests__/integration/chat/ --no-coverage --runInBand
# All suites pass (existing 196 + new ~23 tests)
```

Manual tests:
1. `"links panel"` → disambiguation → `"third one"` → Opens Links Panel E → `"open links panel d"` → Opens Links Panel D → `"open the first one in chat"` → Opens **Links Panels** (chat option #1, NOT widget item #1)
2. `"links panel"` → disambiguation → `"third one"` → Opens Links Panel E → `"open links panel d"` → Opens Links Panel D → `"open the first one pls"` → Opens **summary144 D** (widget item #1, latch applies)
3. `"links panel"` → disambiguation → `"third one"` → Opens Links Panel E → `"open links panel d"` → Opens Links Panel D → `"from chat"` → Restores chat options → `"second one"` → Opens **Links Panel D** (chat option #2)
4. `"links panel"` → disambiguation → `"third one"` → Opens Links Panel E → `"open links panel d"` → Opens Links Panel D → `"open recent in chat"` → Opens **Recent** panel (command routes through, latch suspended)

---

## Acceptance Checks (blockers, per addendum plan)

1. `"open the first one in chat"` with active latch resolves chat option #1 in single turn
2. `"open the first one from chat"` with active latch resolves chat option #1 in single turn
3. `"open the second one"` (no scope cue) with active latch resolves widget item #2 (existing behavior unchanged)
4. `"from chat"` standalone suspends latch and restores full chat-active state without selection
5. Feature flag off → `resolveScopeCue` is skipped (forced to scope='none'), no behavior change
6. Existing re-anchor phrases ("back to options", "from earlier options") still work
7. `"open the first one in chat"` with no latch but recoverable options resolves chat option #1
8. `"open recent in chat"` with active latch → latch suspended, NO stale chat restore, command routes to known-noun
9. Full state restore verified: `setPendingOptions` with correct `PendingOptionState` shape (index, id, label, sublabel, type, data via `reconstructSnapshotData`), using original messageId from recoverable source
10. `"what is this in chat"` with active latch → latch suspended, question falls through
11. `"show the second one in chat"` with recoverable options → selection wins (ordinal found)
