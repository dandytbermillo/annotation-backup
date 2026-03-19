# Stage 6x.8 Phase 5 Addendum — Wrapper-Heavy Retrieval Recall

## Summary

Refine Phase 5 so retrieval-backed semantic memory remains a hinting layer, but the bounded LLM handles the panel-normalized user query whenever deterministic and semantic retrieval do not confidently resolve. The system should stop trying to predict every wrapper-heavy phrasing variant as the primary strategy.

This addendum applies to the existing Phase 5 path in [stage6x8-phase5-retrieval-backed-semantic-memory-plan.md](/Users/dandy/Downloads/annotation_project/annotation-backup/docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-retrieval-backed-semantic-memory-plan.md).

Anti-pattern applicability: **not applicable**. This is retrieval-recall refinement, not provider/reactivity work.

## Problem

Current Phase 5 retrieval works for exact seeded phrasings like:
- `take me home`
- `return home`
- `what did I just do?`

But wrapper-heavy variants can miss retrieval entirely, for example:
- `hey take me home`
- `hi take me home`
- `take me home now pls`
- `please what did I just do? thanks`

When retrieval returns no candidate or only weak candidates:
- Phase 5 hinting provides little or no useful evidence
- the system becomes too dependent on retrieval heuristics and wrapper handling
- the user can receive unrelated disambiguation or clarifier output unless the panel-normalized query reaches the bounded LLM

This is a **retrieval recall** problem, not a missing-seed problem.

## Existing Seed Coverage

The canonical intents are already seeded for the v1 cases discussed here:
- `go home`
- `take me home`
- `return home`
- `what did I just do?`
- `what was my last action?`
- `remind me what I just did`

So the required improvement is:
- keep retrieval available as semantic evidence
- but stop requiring retrieval to understand every harmless user phrasing variant before the bounded LLM can help

## Goal

Improve Phase 5 robustness for wrapper-heavy and conversationally varied queries while keeping the current Phase 5 safety model intact:
- retrieval remains hint-only evidence
- bounded LLM interprets the panel-normalized user query only as a bounded fallback when retrieval did not resolve sufficiently
- live validation still controls execution
- committed state still controls history/info answers

## Proposed Change

### 1. Retrieval stays hint-only, not the primary recovery mechanism

Phase 5 should continue to:
- check deterministic / local rescue first
- consult semantic retrieval for:
  - exact hits
  - semantically similar seeded or learned exemplars
- pass any retrieved hints forward as optional evidence

But retrieval must no longer be treated as the gate that has to understand every harmless phrasing variant before the bounded LLM can act.

### 2. Keep retrieval-only normalization narrow and secondary

Before embedding the query for Phase 5 hint retrieval, derive a **retrieval-normalized query** that strips harmless conversational wrappers and suffix fillers that do not change intent.

This normalization is for:
- Phase 5 hint retrieval only
- specifically, only for Phase 5 semantic-lookup calls that send `intent_scope`

It is not for:
- direct execution
- direct deterministic routing
- overwriting the raw stored user query
- legacy Stage 5/B2 semantic replay calls that do not send `intent_scope`

The raw user query must still be preserved for:
- logs
- writeback exemplars
- telemetry
- UI display

The retrieval layer should also record normalization telemetry sufficient to debug recall behavior:
- `raw_query_text`
- `retrieval_query_text`
- `retrieval_normalization_applied: boolean`

Fingerprint/cache ownership rule:
- Phase 5 hint-lookup fingerprinting and embedding-cache reuse should key off `retrieval_query_text`, because that is the text actually embedded for retrieval
- raw-query logging and writeback exemplar storage must continue to preserve the original user query separately
- this addendum must not change the legacy Stage 5/B2 no-`intent_scope` fingerprint behavior
- if a raw-query embedding retrieval pass is used in addition to the normalized pass, the raw pass must use its own raw-query fingerprint/cache key derived from the standard storage-normalized query text before wrapper stripping
- telemetry must distinguish:
  - raw-query embedding pass
  - normalized-query embedding pass
  - exact-hit shortcut

### 3. Scope of allowed normalization

Allowed normalization should be intentionally narrow.

Normalization may remove only anchored leading wrappers and anchored trailing filler bundles.
It must not strip or rewrite internal words from the middle of the query.

