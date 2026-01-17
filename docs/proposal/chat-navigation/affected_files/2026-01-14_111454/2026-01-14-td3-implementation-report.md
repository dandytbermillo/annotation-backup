# Implementation Report: TD-3 Pattern Consolidation

**Date:** 2026-01-14
**Status:** Complete
**Feature Slug:** `chat-navigation`
**Source Plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/2026-01-14-doc-retrieval-routing-debt-paydown-plan.md`

---

## Summary

Implemented TD-3 (Consolidate Pattern Matching) from the debt paydown plan. All routing patterns and detection functions are now centralized in a single module with comprehensive regression tests. Manual smoke testing and telemetry verification confirm correct behavior.

**Update (2026-01-15):** TD-2 (fuzzy matching) added `findFuzzyMatch`, `findAllFuzzyMatches`, `hasFuzzyMatch` functions and 16 additional tests to this module (total: 204 tests).

---

## TD-3: Consolidate Pattern Matching

### Why

- Reduce pattern drift across multiple files
- Make routing changes safer with centralized logic
- Enable regression testing for routing behavior
- Single source of truth for all pattern constants

### Implementation

#### 1. Created `lib/chat/query-patterns.ts`

New consolidated module (543 lines) containing:

**Pattern Constants:**
- `AFFIRMATION_PATTERN` - yes/ok/sure responses
- `REJECTION_PATTERN` - no/cancel responses
- `QUESTION_START_PATTERN` - what/how/where/when/why
- `COMMAND_START_PATTERN` - open/show/go/create/delete
- `QUESTION_INTENT_PATTERN` - broader question detection
- `ACTION_VERB_PATTERN` - open/close/show/list/go
- `DOC_INSTRUCTION_PATTERN` - "how to", "show me how"
- `INDEX_REFERENCE_PATTERN` - "workspace 6", "note 2"
- `META_EXPLAIN_PATTERNS` - what is X, explain X
- `CONVERSATIONAL_PREFIXES` - "can you tell me", "please"
- `POLITE_COMMAND_PREFIXES` - "can you", "could you"
- `ACTION_NOUNS` - recent, quick links, workspaces
- `DOC_VERBS` - explain, describe, define, clarify
- `CORRECTION_PHRASES` - no, not that, wrong
- `FOLLOWUP_PHRASES` - tell me more, continue
- `META_PATTERNS` - what do you mean?, huh?
- `RESHOW_PATTERNS` - show me options
- `BARE_META_PHRASES` - explain, what is that

**Normalization Functions:**
- `normalizeInputForRouting()` - lowercase, trim, replace separators, tokenize
- `normalizeTitle()` - normalize widget/doc titles for comparison
- `normalizeTypos()` - fix common typos (shwo→show, optins→options)
- `stripConversationalPrefix()` - remove "can you tell me" etc.
- `startsWithAnyPrefix()` - helper for prefix matching

**Detection Functions:**
- `isAffirmationPhrase()` - yes/ok detection
- `isRejectionPhrase()` - no/cancel detection
- `isCorrectionPhrase()` - "not that", "wrong" detection
- `isPronounFollowUp()` - "tell me more" detection
- `hasQuestionIntent()` - question word or ? ending
- `hasActionVerb()` - open/show/create verbs
- `containsDocInstructionCue()` - "how to" patterns
- `looksIndexLikeReference()` - "workspace 6" patterns
- `isMetaPhrase()` - clarification requests
- `matchesReshowPhrases()` - "show me options"
- `isMetaExplainOutsideClarification()` - "what is X" outside clarification
- `isCommandLike()` - imperative command detection
- `isNewQuestionOrCommand()` - new intent detection

**Extraction Functions:**
- `extractMetaExplainConcept()` - "what is workspace" → "workspace"
- `extractDocQueryTerm()` - "how do I add widgets" → "add widgets"

**Response Style:**
- `getResponseStyle()` - short/medium/detailed based on input

**Main API:**
- `classifyQueryIntent()` - returns QueryIntent enum
- `normalizeQuery()` - full query analysis

#### 2. Updated `components/chat/chat-navigation-panel.tsx`

- Added imports from `lib/chat/query-patterns.ts` (lines 55-93)
- Removed 15+ duplicate function definitions
- Renamed local variable `isNewQuestionOrCommand` → `isNewQuestionOrCommandDetected` to avoid conflict with imported function
- Kept component-specific functions that require UIContext:
  - `matchesVisibleWidgetTitle()` - uses uiContext.dashboard.visibleWidgets
  - `isDocStyleQuery()` - uses matchesVisibleWidgetTitle
  - `isBareNounQuery()` - uses matchesVisibleWidgetTitle
  - `routeDocInput()` - uses CORE_APP_TERMS (kept until TD-1)

#### 3. Created `__tests__/chat/query-patterns.test.ts`

Comprehensive test suite with 188 tests:

- **Regression Table** - 32 intent classification tests
- **Pattern Constants** - AFFIRMATION, REJECTION, QUESTION_START, COMMAND_START
- **Normalization** - normalizeInputForRouting, stripConversationalPrefix, normalizeTypos, normalizeTitle
- **Detection Functions** - all 15 detection functions tested
- **Extraction Functions** - extractMetaExplainConcept, extractDocQueryTerm
- **Response Style** - getResponseStyle
- **Main API** - classifyQueryIntent, normalizeQuery

---

## Test Results

### Unit Tests

```bash
$ npm test -- --testPathPattern="query-patterns"

