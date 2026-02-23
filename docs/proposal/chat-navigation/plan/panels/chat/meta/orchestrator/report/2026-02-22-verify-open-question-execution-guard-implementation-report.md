# Layer 1 Fix: Verify-Open Question Execution Guard

**Date**: 2026-02-22
**Slug**: chat-navigation / verify-open-question-execution-guard
**Status**: Implemented and verified (manual + automated)

---

## Summary

**Bug**: "did i open the links panel d?" EXECUTES (opens Links Panel D) instead of answering the verify question.

**Root cause** (three failure paths):
1. **Path A**: LLM misclassifies verify question as `show_quick_links` / `panel_intent` → resolver returns `open_panel_drawer` → panel opens
2. **Path B**: "did i open the panel d?" → grounding LLM enters (Tier 4.5) → `need_more_info` → widget disambiguation → never reaches intent API
3. **Path C**: LLM returns `verify_request` (instead of `verify_action`) → action is `inform` → guard for panel-navigation actions doesn't fire

**Fix**: Four-layer defense:
1. Shared `isVerifyOpenQuestion()` detector in `input-classifiers.ts`
2. Server-side post-LLM guard in `route.ts` (catches paths A + C)
3. Prompt hardening in `intent-prompt.ts` (reduces LLM misclassification)
4. Tier 4.5 grounding bypass in `routing-dispatcher.ts` (fixes path B)

---

## Changes

### 1. Shared Verify-Open Detector

**File**: `lib/chat/input-classifiers.ts` (lines 628-650)

Single source of truth — used by both server guard and grounding bypass.

```typescript
const VERIFY_OPEN_CORE = /(did|have)\s+(i|we|you)\s+open(?:ed)?\b/i
const REQUEST_PHRASE_GUARD = /(did|have)\s+(i|we|you)\s+(ask|tell|request)\s+(you\s+)?to\b/i

export function isVerifyOpenQuestion(input: string): boolean {
  const trimmed = input.trim()
  if (!VERIFY_OPEN_CORE.test(trimmed)) return false
  if (REQUEST_PHRASE_GUARD.test(trimmed)) return false
  return true
}
```

Design decisions:
- **Non-anchored**: Allows conversational prefixes ("hey assistant did i open...")
- **`open(?:ed)?`**: Matches both "did I open..." and "have I opened..."
- **Phrase-based negative guard**: `(did|have)\s+(i|we|you)\s+(ask|tell|request)\s+(you\s+)?to` — more precise than broad `\b(ask|tell|request)\b`, won't block unrelated wording

### 2. Server-Side Post-LLM Guard

**File**: `app/api/chat/navigate/route.ts` (lines 975-1018)

**Import**: `isVerifyOpenQuestion` from `@/lib/chat/input-classifiers` (line 18)

Catches two misclassification types:
- `isMisclassifiedAsNavigation`: verify-open input + panel-navigation action (`open_panel_drawer`, `open_panel_preview`, `show_quick_links`)
- `isMisclassifiedAsRequest`: verify-open input + `verify_request` intent (LLM confused "did I open X?" with "did I ask you to open X?")

When triggered:
1. Extracts panel name from misclassified resolution (tries `panelTitle`, `quickLinksPanelTitle`, badge, `panelId`, `verifyRequestTargetName`)
2. Creates NEW `remappedIntent` (no mutation of original)
3. Re-resolves through `resolveIntent` with `verify_action` + `open_panel` type

### 3. Prompt Hardening

**File**: `lib/chat/intent-prompt.ts`

Three changes:
- **Line 102**: Added verify_action examples with panel names: `"did I open the links panel d?"`, `"did I open the recent widget?"`, `"have I opened links panel this session?"`
- **Line 320-321**: Fixed contradiction — split from generic `"did I open X?" → session_stats` to: workspaces/entries → `session_stats`, panels → `verify_action` with `open_panel`
- **Lines 326-330**: Added CRITICAL disambiguation block explaining `"did I open [panel]?"` (verify_action) vs `"open [panel]"` (command)

### 4. Tier 4.5 Grounding Bypass

**File**: `lib/chat/routing-dispatcher.ts` (lines 2969-2995)

**Import**: `isVerifyOpenQuestion` added to existing input-classifiers import (line 306)

Inserted between existing `isCommandPanelIntent` gate and grounding LLM call:

```typescript
const isVerifyBypass = isVerifyOpenQuestion(ctx.trimmedInput)

if (isCommandPanelIntent) {
  // existing command gate (unchanged)
} else if (isVerifyBypass) {
  // NEW: skip grounding LLM for verify questions
  void debugLog({ action: 'grounding_llm_skipped_verify_question', ... })
} else if (isGroundingLLMEnabled()) {
  // existing grounding LLM (unchanged)
}
```

Note: For inputs where `isCommandPanelIntent` is true (e.g., "did i open the recent widget?" — `isExplicitCommand` matches "open" and `matchVisiblePanelCommand` matches "recent widget"), the command gate fires first. This is correct — both gates skip the grounding LLM and the input reaches the intent API.

---

## Tests

### Unit Tests

**File**: `__tests__/unit/chat/verify-open-question.test.ts` (21 tests)

