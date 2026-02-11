# Phase C: LLM Auto-Execute for High-Confidence Results — Implementation Report

**Date:** 2026-02-11
**Feature slug:** `chat-navigation`
**Governing plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/deterministic-llm-ladder-enforcement-addendum-plan.md` (Phase C addendum)

---

## Summary

When the LLM correctly identifies the right option (e.g., "Links Panel D" for "can you ope panel d please now?") but the system always shows a safe clarifier, the user has to tap a pill every time. This was the clarify-only policy (Rule C).

Phase C adds a strictly gated auto-execute path: when the LLM returns a single clear winner with high confidence from the bounded active-option set, auto-execute it — but only through 3 mandatory gates plus loop guard safety.

Also included in this changeset: removal of `COMMAND_VERB_TYPOS` hardcoded dictionary (plan violation) and a question-intent false positive fix for trailing `?`.

---

## Changes

### 1. `lib/chat/clarification-llm-fallback.ts` (+15 lines)

New Phase C constants and kill switch:

| Export | Value | Purpose |
|--------|-------|---------|
| `AUTO_EXECUTE_CONFIDENCE` | `0.85` | Confidence threshold for auto-execute |
| `AUTO_EXECUTE_ALLOWED_REASONS` | `ReadonlySet<AmbiguityReason>` containing `'no_deterministic_match'` | Typed allowlist — prevents drift |
| `isLLMAutoExecuteEnabledClient()` | Reads `NEXT_PUBLIC_LLM_AUTO_EXECUTE_ENABLED` | Kill switch, default OFF |

### 2. `lib/chat/chat-routing.ts` (+140/−57 lines)

#### Phase C: `tryLLMLastChance` changes (lines 1152–1279)

- **Return type** extended: `autoExecute: boolean`
- **3-gate check** on LLM success path (line 1229–1232):
  - Gate 1: `isLLMAutoExecuteEnabledClient()` (kill switch)
  - Gate 2: `llmConfidence >= AUTO_EXECUTE_CONFIDENCE` (0.85)
  - Gate 3: `AUTO_EXECUTE_ALLOWED_REASONS.has(confidence.ambiguityReason)` (typed allowlist)
- **All 7 return paths** have explicit `autoExecute` value:

| Line | Path | `autoExecute` |
|------|------|---------------|
| 1168 | Question intent | `false` |
| 1181 | Classifier not eligible | `false` |
| 1186 | Feature disabled | `false` |
| 1199 | Loop guard continuity | `false` |
| 1201 | Loop guard plain | `false` |
| 1250 | LLM success (3-gate) | computed |
| 1279 | LLM fail/abstain | `false` |

#### Phase C: Tier 1b.3 unresolved hook auto-execute (lines 4044–4078)

New branch before the `else` safe clarifier:
```
if (llmResult.autoExecute && llmResult.suggestedId) {
  → find option → full state cleanup → handleSelectOption
  → return { handled: true, clarificationCleared: true }
}
```

State cleanup follows badge-aware selection pattern:
- `saveClarificationSnapshot(lastClarification)`
- `setRepairMemory(selectedOption.id, lastClarification.options)`
- `setLastClarification(null)`
- `setPendingOptions([]); setPendingOptionsMessageId(null); setPendingOptionsGraceCount(0)`

#### Phase C: Scope-cue unresolved hook auto-execute (lines 2741–2781)

Full parity with Tier 1b.3 auto-execute branch. Additionally:
- Synthesizes clarification snapshot if `lastClarification` is null (scope-cue can recover from snapshot/lastOptionsShown)
- Calls `setActiveOptionSetId(null)` (scope-cue path manages this)

#### Phase A/B: `COMMAND_VERB_TYPOS` removal (lines 3703–3763)

- Deleted `COMMAND_VERB_TYPOS` dictionary (was: `opn→open, ope→open, shw→show`, etc.)
- Removed typo correction branch from `normalizeCommandVerbs`
- Removed typo stripping branch from `stripCommandVerb`
- Renamed "Command Typo Escape" comment to "Command Verb Escape"
- Rationale: plan contract says "Must not add hardcoded typo dictionaries for ladder eligibility; unresolved inputs should ladder to bounded LLM"

#### Question intent false positive fix (lines 1161–1166)

- `hasQuestionIntent` has `endsWith('?')` catch-all — "ope panel d pls?" was classified as question
- Fix: strip trailing `?!.` before question check in `tryLLMLastChance`
- Genuine questions caught by `QUESTION_INTENT_PATTERN` (starts with what/how/where/is/etc.)

### 3. `deterministic-llm-ladder-enforcement-addendum-plan.md` (+58 lines)

Added Phase C policy section documenting:
- Rule C revision: LLM may auto-execute when all gates pass
- Auto-execute allowlist (typed `Set<AmbiguityReason>`)
- Blocklist (loop guard, LLM fail, question intent)
- Kill switch semantics and rollback
- Safety summary table

### 4. `__tests__/unit/chat/selection-vs-command-arbitration.test.ts` (+143/−14 lines)

New/updated tests:

| Test | Expects |
|------|---------|
| `"can you ope panel d pls" + auto-execute ON + confidence 0.85` | `handleSelectOption` called with Links Panel D, `addMessage` NOT called |
| `"can you ope panel d pls" + auto-execute OFF + confidence 0.85` | Safe clarifier with reorder (kill switch blocks) |
| `"can you ope panel d pls" + auto-execute ON + confidence 0.7` | Safe clarifier (below threshold) |
| Loop guard blocks auto-execute on repeat | Turn 1 auto-executes → Turn 2 same input → safe clarifier, `handleSelectOption` NOT called |

Existing tests unchanged: LLM disabled, LLM timeout, question intent, open recent escape.

Mock setup updated: added `isLLMAutoExecuteEnabledClient`, `AUTO_EXECUTE_CONFIDENCE`, `AUTO_EXECUTE_ALLOWED_REASONS`.

### 5. `__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts` (+75/−14 lines)

New/updated tests:

| Test | Expects |
|------|---------|
| `"opn links panel" + confidence 0.85 + auto-execute ON` | Auto-executes Links Panels at Tier 0 |
| `"opn links panel" + confidence 0.7 + auto-execute ON` | Safe clarifier with reorder (below threshold) |

`beforeEach` blocks updated to reset `isLLMAutoExecuteEnabledClient` to `false` (prevents test pollution from mock state leaking across tests).

---

## Migrations/Scripts/CI

None. No database changes. Feature gated by client-side env var.

---

## Commands

```bash
# Type check
npx tsc --noEmit

