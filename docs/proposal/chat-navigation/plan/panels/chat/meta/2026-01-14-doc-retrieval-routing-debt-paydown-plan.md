# Plan: Doc Retrieval Routing Debt Paydown

**Date:** 2026-01-14
**Updated:** 2026-01-15 (TD-1 decision criteria refined)
**Status:** In Progress
**Feature Slug:** `chat-navigation`
**Source Debt Doc:** `docs/proposal/chat-navigation/plan/panels/chat/meta/technical-debt/2026-01-14-doc-retrieval-routing-debt.md`
**Implementation Reports:**
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-14-definitional-query-fix-implementation-report.md` (pre-debt-paydown fixes)
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-14-td3-implementation-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-15-td4-td8-implementation-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-15-knownterms-race-fix-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-15-td2-fuzzy-matching-implementation-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-16-td7-implementation-report.md`

## Goals
- Reduce pattern fragility without regressing "human feel".
- Remove duplicate app-term lists and cache-miss routing drift.
- Add durable telemetry for tuning and regression detection.

## Non-Goals
- Replacing deterministic routing with always-on LLM intent extraction.
- Large retrieval model changes or embeddings rollout.

## Execution Order (Low-Risk First)
1) ✅ TD-4: Durable routing telemetry — **COMPLETE** (2026-01-15)
2) ✅ TD-8: Don't lock state on weak (doc follow-ups) — **COMPLETE** (2026-01-15)
3) ✅ TD-3: Consolidate routing patterns — **COMPLETE** (2026-01-14)
4) ✅ TD-1: Remove CORE_APP_TERMS duplication — **COMPLETE** (2026-01-16)
5) ✅ TD-2: Gated typo tolerance (fuzzy match) — **COMPLETE** (2026-01-15)
6) ✅ TD-7: Stricter app-relevance fallback — **COMPLETE** (2026-01-16)
7) TD-5: Polite follow-up guard (only if telemetry shows need)
8) TD-6: LLM intent extraction (optional, last)
9) ✅ TD-9: Cross-doc ambiguity override — **COMPLETE** (pre-existing)

---

## TD-4: Durable Telemetry (First)
### Status: ✅ COMPLETE (2026-01-15)

### Why
We need data to validate routing changes and avoid regressions.

### Plan
- Introduce a single stable event: `doc_routing_decision`.
- Define `matched_pattern_id` as a stable enum (e.g., `DEF_WHAT_IS`, `FOLLOWUP_TELL_ME_MORE`).
- Persist to analytics store (not only console).

### Implementation
- Created `lib/chat/routing-telemetry.ts` with stable `RoutingPatternId` enum
- Added `forceLog` option to `debugLog` for always-on telemetry
- Instrumented all routing paths: meta-explain, follow-up, correction, action, doc, llm
- Added classifier timeout **tracking** with AbortController (2s timeout)
- Added correction tracking with `user_corrected_next_turn` field
- Added `AMBIGUOUS_CROSS_DOC` pattern for ambiguous results
- **2026-01-15 fix:** Added `matched_core_term`/`matched_known_term` instrumentation to meta-explain, follow-up, and correction paths (previously NULL, now all paths set these fields for accurate TD-1 metrics)

### Event Schema (implemented)
- `input_len`
- `normalized_query`
- `route_deterministic`
- `route_final`
- `matched_pattern_id` (stable enum)
- `known_terms_loaded`
- `known_terms_count`
- `classifier_called`
- `classifier_result`
- `classifier_latency_ms`
- `classifier_timeout`
- `classifier_error`
- `doc_status` (found|weak|ambiguous|no_match)
- `doc_slug_top`
- `doc_slug_alt[]`
- `followup_detected`
- `is_new_question`
- `last_doc_slug_present`
- `last_doc_slug`
- `routing_latency_ms`
- `user_corrected_next_turn`

### Acceptance Criteria
- [x] Routing events persisted and queryable.
- [x] `matched_pattern_id` enum documented and stable across releases.
- [x] All routes logged (doc, action, llm, followup, clarify).
- [x] Classifier timeout tracked.
- [x] User corrections tracked.
- [ ] Dashboard view of route distribution. *(query available, UI pending)*

### Production Notes
- Retention: Use `timestamp` column for cleanup queries
- Sampling: Default 1.0, use `ROUTING_TELEMETRY_SAMPLE_RATE` env var if needed
- Index: Consider `CREATE INDEX idx_debug_logs_pattern_id ON debug_logs ((metadata->>'matched_pattern_id')) WHERE component = 'DocRouting'`

