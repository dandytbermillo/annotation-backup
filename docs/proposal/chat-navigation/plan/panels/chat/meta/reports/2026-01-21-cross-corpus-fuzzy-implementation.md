# Implementation Report: Cross-Corpus Fuzzy Normalization

**Date:** 2026-01-21
**Feature:** Cross-corpus typo normalization for consistent pills UX
**Status:** Implemented and Type-Checked

---

## Summary

Added fuzzy typo normalization to the cross-corpus retrieval handler so that queries
with typos (e.g., "what is workaspce") can still trigger cross-corpus ambiguity pills
when both docs and notes have matching results.

---

## Design Decisions

1. **Reuse TD-2 fuzzy matcher** - No new algorithm; leverage existing `findAllFuzzyMatches`
2. **Feature flag gated** - `NEXT_PUBLIC_CROSS_CORPUS_FUZZY=true` to enable (default: false)
3. **Conservative guardrails** - Token length >= 5, Levenshtein distance <= 2
4. **Apply only when no exact match** - `intent === 'none'` triggers fuzzy check
5. **Preserve original input** - Only corrected query used for retrieval, not display

---

## Files Modified

### `lib/chat/cross-corpus-handler.ts`

**Changes:**

1. **Added imports** (lines 15-16):
   ```typescript
   import {
     // ... existing imports ...
     findAllFuzzyMatches,
     type FuzzyMatchResult,
   } from '@/lib/chat/query-patterns'
   ```

2. **Added fuzzy normalization logic** (after line 93):
   - Check feature flag `NEXT_PUBLIC_CROSS_CORPUS_FUZZY`
   - If `intent === 'none'`, apply fuzzy matching
   - Replace typo token with corrected term
   - Re-detect intent with corrected query
   - Log telemetry when fuzzy applied

3. **Updated `queryCrossCorpus` call** (line 277):
   ```typescript
   // Before:
   const decision = await queryCrossCorpus(trimmedInput, knownTerms, ...)

   // After:
   const decision = await queryCrossCorpus(queryForRetrieval, knownTerms, ...)
   ```

4. **Added fuzzy telemetry fields** to all CrossCorpus telemetry events:
   - `cross_corpus_fuzzy_applied` (boolean)
   - `cross_corpus_fuzzy_token` (string, when applied)
   - `cross_corpus_fuzzy_term` (string, when applied)
   - `cross_corpus_fuzzy_distance` (number, when applied)

---

## Integration Point

```
handleCrossCorpusRetrieval()
  ├── Get knownTerms and detect intent
  ├── [NEW] If intent === 'none' && fuzzyEnabled:
  │     ├── Apply findAllFuzzyMatches
  │     ├── If match found: replace typo, re-detect intent
  │     └── Log fuzzy_normalization_applied telemetry
  ├── Check explicit docs/notes intent
  ├── Call queryCrossCorpus(queryForRetrieval, ...)
  └── Show pills or single corpus result
```

---

## Feature Flag

```bash
# Enable fuzzy normalization (off by default)
NEXT_PUBLIC_CROSS_CORPUS_FUZZY=true
```

Add to `.env.local` to enable during development/testing.

---

## Verification

### Type-Check
```bash
$ npm run type-check
> tsc --noEmit -p tsconfig.type-check.json
# No errors
```

### Manual Testing (requires feature flag enabled)

| Test Case | Expected | Status |
|-----------|----------|--------|
| "what is workaspce" with flag enabled | Pills shown (Docs vs Notes) | Pending |
| "what is workspace" (no typo) | Pills shown (existing behavior) | Pending |
| "search my notes for workaspce" | Notes result (no fuzzy for explicit intent) | Pending |
| Short token "x" or "ui" | No fuzzy normalization | Pending |

---

## Telemetry

When fuzzy normalization is applied:
```json
{
  "component": "CrossCorpus",
  "action": "fuzzy_normalization_applied",
  "metadata": {
    "cross_corpus_fuzzy_applied": true,
    "cross_corpus_fuzzy_token": "workaspce",
    "cross_corpus_fuzzy_term": "workspace",
    "cross_corpus_fuzzy_distance": 1,
    "original_query": "what is workaspce",
    "corrected_query": "what is workspace",
    "original_intent": "none",
    "corrected_intent": "docs"
  }
}
```

All CrossCorpus telemetry events now include `cross_corpus_fuzzy_applied`.

---

## Known Limitations

1. **Doc-terms only** - Fuzzy matching uses doc known-terms; notes FTS handles its own typos
2. **First match used** - If multiple typos, only the best fuzzy match is corrected
3. **Feature flag required** - Not enabled by default for safety

---

## Next Steps (Optional)

1. Enable feature flag in dev/staging and verify acceptance tests
2. Monitor telemetry for false positives
3. Consider extending to notes-specific terms if needed
