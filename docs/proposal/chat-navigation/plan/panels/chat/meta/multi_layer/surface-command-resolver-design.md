# Design: Dedicated Surface-Command Resolution Path

## Purpose

Create a dedicated pre-LLM surface resolver for built-in non-note surfaces. It sits alongside the note resolver, not inside the Phase 5 hint pipeline.

## Why

- Phase 5 hints are scoped for history/navigation retrieval and LLM biasing.
- Surface commands need direct resolution from:
  - seeded + learned query rows
  - manifest metadata
  - live UI/container context
- This aligns with Step 4 in `how-it-works.md`, where the surface resolver produces a canonical normalized command shape before execution.

## Placement in Routing

1. B1/B2/Stage 5 stay unchanged for exact/semantic memory and replay.
2. After deterministic note/state shortcuts (Tier 4.2/4.25), before arbiter/LLM:
   - run `resolveSurfaceCommand(...)`
3. If it returns a high-confidence resolved command:
   - execute via surface executor
4. If it returns a medium-confidence candidate hint:
   - continue to arbiter/LLM with structured surface-candidate guidance
5. If it returns unresolved/low-confidence:
   - continue to arbiter/LLM with no interception

This means:
- no regex tier
- no Phase 5 scope dependency
- no LLM needed for obvious validated surface commands
- semantic retrieval is useful even when deterministic execution does not fire

Fallback order:
1. deterministic/app-capable resolution first
2. if deterministic resolution cannot safely resolve, bounded arbiter/LLM is the default next step
3. clarification or other safe fallback only after deterministic routing and bounded arbiter/LLM still cannot resolve safely

## Inputs

```
resolveSurfaceCommand(input, runtimeContext)
```

Where:
- `input`: raw trimmed user text
- `runtimeContext`: built fresh from uiContext and visible surfaces

The resolver retrieves seeded candidates internally via a dedicated server-side lookup.

## Runtime Context

Use the existing shared shape from `lib/chat/surface-manifest.ts`:

- `containerType`
- `activeWorkspaceId`
- `activeEntryId`
- `visibleSurfaceIds`
- `visibleSurfaceTypes`
- `duplicateFamilies`

For multi-instance surfaces later, also derive visible instance labels.

## Seed Source

Use DB query rows as the phrase source of truth.

Each row should carry:

- `surfaceType`
- `containerType`
- `intentFamily`
- `intentSubtype`
- `handlerId`
- `executionPolicy`
- optional:
  - `selectorSpecific`
  - `duplicateFamily`
  - `instanceLabel`
  - `arguments`
  - `typeFilter`
  - `requiresVisibleSurface`
  - `requiresContainerMatch`
  - `sourceKind` (`curated_seed` | `learned_success` | `manifest_fallback`)
  - `successCount`
  - `lastSuccessAt`

The retrieval model is:
- curated seeds define the initial canonical intent neighborhoods
- learned successful rows help the app generalize to nearby paraphrases over time
- neither source executes directly without live validation

Operational policy:
- curated seeds are a controlled, reviewed anchor set maintained through normal development/release work
- production adaptation should come primarily from automatic `learned_success` rows created from validated successful handling
- manual curated-seed expansion should be occasional and intentional, not the default reaction to every production miss

### Learned-row eligibility policy

Learned rows are not arbitrary user text. A row is eligible to participate in lookup only if all of the following are true:

- it was written from a successfully handled surface command
- the final command was validated against live manifest + runtime context
- the turn outcome was successful (`executed` or bounded `answered`, depending on policy)
- the row is not deleted and still within the routing-memory retention policy
- the row carries the same surface metadata contract as curated seeds

Rows must **not** be written or reused when the turn ended in:
- clarification
- bounded error
- cancellation / stop
- user correction / repair in the same resolution window
- unknown or unvalidated target

Clarification is a bridge to later learning, not a successful learning outcome by itself.
The system must not treat:
- `clarifier shown`
- `user answered`

as sufficient for learned-row writeback.

Writeback is allowed only after a later turn or follow-up produces:
- a final validated specific surface resolution
- a successful bounded answer or execution from that validated resolution
- the concrete resolved surface metadata used for execution

For this policy, a qualifying “follow-up” may occur:
- in a later conversational turn
- or within the same interaction window, for example a bounded clarification-pill tap or equivalent follow-up action

The important rule is not turn count by itself. The important rule is that:
- the clarifier alone is not treated as success
- the subsequent follow-up still must produce a final validated specific surface resolution and successful bounded outcome before any learned-row writeback occurs

The original noisy phrasing from a clarification-mediated turn may still be retained as weak evidence,
but it should be stored separately from replay-eligible learned-success rows.

That weak evidence tier may record:
- the original noisy query text
- that clarification or clarification-like recovery was required
- the final validated command it eventually resolved to

Operationally, this weak evidence should live in a non-replay-eligible evidence channel:
- either a separate evidence table / telemetry stream
- or rows in the existing memory store that are explicitly marked as not lookup-eligible

It must not participate in deterministic replay or normal semantic candidate retrieval until promotion occurs.
It should also inherit the same redaction, retention, and privacy rules as other routing-memory or telemetry artifacts, since the original noisy phrasing may contain sensitive user text.

It must not be treated as:
- direct deterministic replay evidence
- proof that the original raw phrasing is already safe to auto-execute

