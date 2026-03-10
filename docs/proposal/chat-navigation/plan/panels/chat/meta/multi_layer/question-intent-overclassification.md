# Question-Intent Overclassification — Investigation Note

**Date**: 2026-03-09
**Status**: Open — not yet investigated in depth
**Related**: `stage4-bounded-llm-optimize-design.md` (cross-referenced from baseline exclusions)

---

## Problem

Certain action-oriented queries are classified as question-intent by the upstream classifier, which diverts them away from the grounding pipeline (Tier 4.5). These queries never reach the bounded LLM selector and therefore produce no Stage 4 telemetry.

## Affected Examples (observed 2026-03-09)

| Query | Expected behavior | Actual behavior |
|-------|-------------------|-----------------|
| "which budget" | Grounding LLM clarifier (budget100 vs budget200) | Lane E / semantic answer lane |
| "can I see the budget200 entry" | Grounding LLM select (budget200) | Lane E / semantic answer lane |
| "where is budget200" | Grounding LLM select (budget200) | Lane E / semantic answer lane |

All three:
- Logged `routing_attempt` as `clarifier/E/failed/unhandled`
- Then `execution_outcome` as `llm/D/executed` (general assistant resolved)
- No `llm_*` telemetry persisted on either row

## Mechanism (partially traced, not fully verified)

1. `hasQuestionIntent()` in `query-patterns.ts` uses broad prefix regex matching
2. Patterns like `which ...`, `can ...`, `where ...` trigger question-intent classification
3. At Tier 2c, `skip_panel_disambiguation_question_intent` bypasses panel disambiguation
4. The query enters the semantic answer lane (Lane E)
5. `semantic_lane_skip_grounding` explicitly skips the grounding LLM
6. Query falls through unhandled, then the general conversation LLM resolves it downstream

**Caveat**: The exact chain from question-intent classification to Lane E entry has not been fully traced end-to-end in the code. The above is inferred from debug log action names. A dedicated code trace is needed to confirm the full routing path.

## Why This Matters

1. **Stage 4 baseline bias**: Queries that would exercise the grounding LLM are diverted before reaching it, making Stage 4 telemetry samples incomplete
2. **Unnecessary clarifier avoidance**: "can I see the budget200 entry" names a specific target — it should resolve directly, not go through the semantic answer lane
3. **User experience**: Action requests phrased as questions ("where is X", "can I see X") are common natural-language patterns that should be handled by the navigation pipeline

## Likely Fix Direction

- Tighten question-intent classification to distinguish:
  - True questions about content ("what is in budget100?", "how many items are there?")
  - Action requests phrased as questions ("can I see budget200?", "where is budget100?")
- Possible approach: check if the query contains a known entity name (widget item, panel) before classifying as question-intent
- Alternative: allow question-intent queries to still enter grounding if they contain grounding candidates

## Scope

- This is **not** a Stage 4 bounded-selector issue
- This is an upstream routing/classification issue at Tier 2c
- It affects whether queries reach Stage 4, not how Stage 4 handles them
- Should be tracked separately from Stage 4 hardening work