---

## TD-1: Remove CORE_APP_TERMS Duplication
### Status: ✅ COMPLETE (2026-01-16)

### Why
Avoid divergence between hardcoded terms and docs database.

### Plan
- Preload `knownTerms` at app startup and keep in memory for session.
- SSR embed a snapshot for cold start (required).
- Remove `CORE_APP_TERMS` once knownTerms is guaranteed available.
- Dependency: TD-4 telemetry live so cache-miss rate can be verified before removal.

### Implementation (2026-01-16)
- ✅ `CORE_APP_TERMS` constant removed from `chat-navigation-panel.tsx`
- ✅ `routeDocInput()` now relies solely on `knownTerms` (SSR snapshot guarantees availability)
- ✅ Timeout/fallback logic simplified (no longer falls back to hardcoded terms)
- ✅ `matched_core_term` telemetry field deprecated (no longer set)
- ✅ Type definitions updated in `routing-telemetry.ts`

### Validation (pre-removal)
- ✅ Race condition fixed: `await fetchKnownTerms()` with 2s timeout in sendMessage
- ✅ Telemetry instrumented: all routing paths set `matched_known_term`
- ✅ SSR snapshot implemented and tested (cold-start verified)
- ✅ "action" singular gap fixed (added to docs, re-seeded)
- ✅ All quality criteria passed (0 critical failures, 0% NULL/NULL, 100% terms loaded)

### Check-in Schedule
| Date | Check-in | Status |
|------|----------|--------|
| 2026-01-16 | 24h data review | ⏳ Pending |
| 2026-01-17 | 48h data review | ⏳ Pending |
| 2026-01-18+ | Final decision (when volume sufficient) | ⏳ Pending |

**Note:** Decision date is flexible. If event volume is too low at 72h, extend window rather than deciding on insufficient data.

### Baseline Note
Earlier results from 2026-01-15 include NULL/NULL events caused by incomplete instrumentation.
Those events should be treated as pre-fix noise. **TD-1 analysis should start at
2026-01-16T03:29:00Z** (all routing paths instrumented).

### Decision Criteria (All Must Pass)

| # | Criterion | Threshold | Why |
|---|-----------|-----------|-----|
| 1 | Critical failures | `core=true AND known=false` = 0 (or effectively never) | Proves knownTerms covers all CORE_APP_TERMS cases |
| 2 | Instrumentation coverage | NULL/NULL events < 5% | Ensures we're measuring all traffic, not a subset |
| 3 | Terms loaded | `known_terms_count > 0` for ≥ 95% of events | Proves knownTerms is reliably available |
| 4 | Volume | ≥ 100 total events | Statistical confidence |
| 5 | SSR snapshot ready | Implemented + tested | Required for cold-start (plan prerequisite) |
| 6 | Window | Extend until criteria met | Don't rush decision on low volume |

**Failure modes this guards against:**
1. **Empty data false positive:** If `knownTerms` fails to load, both fields are false/null → "0 critical failures" but neither system working
2. **Instrumentation gaps:** If some paths don't set the fields (NULL/NULL), "0" is misleading because we're not measuring all traffic
3. **Cold-start regression:** Without SSR snapshot, fresh sessions could have "no terms available" routing drift

### TD-1 Decision Query
```sql
SELECT
  -- Criterion 1: Critical failures (target: 0)
  COUNT(*) FILTER (
    WHERE metadata->>'matched_core_term' = 'true'
      AND metadata->>'matched_known_term' = 'false'
  ) as critical_failures,

  -- Criterion 2: Instrumentation coverage (target: < 5% NULL/NULL)
  COUNT(*) FILTER (
    WHERE metadata->>'matched_core_term' IS NULL
      AND metadata->>'matched_known_term' IS NULL
  ) as null_null_events,

  -- Criterion 3: Terms loaded (target: >= 95%)
  COUNT(*) FILTER (
    WHERE (metadata->>'known_terms_count')::int > 0
  ) as events_with_terms,

  -- Criterion 4: Volume (target: >= 100)
  COUNT(*) as total_events,

  -- Computed percentages
  ROUND(
    100.0 * COUNT(*) FILTER (
      WHERE metadata->>'matched_core_term' IS NULL
        AND metadata->>'matched_known_term' IS NULL
    ) / NULLIF(COUNT(*), 0), 1
  ) as null_null_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE (metadata->>'known_terms_count')::int > 0) /
    NULLIF(COUNT(*), 0), 1
  ) as terms_loaded_pct
FROM debug_logs
WHERE action = 'route_decision'
  AND created_at > '2026-01-16T03:29:00Z';

-- Decision: Proceed with CORE_APP_TERMS removal when ALL pass:
-- 1. critical_failures = 0 (or effectively never)
-- 2. null_null_pct < 5 (instrumentation firing on all paths)
-- 3. terms_loaded_pct >= 95 (knownTerms reliably available)
-- 4. total_events >= 100 (sufficient volume)
-- 5. SSR snapshot implemented and tested (manual check)
```