Promotion from weak evidence into a stronger learned-success tier should require repeated validated successes with little or no clarification.
Promotion should also require that:
- the promoted row carries the same validated surface metadata contract as normal learned-success rows
- the noisy phrasing has shown stable alignment with the same final command across multiple turns
- promotion remains reversible through normal cleanup/delete flows if it later proves noisy or misleading

For the first implementation, make this threshold explicit:
- require at least 2 validated successful resolutions of the same noisy phrasing to the same final command
- and at least 1 of those successes must occur without clarification, or with only a minimal confirmation step

This keeps promotion conservative while still allowing noisy phrasing to improve over time.

For this policy, a “minimal confirmation step” should be defined narrowly:
- a short binary confirmation of one already-proposed plausible target
- or a one-tap confirmation of a single bounded suggestion

It should not include:
- a broad open-ended clarifier
- a multi-option disambiguation list
- a follow-up that required the user to restate the target in a more explicit way

For the first slice, implement weak evidence in the existing memory system only if rows can be explicitly marked as non-lookup-eligible.
If that cannot be done cleanly, prefer a separate telemetry/evidence channel rather than overloading replay-eligible routing memory rows.

To avoid noisy rows poisoning retrieval:
- curated seeds remain the strongest base anchors
- learned rows participate only as semantic support
- implementation should bias curated seeds above equally scored learned rows
- implementation may require `successCount >= 2` before a learned row becomes lookup-eligible, or apply an equivalent confidence gate
- stale learned rows should decay by recency and remain removable through normal memory cleanup/delete flows

## Seed Retrieval

### Who retrieves seeds

The resolver calls a **dedicated server-side API route**: `POST /api/chat/surface-command/lookup`

This route:
1. Normalizes the input text via `normalizeForStorage()` (`lib/chat/routing-log/normalization`)
2. Computes an embedding via `computeEmbedding()` (`lib/chat/routing-log/embedding-service`)
3. Queries `chat_routing_memory_index` for rows where:
   - `tenant_id = 'default'` (Option A tenant from `OPTION_A_TENANT_ID`)
   - `intent_id LIKE 'surface_manifest:%'`
   - `is_deleted = false`
   - `semantic_embedding IS NOT NULL`
   - source is either:
     - curated seed rows owned by `ROUTING_MEMORY_CURATED_SEED_USER_ID`, or
     - learned successful rows allowed by the routing-memory policy for this tenant/user
   - Ordered by cosine similarity (`semantic_embedding <=> $embedding`)
   - `LIMIT K` (implementation default can remain small, e.g. `5`)
4. Returns top candidates with `slots_json`, `similarity_score`, `intent_id`

This is independent of Phase 5 hint retrieval — no `detectHintScope()` dependency.

### Client-side reader

A bounded-await client function `lookupSurfaceCommand()` in `lib/chat/surface-resolver.ts`:
- Posts to `/api/chat/surface-command/lookup`
- Timeout: 1500ms (fail-open, returns null on timeout/error)
- Gated by env flag: `NEXT_PUBLIC_SURFACE_COMMAND_RESOLVER_ENABLED`

### Query normalization before retrieval

Before DB lookup, apply lightweight normalization intended to improve retrieval recall without turning code into a phrase parser. This may include:

- stripping low-information wrappers or filler such as `my`
- conservative cleanup of whitespace and punctuation beyond the existing storage normalization
- optional removal of other clearly low-information polite wrappers if this can be done without changing the target noun phrase

Avoid aggressive vocabulary rewriting before retrieval, for example:
- `widget` -> `panel`
- `entries` -> `entry`
- `drawer` -> `panel`

Those transformations can create embedding mismatches between stored seed rows and lookup queries.
Plural/surface vocabulary relationships should instead be handled through:
- embeddings
- lexical overlap features during reranking
- explicit manifest/runtime validation after retrieval

This normalization is for retrieval quality only. It must not become a broad regex intent layer.

## Resolver Contract

### Confidence bands and ownership rules

| Gate | Value | Rationale |
|------|-------|-----------|
| High-confidence floor | `≥ 0.88` | Safe deterministic execution threshold |
| Medium-confidence floor | `< 0.88` but `≥ 0.78` | Useful semantic hint without deterministic execution |
| Near-tie margin | `≥ 0.03` | Prevents ambiguous picks between close candidates |
| Candidate source | curated seeds and allowed learned rows | DB-backed retrieval is the canonical phrase layer |
| Single deterministic winner | Top candidate must pass high floor and margin | No multi-candidate execution |

### Ownership rule

- **High-confidence match** (passes high floor, margin, and validation): branch owns the turn. Returns `handled: true` on success or bounded error on failure. No LLM fallthrough.
- **Medium-confidence candidate** (plausible candidate but not safe for deterministic execution): branch does not execute, but returns a structured surface-candidate hint for the next bounded resolver stage, with bounded candidate arbitration as the primary next consumer and arbiter/LLM as a secondary path when arbitration is not needed, declines, or is unavailable.
- **Low/no match** (fails medium floor or is too ambiguous): returns null. Normal routing continues. No interception.

This preserves the note-manifest style ownership for safe high-confidence wins, while using the DB/semantic layer more effectively for paraphrases that are helpful but not yet deterministic.

### Candidate ranking notes

Ranking should not rely on embedding distance alone. The resolver should combine:
- semantic similarity
- curated-seed bias
- learned-row recency/success signals
- live-context compatibility
- lexical/surface-vocabulary overlap from normalized query text

A practical implementation can use a two-stage approach:
1. retrieve top `K` by embedding similarity
2. apply deterministic reranking using live context and source weighting

