# Stage 6 Enforcement Runtime Fixture — Implementation Report

**Date**: 2026-03-12
**Status**: READY FOR TESTING
**Scope**: Dev-only force-abstain flag + dashboard state fixture for S6 enforcement `open_panel` runtime validation.
**Predecessor**: 6.7 Slice 2 (structured output, closed)

---

## Summary

Creates a controlled runtime environment where the Stage 6 enforcement `open_panel` path is reachable. Two changes:

1. **Force-abstain dev flag** — `NEXT_PUBLIC_STAGE4_FORCE_ABSTAIN=true` makes `callGroundingLLM()` return `need_more_info` immediately, bypassing the bounded LLM and routing all grounded queries to Stage 6.
2. **SQL dashboard fixture** — Hides all panels except 4 (Links Panel D + 3 non-links), creating a single-match scenario for links-related queries.

---

## Changes

### 1. `lib/chat/grounding-llm-fallback.ts` — Force-abstain flag

Added after the `isGroundingLLMEnabled()` check (line ~139), before the actual LLM call:

```typescript
if (process.env.NEXT_PUBLIC_STAGE4_FORCE_ABSTAIN === 'true') {
  return {
    success: true,
    response: { decision: 'need_more_info', choiceId: null, confidence: 0 },
    latencyMs: Date.now() - startTime,
  }
}
```

**Why `success: true`**: The `stage4_abstain` S6 path requires `llmResult.success === true && llmResult.response.decision === 'need_more_info'` (routing-dispatcher.ts:5234). Returning `success: false` would trigger the `stage4_timeout` path instead, which is a different escalation reason.

**Scope**: Affects all `callGroundingLLM` callsites (Tiers 2c, 2d, 3.6, 4.5). For the fixture's test queries, only the Tier 4.5 callsite (line 4812) is reached — earlier tiers don't fire because the queries lack scope cues or widget context.

### 2. `.env.local` — Flag added

```
NEXT_PUBLIC_STAGE4_FORCE_ABSTAIN=true
```

### 3. `docs/proposal/chat-navigation/test_scripts/s6-enforcement-fixture.sql`

SQL fixture with 6 sections:
- §0 Pre-check
- §1 Setup (hide all, show 4 fixture panels)
- §2 Expected tier flow analysis
- §3 Test queries
- §4 Verification queries (durable log)
- §5 Rollback
- §6 Cleanup notes

---

## Tier flow analysis

For query **"take me to my links"** with fixture dashboard:

| Tier | Handler | Input | Decision |
|------|---------|-------|----------|
| 4 | `matchKnownNoun` | `canonicalize("take me to my links")` = "take me to my links" (no recognized verb prefix) | Not in KNOWN_NOUN_MAP → `handled: false` |
| 4 | Unknown noun fallback | 5 words → exceeds 1-4 word limit | Skipped |
| 4.5 | Deterministic | `matchVisiblePanelCommand` → tokens {take, links} → no full match against any panel title | No match |
| 4.5 | LLM | `callGroundingLLM(candidates)` | **FORCE_ABSTAIN** → `need_more_info` |
| 4.5→6 | S6 abstain path | `escalationReason: 'stage4_abstain'` | **S6 fires** |
| 6 | Gemini loop | `inspect_dashboard` → Links Panel D is only links panel → single match → Rule 5: ACT | `open_panel` |
| 6→bridge | `executeS6OpenPanel` | TOCTOU revalidation → panel visible → `openPanelDrawer()` | **Executed** |

---

## Test procedure

### 1. Setup

```bash
# Run SQL §1 against annotation_dev
psql -d annotation_dev -f docs/proposal/chat-navigation/test_scripts/s6-enforcement-fixture.sql
# (run §0 and §1 sections only)

# Restart dev server to pick up env change
npm run dev
```

### 2. Test queries (try in chat)

1. "take me to my links"
2. "I need to check my links"
3. "show me my saved links"
4. "where are my links"

### 3. Verify

Run SQL §4 against `annotation_dev`. Look for:

| Column | Expected |
|--------|----------|
| `routing_lane` | `D` |
| `decision_source` | `llm` |
| `result_status` | `executed` |
| `s6_outcome` | `action_executed` |
| `s6_action_type` | `open_panel` |
| `s6_escalation_reason` | `stage4_abstain` |

### 4. Rollback

```bash
# Run SQL §5 to restore all panels
# Remove NEXT_PUBLIC_STAGE4_FORCE_ABSTAIN from .env.local (or set to false)
# Restart dev server
```

---

## Success criteria

A single durable log row matching the column values above proves the full enforcement pipeline end-to-end:

```
callGroundingLLM → need_more_info → S6 loop (Gemini) → inspect_dashboard
→ single match → open_panel → validateResponseStructure ✓
→ action validator ✓ → enforcement loop returns action_executed
→ dispatcher: executeS6OpenPanel → TOCTOU revalidation ✓ → openPanelDrawer()
→ handledByTier: 6, tierLabel: 's6_enforced:open_panel'
→ durable log: routing_lane=D, decision_source=llm, result_status=executed
```

---

## Verification

```
$ npm run type-check
(clean — pre-existing test syntax error only)

$ npx jest __tests__/unit/chat/stage6 --no-coverage
Test Suites: 5 passed, 5 total
Tests:       78 passed, 78 total
```

---

## What this fixture does NOT do

- No changes to S6 loop logic, prompt, schema, or validation
- No changes to action validators or execution bridge
- No changes to routing dispatcher logic
- No permanent production code changes — the force-abstain flag is dev-only and removable
- Does not validate Stage 4.5 LLM's natural abstain behavior (the fixture bypasses the LLM entirely)

---

## After validation

Once the durable log row is confirmed:
1. Remove `NEXT_PUBLIC_STAGE4_FORCE_ABSTAIN` from `.env.local`
2. Run SQL §5 rollback to restore all panels
3. The fixture report can be closed
4. Consider removing the force-abstain code from `grounding-llm-fallback.ts` or keeping it for future regression testing
