# Stage 6 Slice 6.7 Prompt Slice 1: Prompt Hardening — Implementation Report

**Date**: 2026-03-12
**Status**: CLOSED (environment limitation — see §Runtime below)
**Scope**: Prompt wording only. No threshold changes, no loop-logic changes, no new tools.
**Predecessors**: Slice 6.5 Phase 1 (enforcement mode, closed)

---

## Summary

Targeted prompt changes to the Stage 6 system prompt (`stage6-loop/route.ts:89`) addressing three failure patterns observed in enforcement runtime traces:

1. Model didn't know `panelSlug` should be a `widgetId` from `inspect_dashboard`
2. Model fabricated IDs instead of copying from tool results (prior shadow traces)
3. Act/clarify/abort decision boundaries were soft ("prefer acting" vs concrete rules)

---

## Changes

**Single file modified**: `app/api/chat/stage6-loop/route.ts` — `buildSystemPrompt()` function

### Before (6 rules)

```
RULES:
1. Respond with ONLY valid JSON. No markdown, no explanation.
2. Prefer acting over clarifying when you have enough info.
3. Only clarify when multiple targets match with no distinguishing signal.
4. You may call at most ${maxRounds} inspection tools before deciding.
5. Target IDs must come from inspection results or the grounding candidates.
6. If exactly one target matches, execute the action immediately.
```

### After (8 rules)

```
RULES:
1. Respond with ONLY valid JSON. No markdown, no explanation.
2. Start with the most relevant inspect tool. Use inspect_dashboard first when the
   request refers to a panel or dashboard element. Use inspect_recent_items or
   inspect_search first when the request refers to a previously accessed item or content.
3. For open_panel: the panelSlug MUST be a widgetId value copied exactly from
   inspect_dashboard results. Panels are the widgets shown on the dashboard.
4. ALL target IDs (panelSlug, widgetId, itemId, entryId) MUST be copied
   character-for-character from tool results. NEVER fabricate, guess, or modify IDs.
5. ACT when exactly one target matches the user's intent — do not clarify single matches.
6. CLARIFY only when 2+ targets match with no distinguishing signal.
7. ABORT only when no target matches at all after inspecting available state.
8. You may call at most ${maxRounds} inspection tools before deciding.
```

### Additional prompt changes

- Each inspect tool now has a one-line description of what it returns
- `open_panel` action template shows `<widgetId from inspect_dashboard>` instead of `"..."`
- `open_panel` listed first in terminal actions (most common action type)

---

## Trace analysis (3 enforcement rows that motivated the changes)

| # | Query | Dashboard | S6 tool trace | S6 outcome | Correct? |
|---|-------|-----------|---------------|------------|----------|
| 1 | "open the budget report I was looking at" | Links A, B, C, Recent | inspect_recent → inspect_search → abort | abort ("Could not find") | Yes — no budget panel exists |
| 2 | "open the budget report I was looking at" | Links A, B, C, Recent | inspect_recent → clarify (2) | clarification_accepted | Questionable — should have aborted |
| 3 | "show me the panel with links" | Links A, B, C, Recent | inspect_dashboard → clarify (3) | clarification_accepted | Yes — 3 links panels, genuinely ambiguous |

Trace #2 is the only questionable outcome: the model offered clarification for a query that has no matching panel. The new Rule 7 ("ABORT only when no target matches") should bias toward abort in this case with future enforcement runs.

---

## Runtime validation

### Post-prompt-change test (2026-03-12 01:19 UTC)

Query: "show me the panel with links"
Dashboard: Links Panel A, B, C, Recent
S6 trace: `inspect_dashboard` → `clarify` (3 candidates)
Outcome: `clarification_accepted` → fell through to normal clarifier

**Expected**: Correct. 3 Links Panels open = genuinely ambiguous. Prompt changes do not alter this — they should not make the model guess when 3 panels match.

### Environment limitation

The current dashboard always has all panels open (Links A, B, C, Recent). This means:
- Any "links" query → 3 matches → clarify (correct)
- Any "budget" query → 0 matches → abort (correct)
- Any single-panel query specific enough to match 1 → handled by earlier tiers before reaching S6

**Single-match `open_panel` act path is not runtime-observable** in this dashboard shape. The prompt changes are analytically correct for that case but cannot be runtime-proven until a dashboard with distinct panel types is available.

---

## Verification

```
$ npm run type-check
(clean — no errors)

$ npx jest __tests__/unit/chat/stage6 --no-coverage
Test Suites: 5 passed, 5 total
Tests:       74 passed, 74 total
```

---

## What this slice does NOT do

- No structured output format changes (JSON schema enforcement)
- No confidence threshold parameters
- No loop-logic changes (round limits, timeout adjustments)
- No new inspect tools
- No changes to action validators or execution bridge

---

## 6.7 overall status

**Open.** This is slice 1 of multiple planned tuning slices:

| Slice | Scope | Status |
|-------|-------|--------|
| **1. Prompt hardening** | panelSlug mapping, ID copy, act/clarify/abort rules | CLOSED (this report) |
| 2. Structured output | Reduce parse failures via JSON schema or response format | Not started |
| 3. Confidence thresholds | Tune act vs clarify boundary | Not started |
| 4. Tool-call efficiency | Reduce unnecessary inspect rounds | Not started |
