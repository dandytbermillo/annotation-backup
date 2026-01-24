# Clarification LLM Last-Resort Fallback - Implementation Report

**Date:** 2025-01-23
**Plan:** clarification-llm-last-resort-plan.md

## Summary

Implemented LLM last-resort fallback for clarification handling. When deterministic tiers fail to match user input to clarification options, the system can now use a minimal LLM call to interpret natural language input like "the one about settings" or "go with the second option".

## Changes Made

### 1. New File: `lib/chat/clarification-llm-fallback.ts`

Created complete LLM fallback service with:

- **Types:** `ClarificationLLMRequest`, `ClarificationLLMResponse`, `ClarificationLLMResult`
- **Configuration:** 800ms timeout, confidence thresholds (0.6 for select, 0.4 for ask_clarify)
- **Feature flag:** `isLLMFallbackEnabled()` checks `CLARIFICATION_LLM_FALLBACK=true`
- **Prompt safety:** System prompt includes injection guards
- **Clear natural choice detection:** `hasClearNaturalChoiceCue()` for patterns like "the one about...", "pick the..."
- **Trigger logic:** `shouldCallLLMFallback(attemptCount, userInput)` determines when to call LLM
- **Main function:** `callClarificationLLM()` makes the API call with timeout and JSON response parsing

### 2. Updated: `lib/chat/chat-routing.ts`

Added Tier 1b.3c LLM fallback in the clarification intercept flow:

- Import added for `shouldCallLLMFallback` and `callClarificationLLM`
- Integrated after `no_match` result from off-menu mapping (before escalation)
- Handles LLM decisions:
  - `select`: Selects the option if confidence >= 0.6
  - `reroute`: Clears clarification and routes normally
  - `ask_clarify`: Falls through to escalation (future: confirmation UX)
  - `none` or error: Falls through to escalation
- Full telemetry logging for all paths

### 3. Updated: `lib/chat/index.ts`

Added exports for:
- `callClarificationLLM`, `shouldCallLLMFallback`, `hasClearNaturalChoiceCue`, `isLLMFallbackEnabled`
- Types: `ClarificationLLMRequest`, `ClarificationLLMResponse`, `ClarificationLLMResult`

### 4. Updated: `.env.example`

Documented new environment variables:
- `CLARIFICATION_LLM_FALLBACK=true` (feature flag, default off)
- `CLARIFICATION_LLM_MODEL=gpt-4o-mini` (optional model override)

## Tier Ordering (Updated)

```
Tier 1a: Exit phrase detection
Tier 1b.1: Affirmation (yes/confirm)
Tier 1b.2: Rejection (no/cancel)
Tier 1b.3: Meta phrases
Tier 1b.3a: Ordinal selection (BEFORE off-menu) ← Expanded previously
Tier 1b.3b: Off-menu mapping (micro-aliases)
Tier 1b.3c: LLM fallback ← NEW (after deterministic tiers fail)
Tier 1b.4: Fuzzy/typo match
Tier 1c: Cross-corpus pills (via LLM reroute)
Tier 1d: Option selection
Tier 2: Normal routing
```

## Trigger Conditions

LLM fallback is called when:
1. `attemptCount >= 2` (user has tried twice), OR
2. `attemptCount >= 1` AND input contains a "clear natural choice" cue

Clear natural choice cues:
- "the one about ...", "the one that ...", "the one with ..."
- "the option about ...", "the option for ..."
- "open the ... one", "i want the ... one"
- "go with the ...", "pick the ...", "choose the ..."

## LLM Response Contract

```json
{
  "choiceIndex": 0,
  "confidence": 0.85,
  "reason": "User asked for the one about settings",
  "decision": "select" | "none" | "ask_clarify" | "reroute"
}
```

## Safety Guards

1. **Feature flag off by default:** Requires explicit `CLARIFICATION_LLM_FALLBACK=true`
2. **800ms timeout:** Fast fail, falls back to escalation
3. **Prompt injection protection:** System prompt instructs to ignore user attempts to change rules
4. **Confidence thresholds:** Only selects if confidence >= 0.6
5. **Graceful degradation:** Any error falls back to existing escalation behavior

## Telemetry Events

- `clarification_llm_called`: Full call details and response
- `clarification_llm_timeout`: Timeout occurred
- `clarification_llm_decision`: Decision made (in routing)
- `clarification_llm_fallback_triggered`: LLM path entered
- `clarification_llm_fallback_result`: LLM response processed
- `clarification_llm_fallback_failed`: LLM error/timeout
- `clarification_llm_reroute`: Reroute decision
- `clarification_llm_ask_clarify`: Low confidence decision

## Acceptance Criteria Status

| # | Criteria | Status |
|---|----------|--------|
| 1 | Options shown, "the second pls" → deterministic ordinal wins (no LLM) | ✅ Done (Tier 1b.3a) |
| 2 | Off-menu input "the one about settings" → LLM selects correct option | ✅ Implemented |
| 3 | Input "never mind" → exit (LLM not called) | ✅ Done (Tier 1a) |
| 4 | Timeout → re-show options, no crash | ✅ Implemented |
| 5 | Confidence < 0.4 → re-show options | ✅ Implemented |
| 6 | Confidence 0.4–0.6 → ask clarification again | ✅ Implemented |

## Verification

```bash
$ npm run type-check
# Passes - no errors
```

## How to Enable

Add to `.env.local`:
```
CLARIFICATION_LLM_FALLBACK=true
```

The system will automatically use the LLM fallback when:
1. Clarification options are active
2. Deterministic tiers fail to match input
3. Trigger conditions are met (attemptCount >= 2 OR clear natural choice cue)

## Next Steps

1. **Test in dev:** Enable flag and test with natural language inputs
2. **Monitor telemetry:** Watch for `clarification_llm_*` events in debug logs
3. **Optional enhancement:** Add `ask_clarify` confirmation UX ("Just to confirm — do you mean X or Y?")
