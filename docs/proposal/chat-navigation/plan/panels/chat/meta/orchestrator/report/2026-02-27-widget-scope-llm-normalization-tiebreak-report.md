# Widget-Scoped LLM Input Normalization + Post-LLM Canonical Tie-Break — Implementation Report

**Date**: 2026-02-27
**Feature**: Verbose wrapper normalization for widget-scoped LLM input + canonical tie-break on `need_more_info`
**Scope**: Local `normalizeLLMInput`, LLM input normalization, post-LLM canonical tie-break, grounded clarifier for all fallthrough paths
**Builds on**: widget-scope-cue (2026-02-26), unified-source-cue-signal (2026-02-27)

---

## Problem

When a user types `"i want you to open the sample2 from active"`, the system:
1. Correctly strips `"from active"` scope cue and scopes to the active widget (Recent)
2. Feeds `"i want you to open the sample2"` to the grounding LLM
3. LLM returns `need_more_info` (confidence 0.5) — it can't distinguish if "sample2" means the exact candidate or shorthand for "sample2 F"
4. System falls through to clarifier showing `sample1`, `sample2`, `sample3` — even though `sample2` is literally one of the candidates

Meanwhile, `"open sample2 from active"` (no verbose wrapper) auto-executes correctly.

### Root Cause

Two issues:
1. **LLM receives noisy input**: The verb-laden `"i want you to open the sample2"` confuses the LLM, while `"sample2"` would be unambiguous
2. **No post-LLM recovery**: When the LLM returns `need_more_info` despite a unique canonical match in the candidate pool, there's no safety net
3. **Generic clarifier**: Before this fix, the fallthrough showed `"I couldn't find 'X' in Recent"` — a generic message without disambiguation options

---

## Solution

Two-part fix:

### Fix 1: Grounded Clarifier for All Fallthrough Paths

Replaced the generic `"I couldn't find"` safe clarifier with a grounded clarifier using `buildGroundedClarifier()` + `bindGroundingClarifierOptions()`. This shows disambiguation option pills for all fallthrough reasons: LLM `need_more_info`, LLM disabled, LLM error, LLM abstain.

### Fix 2: LLM Input Normalization + Post-LLM Canonical Tie-Break

1. **Local `normalizeLLMInput`**: Strips verb/polite wrappers (`"i want you to open the"` → `"sample2"`) for LLM input ONLY. Does NOT affect deterministic path (raw `groundingInput` still used for strict-exact).
2. **Post-LLM canonical tie-break**: When LLM **successfully** returns `need_more_info`, checks if normalized input uniquely matches exactly one `widget_option` candidate label. If so, auto-executes.

### Design Principles

1. **Strict-exact policy UNCHANGED**: Deterministic path still uses raw `groundingInput`
2. **No pre-LLM auto-execute**: Normalization helps the LLM, doesn't enable deterministic execution
3. **Tie-break gated to `need_more_info` only**: Never on `llm_disabled`, `llm_error`, or `llm_abstain`
4. **`widget_option` type filter**: Prevents accidental future regressions with other candidate types
5. **Local function**: No modification to global `canonicalizeCommandInput` (10+ callers, high blast radius)
6. **No duplicate side effects**: `executeScopedCandidate` already handles latch + continuity

---

## Changes

### File 1: `lib/chat/routing-dispatcher.ts`

**Local `normalizeLLMInput` function** (lines 1518-1543):
- Strips trailing punctuation
- Strips verb/polite prefixes (longest-first matching): `"i want you to open"`, `"can you please show"`, `"please open"`, `"open"`, etc.
- Strips articles (`the`, `a`, `an`)
- Normalizes whitespace

**LLM input normalization** (line 1565-1566):
```typescript
const llmNormalizedInput = normalizeLLMInput(groundingInput)
const llmResult = await callGroundingLLM({
  userInput: llmNormalizedInput || groundingInput,  // fallback to raw if empty
  ...
})
```

**Post-LLM canonical tie-break** (lines 1613-1648):
- Gate: `widgetScopeLlmFallbackReason === 'need_more_info'` ONLY
- Gate: `c.type === 'widget_option'` ONLY
- Normalized comparison: `canonical.toLowerCase().trim() === c.label.toLowerCase().trim()`
- Requires `exactMatches.length === 1` — unique match only
- Provenance: `tierLabel: 'scope_cue_widget_llm_tiebreak'`, `_devProvenanceHint: 'llm_influenced'`

