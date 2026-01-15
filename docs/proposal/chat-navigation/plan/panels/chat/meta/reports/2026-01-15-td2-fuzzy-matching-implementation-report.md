# Implementation Report: TD-2 Gated Fuzzy Matching

**Date:** 2026-01-15
**Status:** Complete
**Feature Slug:** `chat-navigation`
**Source Plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/2026-01-14-doc-retrieval-routing-debt-paydown-plan.md`

---

## Summary

Implemented gated fuzzy matching for typo tolerance in doc retrieval routing. The feature corrects common typos like `wrkspace` → `workspace` while maintaining strict guardrails to prevent false positives.

**Four integration points (fixes):**
1. **Routing gate** - Pass app-relevance check with fuzzy-matched terms
2. **Clarification escape** - Exit clarification mode for fuzzy-matched queries
3. **General retrieval correction** - Correct query before calling retrieval API
4. **Meta-explain correction** - Correct concept term in "what is X" queries

---

## Problem Statement

Users typing queries with typos (e.g., `wrkspace`, `dashbord`, `workspac`) were routed to LLM fallback instead of doc retrieval because:
1. Exact match against `knownTerms` failed
2. No fuzzy matching existed to catch near-misses

---

## TD-2 Guardrails

Per the debt paydown plan, fuzzy matching is strictly gated:

| Guardrail | Value | Rationale |
|-----------|-------|-----------|
| Min token length | 5 | Short tokens have too many false positives (e.g., `note` matching `mode`) |
| Max Levenshtein distance | 2 | Allows common typos without over-matching |
| Match against | `knownTerms` only | Database-backed terms, not arbitrary strings |

---

## Changes Made

### Fix 1: Routing Gate

**File:** `components/chat/chat-navigation-panel.tsx` (lines 455-464)

Added fuzzy matching as fallback in `routeDocInput` when exact match fails:

```typescript
// TD-2: Try fuzzy matching as fallback (gated: length >= 5, distance <= 2)
const hasFuzzy = hasFuzzyMatch(tokens, knownTerms)
if (hasFuzzy) {
  isAppRelevant = true
} else if (!hasCoreAppTerm) {
  return 'llm'
}
```

**Effect:** Typos now pass app-relevance gate and route to doc retrieval.

---

### Fix 2: Clarification Escape

**File:** `components/chat/chat-navigation-panel.tsx` (lines 2122-2132)

Added fuzzy match check to escape clarification mode:

```typescript
// TD-2: Check if input fuzzy-matches a known term (for typos like "wrkspace")
const { tokens: clarificationTokens } = normalizeInputForRouting(trimmedInput)
const isFuzzyMatchNewIntent = bareNounKnownTerms
  ? hasFuzzyMatch(clarificationTokens, bareNounKnownTerms)
  : false

const isNewQuestionOrCommandDetected =
  isNewQuestionOrCommand(trimmedInput) ||
  trimmedInput.endsWith('?') ||
  isBareNounNewIntent ||
  isFuzzyMatchNewIntent  // TD-2: Typos that fuzzy-match should also exit clarification