This keeps phrase matching in the DB/semantic layer while keeping execution safety in code.

### Resolution steps

Add a dedicated module: `lib/chat/surface-resolver.ts`

It should:

1. Call `lookupSurfaceCommand()` to retrieve seeded candidates
2. Re-rank candidates using live context signals, for example:
   - visible surface boost
   - container match boost
   - read-only/state-info boost for low-risk commands
   - surface alias overlap (`recent`, `widget`, `panel`, instance labels)
3. Apply confidence bands and ambiguity gates:
   - determine `high`, `medium`, or `low`
   - reject near-tied candidates from deterministic execution
4. Validate the leading candidate against live manifest:
   - `findSurfaceEntry(surfaceType, containerType)` exists
   - `findSurfaceCommand(surfaceType, containerType, intentFamily, intentSubtype)` exists
   - `handlerId` matches
   - `executionPolicy` matches
5. Validate against runtime context:
   - container matches (`runtimeContext.containerType === seed.containerType`)
   - visible surface exists if `requiresVisibleSurface` (check `runtimeContext.visibleSurfaceTypes`)
   - duplicate instance resolves if needed (future multi-instance slice)
6. On high-confidence validations passing: produce `ResolvedSurfaceCommand`
7. On high-confidence match but validation failure: return a separate error shape `{ matchedStrongly: true, validationError: string }` so the executor can produce a bounded error. Do not use `ResolvedSurfaceCommand` for errors — its `confidence` type only allows `'high' | 'medium' | 'low'`.
8. On medium-confidence plausible match: return a `SurfaceCandidateHint`
9. On low/no match: return null

### Manifest/runtime-derived fallback hint

If DB semantic retrieval does not produce a usable medium/high candidate, the resolver may still form a bounded fallback `SurfaceCandidateHint` when all of the following are true:

- the candidate surface is currently visible
- the surface command family is low-risk, read-only `state_info`
- the normalized query has strong vocabulary overlap with the surface and command family
- runtime/container context is compatible

Example:
- visible singleton surface: `recent`
- query includes overlapping terms such as `recent` + `entry` / `entries` + `widget`
- no strong DB row match exists yet

In that case, the resolver may synthesize a medium-confidence hint from:
- the manifest definition
- the visible runtime surface
- normalized lexical overlap

This fallback hint:
- must never directly execute
- is advisory only
- exists to prevent avoidable misses on new phrasings before learned rows accumulate

## Candidate Hint Output

Add a separate result shape for non-deterministic but useful semantic candidates, for example:

- `surfaceType`
- `containerType`
- `intentFamily`
- `intentSubtype`
- `candidateConfidence` (`medium`)
- `similarityScore`
- `visibleSurfaceMatch`
- `containerMatch`
- `requiresVisibleSurface`
- `selectorSpecific`
- `arguments`

This hint is passed to arbiter/LLM as structured guidance. The LLM sees the original user query plus the candidate hint; it does not receive a rewritten replacement query as the new source of truth.

### Handoff contract

The medium-confidence hint needs an explicit routing seam. Add a dedicated optional field carried from dispatcher into arbiter/LLM input, for example:

- `surfaceCandidateHint?: SurfaceCandidateHint | null`

This is distinct from existing exact-preference hints. It is advisory only and must contain:

- `surfaceType`
- `containerType`
- `intentFamily`
- `intentSubtype`
- `candidateConfidence`
- `similarityScore`
- `sourceKind` (`curated_seed` | `learned_success` | `manifest_fallback`)
- `visibleSurfaceMatch`
- `containerMatch`
- `selectorSpecific`
- `instanceLabel` when available
- `arguments`
- `validationSnapshot`
  - `requiresVisibleSurface`
  - `requiresContainerMatch`
  - `manifestMatched`
  - `commandMatched`

Dispatcher behavior:
- high-confidence `ResolvedSurfaceCommand` → execute directly
- medium-confidence `SurfaceCandidateHint` → carry forward as structured bounded context for the next resolver stage
- low/no match → no hint

Arbitration / arbiter behavior:
- bounded candidate arbitration is the primary next consumer for plausible medium-confidence surface candidates
- if bounded candidate arbitration is not needed, declines, or is unavailable for the current path, the same structured hint may still be attached to arbiter/LLM request context

Arbiter/LLM behavior when it receives a hint:
- treat `surfaceCandidateHint` as bounded advisory context
- may select the hinted surface intent if the original query is compatible
- may ignore the hint if the original query or broader context contradicts it
- must not treat the hint as an already-executed command

This preserves the original user query as the source of truth while still letting semantic retrieval reduce avoidable misses.

## Resolved Output

Use `lib/chat/surface-manifest.ts` as the canonical output, with:

- `surfaceType`
- `containerType`
- `intentFamily`
- `intentSubtype`
- `targetSurfaceId`
- `instanceLabel`
- `selectorSpecific`
- `arguments`
- `confidence`
- `executionPolicy`
- `replayPolicy`
- `clarificationPolicy`
- `handlerId`

## Execution Rules

Executor behavior should come from manifest policy, not phrase text.

Examples:

- `recent.state_info.list_recent`
  - execution policy: bounded chat answer
- `links_panel.navigate.open_item`
  - execution policy: execute item
- `links_panel.state_info.list_items`
  - execution policy: preview/list answer
- `open_surface` / `focus_surface`
  - only for imperative surface-open commands

The executor should only run on `ResolvedSurfaceCommand` high-confidence results.
`SurfaceCandidateHint` results are guidance for downstream routing, not executable commands.