| Category | Count | Examples |
|----------|-------|---------|
| Positive: verify-open patterns | 9 | "did i open the links panel d?", "have i opened links panel this session?", "hey assistant did i open the Recent?" |
| Negative: request phrase guard | 4 | "did i ask you to open links panel d?", "did i request to open links panel?" |
| Negative: non-verify patterns | 4 | "open links panel d", "can you open links panel d?", "please open recent" |
| Edge cases | 3 | empty string, "did i" (no "open"), "did i close the panel?" |
| Special: "what did i open today?" | 1 | Returns true (contains "did i open" — acceptable since session_stats not intercepted by panel guard) |

### Integration Tests

**File**: `__tests__/integration/chat/verify-question-no-execution.integration.test.ts` (17 tests)

Uses simulated resolution pattern — injects what the resolver would return in production (DB-dependent resolver can't run in test environment), then runs real `resolveIntent` only for the remap step.

| Category | Count |
|----------|-------|
| Critical no-execution guarantee | 2 |
| verify_request remap | 2 |
| Scope boundaries (commands/polite/request/workspace) | 4 |
| Panel name extraction (panelTitle, badge, panelId) | 3 |
| Conversational prefix | 1 |
| Parametric no-execution (4 verify question forms) | 4 |
| Edge: workspace verify → no intercept | 1 |

### Test Results

```
$ npx jest --no-coverage __tests__/unit/chat/verify-open-question.test.ts __tests__/integration/chat/verify-question-no-execution.integration.test.ts

PASS __tests__/unit/chat/verify-open-question.test.ts
PASS __tests__/integration/chat/verify-question-no-execution.integration.test.ts

Test Suites: 2 passed, 2 total
Tests:       38 passed, 38 total
Time:        0.274 s
```

---

## Manual Verification Results

Tested in running application (2026-02-22). All results correct:

| Input | Expected | Actual | Status |
|-------|----------|--------|--------|
| "hey assistant did i open the panel d?" | Verify answer | "Yes, you opened 'Links Panel D' this session." | PASS |
| "hey assistant did i open the links panel d?" | Verify answer | "Yes, you opened 'Links Panel D' this session." | PASS |
| "hey assistant did i open the recent widget?" | Verify answer | "Yes, you opened 'Recent' this session." | PASS |
| "hey assistant can you open that panel d from chat pls thank you???" | Execute | "Opening Links Panel D..." | PASS |
| "hey assistant can you open that panel e from chat pls thank you???" | Execute | "Opening Links Panel E..." | PASS |
| "hey assistant did i open the panel e???" | Verify answer | "Yes, you opened 'Links Panel E' this session." | PASS |

---

## Debug Log Analysis

Queried `debug_logs` table after manual testing:

| Log Action | Count | Meaning |
|------------|-------|---------|
| `grounding_llm_skipped_verify_question` | 4 | Grounding bypass fired for ambiguous panel names ("panel d?") |
| `verify_question_execution_guard` | 0 | Server-side guard not needed — LLM classified correctly after bypass + hardening |
| `grounding_llm_skipped_command_panel_intent` | (some) | Command gate fires first for well-known panels ("recent widget") — still correct |

Key observation: The combination of grounding bypass + prompt hardening was sufficient for all test cases. The server-side guard had zero firings, meaning it serves as a safety net for future edge cases where the LLM might misclassify.

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/input-classifiers.ts` | 628-650 | Added `isVerifyOpenQuestion()` shared detector |
| `app/api/chat/navigate/route.ts` | 18, 975-1018 | Import + server-side verify-question guard |
| `lib/chat/intent-prompt.ts` | 102, 320-321, 326-330 | Prompt hardening (examples + contradiction fix + disambiguation) |
| `lib/chat/routing-dispatcher.ts` | 306, 2969-2995 | Import + Tier 4.5 grounding bypass |
| `__tests__/unit/chat/verify-open-question.test.ts` | NEW | 21 unit tests for `isVerifyOpenQuestion` |
| `__tests__/integration/chat/verify-question-no-execution.integration.test.ts` | NEW | 17 integration tests for execution guard |

## Files NOT Modified

| File | Reason |
|------|--------|
| `lib/chat/query-patterns.ts` | Not widening `QUESTION_INTENT_PATTERN` globally — risk of unrelated routing changes |
| `components/chat/chat-navigation-panel.tsx` | No client-side guard needed — server remap + re-resolve is the correct fix point |

---

## Risks / Limitations

1. **`isCommandPanelIntent` gate priority**: For some verify-open inputs (e.g., "did i open the recent widget?"), the command gate fires before the verify bypass. Functionally correct (both skip grounding LLM), but verify-specific debug logs won't fire for these inputs.
2. **Pattern scope**: `isVerifyOpenQuestion` only covers "open" verb. Future verify patterns ("did I close...?", "did I create...?") would need separate detectors.
3. **Conversational prefix tolerance**: Non-anchored pattern means edge cases like "I wonder what did I open..." would match. Acceptable since the server guard only fires for panel-navigation actions.

---

## Plan Reference

Plan file: `/Users/dandy/.claude/plans/spicy-wobbling-backus.md` (Revised v2)