# Unit tests
npx jest __tests__/unit/chat/selection-vs-command-arbitration.test.ts --no-coverage --runInBand

# Integration tests
npx jest __tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts --no-coverage --runInBand

# Enable auto-execute (add to .env.local)
NEXT_PUBLIC_LLM_AUTO_EXECUTE_ENABLED=true
NEXT_PUBLIC_CLARIFICATION_LLM_FALLBACK=true
```

---

## Test Results

```
Type-check:
$ npx tsc --noEmit
__tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005: ')' expected.
(Pre-existing, unrelated — documented in MEMORY.md)

Unit + Integration:
$ npx jest [...] --no-coverage --runInBand
PASS __tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts
PASS __tests__/unit/chat/selection-vs-command-arbitration.test.ts
Test Suites: 2 passed, 2 total
Tests:       79 passed, 79 total
```

---

## Safety Summary

| Gate | Check | Fail behavior |
|------|-------|---------------|
| Kill switch | `NEXT_PUBLIC_LLM_AUTO_EXECUTE_ENABLED === 'true'` | Safe clarifier |
| Confidence | `>= 0.85` | Safe clarifier with reorder |
| Reason allowlist | `no_deterministic_match` only | Safe clarifier with reorder |
| Loop guard | Not repeat input in same cycle | Safe clarifier with stored ordering |
| LLM fail/timeout/429 | Not success | Safe clarifier, original order |
| Question intent | Excluded before LLM call | Falls through to downstream |
| `suggestedId` not found | Option lookup fails | Falls through to safe clarifier |

**Rollback:** Set `NEXT_PUBLIC_LLM_AUTO_EXECUTE_ENABLED=false` (or remove). All auto-execute stops instantly, falls back to safe clarifier.

---

## Errors Encountered

### 1. `COMMAND_VERB_TYPOS` Removal — Badge Path Still Works

No error. Verified: "ope panel d" still resolves via `extractBadge` (badge "d" → match "Links Panel D"). Only `COMMAND_VERB_TYPOS` dictionary removed; `COMMAND_VERBS` set (`open`, `show`, `go`, `view`, `close`) and `extractBadge` logic unchanged.

### 2. Question Intent False Positive

**Error:** "ope the panel d pls?" hit `clarification_unresolved_hook_question_escape` → Tier 1b.4 "Please choose" instead of LLM.

**Root cause:** `hasQuestionIntent` in `query-patterns.ts:354` returns `true` for `endsWith('?')`. `isPoliteImperativeRequest` only catches "can you..."/"could you..." prefixes — "ope..." not matched.

**Fix:** In `tryLLMLastChance` line 1165: `trimmedInput.replace(/[?!.]+$/, '').trim()` before question check. Genuine questions caught by `QUESTION_INTENT_PATTERN` (starts with what/how/where/is/etc.), not trailing `?` alone.

### 3. Integration Test ID Mismatch

**Error:** `"opn links panel"` auto-execute test failed — `matchKnownNoun is not a function`.

**Root cause:** LLM mock returned `choiceId: 'opt-links-panels'` but actual option id was `'opt-0'`. Auto-execute `find()` returned `undefined` → fell through to safe clarifier → continued downstream where `matchKnownNoun` mock was incomplete.

**Fix:** Changed mock `choiceId` to `'opt-0'` (matching actual option id in test setup).

### 4. Test Pollution — Mock State Leaking

**Error:** BLOCKER test expected safe clarifier but got auto-execute.

**Root cause:** Previous test set `isLLMAutoExecuteEnabledClient.mockReturnValue(true)`. `jest.clearAllMocks()` clears call counts but not mock implementations.

**Fix:** Added `(isLLMAutoExecuteEnabledClient as jest.Mock).mockReturnValue(false)` to `beforeEach` blocks.

---

## Risks/Limitations

1. **Scope-cue auto-execute path is untested in integration** — only Tier 1b.3 has integration-level coverage. Scope-cue parity verified at unit level only.
2. **`command_selection_collision` auto-execute** — blocked by design (not in allowlist). If future expansion is needed, add to `AUTO_EXECUTE_ALLOWED_REASONS` and add corresponding tests.
3. **Operator precedence on line 1232** — `confidence.ambiguityReason ?? '' as never`: the `as never` applies to `''` only, not the whole expression. Safe: when `ambiguityReason` is undefined, `Set.has('')` returns false (blocks auto-execute). In practice, `ambiguityReason` is always set by the classifier before this code runs.

---

## Next Steps

1. Manual verification with live LLM (`NEXT_PUBLIC_LLM_AUTO_EXECUTE_ENABLED=true`):
   - `open links panel` → disambiguation → `can you ope panel d pls` → auto-opens Links Panel D
   - Same flow with kill switch OFF → safe clarifier with reorder
2. Monitor debug logs for `clarification_unresolved_hook_llm_auto_execute` and `scope_cue_unresolved_hook_llm_auto_execute` actions
3. Consider expanding allowlist to include `typo_ambiguous` after bake-in period
4. Schedule removal of kill switch once stable (per CLAUDE.md feature flag convention)
