# Widget-Scoped Clarifier Reply Context for Grounding LLM — Implementation Report

**Date**: 2026-02-27
**Feature**: Clarifier-reply mode for widget-scoped grounded clarifier follow-ups
**Scope**: `clarifierContext` in LLM request, clarifier-reply detection, deterministic label/ordinal, bounded LLM with context, loop guard
**Builds on**: widget-scope-cue (2026-02-26), unified-source-cue-signal (2026-02-27)

---

## Problem

When a user types `"can youu  you to open the sample2 from active widget"`, the system:
1. Correctly strips `"from active widget"` scope cue and scopes to the active widget (Recent)
2. Feeds `"can youu  you to open the sample2"` to the grounding LLM
3. LLM returns `need_more_info` — can't parse noisy input
4. System shows grounded clarifier with pills (sample1, sample2, sample3)
5. User repeats or rephrases with same scope cue
6. System **re-runs the entire scope-cue path** with the same noisy input
7. LLM returns `need_more_info` again → **infinite clarification loop**

### Root Cause

Three issues:
1. **Scope cue re-triggers every time**: `"from active widget"` causes `handleScopeCuePhase` to emit a new `scopeCueSignal` on every message, bypassing Tier 3.6 (which reads `widgetSelectionContext`)
2. **LLM has no clarifier context**: Receives ONLY `{ userInput, candidates }` — no previous question, no reply context, no `clarifierMode`
3. **Normalization prefix list is the wrong fix**: Expanding the prefix list to cover every typo/greeting variant is whack-a-mole (`"can youu"`, `"hi assistant."`, doubled words — infinite variants)

### The Right Fix

Give the LLM the context it needs to resolve the reply. When a previous grounded clarifier exists for the same widget, call the LLM in **clarifier-reply mode** with explicit context about the previous question and shown options.

---

## Solution

Complete clarifier-reply block inserted between the deterministic grounding match and the first-time LLM call in the widget scope path. Detects when `widgetSelectionContext` is active for the same widget, and resolves against prior pills only.

### Design Principles

1. **Prior pills only**: Candidates = exactly `widgetSelectionContext.options` — no fresh grounding, no drift
2. **Real stored text**: `previousQuestion` = `widgetSelectionContext.questionText` (stored at creation time)
3. **Policy lock**: Non-exact reply NEVER deterministic-executes. Only bounded LLM `select` can execute.
4. **Deterministic first**: Exact label match and ordinal match are checked before LLM call
5. **Complete early-return**: Block always returns — never falls through to first-time path
6. **Loop guard**: If LLM still returns `need_more_info` → re-show same pills with concise guidance

---

## Changes

### File 1: `lib/chat/chat-navigation-context.tsx`

Added optional `questionText` field to `WidgetSelectionContext`:

```typescript
export interface WidgetSelectionContext {
  // ...existing fields...
  /** The actual clarifier message content shown to the user (for reply-context) */
  questionText?: string
}
```

### File 2: `lib/chat/grounding-llm-fallback.ts`

Added optional `clarifierContext` to `GroundingLLMRequest`:

```typescript
export interface GroundingLLMRequest {
  userInput: string
  candidates: { id: string; label: string; type: string; actionHint?: string }[]
  /** Clarifier reply context — only when user is replying to a previous grounded clarifier */
  clarifierContext?: {
    messageId: string
    previousQuestion: string
  }
}
```

No changes to `callGroundingLLM` body — `JSON.stringify(request)` passes the field through automatically.

### File 3: `app/api/chat/grounding-llm/route.ts`

Updated `buildUserPrompt()` to use clarifier-reply prompt when `clarifierContext` is present:

```
The assistant previously asked: "${previousQuestion}"
The shown options were: [candidates]
The user replied: "${userInput}"
The user is answering the previous clarifier. Map their reply to exactly one of the shown option IDs.
```

### File 4: `lib/chat/routing-dispatcher.ts`

**Store `questionText`** (after grounded clarifier creation, ~line 1599):
- After `bindGroundingClarifierOptions` sets `widgetSelectionContext`, updates it with `questionText` = the clarifier content built by `buildGroundedClarifier()`

**Clarifier-reply detection block** (between deterministic match and first-time LLM call):

1. **Gate**: `widgetSelectionContext !== null && turnsSinceShown < 3 && widgetId === scopedWidgetId`
2. **Exact label match**: `groundingInput.toLowerCase().trim() === option.label.toLowerCase().trim()`
   - Unique match → deterministic execute, tierLabel: `scope_cue_widget_clarifier_reply_exact`
3. **Ordinal match**: `isSelectionOnly(groundingInput, ...)` in embedded mode
   - Match → deterministic execute, tierLabel: `scope_cue_widget_clarifier_reply_ordinal`
4. **Bounded LLM with clarifier context**: Only if LLM enabled
   - Candidates = `priorOptions` (from `widgetSelectionContext.options`)
   - `clarifierContext` = `{ messageId: priorOptionSetId, previousQuestion: priorQuestionText }`
   - LLM `select` → execute, tierLabel: `scope_cue_widget_clarifier_reply_select`
5. **Loop guard**: Re-show same pills with "Please tap an option or say the exact label"
   - tierLabel: `scope_cue_widget_clarifier_reply_need_more_info`
   - Stores `questionText` on re-shown clarifier for next turn

### File 5: `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts`

Added 5 integration tests + updated 1 stale test:

| # | Test | Input | Setup | Expected |
|---|---|---|---|---|
| 1 | LLM select in reply mode | noisy input + scope cue | `widgetSelectionContext` active, LLM → select | Auto-execute, tierLabel: `scope_cue_widget_clarifier_reply_select`, LLM received `clarifierContext` |
| 2 | LLM need_more_info → loop guard | noisy input + scope cue | `widgetSelectionContext` active, LLM → need_more_info | Re-show pills, tierLabel: `scope_cue_widget_clarifier_reply_need_more_info` |
| 3 | No prior clarifier → normal path | noisy input + scope cue | `widgetSelectionContext: null` | Normal grounding clarifier, `callGroundingLLM` NOT called |
| 4 | Different widget → no reply mode | noisy input + scope cue | `widgetSelectionContext.widgetId` differs | Normal grounding clarifier (not treated as reply) |
| 5 | Exact label match | `"sample2 from active widget"` | `widgetSelectionContext` with items NOT in current snapshot | Deterministic execute, tierLabel: `scope_cue_widget_clarifier_reply_exact`, LLM NOT called |

Updated test (line 884): Changed from expecting reverted `scope_cue_widget_llm_tiebreak` to `scope_cue_widget_llm_need_more_info`.

---

## Safety Analysis

| Concern | Mitigation | Verified |
|---------|-----------|----------|
| Deterministic path changed | NO — strict-exact still uses raw `groundingInput` in first-time path | By design |
| Non-exact reply auto-executes without LLM | NO — only exact-label and ordinal can deterministic-execute. All else goes to bounded LLM. | Test 1, 2, 5 |
| LLM selects invalid candidate | Validated against `priorOptions` by ID — same bounded set the user saw | Test 1 |
| Candidates drift from shown pills | Uses `widgetSelectionContext.options` exclusively — no fresh grounding candidates | Test 1 (asserts candidates match) |
| Clarifier question fabricated | Uses `widgetSelectionContext.questionText` (stored at creation time). Fallback reconstructs from labels only if field missing. | Test 1 (asserts previousQuestion) |
| Cross-widget leakage | `widgetSelectionContext.widgetId === scopedWidgetId` check | Test 4 |
| Stale clarifier match | `turnsSinceShown < 3` TTL guard | By design |
| Loop guard hides real errors | Re-shows exact same pills with concise "tap or say exact label" — user can click, say label, or say ordinal | Test 2 |
| First-time path regressed | `isReplyToPreviousClarifier` is false on first occurrence → entire existing path runs unchanged | Test 3 |

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
# Tests:       953 passed, 953 total
```

All 5 new clarifier-reply tests pass. All 62 dispatcher integration tests pass. All existing tests unaffected.

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/chat-navigation-context.tsx` | +2 | `questionText` field on `WidgetSelectionContext` |
| `lib/chat/grounding-llm-fallback.ts` | +6 | `clarifierContext` on `GroundingLLMRequest` |
| `app/api/chat/grounding-llm/route.ts` | +5 | Clarifier-reply prompt in `buildUserPrompt` |
| `lib/chat/routing-dispatcher.ts` | +120 (clarifier-reply block), +8 (store questionText) | Detect reply, deterministic label/ordinal, bounded LLM, loop guard, store questionText |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | +150 (5 tests), +10 (1 updated test) | 5 clarifier-reply tests + 1 stale tie-break test updated |

---

## Telemetry Keys

| Key | Tier Label | When |
|---|---|---|
| `scope_cue_widget_clarifier_reply_mode` | — (entry log) | Clarifier-reply detected |
| `scope_cue_widget_clarifier_reply_exact_label` | `scope_cue_widget_clarifier_reply_exact` | Deterministic exact label match |
| `scope_cue_widget_clarifier_reply_ordinal` | `scope_cue_widget_clarifier_reply_ordinal` | Deterministic ordinal match |
| `scope_cue_widget_clarifier_reply_llm_result` | — (diagnostic) | LLM result in reply mode |
| `scope_cue_widget_clarifier_reply_llm_select` | `scope_cue_widget_clarifier_reply_select` | LLM selected → execute |
| `scope_cue_widget_clarifier_reply_need_more_info` | `scope_cue_widget_clarifier_reply_need_more_info` | Loop guard fired |
| `scope_cue_widget_clarifier_reply_llm_error` | — (diagnostic) | LLM error in reply mode |

---

## Flow After Fix

```
User: "can youu  you to open the sample2 from active widget" (FIRST TIME)
  │
  ├─ resolveScopeCue() → scope: 'widget', stripped: "can youu  you to open the sample2"
  ├─ widgetSelectionContext: null → NOT clarifier-reply
  ├─ Deterministic: isStrictExactMatch("can youu ...", "sample2") = false ✗
  ├─ LLM: need_more_info (can't parse noisy input)
  ├─ Grounded clarifier with pills: sample1, sample2, sample3
  └─ Stores widgetSelectionContext { options, questionText }

User: "can youu  you to open the sample2 from active widget" (SECOND TIME)
  │
  ├─ resolveScopeCue() → scope: 'widget', stripped: "can youu  you to open the sample2"
  ├─ widgetSelectionContext: ACTIVE, same widget → CLARIFIER-REPLY MODE
  ├─ Exact label: "can youu  you to open the sample2" ≠ any pill label ✗
  ├─ Ordinal: not a selection ✗
  ├─ Bounded LLM with clarifierContext:
  │   ├─ previousQuestion: "Which option did you mean? sample1, sample2, sample3?"
  │   ├─ candidates: [sample1, sample2, sample3] (from prior pills)
  │   └─ LLM: select → "sample2" (confidence 0.9) ✓
  └─ Auto-execute sample2, tierLabel: 'scope_cue_widget_clarifier_reply_select'
```
