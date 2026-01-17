# Implementation Report: Definitional Query Fix & Routing Improvements

**Date:** 2026-01-14
**Status:** Implemented
**Feature Slug:** `chat-navigation`

---

## Summary

Fixed multiple issues with doc retrieval routing where queries like "what is workspace" and "can you tell me what are the workspaces actions?" were returning wrong results or falling through to LLM fallback.

---

## Issues Fixed

### Issue 1: Cross-Doc Ambiguity Suppression

**Problem:** Query "what is workspace" returned `actions/workspaces` instead of showing both `concepts/workspace` and `actions/workspaces` as options.

**Root Cause:** Same-doc tie collapse rule suppressed cross-doc candidates.

**Fix:** Added cross-doc ambiguity override in `keyword-retrieval.ts`:
```typescript
// Check for cross-doc candidate before same-doc collapse
const crossDocCandidates = topResults.filter(r =>
  r.doc_slug !== topDocSlug &&
  (topScore - r.score) < MIN_GAP
)
if (crossDocCandidate) {
  return { status: 'ambiguous', options: [...] }
}
```

---

### Issue 2: Follow-up Scoping After New Question

**Problem:** After "what is workspace" returned concept doc, query "can you tell me what are the workspaces actions?" returned chunks from `concepts/workspace` instead of fresh retrieval.

**Root Cause:** Follow-up classifier incorrectly marked new questions as follow-ups because both contained "workspace".

**Fix:** Added `!isNewQuestionOrCommand` guard to skip classifier for new questions:
```typescript
// chat-navigation-panel.tsx:2936
if (docRetrievalState?.lastDocSlug && !isFollowUp && !isNewQuestionOrCommand) {
  // Only call classifier for potential follow-ups, NOT new questions
}
```

---

### Issue 3: Conversational Prefix Breaking Pattern Match

**Problem:** "can you tell me what are the workspaces actions?" didn't match meta-explain patterns because it starts with "can" not "what".

**Root Cause:** `isMetaExplainOutsideClarification` only matched queries starting with "what is/are".

**Fix:** Added `stripConversationalPrefix()` helper:
```typescript
function stripConversationalPrefix(input: string): string {
  const prefixes = [
    /^(can|could|would|will) you (please |pls )?(tell me|explain) /i,
    /^(please |pls )?(tell me|explain) /i,
    // ...
  ]
  // Returns: "what are the workspaces actions"
}
```

---

### Issue 4: Cache-Dependent Routing Failure

**Problem:** Queries with app-relevant keywords ("workspaces", "action") fell to LLM fallback when `knownTerms` cache was empty.

**Root Cause:** App-relevance check only used cached `knownTerms`, which could be null.

**Fix:** Added `CORE_APP_TERMS` cache-independent fallback:
```typescript
const CORE_APP_TERMS = new Set([
  'workspace', 'workspaces',
  'note', 'notes',
  'action', 'actions',
  // ...
])

// In routeDocInput:
const hasCoreAppTerm = tokens.some(t => CORE_APP_TERMS.has(t))
if (hasCoreAppTerm) {
  isAppRelevant = true
}
```

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/docs/keyword-retrieval.ts` | Cross-doc ambiguity override, HS1 guard |
| `components/chat/chat-navigation-panel.tsx` | Conversational prefix stripping, CORE_APP_TERMS, new question guard |
| `app/api/docs/retrieve/route.ts` | Pass status/options for ambiguous results |
| `lib/chat/chat-navigation-context.tsx` | Extended SelectionOption type |

---

## Test Results

| Query | Before | After |
|-------|--------|-------|
| "what is workspace" | Wrong doc (actions) | Correct (concept) |
| "what are the workspaces actions?" | Pills | Pills |
| "can you tell me what are the workspaces actions?" | Wrong doc (scoped) | Pills |
| "can you pls tell me what are workspaces action?" | LLM fallback | Pills |
| "an you pls tell what are workspaces action?" | LLM fallback | Pills |

---

## Validation

```bash
npm run type-check  # ✓ Passed
```

---

## Known Limitations

1. ~~**Hardcoded patterns**~~ - ✅ Addressed by TD-3 (consolidated in `lib/chat/query-patterns.ts`)
2. ~~**No fuzzy matching**~~ - ✅ Addressed by TD-2 (gated fuzzy matching with distance ≤ 2)
3. ~~**No telemetry**~~ - ✅ Addressed by TD-4 (durable routing telemetry)

See: `2026-01-14-doc-retrieval-routing-debt-paydown-plan.md` for full debt paydown status.

---

## Architecture Notes

### Current Flow (Pattern-Based)
```
User Query
    ↓
[Conversational Prefix Strip]
    ↓
[Pattern Matching] → Meta-explain? Doc-style? Bare noun?
    ↓
[CORE_APP_TERMS Check] → App-relevant fallback
    ↓
[Keyword Retrieval] → Database query
    ↓
[Cross-Doc Ambiguity] → Pills or direct answer
```

### LLM Classifier Usage
The follow-up classifier (`/api/chat/classify-followup`) is ONLY used for:
- Detecting if "tell me more" is a follow-up to previous doc
- Simple YES/NO classification
- NOT used for general intent extraction

---

## References

- `docs/proposal/chat-navigation/plan/panels/chat/meta/definitional-query-fix-proposal.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/general-doc-retrieval-routing-plan.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/technical-debt/2026-01-14-doc-retrieval-routing-debt.md`