```

**Effect:** When user types a typo while clarification pills are shown, it escapes to main routing instead of going to LLM tier2.

---

### Fix 3: Retrieval Correction

**File:** `components/chat/chat-navigation-panel.tsx` (lines 3075-3100)

Applied fuzzy correction to the query before calling retrieval API:

```typescript
// TD-2: Apply fuzzy correction for retrieval
const { tokens: retrievalTokens } = normalizeInputForRouting(queryTerm)
if (knownTerms && !isBareNoun) {
  const fuzzyMatches = findAllFuzzyMatches(retrievalTokens, knownTerms)
  if (fuzzyMatches.length > 0) {
    let correctedQuery = queryTerm
    for (const fm of fuzzyMatches) {
      correctedQuery = correctedQuery.replace(
        new RegExp(`\\b${fm.inputToken}\\b`, 'gi'),
        fm.matchedTerm
      )
    }
    console.log(`[DocRetrieval] Fuzzy correction: "${queryTerm}" → "${correctedQuery}"`)
    queryTerm = correctedQuery
  }
} else if (knownTerms && isBareNoun) {
  const fuzzyMatch = findAllFuzzyMatches(retrievalTokens, knownTerms)[0]
  if (fuzzyMatch) {
    console.log(`[DocRetrieval] Fuzzy correction (bare noun): "${queryTerm}" → "${fuzzyMatch.matchedTerm}"`)
    queryTerm = fuzzyMatch.matchedTerm
  }
}
```

**Effect:** Retrieval API receives corrected query (`workspace`) instead of typo (`wrkspace`), enabling doc matches.

---

### Fix 4: Meta-Explain Path Correction

**File:** `components/chat/chat-navigation-panel.tsx` (lines 2563-2578)

**Problem:** Meta-explain queries like `what is wrkspace` were NOT being fuzzy-corrected. The concept was extracted as `wrkspace` and sent directly to retrieval, returning no match.

Added fuzzy correction to the meta-explain path:

```typescript
// TD-2: Apply fuzzy correction for meta-explain queries
let metaFuzzyCorrectionApplied = false
if (queryTerm && metaExplainKnownTerms) {
  const fuzzyMatch = findFuzzyMatch(queryTerm, metaExplainKnownTerms)
  if (fuzzyMatch) {
    console.log(`[MetaExplain] Fuzzy correction: "${queryTerm}" → "${fuzzyMatch.matchedTerm}"`)
    queryTerm = fuzzyMatch.matchedTerm
    metaFuzzyCorrectionApplied = true
    // Track fuzzy match in telemetry
    metaExplainTelemetryEvent.fuzzy_matched = true
    metaExplainTelemetryEvent.fuzzy_match_token = fuzzyMatch.inputToken
    metaExplainTelemetryEvent.fuzzy_match_term = fuzzyMatch.matchedTerm
    metaExplainTelemetryEvent.fuzzy_match_distance = fuzzyMatch.distance
  }
}
metaExplainTelemetryEvent.retrieval_query_corrected = metaFuzzyCorrectionApplied
```

**Effect:** `what is wrkspace` now correctly retrieves workspace docs instead of showing "Which part would you like me to explain?" with no pills.

---

## Core Implementation

### Fuzzy Match Functions

**File:** `lib/chat/query-patterns.ts` (lines 579-699)

```typescript
export function findFuzzyMatch(
  token: string,
  knownTerms: Set<string>
): FuzzyMatchResult | null {
  // Guard: token must be at least 5 characters
  if (token.length < FUZZY_MIN_TOKEN_LENGTH) return null

  for (const term of knownTerms) {
    // Skip if exact match (not a fuzzy case)
    if (tokenLower === termLower) continue

    // Skip terms too different in length (optimization)
    if (Math.abs(tokenLower.length - termLower.length) > FUZZY_MAX_DISTANCE) continue

    const distance = levenshteinDistance(tokenLower, termLower)
    if (distance <= FUZZY_MAX_DISTANCE) {
      // Track best match (lowest distance)
      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { matchedTerm: term, inputToken: token, distance }
      }
    }
  }
  return bestMatch
}
```

### Levenshtein Distance

**File:** `lib/chat/typo-suggestions.ts` (lines 320-345)

Exported existing `levenshteinDistance` function for reuse.

---

## Telemetry

**File:** `lib/chat/routing-telemetry.ts`

Added fields to track fuzzy matching:

| Field | Type | Purpose |
|-------|------|---------|
| `fuzzy_matched` | boolean | Did fuzzy match contribute to routing? |
| `fuzzy_match_token` | string | The input token that was fuzzy-matched |
| `fuzzy_match_term` | string | The known term it matched to |
| `fuzzy_match_distance` | number | Levenshtein distance (1 or 2) |
| `retrieval_query_corrected` | boolean | Was the retrieval query corrected via fuzzy match? |

**Note:** `retrieval_query_corrected` provides unified telemetry - all fuzzy match data is now in the `route_decision` event, eliminating the need for separate debug logs.

---

## Verification

### Unit Tests

**File:** `__tests__/chat/query-patterns.test.ts`

Added 16 tests covering all guardrails:

```
findFuzzyMatch
  ✓ workspac → workspace (missing trailing e)
  ✓ wrkspace → workspace (missing o)
  ✓ worksapce → workspace (transposition)
  ✓ note does NOT fuzzy-match (length 4 < min 5)
  ✓ does NOT match if distance > 2
  ✓ does NOT match if too different in length
  ✓ exact match skipped, returns closest fuzzy
  ✓ dashbord → dashboard (missing a)
  ✓ setings → settings (missing t)
  ✓ annotaions → annotations (missing t)
findAllFuzzyMatches
  ✓ finds multiple fuzzy matches
  ✓ returns empty array when no fuzzy matches
  ✓ skips short tokens