Safe examples:
- leading wrappers:
  - `hey`
  - `hi`
  - `hello`
  - `assistant`
  - `please`
  - `ok`
  - `okay`
  - `um`
  - `uh`
- trailing fillers:
  - `thanks`
  - `thank you`
  - `thx`
  - `pls`
  - `please`
  - allowed removable trailing filler bundles may include a time-softener only when it is part of a clearly non-semantic politeness tail, e.g.:
    - `now pls`
    - `now please`
  - bare `now` is not removable by itself
  - rationale: retrieval normalization may remove clearly non-semantic politeness bundles, but it must not strip standalone temporal wording that could change interpretation
  - edge-case note: `take me home now` must remain distinct from `take me home`; bare `now` can signal urgency or otherwise change the request in ways retrieval normalization must not erase
- punctuation-only cleanup:
  - repeated `?`, `!`, commas, extra spaces

This should mirror the same wrapper-removal principle already used in local semantic detection, but only for retrieval input.

### 4. Example retrieval-normalization behavior

#### Positive examples
- `hey take me home` -> `take me home`
- `hi take me home` -> `take me home`
- `take me home now pls` -> `take me home`
- `please what did I just do? thanks` -> `what did I just do?`
- `assistant what was my last action?` -> `what was my last action?`

#### Non-examples
- `take me to budget100` -> do not normalize into `take me home`
- `did I go home?` -> do not normalize into `go home`
- `go home and open recent` -> do not collapse into single-intent `go home`
- `take me home if I'm not already there` -> keep semantic interpretation intact

Rationale for non-examples:
- `take me to budget100` is target-bearing and must preserve its explicit destination
- `did I go home?` is a history/verification question, not a `go_home` action request
- `go home and open recent` is compound and must not be reduced to a single action
- `take me home if I'm not already there` is conditional and must remain in the semantic interpretation path

## Guardrails

### 1. No direct execution from normalized text
The normalized retrieval text must not itself authorize:
- `go_home`
- `open_entry`
- `open_panel`
- any other action

It is only an aid to retrieve a better semantic hint candidate.

### 2. Do not over-normalize long or compound queries
If the query is:
- clearly multi-intent
- conditional
- target-bearing in a meaningful way
- semantically altered by wrapper removal

then retrieval normalization must stay conservative and allow the bounded LLM / clarifier path to do the real interpretation.

### 3. Preserve current Phase 5 truth model
This addendum does not change:
- hint-only retrieval semantics
- navigate-route validation
- current entity/workspace/panel validation
- committed session-state answer sources for `history_info`

### 4. Raw-query bounded LLM is the intended fallback
If deterministic and semantic retrieval do not confidently resolve the query, Phase 5 should send the **panel-normalized user query** to the bounded LLM along with:
- current live context
- any retrieved semantic hints that do exist
- current validation boundaries

This is the intended recovery path for conversational phrasing that retrieval does not capture cleanly.

Terminology note:
- `raw user query` still refers to the original user text preserved for logging, UI display, telemetry, and writeback exemplars
- `panel-normalized user query` refers to the message actually forwarded from the panel to the navigate API after UI-level conversational-prefix cleanup
- this addendum treats the panel-normalized user query, not the literal raw query string, as the bounded-LLM fallback input contract

### 5. Semantic retrieval remains the default cost-saving path
The intended cost-saving order remains:
1. deterministic / local rescue
2. exact-hit shortcut
3. semantic retrieval
4. bounded LLM fallback only when the earlier steps did not resolve sufficiently
5. live validation

This addendum does not convert the bounded LLM into the default path for all Phase 5 requests.

### 6. True no-LLM completion path
Phase 5 should preserve a real no-LLM path for cases where semantic retrieval is already sufficient.

Examples:
- exact-hit or strong unambiguous retrieval for a v1-safe intent where the existing validated resolver can already produce the outcome
- structured history/info answers that can already be produced from committed state
- validated navigation outcomes that do not need extra language interpretation

In those cases:
- do not call the bounded LLM
- use the existing resolver / validator path directly
- keep routing and telemetry explicit that no LLM fallback was needed

### 7. No further wrapper-expansion as the primary strategy
Do not keep extending retrieval with more wrapper-specific rules as the main solution.