### TD-1 Breakdown Query (for debugging)
```sql
SELECT
  metadata->>'matched_core_term' as core_match,
  metadata->>'matched_known_term' as known_match,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct
FROM debug_logs
WHERE action = 'route_decision'
  AND created_at > '2026-01-16T03:29:00Z'
GROUP BY 1, 2
ORDER BY count DESC;
```

### SSR Snapshot Prerequisite (Criterion 5)
**Status:** ✅ Implemented (2026-01-15)

Implementation checklist:
- [x] SSR embed a snapshot of knownTerms for cold start (`app/layout.tsx`)
- [x] Add `version`/`hash` field to snapshot (`v1:sha256hash`)
- [x] Add TTL staleness guard (7 days)
- [x] Test: fresh session without cache still routes correctly (2026-01-15)

**Files:**
- `lib/docs/known-terms-snapshot.ts` - Server-side snapshot builder
- `app/providers/known-terms-provider.tsx` - Client init from snapshot
- `app/layout.tsx` - SSR injection
- `lib/docs/known-terms-client.ts` - `initFromSnapshot()` function

**See:** `knownterms-ssr-snapshot-plan.md` for full details

### Acceptance Criteria
- [ ] All 5 telemetry criteria pass (query above)
- [x] SSR snapshot implemented and tested (2026-01-15)
- [ ] No routing path depends on `CORE_APP_TERMS`
- [ ] No cache-miss scenarios in production

### Coverage Gap Resolution Process

**Step 1: Verify data quality before interpreting gaps**
- [ ] Volume ≥ 100 events
- [ ] NULL/NULL rate < 5% (or filter to main routing paths only)
- [ ] Terms loaded ≥ 95%

**Step 2: Identify gap tokens**
```sql
-- List tokens causing core=true AND known=false
SELECT
  metadata->>'normalized_query' as query,
  metadata->>'fuzzy_matched' as fuzzy_saved,
  metadata->>'fuzzy_match_term' as corrected_to,
  COUNT(*) as count
FROM debug_logs
WHERE action = 'route_decision'
  AND metadata->>'matched_core_term' = 'true'
  AND metadata->>'matched_known_term' = 'false'
GROUP BY 1, 2, 3
ORDER BY count DESC;
```

**Step 3: Classify each gap into buckets**

| Bucket | Action | Example |
|--------|--------|---------|
| No docs intended | Remove from CORE_APP_TERMS | "canvas" if no canvas doc planned |
| Inflection gap | Add alias to knownTerms/keywords | "action" → add "action" keyword |
| Real missing doc | Add doc or decide handling | "folder" → create folder.md |

**Step 4: Track fuzzy-rescued cases separately**
- Don't exclude from gap count (they still indicate coverage gaps)
- Note which tokens were corrected and whether fuzzy is reliable fallback
- Example: "action" → "actions" (fuzzy distance=1, reliable)

**Step 5: Re-run after each change**
- Verify gap list shrinks
- Confirm no new gaps introduced
- Update this section with results

### Current Gap Status (2026-01-15)

| Token | Count | Fuzzy Saved? | Bucket | Resolution |
|-------|-------|--------------|--------|------------|
| action | 1 | ✅ Yes → actions | Inflection | Fuzzy handles; optionally add alias |

**NULL/NULL Note:** 35% of events are NULL/NULL because meta-explain and follow-up paths don't set these fields. This is expected - those paths don't depend on CORE_APP_TERMS. Consider filtering to main routing paths (`matched_pattern_id IN ('ROUTE_DOC_STYLE', 'ROUTE_BARE_NOUN', 'ROUTE_APP_RELEVANT', 'ROUTE_CORE_TERMS')`) for cleaner metrics.

