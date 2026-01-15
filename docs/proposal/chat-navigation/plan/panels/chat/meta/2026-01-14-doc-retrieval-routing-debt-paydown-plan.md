# Plan: Doc Retrieval Routing Debt Paydown

**Date:** 2026-01-14
**Updated:** 2026-01-14
**Status:** In Progress
**Feature Slug:** `chat-navigation`
**Source Debt Doc:** `docs/proposal/chat-navigation/plan/panels/chat/meta/technical-debt/2026-01-14-doc-retrieval-routing-debt.md`
**Implementation Reports:**
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-15-knownterms-race-fix-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-15-td4-td8-implementation-report.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-01-14-td3-implementation-report.md`

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
4) TD-1: Remove CORE_APP_TERMS duplication — *waiting for telemetry data*
5) TD-2: Gated typo tolerance (fuzzy match)
6) TD-7: Stricter app-relevance fallback
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
### Status: ⏳ Collecting Telemetry (2026-01-15 → 2026-01-18)

### Why
Avoid divergence between hardcoded terms and docs database.

### Plan
- Preload `knownTerms` at app startup and keep in memory for session.
- SSR embed a snapshot for cold start (required).
- Remove `CORE_APP_TERMS` once knownTerms is guaranteed available.
- Dependency: TD-4 telemetry live so cache-miss rate can be verified before removal.

### Current State
- ✅ Race condition fixed: `await fetchKnownTerms()` with 2s timeout in sendMessage
- ✅ Telemetry instrumented: `matched_core_term` + `matched_known_term` fields added
- ⏳ Data collection: Started 2026-01-15T20:40:00Z, need 48-72 hours

### TD-1 Analysis Query
```sql
SELECT
  metadata->>'matched_core_term' as core_match,
  metadata->>'matched_known_term' as known_match,
  COUNT(*) as count
FROM debug_logs
WHERE action = 'route_decision'
  AND created_at > '2026-01-15T20:40:00Z'
GROUP BY 1, 2
ORDER BY count DESC;
```

**Decision criteria:** CORE_APP_TERMS can be removed when `core_match=true AND known_match=false` is rare/never (proves knownTerms covers all cases).

### Staleness Guard
- Embed a `version`/`hash` with the snapshot.
- Expire snapshot after a fixed TTL (e.g., 7 days).

### Acceptance Criteria
- No routing path depends on `CORE_APP_TERMS`.
- No cache-miss scenarios in production.

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
### Why
Fix common typos without flooding routing with false positives.

### Plan
- Fuzzy match only if no exact match.
- Require token length ≥ 5 and max distance ≤ 2.
- Only match against `knownTerms`.
- Log fuzzy hits for tuning.

### Acceptance Criteria
- `workspac` → `workspace`
- `wrkspace` → `workspace`
- `note` does NOT fuzzy-match (length 4)
- False positive rate < 1% (via telemetry)

---

## TD-7: Stricter App-Relevance Fallback
### Why
Reduce false routes for marginally relevant queries.

### Plan (Low-risk)
- Require intent cue + app keyword for fallback routing.
- Limit stricter checks to high-ambiguity terms first (e.g., `home`, `notes`).
- If borderline, ask one clarifying question (2 options max).
- Roll out behind a feature flag for gradual exposure.

### Acceptance Criteria
- "I love workspace music" does NOT route to docs.
- "what is workspace" still routes correctly.

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