Further improvements should prefer:
- raw-query bounded LLM interpretation
- current-context validation
- clarification on genuine ambiguity

over:
- predicting more prefix/suffix variants
- relying on normalization to rewrite every harmless phrasing pattern

## Preferred Implementation Shape

### Option A — Deterministic, then retrieval hints, then panel-normalized-query bounded LLM
Preferred end-state.

Phase 5 handling should be:
1. deterministic / local rescue
2. exact-hit shortcut when available
3. semantic retrieval for hint candidates
4. if exact-hit or strong unambiguous retrieval is already sufficient for an existing validated resolver, complete without the bounded LLM
5. if retrieval is strong but still benefits from bounded interpretation, pass the panel-normalized query plus hint(s) into the bounded LLM
6. if retrieval is weak or empty, pass the **panel-normalized user query** into the bounded LLM with any available hints
7. if retrieval is near-tied across conflicting actions or targets, clarify directly unless policy explicitly allows bounded-LLM comparison for that tie class
8. validate the resulting intent against current truth
9. answer, execute, or clarify

Rationale:
- retrieval helps when it works
- exact and strong retrieval can still save LLM calls
- bounded LLM sees the panel-normalized sentence from the UI layer instead of a retrieval-normalized guess
- validation remains the execution authority

### Option A1 — Confidence handoff from retrieval to bounded LLM
Retrieval should not block the LLM from helping.

Expected behavior:
1. deterministic/local rescue runs first
2. exact-hit and semantic retrieval run next
3. retrieval returns:
   - candidate list
   - confidence / near-tie metadata
4. if retrieval is already sufficient for a validated structured outcome:
   - do not call the bounded LLM
   - resolve through the existing structured path
5. if retrieval is not confidently decisive:
   - call the bounded LLM on the panel-normalized user query
   - include retrieval hints as optional evidence, not as a requirement

### Option A1a — Concrete handoff thresholds
Unless a future slice explicitly changes them, this addendum inherits the current Phase 5 retrieval thresholds:
- `navigation` hint floor: `0.85`
- `history_info` hint floor: `0.80`
- near-tie threshold: `0.03`

Interpretation:
- exact hit -> no embedding, and no bounded LLM unless the downstream resolver still requires bounded interpretation
- top candidate above the applicable floor with no near-tie -> eligible for direct validated resolution or bounded-LLM-assisted resolution, depending on the existing resolver path
- top candidate below the applicable floor -> retrieval is weak; bounded LLM fallback may run on the panel-normalized user query
- near-tie within `0.03` -> do not treat retrieval as decisive
- until a separate policy explicitly defines allowed near-tie comparison classes, the allowed set is empty and direct clarification is required

### Option A2 — Exact-hit shortcut before embedding
For Phase 5 requests with `intent_scope`, keep a cheap exact-hit shortcut before calling the embedding service.

Expected behavior:
1. derive `retrieval_query_text`
2. compute the retrieval fingerprint from that text
3. check for exact Phase 5 matches in the appropriate hint pools:
   - learned rows for the current runtime user
   - curated-seed rows in the curated partition
4. if an exact hit exists:
   - return the Phase 5 candidate directly
   - skip embedding generation
   - skip vector similarity search
5. only fall back to embedding + vector search when no exact Phase 5 hit exists

Guardrails:
- this shortcut applies only to Phase 5 hint lookups with `intent_scope`
- it must not alter legacy Stage 5/B2 no-`intent_scope` behavior
- exact Phase 5 hits remain hint-only, not direct execution authority
- raw-query logging and writeback semantics remain unchanged
- retrieval-normalized exact hits must respect the same scope boundaries as the vector path:
  - `history_info` -> `info_intent`
  - `navigation` -> `action_intent`
- exact-hit shortcut must preserve the parent Phase 5 context policy:
  - learned `navigation` rows still require current-context compatibility
  - `history_info` exact hits do not require strict current-context compatibility
  - curated navigation seeds remain hint-only and may participate without exact current-context compatibility
- exact-hit shortcut must still honor clarified-exemplar restrictions:
  - clarified exemplars may not be treated as direct high-confidence precedents just because the normalized retrieval text matches exactly
  - if a matched exact row is marked as clarification-required, it must still be down-ranked or restricted to clarification assistance per the parent Phase 5 plan