---

## TD-3: Consolidate Pattern Matching
### Status: ✅ COMPLETE (2026-01-14)

### Why
Reduce pattern drift and make changes safer.

### Plan
- Move all routing regex/patterns into `lib/chat/query-patterns.ts`.
- Expose a single `normalizeQuery()` API for routing helpers.
- Add a regression test table with common phrases.

### Implementation
- Created `lib/chat/query-patterns.ts` with all consolidated patterns
- Updated `components/chat/chat-navigation-panel.tsx` to import from the new module
- Removed 15+ duplicate function definitions from the component
- Created regression test suite: `__tests__/chat/query-patterns.test.ts` with 188 tests

### Exported API
- **Pattern constants**: AFFIRMATION_PATTERN, REJECTION_PATTERN, QUESTION_START_PATTERN, COMMAND_START_PATTERN, ACTION_NOUNS, DOC_VERBS, POLITE_COMMAND_PREFIXES, META_PATTERNS, RESHOW_PATTERNS, BARE_META_PHRASES
- **Normalization**: normalizeInputForRouting, normalizeTitle, normalizeTypos, stripConversationalPrefix, startsWithAnyPrefix
- **Detection**: isAffirmationPhrase, isRejectionPhrase, isCorrectionPhrase, isPronounFollowUp, hasQuestionIntent, hasActionVerb, containsDocInstructionCue, looksIndexLikeReference, isMetaPhrase, matchesReshowPhrases, isMetaExplainOutsideClarification, isCommandLike, isNewQuestionOrCommand
- **Extraction**: extractMetaExplainConcept, extractDocQueryTerm
- **Response style**: getResponseStyle
- **Main API**: classifyQueryIntent, normalizeQuery

### Regression Table (Examples - All tested)
- `what is workspace` → explain ✓
- `can you tell me what are actions` → explain ✓
- `open notes` → action ✓
- `tell me more` → followup ✓
- `hello` → unknown ✓

### Acceptance Criteria
- [x] All patterns defined in one module (`lib/chat/query-patterns.ts`)
- [x] Test suite validates 188 common phrases and patterns
- [x] Component imports from consolidated module
- [x] Type-check passes

---

## TD-2: Gated Typo Tolerance
### Status: ✅ COMPLETE (2026-01-15)

### Why
Fix common typos without flooding routing with false positives.

### Plan
- Fuzzy match only if no exact match.
- Require token length ≥ 5 and max distance ≤ 2.
- Only match against `knownTerms`.
- Log fuzzy hits for tuning.

### Implementation
- Added `findFuzzyMatch`, `findAllFuzzyMatches`, `hasFuzzyMatch` to `lib/chat/query-patterns.ts`
- **Fix 1 (Routing):** Integrated into `routeDocInput` as fallback after exact match fails
- **Fix 2 (Clarification):** Added fuzzy check to `isNewQuestionOrCommandDetected` to escape clarification mode
- **Fix 3 (Retrieval):** Applied fuzzy correction to query before calling retrieval API
- Added telemetry fields: `fuzzy_matched`, `fuzzy_match_token`, `fuzzy_match_term`, `fuzzy_match_distance`
- Added 16 unit tests covering all guardrails
- See: `2026-01-15-td2-fuzzy-matching-implementation-report.md` for full details

### Acceptance Criteria
- [x] `workspac` → `workspace` (verified, distance=1)
- [x] `wrkspace` → `workspace` (verified, distance=1)
- [x] `note` does NOT fuzzy-match (length 4 < min 5)
- [ ] False positive rate < 1% (via telemetry) - *requires data collection*

### Files Modified
- `lib/chat/query-patterns.ts` - Added fuzzy matching functions
- `lib/chat/typo-suggestions.ts` - Exported `levenshteinDistance`
- `lib/chat/routing-telemetry.ts` - Added fuzzy telemetry fields
- `components/chat/chat-navigation-panel.tsx` - Integrated fuzzy into routing + telemetry
- `__tests__/chat/query-patterns.test.ts` - Added 16 fuzzy matching tests

---

## TD-7: Stricter App-Relevance Fallback
### Status: ✅ COMPLETE (2026-01-16)

### Why
Reduce false routes for marginally relevant queries.

### Plan (Low-risk)
- Require intent cue + app keyword for fallback routing.
- Limit stricter checks to high-ambiguity terms first (e.g., `home`, `notes`).
- If borderline, ask one clarifying question (2 options max).
- Roll out behind a feature flag for gradual exposure.