PASS __tests__/chat/query-patterns.test.ts
  Query Patterns Module
    Regression Table - Intent Classification (32 tests)
    AFFIRMATION_PATTERN (12 tests)
    REJECTION_PATTERN (9 tests)
    QUESTION_START_PATTERN (8 tests)
    COMMAND_START_PATTERN (8 tests)
    normalizeInputForRouting (4 tests)
    stripConversationalPrefix (4 tests)
    normalizeTypos (3 tests)
    normalizeTitle (2 tests)
    isAffirmationPhrase (8 tests)
    isRejectionPhrase (7 tests)
    isCorrectionPhrase (7 tests)
    isPronounFollowUp (8 tests)
    hasQuestionIntent (5 tests)
    hasActionVerb (6 tests)
    containsDocInstructionCue (6 tests)
    looksIndexLikeReference (6 tests)
    isMetaPhrase (8 tests)
    matchesReshowPhrases (6 tests)
    isMetaExplainOutsideClarification (9 tests)
    isCommandLike (7 tests)
    isNewQuestionOrCommand (8 tests)
    extractMetaExplainConcept (5 tests)
    extractDocQueryTerm (4 tests)
    getResponseStyle (3 tests)
    normalizeQuery (3 tests)

Test Suites: 1 passed, 1 total
Tests:       188 passed, 188 total
Time:        0.299 s
```

### Manual Smoke Testing

Tested all major routing paths in the chat panel:

| Input | Expected Route | Actual Behavior | Status |
|-------|---------------|-----------------|--------|
| `what is workspace` | explain | Shows doc content | ✓ |
| `what are actions` | explain/ambiguous | Shows disambiguation pills | ✓ |
| `can you tell me what are actions` | explain | Strips prefix, shows options | ✓ |
| `open notes` | action | Found Quick Links panels | ✓ |
| `recent` | action | Opening panel... | ✓ |
| `tell me more` | followup | Expands previous doc | ✓ |
| `no` | correction | "Got it — let's try again" | ✓ |
| `workspace 6` | action | Clarification (no workspace #6) | ✓ |
| `hello` | llm | LLM fallback response | ✓ |
| `yes` | affirmation | Confirms previous action | ✓ |

### Telemetry Verification

Verified routing telemetry in database (TD-4 integration):

```
┌─────────┬───────────────────────────────┬─────────────┬───────────────────────┬─────────────┬───────────┐
│ (index) │ query                         │ route       │ pattern               │ doc_status  │ corrected │
├─────────┼───────────────────────────────┼─────────────┼───────────────────────┼─────────────┼───────────┤
│ 0       │ 'hello'                       │ 'llm'       │ 'ROUTE_LLM_FALLBACK'  │ null        │ null      │
│ 1       │ 'workspace 6'                 │ 'action'    │ 'ACTION_COMMAND'      │ null        │ null      │
│ 2       │ 'no'                          │ 'clarify'   │ 'CORRECTION'          │ null        │ 'true'    │
│ 3       │ 'tell me more'                │ 'followup'  │ 'FOLLOWUP_PRONOUN'    │ null        │ null      │
│ 4       │ 'recent'                      │ 'action'    │ 'ACTION_WIDGET'       │ null        │ null      │
│ 5       │ 'open notes'                  │ 'action'    │ 'ACTION_COMMAND'      │ null        │ null      │
│ 6       │ 'what are actions'            │ 'doc'       │ 'AMBIGUOUS_CROSS_DOC' │ 'ambiguous' │ null      │
│ 7       │ 'what is workspace'           │ 'doc'       │ 'DEF_WHAT_IS'         │ 'found'     │ null      │
└─────────┴───────────────────────────────┴─────────────┴───────────────────────┴─────────────┴───────────┘
```

All routes logged correctly with appropriate `matched_pattern_id` values.

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/query-patterns.ts` | **NEW** - Consolidated patterns module (543 lines) |
| `components/chat/chat-navigation-panel.tsx` | Imports from query-patterns, removed 15+ duplicate functions |
| `__tests__/chat/query-patterns.test.ts` | **NEW** - Regression test suite (188 tests) |
| `docs/.../2026-01-14-doc-retrieval-routing-debt-paydown-plan.md` | Updated TD-3 status |