- exact-hit path should emit dedicated observability fields so cost and behavior can be verified:
  - `phase5_exact_hit_used: boolean`
  - `phase5_exact_hit_source: learned | curated_seed`
  - exact-hit usage must be distinguishable from embedding/vector retrieval in Phase 5 telemetry

### Option A3 — Retrieval confidence only influences hint strength
Whether retrieval uses:
- exact-hit
- raw-query embedding retrieval
- normalized-query embedding retrieval

the result should only influence:
- which hints are sent to the bounded LLM
- how strongly the system trusts retrieval before asking the LLM to interpret the raw query

It should not become the main place where wrapper-heavy language is forced into intent meaning.

### Option B — Additional wrapper-heavy curated seeds
Acceptable only as a secondary reinforcement.

Examples:
- `hey take me home`
- `hi take me home`
- `take me home now pls`
- `please what did I just do? thanks`

This should not be the primary strategy because it does not scale as well as letting the bounded LLM read the raw query when retrieval is weak.

If Option B is used, the added variants must still go through the existing curated-seed contract:
- same curated-seed ingest script or privileged seeding path
- same normalization + embedding pipeline
- same `scope_source = 'curated_seed'` partition
- same reserved curated-seed `user_id`

## Tests

### Unit / API
- Phase 5 exact hint lookup returns a candidate without embedding when `retrieval_query_text` exactly matches a stored Phase 5 row
- exact-hit or strong unambiguous retrieval can resolve through the existing validated path without bounded LLM fallback
- bounded LLM receives the **panel-normalized user query** when retrieval is:
  - empty
  - weak
- near-tied only when policy allows bounded comparison instead of direct clarification
- until such a policy exists, near-tied retrieval must clarify directly
- retrieved hints, when present, are passed to the bounded LLM as optional evidence
- legacy Stage 5/B2 no-`intent_scope` path remains unchanged

### Negative tests
- retrieval does not incorrectly map:
  - `did I go home?` -> `go_home`
  - `go home and open recent` -> single-intent `go_home`
  - `take me to budget100` -> `go_home`
  - `take me home now` -> `take me home`
- learned navigation exact-hit + context mismatch does not reuse the row as an exact Phase 5 hit
- exact normalized hit on a clarification-required exemplar does not behave like a direct unrestricted exact hit
- retrieval misses do not block the bounded LLM from seeing the panel-normalized user query
- strong retrieval does not automatically force bounded LLM fallback when an existing validated resolver can already finish safely
- near-tie across conflicting actions or conflicting targets clarifies directly instead of silently escalating to bounded LLM by default
- bounded LLM fallback still cannot bypass current validation
- wrapper-heavy phrasing is not handled by adding new execution regex

### Smoke tests
- `pls take me home`
- `pls take me home now pls`
- `hey take me home`
- `hi take me home`
- `take me home now pls`
- `please what did I just do? thanks`
- `hello can you take me home?`
- `can you pls return home`
- regression checks:
  - `take me home`
  - `return home`
  - `what did I just do?`
  - `what was my last action?`

## Acceptance

This addendum is successful when:
- retrieval continues to provide helpful seeded or learned hints when available
- exact Phase 5 hint matches do not call the embedding service unnecessarily
- exact-hit and strong unambiguous retrieval still preserve a real no-LLM cost-saving path when the existing validated resolver already suffices
- when retrieval is not confidently decisive, the bounded LLM receives the panel-normalized user query and current context instead of the system trying to predict more wrapper variants first
- bounded LLM remains the fallback rather than the default path for all Phase 5 requests
- wrapper-heavy conversational phrasing can still resolve without requiring dedicated retrieval rules for each variant
- no new direct execution path is introduced
- exact current working cases remain unchanged
- multi-intent and target-changing queries are not over-normalized into incorrect single-intent actions

## Decision

Use this addendum to extend Phase 5.

Do not create a separate routing lane.
Do not solve this with new execution regex.
Do not treat wrapper normalization as an execution authority.
Do not rely on wrapper enumeration alone when the seeded semantic exemplars should already be reachable through retrieval hints plus panel-normalized-query bounded LLM fallback.