Future write-target expansion should define explicit write execution policies rather than overloading presentation behavior.
Representative policies may include:
- `write_into_note`
- `write_into_editable_surface`

Those write policies must remain stricter than presentation policies. Before any write-target execution, the app should validate:
- the target exists
- the target is writable
- the target is uniquely identified enough for safe execution
- the requested insertion behavior is defined, for example:
  - `append`
  - `replace`
  - `insert`
- mutation policy allows the write without additional confirmation

If any of the above remain unresolved:
- do not silently downgrade the request to a presentation action
- do not pick an arbitrary writable target
- clarify instead

## Product Rule

Question-form surface state/info queries:
- answer in chat
- no side effects

Imperative surface-open commands:
- open/focus the UI surface

Do not mix these in one policy.

Future write-delivery requests should be treated as a separate product rule:
- retrieve/prepare the requested content first
- resolve the write target separately
- apply write-specific validation and policy before mutation
- if target resolution or write mode is ambiguous, clarify instead of auto-writing

## Failure Modes

If a candidate matched strongly enough to claim ownership:
- validation failure → bounded deterministic error/clarifier
- no LLM side-effect fallback

If a medium-confidence candidate exists:
- no deterministic execution
- keep the structured surface-candidate hint as bounded context for the next resolver stage
- run bounded candidate arbitration first when the medium-confidence candidate remains plausible for execution or bounded answer
- if arbitration is not needed, declines, or is unavailable, the same hint may still be forwarded to arbiter/LLM

If there is low/no candidate:
- normal routing continues with no surface hint

If a medium-confidence hint is provided to arbiter/LLM but the model still declines it:
- normal LLM routing continues from the original query
- the rejected hint should be logged for offline analysis, not executed

If DB retrieval is weak but a manifest/runtime-derived fallback hint exists:
- admit that hint into the same bounded surface-candidate decision scope
- run bounded candidate arbitration first when the fallback hint remains plausible for execution or bounded answer
- if arbitration is not needed, declines, or is unavailable, the same hint may still be passed to arbiter/LLM before clarifying
- only fall all the way to clarification/safe fallback if deterministic routing, bounded candidate arbitration, and bounded arbiter/LLM all still cannot resolve safely

If retrieval or reranking yields only medium/low-confidence but still plausible candidates:
- do not jump straight from retrieval miss to clarification
- run one bounded candidate-arbitration step over the small validated candidate set
- this bounded arbitration step must run before broad fallback gates or later routing layers discard a correct medium-confidence surface hint
- in particular, broad action/navigation handling such as `show` must not bypass or erase a valid surface-candidate arbitration opportunity
- likewise, earlier fallback or enforcement layers such as `Stage 6` content-intent routing must not preempt a valid bounded surface-candidate arbitration opportunity when the current turn is already inside the validated surface-candidate decision scope
- bounded candidate arbitration should have an explicit fail-open latency budget
  - first implementation target: `<= 2000ms`
  - if the arbitration call times out, errors, or returns unusable output, continue with candidate-backed clarification or the normal bounded non-execution path
  - if arbitration is known to be unavailable up front, for example missing API configuration or disabled provider access, skip the call entirely and continue with the same bounded non-execution path rather than waiting for timeout
- whole-path latency should still be monitored across retrieval, optional rewrite, optional second retrieval, and optional arbitration
  - the first slice does not require a single hard end-to-end cap
  - later rollout should add telemetry and budget tuning so optional stages can be skipped when compound latency becomes too high
- this arbitration step may:
  - select one candidate for normal app-side validation and execution
  - decline to choose and request clarification instead
- it must not be a free-form retry over the whole query space
- it must not invent new targets outside the bounded candidate set

Bounded candidate arbitration should be informed by:
- the current user query
- the top validated candidates from raw retrieval and, if present, rewrite-assisted retrieval
- candidate metadata such as:
  - surface type
  - intent family / subtype
  - execution policy
  - provenance / source kind
- structured current-turn delivery state, for example:
  - `delivery_kind = present | write`
  - `presentation_target = chat | surface | unspecified`
  - `write_target = none | active_note | named_note | open_editable_surface | any_open_editable_surface`
  - `destination_source = explicit | inferred | default`
- generic current-turn cue extraction that can inform that destination state, such as:
  - `in the chat`
  - `here in the chat`
  - `in chat`
  - `open`
  - `show`
  - `list`

Delivery state should be treated as a first-class routing constraint, not merely wording embedded in free text.

The distinction between destination value and destination source matters:
- explicit user constraints, for example `in the chat`, are stronger than product defaults
- inferred/default behavior, for example bare `show recent` usually meaning surface display, must not be treated as if the user explicitly requested that destination
- a practical structure is:
  - `delivery_kind = present | write`
  - `presentation_target = chat | surface | unspecified`
  - `write_target = none | active_note | named_note | open_editable_surface | any_open_editable_surface`
  - `destination_source = explicit | inferred | default`

Presentation destination and write target must not be collapsed into one field:
- presentation requests such as `show recent in the chat` are usually read-only and low-risk
- write-target requests such as `put it in the note` or `write it into any open editable panel` are mutation requests and require stricter validation

For the current present-only slice:
- `delivery_kind = present`
- `presentation_target` is the relevant destination field
- `write_target = none`

For future write-target expansion:
- `delivery_kind = write`
- `write_target` becomes the routing target
- `presentation_target` may be irrelevant or secondary
- write-specific policy may later include fields such as:
  - `write_mode = append | replace | insert | unspecified`

