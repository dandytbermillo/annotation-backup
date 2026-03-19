# Stage 6x.8 Phase 5 Addendum — Wrapper-Heavy Retrieval Recall

## Summary

Refine Phase 5 retrieval-backed semantic memory so harmless wrapper-heavy variants can retrieve already-seeded exemplars without adding new execution regex or bypassing current validation.

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

When retrieval returns no candidate:
- Phase 5 hinting does not activate
- the bounded LLM falls back to normal routing
- the user can receive unrelated disambiguation or clarifier output

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
- better retrieval of already-seeded semantic exemplars for harmless wrapper-heavy variants

## Goal

Improve retrieval recall for wrapper-heavy but semantically unchanged queries while keeping the current Phase 5 safety model intact:
- retrieval remains hint-only
- bounded LLM still interprets the query
- live validation still controls execution
- committed state still controls history/info answers

## Proposed Change

### 1. Add retrieval-only normalization before Phase 5 embedding lookup

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

### 2. Scope of allowed normalization

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

### 3. Example retrieval-normalization behavior

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

## Preferred Implementation Shape

### Option A — Exact-hit, then raw-query retrieval, then normalized-query retrieval
Preferred first step.

Phase 5 lookup should:
1. keep `raw_query_text`
2. derive `retrieval_query_text`
3. attempt an exact Phase 5 hint lookup using `retrieval_query_text` first
4. if no exact Phase 5 hit is found, run a **raw-query embedding retrieval** using the standard storage-normalized query text before wrapper stripping
5. if `retrieval_query_text` differs from the standard storage-normalized query text before wrapper stripping, run a **second embedding retrieval** using `retrieval_query_text`
6. merge and rerank candidates from:
   - raw-query embedding retrieval
   - normalized-query embedding retrieval
7. return the merged candidates and telemetry

Rationale:
- raw-query embedding retrieval is the primary semantic recovery path for short noisy variants such as `pls take me home`
- normalized-query retrieval is a secondary assist, not the sole mechanism that must rescue wrapper-heavy phrasing
- this avoids requiring endless wrapper expansion while still preserving the narrow normalization contract above

### Option A2 — Exact-hit shortcut before embedding
For Phase 5 requests with `intent_scope`, add a cheap exact-hit shortcut before calling the embedding service.

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

### Option A3 — Raw-query and normalized-query embedding merge
If the exact-hit shortcut misses, retrieval should not depend on a single vector pass.

Expected behavior:
1. compute an embedding for the raw semantic query text
2. retrieve Phase 5 hint candidates from learned + curated pools using that raw-query embedding
3. if `retrieval_query_text` differs, compute a second embedding for `retrieval_query_text`
4. retrieve candidates again using the normalized-query embedding
5. merge and rerank both result sets

Flow rule:
- exact-hit short-circuits and returns immediately
- merge/rerank applies only after the exact-hit shortcut misses

Merge / rerank order:
- learned candidates outrank curated seeds when the semantic evidence is otherwise comparable
- context-compatible learned navigation rows remain required
- non-clarification-required rows outrank clarification-required rows
- when scores are near-tied, prefer the raw-query pass over the normalized-query pass

Dedupe rule:
- if the same learned row appears in both passes, collapse it to one candidate keyed by `matched_row_id`
- for curated rows without a stable learned-row identity, dedupe by `(intent_id, target_ids, scope_source)`
- after dedupe, keep the strongest surviving candidate record and preserve telemetry about which pass(es) produced it

This keeps the semantic path centered on embeddings instead of forcing wrapper enumeration to do all the work.

### Option A4 — Lower the Phase 5 navigation hint floor
The current navigation hint floor is too strict for short wrapper-heavy variants that are semantically close to seeded home-navigation intents.

Update the Phase 5 hint policy to:
- keep `history_info` at `0.80`
- lower the **navigation hint candidate floor** to approximately `0.85`
- use the same merged-candidate pipeline above before applying that floor

For the v1-safe Phase 5 override intents:
- `go_home`
- `last_action`
- `explain_last_action`
- `verify_action`

