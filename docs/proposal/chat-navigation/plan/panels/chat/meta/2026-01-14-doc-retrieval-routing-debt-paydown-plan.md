****# Plan: Doc Retrieval Routing Debt Paydown

**Date:** 2026-01-14
**Status:** Proposal
**Feature Slug:** `chat-navigation`
**Source Debt Doc:** `docs/proposal/chat-navigation/plan/panels/chat/meta/technical-debt/2026-01-14-doc-retrieval-routing-debt.md`

## Goals
- Reduce pattern fragility without regressing "human feel".
- Remove duplicate app-term lists and cache-miss routing drift.
- Add durable telemetry for tuning and regression detection.

## Non-Goals
- Replacing deterministic routing with always-on LLM intent extraction.
- Large retrieval model changes or embeddings rollout.

## Execution Order (Low-Risk First)
1) TD-4: Durable routing telemetry
2) TD-8: Don't lock state on weak (doc follow-ups)
3) TD-1: Remove CORE_APP_TERMS duplication
4) TD-3: Consolidate routing patterns
5) TD-2: Gated typo tolerance (fuzzy match)
6) TD-7: Stricter app-relevance fallback
7) TD-5: Polite follow-up guard (only if telemetry shows need)
8) TD-6: LLM intent extraction (optional, last)
9) TD-9: Cross-doc ambiguity override (already implemented)

---

## TD-4: Durable Telemetry (First)
### Why
We need data to validate routing changes and avoid regressions.

### Plan
- Introduce a single stable event: `doc_routing_decision`.
- Define `matched_pattern_id` as a stable enum (e.g., `DEF_WHAT_IS`, `FOLLOWUP_TELL_ME_MORE`).
- Persist to analytics store (not only console).

### Event Schema (minimum viable)
- `input_len`
- `normalized_query`
- `route_deterministic`
- `route_final`
- `matched_pattern_id` (stable enum)
- `known_terms_loaded`
- `classifier_called`
- `classifier_confidence`
- `classifier_timeout`
- `doc_status` (found|weak|ambiguous|no_match)
- `doc_slug_top`
- `doc_slug_alt[]`
- `followup_detected`
- `last_doc_slug_present`
- `user_corrected_next_turn`

### Acceptance Criteria
- Routing events persisted and queryable.
- Dashboard view of route distribution and LLM fallback rate.
- `matched_pattern_id` enum documented and stable across releases.

---

## TD-1: Remove CORE_APP_TERMS Duplication
### Why
Avoid divergence between hardcoded terms and docs database.

### Plan
- Preload `knownTerms` at app startup and keep in memory for session.
- SSR embed a snapshot for cold start (required).
- Remove `CORE_APP_TERMS` once knownTerms is guaranteed available.
- Dependency: TD-4 telemetry live so cache-miss rate can be verified before removal.

### Staleness Guard
- Embed a `version`/`hash` with the snapshot.
- Expire snapshot after a fixed TTL (e.g., 7 days).

### Acceptance Criteria
- No routing path depends on `CORE_APP_TERMS`.
- No cache-miss scenarios in production.

---

## TD-3: Consolidate Pattern Matching
### Why
Reduce pattern drift and make changes safer.

### Plan
- Move all routing regex/patterns into `lib/chat/query-patterns.ts`.
- Expose a single `normalizeQuery()` API for routing helpers.
- Add a regression test table with common phrases.

### Regression Table (Examples)
- `what is workspace` → explain
- `can you tell me what are actions` → explain
- `open notes` → action
- `tell me more` → follow-up
- `hello` → unknown

### Acceptance Criteria
- All patterns defined in one module.
- Test suite validates 20+ common phrases.

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
### Why
Weak clarifications can lock the user into the wrong doc and make follow-ups expand the wrong content.

### Plan
- Only set `lastDocSlug` when the retrieval is confident or when the user explicitly confirms.
- If the result is `weak`, avoid setting follow-up state unless the user selects a pill or confirms.

### Acceptance Criteria
- After a weak clarification, “tell me more” re-queries instead of expanding a guessed doc.
- After a pill selection, follow-ups expand the selected doc.

## Risks & Mitigations
- Pattern changes can regress routing → regression tests + telemetry.
- Snapshot staleness → version/hash + TTL.
- Fuzzy matching too permissive → strict guardrails + logging.

## Deliverables
- Telemetry event schema + dashboard query.
- `query-patterns` module + tests.
- knownTerms preload + CORE_APP_TERMS removal.