For single-candidate medium-confidence cases:
- arbitration is still allowed, because the bounded decision may still be:
  - select this candidate
  - or decline and clarify
- implementation may skip arbitration as a latency optimization when deterministic rules already make the next bounded step obvious
  - for example, when the single candidate clearly cannot be auto-executed and should move directly to clarification
  - or when existing bounded routing rules already consume that one candidate safely without an additional arbitration call

Delivery state and extracted cues are ranking/arbitration signals, not execution authority.
They should help distinguish intent shape across surfaces generally,
for example chat-answer/listing versus surface display,
without becoming a per-widget phrase table.

Structured delivery state should be applied in multiple places, not only late arbitration:
- retrieval reranking:
  - chat-compatible candidates may receive a boost when `delivery_kind = present` and `presentation_target = chat`
  - surface/display candidates may receive a penalty when they conflict with an explicit chat destination
- deterministic gating:
  - a high-confidence candidate must not auto-execute if it conflicts with an explicit destination constraint and a plausible compatible candidate still exists in the bounded set
- execution gating across all lanes:
  - no panel-open path should execute a structurally generic ambiguous phrase unless the target is sufficiently specific and validated
  - this rule must apply consistently to:
    - bounded grounding execution paths
    - `/api/chat/navigate` intent parsing
    - `intent-resolver` panel execution branches
  - a broad generic phrase such as `open entries` must not be allowed to:
    - exact-open a visible `Entries` panel
    - collapse to a navigator-family or similar family-specific clarification by itself
    - or otherwise execute a panel-open chosen by model preference alone
  - generic phrases should execute only when:
    - the user supplied an explicit sufficiently specific target, for example `open entry navigator c` or `open links panel cc`
    - or product explicitly approves a safe default for that exact generic phrase
  - any product-approved safe default exception must stay narrow:
    - it should be documented for that exact phrase or phrase family
    - it should be covered by explicit regression tests
    - it should not be inferred ad hoc from model preference or a surviving single candidate alone
  - implementation should enforce this as one shared ambiguity policy across lanes rather than duplicating slightly different guards in each path
    - grounding execution, `/api/chat/navigate`, and `intent-resolver` should all consult the same generic-phrase execution rule
    - otherwise the same ambiguous phrase can still clarify in one lane and auto-execute in another
  - otherwise the bounded candidate set should be clarified instead of executed
- bounded candidate arbitration:
  - the structured delivery state should be part of the arbitration input, not merely implied by raw text
- clarification:
  - wording should reflect the destination conflict explicitly when relevant

Future write-target handling should be stricter than presentation handling:
- validate that the chosen write target exists, is writable, and is uniquely identified enough
- if the request names an `any open editable` target, auto-selection is safe only when exactly one eligible target exists
- otherwise clarify instead of silently choosing a writable target

Cue precedence should remain explicit:
- explicit output-destination cues such as `in the chat`, `here in the chat`, or `in chat`
  should outrank generic action verbs such as `show` when the bounded candidate set already contains both chat-answer/list and surface/display interpretations
- generic action verbs alone should not override an explicit current-turn output-destination cue

Conflict handling should remain explicit:
- if the top candidate conflicts with an explicit destination constraint and no plausible compatible candidate survives in the bounded set:
  - do not execute the conflicting candidate anyway
  - fall back to candidate-backed clarification

Bounded candidate arbitration output must be validated structurally:
- the model should return only:
  - one candidate ID / index from the provided bounded set
  - or an explicit decline-to-choose outcome
- any output that does not map exactly to the provided candidate set must be rejected as unusable
- rejected or unusable arbitration output should fail open to candidate-backed clarification, not free-form execution

The app must still validate the chosen candidate normally after bounded arbitration:
- manifest policy
- visible/runtime context
- execution policy
- normal safety checks

If arbitration selects a candidate but normal app-side validation then fails:
- do not execute that candidate
- do not treat the failed selection as proof that another candidate should execute automatically
- the app may try another candidate only if:
  - that alternative is already in the same bounded validated surface-candidate set
  - and it independently passes normal validation without relying on the failed pick
  - and the near-tie / ambiguity rules still permit deterministic selection
- otherwise, fall back to candidate-backed clarification

If bounded candidate arbitration still cannot safely choose:
- reuse the same bounded candidate set for candidate-backed clarification
- do not discard the retrieved candidates and start an unrelated free-form fallback

Candidate-set purity is required here:
- bounded candidate arbitration should operate only on the validated surface candidate set produced by the surface resolver / rewrite-retrieval path
- it should not silently expand to unrelated later grounding candidates such as widget-list items, visible-panel fallbacks, or generic referents unless those candidates have already been admitted into the same validated surface-candidate decision scope

### Post-arbiter coarse-result guardrail

The system must distinguish:

- generic panel/container state questions
- specific surface-content requests

Examples:
- generic:
  - `what panels are visible?`
  - `which panels are open?`
- specific:
  - `list recent widget entries`
  - `show links panel b items`

If arbiter/LLM returns only a coarse result such as `panel_widget.state_info`, that is sufficient only for generic panel-state questions.

If all of the following are true:
- the query shape appears to ask for a specific surface's contents/items/state rather than generic visible-panels state
- there is no validated `ResolvedSurfaceCommand`
- there is no accepted `SurfaceCandidateHint` path that can be executed safely
- arbiter/LLM still only produces a coarse surface-family result

then the app must not execute the broader generic answer (for example, a visible-panels list).