**Grounded clarifier for all fallthrough** (lines 1655-1698):
- When candidates exist: `buildGroundedClarifier()` + `bindGroundingClarifierOptions()`
- Shows "Which option did you mean?" with clickable pills
- `tierLabel`: `scope_cue_widget_llm_need_more_info` (LLM ran) or `scope_cue_widget_grounding_clarifier` (LLM disabled/error/abstain)

### File 2: `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts`

Added 4 integration tests + updated 2 existing assertions:

| # | Test | Input | LLM Mock | Expected |
|---|---|---|---|---|
| 1 | Tie-break fires | `"i want you to open the sample2 from active"` | `need_more_info` | Auto-execute `sample2`, tierLabel: `scope_cue_widget_llm_tiebreak` |
| 2 | Ambiguous — no tie-break | `"i want you to open the sample from active"` | `need_more_info` | Grounded clarifier, tierLabel: `scope_cue_widget_llm_need_more_info` |
| 3 | LLM error — no tie-break | `"i want you to open the sample2 from active"` | throws Error | Grounded clarifier, tierLabel: `scope_cue_widget_grounding_clarifier` |
| 4 | LLM select — no override | `"open sample2 from active"` | `select` (id: recent_2) | Direct execute, tierLabel NOT `scope_cue_widget_llm_tiebreak` |

Existing test (line 850): `"i want you to open the sample2 from active" shows grounded clarifier` — serves as LLM-disabled regression (tie-break gate rejects `llm_disabled`).

---

## Safety Analysis

| Concern | Mitigation | Verified |
|---------|-----------|----------|
| Deterministic path changed | NO — deterministic grounding still uses raw `groundingInput` | By design |
| Strict-exact policy violated | NO — tie-break ONLY fires after successful LLM `need_more_info` | Test 1 + Test existing (LLM disabled) |
| Global `canonicalizeCommandInput` modified | NO — local `normalizeLLMInput` function, zero blast radius | By design |
| Tie-break false positive on ambiguous | Requires `exactMatches.length === 1` — 0 or 2+ → clarifier | Test 2 |
| Tie-break on LLM error | Gate: `need_more_info` only — `llm_error` rejected | Test 3 |
| Tie-break overrides LLM select | LLM select returns early before tie-break code runs | Test 4 |
| Tie-break on LLM disabled | Gate: `need_more_info` only — `llm_disabled` rejected | Existing test (line 850) |
| Non-widget-option auto-exec | Filtered to `c.type === 'widget_option'` | By design |
| Duplicate latch/continuity | None — `executeScopedCandidate` handles both | By design |
| Empty normalization | `llmNormalizedInput \|\| groundingInput` fallback | By design |

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
# Tests:       948 passed, 948 total
```

All 4 new tie-break integration tests pass. All 57 dispatcher integration tests pass. All existing tests unaffected.

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/routing-dispatcher.ts` | +25 (normalization), +35 (tie-break), +40 (grounded clarifier) | Local normalization, LLM input normalization, post-LLM tie-break, grounded clarifier |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | +120 (4 tests), +10 (2 assertion updates) | 4 tie-break tests + 2 updated existing assertions |

---

## Flow After Fix

```
User: "i want you to open the sample2 from active"
  │
  ├─ resolveScopeCue() → scope: 'widget', stripped: "i want you to open the sample2"
  │
  ├─ handleScopeCuePhase() → scopeCueSignal { scope: 'widget' }
  │
  ├─ Dispatcher resolves widget scope:
  │   ├─ Deterministic: isStrictExactMatch("i want you to open the sample2", "sample2") = false ✗
  │   ├─ normalizeLLMInput("i want you to open the sample2") → "sample2"
  │   ├─ LLM: callGroundingLLM({ userInput: "sample2", ... })
  │   │   └─ LLM returns need_more_info (confidence 0.5)
  │   ├─ Post-LLM tie-break:
  │   │   ├─ Gate: need_more_info ✓
  │   │   ├─ canonical: "sample2"
  │   │   ├─ exactMatches: [{ label: "sample2", id: "recent_2", type: "widget_option" }]
  │   │   ├─ length === 1 ✓
  │   │   └─ executeScopedCandidate → auto-execute ✓
  │   └─ Return: tierLabel='scope_cue_widget_llm_tiebreak', provenance='llm_influenced'
```