### Implementation (2026-01-16)
- ✅ Added `HIGH_AMBIGUITY_TERMS` constant (5 terms: home, notes, note, action, actions)
- ✅ Added `getHighAmbiguityOnlyMatch()` and `hasExplicitIntentCue()` helpers
- ✅ Feature flag: `NEXT_PUBLIC_STRICT_APP_RELEVANCE_HIGH_AMBIGUITY`
- ✅ Updated `routeDocInput()` Step 6 (bare noun) and Step 7 (app-relevant fallback)
- ✅ Added clarification handling with 2 options: "[Term] (App)" and "Something else"
- ✅ Telemetry fields: `strict_app_relevance_triggered`, `strict_term`
- ✅ Pattern ID: `CLARIFY_HIGH_AMBIGUITY`

### Files Modified
- `lib/chat/query-patterns.ts` - Added HIGH_AMBIGUITY_TERMS, helper functions
- `lib/chat/routing-telemetry.ts` - Added telemetry fields and pattern ID
- `lib/chat/chat-navigation-context.tsx` - Added TD7ClarificationData type
- `components/chat/chat-navigation-panel.tsx` - Routing logic and clarification handling

### Acceptance Criteria
- [x] High-ambiguity bare nouns trigger clarification (when flag enabled)
- [x] Doc-style queries bypass clarification (intent cue present)
- [x] Action commands bypass clarification
- [ ] "I love workspace music" does NOT route to docs. *(Note: workspace not in initial HIGH_AMBIGUITY_TERMS list; will be added based on telemetry)*
- [x] "what is workspace" still routes correctly.

### References
- **Spec:** `td7-stricter-app-relevance-plan.md`
- **Implementation Report:** `reports/2026-01-16-td7-implementation-report.md`

---

## TD-5: Follow-up Guard Edge Case (Conditional)
### Why
Polite follow-ups can be misclassified as new questions.

### Plan
- Monitor for frequency via telemetry.
- If common, add `POLITE_FOLLOWUP_PATTERN` to treat as follow-up.

### Acceptance Criteria
- "can you tell me more?" treated as follow-up.
- "can you explain what is workspace?" treated as new question.

---

## TD-6: LLM Intent Extraction (Optional)
### Why
Only if patterns remain too brittle after the above.

### Plan
- Prototype a lightweight classifier for borderline cases only.
- Measure latency and cost before rollout.

### Acceptance Criteria
- Clear latency/cost report.
- A/B test shows improved resolution without regressions.

---

## TD-9: Cross-Doc Ambiguity Override (Already Implemented)
### Why
Same-doc tie collapse can hide a distinct doc that scores equally well.

### Status
Implemented in `lib/docs/keyword-retrieval.ts` (cross-doc candidate check before same-doc collapse).

### Guardrail
If top two results are same-doc and a distinct doc exists within `MIN_GAP`, return ambiguous with pills.

## TD-8: Don't Lock State on Weak (Doc Follow-ups)
### Status: ✅ COMPLETE (2026-01-15)

### Why
Weak clarifications can lock the user into the wrong doc and make follow-ups expand the wrong content.

### Plan
- Only set `lastDocSlug` when the retrieval is confident or when the user explicitly confirms.
- If the result is `weak`, avoid setting follow-up state unless the user selects a pill or confirms.

### Implementation
- General doc retrieval: weak results show confirmation pill, don't set `lastDocSlug`
- Meta-explain path: added `isConfidentResult` check, only set `lastDocSlug` for `found` status
- Ambiguous results: don't set `lastDocSlug` until pill selection

### Acceptance Criteria
- [x] After a weak clarification, "tell me more" re-queries instead of expanding a guessed doc.
- [x] After a pill selection, follow-ups expand the selected doc.
- [x] Do not set `lastDocSlug` on ambiguous results; only set after pill selection.
- [ ] Telemetry shows weak→followup misroute rate decreases. *(requires data collection)*

## Risks & Mitigations
- Pattern changes can regress routing → regression tests + telemetry.
- Snapshot staleness → version/hash + TTL.
- Fuzzy matching too permissive → strict guardrails + logging.

## Deliverables
- Telemetry event schema + dashboard query.
- `query-patterns` module + tests.
- knownTerms preload + CORE_APP_TERMS removal.