It must clarify instead.

This guardrail is structural, not widget-specific:
- it should not depend on maintaining per-widget regex phrase rules
- it should rely on the mismatch between a specific-looking query and a coarse unresolved result

The “specific surface-content request” detector should stay narrow and structural.
Useful signals are:
- a content/listing verb such as `list`, `show`, `display`, or `view`
- an object noun such as `entries`, `items`, or `content`
- plus some sign of target specificity, for example:
  - an explicit surface term
  - an accepted surface candidate hint
  - strong surface-family evidence from retrieval/runtime context
  - an instance reference

These signals are guardrail inputs, not a replacement phrase-matching system.
They must not grow into a hidden per-widget phrase table.

Clarification is important here not only for safety, but also because it creates a path to a validated final resolution that can justify learned-row writeback later.

Visible-panel ambiguity and panel-evidence matching must also stay bounded:
- they should not treat a long natural-language sentence as a panel-title reference merely because the sentence contains one or more single-word visible panel titles
- they should prefer panel-title ambiguity only when the overall input shape still resembles a panel reference or panel command
- this rule is general, not `recent`-specific; it should protect any present or future single-word panel title from over-triggering panel disambiguation
- implementation must apply this constraint consistently to both:
  - pre-LLM panel disambiguation
  - `visible_panels` grounding / panel-evidence fallback
- fixing only one of those paths is insufficient; otherwise the same false ambiguity can reappear later in routing

The design requirement above intentionally does not force a single implementation shape.
Acceptable bounded mechanisms could include:
- a token-ratio or title-length guard in panel-title matching so single-word titles do not dominate long natural-language input
- a content-noun/content-verb guard that prevents words like `entries` or `items` from being treated as panel references when they are clearly acting as content objects
- a narrow pre-disambiguation routing guard for specific surface-content requests

The detailed implementation plan should choose one mechanism or a small compatible combination.
It should not satisfy this rule by adding a growing set of per-panel special cases.

Examples:
- `recent`
- `open recent`
- `recent panel`
  - these may still be treated as panel-reference inputs
- `show the recent widget entries`
- `i want to see the recent widget entries`
- `can you list the recent entries`
  - these should not become a visible-panel ambiguity between `Recent` and another single-word panel like `Entries` merely because both title words appear in the sentence

When this guardrail fires, the clarifier should be bounded and preferably candidate-backed:
- generic safe fallback is acceptable only when no plausible bounded candidates exist
- better when possible: use plausible low/medium candidates plus visible-surface context to propose likely safe options without executing them
- keep proposals to a small plausible set rather than dumping all visible panels
- do not suggest a surface only because it is visible; suggestions should still be informed by retrieval/runtime evidence
- when the ambiguity is between two intent shapes rather than two surfaces, prefer intent-shaped options over bare panel-title options
- for example, prefer:
  - `Open the Recent panel`
  - `List recent entries here in chat`
  over:
  - `Recent`
  - `Entries`

Candidate-backed clarification is preferred because it helps confused users recover without unsafe execution.
These candidates may come from:
- medium-confidence surface hints that were not accepted for execution
- weaker semantic retrieval candidates
- candidates that remained plausible after bounded candidate arbitration declined to choose
- visible/runtime-compatible surface evidence
- recent routing context from the latest conversation, such as:
  - previous user phrasing
  - previous assistant clarification
  - previous resolved surface
  - previous resolved intent family
  - previous turn outcome

Recent routing context should be used as bounded evidence for ranking or proposing clarification options,
especially for follow-up replies and typo-corrections after an unresolved turn.
It should not be treated as execution authority by itself.
Explicit current-turn nouns, targets, and surface cues must always outrank recent routing context.
Recent context is a ranking hint for recovery, not a carry-forward assumption that can override the current turn.

Low-confidence candidates are clarification aids only:
- they may be presented as options
- they must not be auto-executed

Examples:
- `Do you mean the Recent panel or another visible panel?`
- `Do you want the items from the Recent panel, or are you asking which panels are visible?`
- `Did you mean Recent, or were you asking which panels are visible?`

The clarifier must not:
- assume a specific surface has already been chosen
- execute a candidate command before the user confirms
- be treated as a successful learned resolution by itself

Clarification should also have a bounded anti-loop rule:
- if the user repeats the same unresolved noisy phrasing or gives another low-information reply after one grounded clarifier
- do not keep asking similar clarifiers indefinitely
- fall back to a more explicit bounded prompt such as:
  - `I'm still not sure which panel you mean. Name the panel directly.`

### Rewrite-Assisted Retrieval Recovery

For typo-heavy or noisy surface queries, the resolver may use a bounded LLM rewrite as a second-pass retrieval aid.

This is a retrieval recovery layer, not an execution shortcut:
- the original raw query remains the source of truth for logs, UX, and safety
- the rewritten query is used only to improve semantic retrieval recall
- the rewritten query must never become direct execution authority

Recommended flow:
1. run semantic retrieval on the raw query against curated seeds + learned-success rows
2. if raw retrieval is weak or unresolved, optionally request a bounded retrieval rewrite from the LLM
3. run semantic retrieval again on the rewritten query against the same query-memory rows
4. merge and rerank raw-query and rewritten-query candidate sets, preserving provenance
5. validate candidates against manifest policy and live runtime context
6. choose:
   - high validated match -> execute
   - medium/low but plausible -> bounded candidate arbitration
   - if arbitration chooses -> validate and execute
   - if arbitration declines -> candidate-backed clarification
   - still coarse or unresolved -> clarify

