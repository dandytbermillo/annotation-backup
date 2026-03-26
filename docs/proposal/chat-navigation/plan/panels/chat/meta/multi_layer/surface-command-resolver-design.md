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
  - `sourceKind` (`curated_seed` vs `learned_success`)
  - `successCount`
  - `lastSuccessAt`

The retrieval model is:
- curated seeds define the initial canonical intent neighborhoods
- learned successful rows help the app generalize to nearby paraphrases over time
- neither source executes directly without live validation

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
- **Medium-confidence candidate** (plausible candidate but not safe for deterministic execution): branch does not execute, but returns a structured surface-candidate hint to arbiter/LLM.
- **Low/no match** (fails medium floor or is too ambiguous): returns null. Normal routing continues. No interception.

This preserves the note-manifest style ownership for safe high-confidence wins, while using the DB/semantic layer more effectively for paraphrases that are helpful but not yet deterministic.

### Candidate ranking notes

Ranking should not rely on embedding distance alone. The resolver should combine:
- semantic similarity
- curated-seed bias
- learned-row recency/success signals
- live-context compatibility

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
- `sourceKind` (`curated_seed` or `learned_success`)
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
- medium-confidence `SurfaceCandidateHint` → attach to arbiter/LLM request
- low/no match → no hint

Arbiter/LLM behavior:
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

## Product Rule

Question-form surface state/info queries:
- answer in chat
- no side effects

Imperative surface-open commands:
- open/focus the UI surface

Do not mix these in one policy.

## Failure Modes

If a candidate matched strongly enough to claim ownership:
- validation failure → bounded deterministic error/clarifier
- no LLM side-effect fallback

If a medium-confidence candidate exists:
- no deterministic execution
- forward the original user query plus structured surface-candidate hint to arbiter/LLM

If there is low/no candidate:
- normal routing continues with no surface hint

If a medium-confidence hint is provided to arbiter/LLM but the model still declines it:
- normal LLM routing continues from the original query
- the rejected hint should be logged for offline analysis, not executed

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

With seed examples like:
- `list my recent entries`
- `show my recent entries`

Not:
- `what did I open recently?`

The goal of the first slice is not exact-phrase dependence. A small curated seed set should generalize to nearby paraphrases such as:
- `list recent entries`
- `list my recent widget entries`

without adding regex phrase logic.

## Testing

Add dispatcher-level tests for:
- strong seeded recent query → resolved surface command → bounded answer
- semantically close paraphrase → medium or high candidate path, not notes-only clarifier
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
- writeback should store:
  - normalized query text
  - validated surface metadata
  - sourceKind=`learned_success`
  - success counters / timestamps
- writeback should not occur for failed, ambiguous, corrected, or reverted turns

This is how the app should improve over time without manual paraphrase farming.

## Rollout

1. Design doc (this document)
2. Add `surface-resolver.ts`
3. Wire a pre-LLM surface resolver branch (Tier 4.3)
4. Implement recent-only deterministic execution first
5. Add medium-confidence candidate handoff to arbiter/LLM
6. Verify logs/provenance and learned-row writeback
7. Extend to multi-instance surfaces later