hasFuzzyMatch
  ✓ returns true when fuzzy match exists
  ✓ returns false when no fuzzy match
  ✓ returns false for short tokens
```

### Manual Testing

| Query | Fuzzy | Matched To | Route | Doc Status |
|-------|-------|------------|-------|------------|
| `wrkspace` | true | workspace | doc | ambiguous |
| `workspac` | true | workspace | doc | ambiguous |
| `dashbord` | true | dashboard | doc | ambiguous |
| `note` | false | - | bare_noun | ambiguous |
| `what is wrkspace` | true | workspace | doc | found |
| `wht is workspac` | true | workspace | doc | ambiguous |
| `wokspace` | true | workspace | doc | ambiguous |

**Note:** `wht is workspac` has two typos - "wht" (3 chars) is NOT corrected (below min length 5), but "workspac" IS corrected. The query still routes correctly because pattern matching is lenient.

### Telemetry Evidence

```sql
SELECT metadata->>'normalized_query' AS query,
       metadata->>'fuzzy_match_token' AS token,
       metadata->>'fuzzy_match_term' AS matched_to,
       metadata->>'retrieval_query_corrected' AS retrieval_corrected,
       metadata->>'doc_status' AS doc_status
FROM debug_logs
WHERE action = 'route_decision'
  AND metadata->>'route_final' = 'doc'
  AND metadata->>'retrieval_query_corrected' = 'true'
ORDER BY created_at DESC LIMIT 5;

 query             | token    | matched_to | retrieval_corrected | doc_status
-------------------+----------+------------+---------------------+------------
 wht is workspac   | workspac | workspace  | true                | ambiguous
 wokspace          | wokspace | workspace  | true                | ambiguous
 what is wrkspace  | wrkspace | workspace  | true                | found
 wrkspace          | wrkspace | workspace  | true                | ambiguous
```

This confirms the full pipeline across all paths:
- **Bare noun:** `wrkspace` → corrected → ambiguous (multiple docs)
- **Meta-explain:** `what is wrkspace` → corrected → found (confident result)
- **Multi-typo:** `wht is workspac` → app term corrected, question word ignored → ambiguous

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/query-patterns.ts` | Added `findFuzzyMatch`, `findAllFuzzyMatches`, `hasFuzzyMatch`, `FuzzyMatchResult` |
| `lib/chat/typo-suggestions.ts` | Exported `levenshteinDistance` |
| `lib/chat/routing-telemetry.ts` | Added fuzzy telemetry fields |
| `components/chat/chat-navigation-panel.tsx` | Fix 1 (routing), Fix 2 (clarification), Fix 3 (retrieval), Fix 4 (meta-explain) |
| `__tests__/chat/query-patterns.test.ts` | Added 16 fuzzy matching tests |

---

## Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `workspac` → `workspace` | ✅ | Telemetry: fuzzy_matched=true, distance=1 |
| `wrkspace` → `workspace` | ✅ | Telemetry: fuzzy_matched=true, distance=1 |
| `note` does NOT fuzzy-match (length 4) | ✅ | Telemetry: fuzzy_matched=null |
| False positive rate < 1% | ⏳ | Requires data collection period |

---

## Known Limitations

1. **Retrieval-time correction only** - The original typo is shown in chat history, not the corrected term
2. **Single-token correction** - Multi-word typos are corrected token-by-token, not as phrases
3. **No user feedback** - User isn't told "Did you mean X?" before retrieval (silent correction)

---

## Future Improvements

1. **Show correction** - Display "Showing results for 'workspace'" when fuzzy-corrected
2. **Confidence threshold** - Maybe require distance=1 for bare nouns, allow distance=2 for longer queries
3. **False positive monitoring** - Track `fuzzy_matched=true` + `doc_status=no_match` as potential false positives

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-01-15 | Claude | Initial fuzzy matching implementation |
| 2026-01-15 | Claude | Fix 1: Routing gate for fuzzy matches |
| 2026-01-15 | Claude | Fix 2: Clarification escape for fuzzy matches |
| 2026-01-15 | Claude | Fix 3: Retrieval correction with fuzzy terms |
| 2026-01-15 | Claude | Added 16 unit tests |
| 2026-01-15 | Claude | Verified with manual testing + telemetry |
| 2026-01-15 | Claude | Added `retrieval_query_corrected` to unified routing telemetry |
| 2026-01-15 | Claude | Fix 4: Meta-explain path fuzzy correction (missing from original impl) |