Rewrite-assisted retrieval should not run universally. It should be gated to recovery cases such as:
- raw retrieval is weak or unresolved
- the query shows typo/noise signals
- the query structurally looks like a surface-content request
- the candidate action family is read-only / low-risk

The rewrite task must stay narrow:
- correct obvious typos
- simplify wording
- preserve likely intent
- do not add new goals
- do not invent missing entities

When merging candidates, prefer agreement between raw-query and rewritten-query retrieval:
- strongest: candidates supported by both raw and rewritten retrieval
- next: strong rewritten-query candidates with good validation support
- weakest: one-sided low-confidence candidates

Disagreement handling:
- disagreement between raw-query and rewritten-query retrieval must not by itself produce a high-confidence execute
- if raw and rewritten retrieval point at different top commands, the result should remain medium-confidence or clarify unless one candidate clearly wins under validation and provenance-aware reranking
- unresolved raw-vs-rewrite disagreement should bias toward hint / clarification, not deterministic execution

Rewrite budget:
- at most one bounded rewrite attempt per user turn
- bounded timeout / latency budget for the rewrite request
- no rewrite-on-rewrite chaining
- if the rewrite step times out or fails, continue with the normal non-rewrite path
- if the rewrite step succeeds syntactically but rewritten-query retrieval still returns zero useful candidates, do not retry; continue with the normal hint / clarification path

All merged candidates must preserve provenance such as:
- `source=raw_query`
- `source=llm_rewrite`
- score / confidence per source
- whether rewrite assistance was used

Bad implementations to avoid:
- replacing the original user query with the rewritten form
- allowing rewritten-query retrieval to bypass normal manifest/runtime validation
- learning rewrite-assisted successes as if they were direct raw-query deterministic wins without provenance
- using creative rewrites for destructive or mutation actions

This rewrite-assisted retrieval layer should roll out narrowly first:
- implement for the `recent` slice first
- observe outcome quality and drift
- expand to other surfaces only after the recovery behavior is stable

Even when rewrite-assisted retrieval is enabled, the post-arbiter guardrail still remains mandatory. If recovery retrieval still cannot produce a safe specific result, the system must clarify rather than execute a coarse generic answer.

## What This Replaces

Do not use:
- `detectHintScope()` gating
- Phase 5 hint piggybacking
- regex phrase detection for surfaces

Phase 5 remains for:
- memory replay
- semantic hints to LLM
- history/navigation families

This surface resolver is its own semantic retrieval path. It may still hand off structured candidate hints to arbiter/LLM, but it does not depend on Phase 5 scope detection or Phase 5 seed retrieval.

## Minimal First Slice

Implement first for:
- `recent.state_info.list_recent`

The first slice should also make the user-facing contract explicit:
- `show recent`
- `show recent widget`
- `show recent widget entries`
  - default to showing the Recent surface in its drawer / surface display
- `list recent entries`
- `show recent entries in the chat`
  - default to listing Recent content in chat

Current-code tension to resolve during implementation:
- the existing broad action-navigation gate treats `show` as navigation/open language
- that broad gate must not prevent the surface resolver or equivalent drawer/display path from correctly handling:
  - `show recent`
  - `open recent`
  - `show recent widget`
  - `show recent widget entries`
- the detailed implementation plan must therefore specify how the `show ... recent ...` contract is honored without letting those turns fall into the wrong generic panel/open ambiguity path
- `open recent` should be owned by the surface resolver / surface-memory path for consistency with the `Recent` drawer/display contract rather than depending on legacy memory-only routing

Recent ownership must also stay bounded:
- the Recent resolver must not claim generic content-noun queries such as `show entries` unless there is real Recent-family evidence
- generic nouns like `entries`, `items`, or `content` are not enough by themselves to prove the user means `Recent`
- acceptable Recent-family evidence can include:
  - an explicit `recent` / `recently` term
  - a validated Recent candidate from retrieval
  - typo-tolerant near-match evidence pointing at `recent`
  - strong runtime evidence tied to a Recent-specific content request
- when that evidence is absent, the Recent resolver should decline ownership and let bounded clarification or other candidate sources compete normally

Queries like `show entries` are structurally ambiguous:
- they may refer to Recent content
- they may refer to links panels containing entries
- they may refer to a visible panel/widget titled `Entries`
- the system must not deterministically map that query to `Recent` without stronger evidence
- when multiple bounded candidates remain plausible, it should clarify instead
- even if only one bounded non-Recent candidate survives, bare generic phrasing like `show entries` should still prefer clarification unless that candidate is both:
  - extremely strong under the normal validation rules
  - and explicitly approved by product policy as a safe default for that generic phrase
- without that stronger policy decision, surviving alone is not enough to convert a structurally generic phrase into deterministic execution

Curated seeds must be aligned to that contract before broadening retrieval behavior:
- keep a small reviewed anchor set for drawer/show phrasing
- keep a small reviewed anchor set for explicit chat-list phrasing
- audit existing curated seeds for conflicting meanings
- revise or remove conflicting seeds rather than letting contradictory anchors coexist
- the seed audit should explicitly review any current rows whose normalized phrasing resembles:
  - `show my recent entries`
  - `show me my recent items`
  when those rows map to a chat-list answer under a contract where bare `show ... recent ...` should default to drawer/surface display

Not:
- `what did I open recently?`