allow Phase 5 to proceed to the navigate/history resolver when:
- top hint score meets the scope-specific floor
- there is no near-tie ambiguity requiring clarification

Near-tie rule:
- treat candidates as a near tie when the top-two merged candidates are within `0.03` similarity of each other
- when a near tie exists, do not use the lower-floor Phase 5 override; clarify instead

This change is only for Phase 5 hinting and resolver reachability. It does not authorize direct execution.

### Option B — Additional wrapper-heavy curated seeds
Acceptable only as a secondary reinforcement.

Examples:
- `hey take me home`
- `hi take me home`
- `take me home now pls`
- `please what did I just do? thanks`

This should not be the primary strategy because it does not scale as well as stronger retrieval over the existing semantic seed set.

If Option B is used, the added variants must still go through the existing curated-seed contract:
- same curated-seed ingest script or privileged seeding path
- same normalization + embedding pipeline
- same `scope_source = 'curated_seed'` partition
- same reserved curated-seed `user_id`

## Tests

### Unit / API
- Phase 5 exact hint lookup returns a candidate without embedding when `retrieval_query_text` exactly matches a stored Phase 5 row
- Phase 5 raw-query embedding retrieval returns `go_home` candidate for:
  - `pls take me home`
  - `pls take me home now pls`
- Phase 5 semantic lookup returns `go_home` candidate for:
  - `hey take me home`
  - `hi take me home`
  - `take me home now pls`
- Phase 5 semantic lookup returns `last_action` candidate for:
  - `please what did I just do? thanks`
  - `assistant what was my last action?`
- Phase 5 exact-hit shortcut checks the retrieval-normalized query before calling the embedding service
- Phase 5 merged retrieval prefers:
  - learned over curated when semantic evidence is otherwise comparable
  - raw-query pass over normalized-query pass when scores are near-tied
- Phase 5 merged retrieval dedupes repeated hits across raw-pass, normalized-pass, and exact-hit sources before final reranking
- Phase 5 navigation hints in the `0.85–0.92` range can still reach the navigate resolver for v1-safe intents when there is no near-tie ambiguity
- legacy Stage 5/B2 no-`intent_scope` path remains unchanged

### Negative tests
- retrieval does not incorrectly map:
  - `did I go home?` -> `go_home`
  - `go home and open recent` -> single-intent `go_home`
  - `take me to budget100` -> `go_home`
  - `take me home now` -> `take me home`
- learned navigation exact-hit + context mismatch does not reuse the row as an exact Phase 5 hit
- exact normalized hit on a clarification-required exemplar does not behave like a direct unrestricted exact hit
- lowering the navigation hint floor does not admit unrelated navigation candidates with materially weaker semantic evidence
- near-tie merged candidates still clarify instead of auto-routing
- duplicate raw-pass + normalized-pass hits collapse to one merged candidate instead of double-weighting the same row

### Smoke tests
- `pls take me home`
- `pls take me home now pls`
- `hey take me home`
- `hi take me home`
- `take me home now pls`
- `please what did I just do? thanks`
- regression checks:
  - `take me home`
  - `return home`
  - `what did I just do?`
  - `what was my last action?`

## Acceptance

This addendum is successful when:
- wrapper-heavy variants retrieve the same canonical Phase 5 hints as the seeded base phrasing
- exact Phase 5 hint matches do not call the embedding service unnecessarily
- short noisy variants such as `pls take me home` are recovered by semantic retrieval without requiring a dedicated wrapper seed
- raw-query embedding retrieval remains the primary semantic recall mechanism; normalization is a secondary assist
- merged retrieval makes valid seeded neighbors available to the bounded LLM before unrelated fallback routing can win
- merged retrieval does not double-count the same candidate across exact-hit, raw-pass, and normalized-pass sources
- no new direct execution path is introduced
- exact current working cases remain unchanged
- multi-intent and target-changing queries are not over-normalized into incorrect single-intent actions

## Decision

Use this addendum to extend Phase 5.

Do not create a separate routing lane.
Do not solve this with new execution regex.
Do not treat wrapper normalization as an execution authority.
Do not rely on wrapper enumeration alone when the seeded semantic exemplars should already be reachable through embedding retrieval.