---

## Acceptance Criteria

- [x] All patterns defined in one module (`lib/chat/query-patterns.ts`)
- [x] Test suite validates 188 common phrases and patterns
- [x] Component imports from consolidated module
- [x] Type-check passes (`npm run type-check`)
- [x] Manual smoke testing confirms correct routing
- [x] Telemetry (TD-4) captures all routing decisions correctly
- [x] No regressions in existing routing behavior

---

## Integration with Other TD Items

### TD-4: Durable Telemetry
- Query patterns work with telemetry instrumentation
- `matched_pattern_id` correctly populated for all routes
- `getPatternId()` function in `routing-telemetry.ts` uses consolidated patterns

### TD-8: Don't Lock State on Weak
- Ambiguous results (`AMBIGUOUS_CROSS_DOC`) correctly detected
- Follow-up detection (`isPronounFollowUp`) unchanged

### TD-1: CORE_APP_TERMS (Future)
- `CORE_APP_TERMS` kept in component until telemetry data confirms removal is safe
- Pattern module ready to absorb this when TD-1 is implemented

---

## Regression Prevention

### Pattern Module Rules

```typescript
// lib/chat/query-patterns.ts header comment
/**
 * Query Patterns Module
 * Part of: TD-3 (Consolidate Pattern Matching)
 *
 * Single source of truth for all routing patterns and query normalization.
 * DO NOT duplicate these patterns elsewhere - import from this module.
 */
```

### Test Coverage

The 188 regression tests ensure:
- Pattern constants match expected inputs
- Detection functions return correct booleans
- Extraction functions parse queries correctly
- Intent classification routes to correct handlers

Run tests before merging any pattern changes:
```bash
npm test -- --testPathPattern="query-patterns"
```

---

## Next Steps

Per debt paydown plan execution order (as of 2026-01-15):
1. ~~TD-4: Durable telemetry~~ ✅
2. ~~TD-8: Don't lock state on weak~~ ✅
3. ~~TD-3: Consolidate pattern matching~~ ✅
4. ~~TD-2: Gated fuzzy matching~~ ✅ (added 16 fuzzy tests → total now 204)
5. ⏳ TD-1: Remove CORE_APP_TERMS (collecting telemetry until 2026-01-18)
6. ⏳ TD-7: Stricter app-relevance fallback (blocked on TD-1)

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-01-14 | Claude | Initial implementation of TD-3 |
| 2026-01-14 | Claude | Created query-patterns.ts with all consolidated patterns |
| 2026-01-14 | Claude | Updated chat-navigation-panel.tsx to import from module |
| 2026-01-14 | Claude | Created regression test suite (188 tests) |
| 2026-01-14 | Claude | Fixed extractMetaExplainConcept to check original text first |
| 2026-01-14 | Claude | Manual smoke testing and telemetry verification |