The goal of the first slice is not exact-phrase dependence. A small curated seed set should generalize to nearby paraphrases such as:
- `list recent entries`
- `list my recent widget entries`
- `show recent`
- `show recent widget entries`

without adding regex phrase logic.

## Testing

Add dispatcher-level tests for:
- strong seeded recent query → resolved surface command → bounded answer
- semantically close paraphrase → medium or high candidate path, not notes-only clarifier
- weak DB match + strong manifest/runtime overlap → fallback `SurfaceCandidateHint`, not direct clarification
- weak/noisy raw query + bounded rewrite retrieval → improved candidate recall with preserved provenance
- medium/low plausible candidates + bounded candidate arbitration → either validated selection or candidate-backed clarification, not unrelated fallback
- explicit current-turn output cue like `in the chat` should bias bounded arbitration toward chat-answer/list candidates when those candidates are already in the validated set
- wrapped/preamble query such as `hi there show the recent widget entries in the chat` with a medium-confidence chat-list candidate → bounded arbitration preserves the `in the chat` cue and selects the chat-answer/list candidate rather than drawer/display or unrelated fallback
- structured destination state should distinguish:
  - explicit destination constraint
  - inferred destination
  - default destination
- structured delivery state should distinguish:
  - `delivery_kind = present | write`
  - `presentation_target`
  - `write_target`
- explicit chat destination must demote conflicting surface/display high-confidence candidates when a plausible chat-answer/list candidate remains in the bounded set
- `show recent` → surface destination by default policy
- `open recent` → surface-resolver-owned surface destination, not legacy memory-only routing
- `list recent entries` → chat destination by likely-intent policy
- `show recent contents in the chat` → chat destination
- `show entries` with no Recent-family evidence → do not route deterministically to Recent; bounded clarification across surviving candidates instead
- `open entries` with no product-approved safe default → bounded clarification across surviving candidates instead of exact-opening `Entries` or collapsing to a family-specific panel interpretation
- `open entry navigator c` → deterministic panel open
- `open links panel cc` → deterministic panel open
- `show entries in the chat` with no clear surviving Recent-compatible candidate → clarify rather than forcing Recent chat-list
- `show recent in the chat` with no safe chat-compatible candidate → clarify rather than forcing surface/display
- the same generic-phrase ambiguity rule must hold in both:
  - grounding execution paths
  - `/api/chat/navigate` + `intent-resolver` execution paths
- `list the recent widget content in the note` → write delivery targeting the active note only if write-target validation succeeds
- `list the recent widget content in any open editable panel` → clarify unless exactly one eligible writable target exists
- bounded candidate arbitration timeout/error/unusable output → fail open to candidate-backed clarification or bounded non-execution path
- bounded candidate arbitration response outside the provided candidate IDs/indexes → rejected as unusable
- arbitration-selected candidate fails normal app validation → no execution; clarification or other bounded fallback
- raw/rewrite agreement outranks rewrite-only candidates during reranking
- raw top candidate != rewritten top candidate → disagreement alone does not produce a high-confidence execute
- rewrite-assisted retrieval still requires normal manifest/runtime validation before execute or hint
- specific-looking query + only coarse `panel_widget.state_info` result → clarification, not generic visible-panels answer
- generic visible-panels query + coarse `panel_widget.state_info` result → generic visible-panels answer is still allowed
- long natural-language input containing single-word panel titles should not trigger visible-panel ambiguity unless the overall input still looks like a panel reference
- no visible recent surface → bounded deterministic failure
- wrong container → bounded deterministic failure
- medium-confidence candidate → arbiter/LLM receives structured surface hint
- weak/no seed → no interception
- imperative recent → old known-noun path unchanged
- duplicate-instance surface later: links panel B resolves specific instance
- successful paraphrase writeback creates/updates a learned row for future retrieval
- learned row with insufficient evidence does not outrank a curated seed
- rejected/incorrect learned row is not written back or reused

## Learning Loop

On successful handling of a paraphrased surface query:
- write back a learned routing-memory row with the validated surface metadata
- increment success count / update recency
- keep curated seeds as stable anchors, not the only examples

Writeback policy:
- deterministic high-confidence success may write immediately
- medium-confidence hint accepted by arbiter/LLM may write only after the final action/answer succeeds and the resolved surface metadata is known
- arbitration-mediated success may write only after the final action/answer succeeds and the resolved surface metadata is known
- rewrite-assisted success may write only with explicit rewrite-assistance provenance preserved
- rewrite-assisted successes should not be treated as direct raw-query deterministic wins during learning or promotion
- rewrite-assisted successes may enter `learned_success` only with rewrite-assistance provenance preserved; if promotion rules later distinguish weaker evidence tiers, rewrite-assisted rows should start conservatively rather than outranking stable raw-query wins too early
- writeback should store:
  - normalized query text
  - validated surface metadata
  - sourceKind=`learned_success`
  - success counters / timestamps
  - whether rewrite assistance was used
- writeback should not occur for failed, ambiguous, corrected, or reverted turns

This is how the app should improve over time without manual paraphrase farming.

## Rollout

1. Design doc (this document)
2. Add `surface-resolver.ts`
3. Wire a pre-LLM surface resolver branch (Tier 4.3)
4. Implement recent-only deterministic execution first
5. Add medium-confidence candidate handoff to arbiter/LLM
6. Add bounded candidate arbitration for plausible medium/low-confidence candidates
7. Add rewrite-assisted retrieval recovery for typo-heavy recent queries
8. Verify logs/provenance and learned-row writeback
9. Extend to multi-instance surfaces later
