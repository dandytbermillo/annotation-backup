# Single Visible-Panel Auto-Execute — Implementation Report

**Date**: 2026-03-11
**Feature**: Tier 4.5 single visible-panel LLM abstain override
**Status**: Implemented, unit-tested, documented. Not runtime-proven (branch has not fired in durable log).

---

## Summary

Added a narrow exception to the Tier 4.5 `need_more_info` → clarifier contract: when the bounded LLM abstains but there is exactly 1 candidate from `visible_panels` and the input is a command form, auto-execute instead of showing a single-option clarifier.

This is an **LLM abstain override** — the LLM returned `need_more_info`, and the code overrides that decision based on a narrow heuristic. It is NOT a generic Tier 4.5 rule and NOT a deterministic execution path.

### Origin

"open links panel a" was expected to auto-execute but showed a single-option clarifier ("Which option did you mean? Links Panel A?") on first attempt. The initial plan proposed verb-stripped strict-exact matching at Tier 4, but this violated the repo's strict-exact rules (verb stripping forbidden for deterministic authorization). The fix was redesigned as a post-LLM heuristic in the bounded LLM path.

---

## Strict-Exact Compliance

The original plan (`/Users/dandy/.claude/plans/serene-imagining-flamingo.md`) proposed `effectiveMatchKind = 'registry_exact'` after `canonicalizeCommandInput`. This was rejected because:

1. **Forbidden**: "Verb stripping / polite-prefix stripping" for deterministic execution
2. **Violated**: "rawInput.trim().toLowerCase() === label.trim().toLowerCase()" exact means definition
3. **Violated**: "Any call to deterministic resolver must use raw input, not rewritten input"

The approved fix uses a different approach:
- Candidate found through **advisory** panel evidence matching (permitted)
- Bounded LLM was **consulted** (pipeline ran)
- Execution is a **post-LLM heuristic**, not a deterministic gate
- `matchKind: 'partial'` — NOT `registry_exact`
- Provenance: `llm_executed` — NOT `deterministic`

---

## Changes

### 1. `lib/chat/routing-dispatcher.ts:5234-5295`

New `grounding_llm_single_panel_auto_execute` branch in the `need_more_info` path.

**Gate conditions** (all three required):
- `groundingResult.llmCandidates.length === 1`
- `isExplicitCommand(ctx.trimmedInput)`
- `groundingResult.llmCandidates[0].source === 'visible_panels'`

**Execution**: Opens panel drawer, shows "Opening {label}...", returns `handled: true` with `llm_executed` provenance.

### 2. `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage4-bounded-llm-optimize-design.md`

Updated §4 (single-candidate audit) to document the narrow exception. Replaced the prior "No single-candidate shortcut exists" statement. Describes it honestly as an LLM abstain override, not normal bounded-LLM select behavior.

### 3. `__tests__/unit/chat/single-panel-auto-execute.test.ts` (new file)

3 tests:
- **Positive**: 1 visible_panels candidate + command form + LLM need_more_info → auto-execute (`grounding_llm_single_panel_auto_execute`, `llm_executed`)
- **Negative**: 1 visible_panels candidate + non-command input → clarifier (`grounding_llm_need_more_info`, `llm_influenced`)
- **Negative**: 1 widget_list candidate + command form → clarifier

---

## Validation

### Type-check
```
$ npm run type-check
# Clean — zero errors
```

### Unit tests
```
$ npx jest --testPathPattern='single-panel-auto-execute|stage5|known-noun|strict-deterministic|classify-execution'
# 6 suites, 96 tests, all passing
```

### Runtime (durable log)

The new branch has **not been runtime-proven**. Zero durable log rows with `provenance = 'grounding_llm_single_panel_auto_execute'`.

**Why**: In the test environment, the grounding LLM currently selects correctly for "open links panel a" (returns `decision: 'select'`), so the `need_more_info` path is not reached. The branch is a safety net for when the LLM abstains, which was observed historically (March 3 data: two `grounding_llm_need_more_info` rows for "open links panel a") but does not reproduce in the current environment.

**Decision**: Closed without branch-specific runtime proof. The branch has direct unit coverage, the surrounding runtime behavior is correct, and the policy is documented.

---

## Durable Log Evidence

### Historical proof the problem existed (March 3):
| Time (UTC) | Input | Provenance | Status |
|---|---|---|---|
| 2026-03-03 01:43:55 | open links panel a | `grounding_llm_need_more_info` | clarified |
| 2026-03-03 01:53:13 | open links panel a | `grounding_llm_need_more_info` | clarified |

### Latest test (March 11):
| Time (UTC) | Input | Provenance | Status |
|---|---|---|---|
| 02:07:02 | open links panel | `grounding_llm_need_more_info` | clarified |
| 02:07:05 | 1 | `clarification_intercept` | executed |
| 02:07:13 | open links panel a | `grounding_llm_select_message_fallback` | executed |

The third row shows the LLM selected correctly (aided by message history from the preceding clarifier). The new branch did not fire.

---

## Risks / Limitations

1. **Not runtime-proven**: The branch has never fired in the durable log. It may never fire if the LLM consistently selects correctly for single visible_panels candidates.
2. **LLM abstain override**: The code overrides the LLM's `need_more_info` decision. If the LLM abstained for a valid reason (candidate not actually matching the input), the override would incorrectly auto-execute.
3. **Narrow scope**: Only covers `visible_panels` + command form. Other single-candidate `need_more_info` cases still show clarifiers.

---

## Files Modified

| File | Change |
|---|---|
| `lib/chat/routing-dispatcher.ts` | New `grounding_llm_single_panel_auto_execute` branch (lines 5234-5295) |
| `stage4-bounded-llm-optimize-design.md` | §4 exception documented |
| `__tests__/unit/chat/single-panel-auto-execute.test.ts` | New file — 3 tests |
