# Design: Dedicated Surface-Command Resolution Path

## Purpose

Create a dedicated pre-LLM surface resolver for built-in non-note surfaces. It sits alongside the note resolver, not inside the Phase 5 hint pipeline.

## Why

- Phase 5 hints are scoped for history/navigation retrieval and LLM biasing.
- Surface commands need direct resolution from:
  - seeded query rows
  - manifest metadata
  - live UI/container context
- This aligns with Step 4 in `how-it-works.md`, where the surface resolver produces a canonical normalized command shape before execution.

## Placement in Routing

1. B1/B2/Stage 5 stay unchanged for exact/semantic memory and replay.
2. After deterministic note/state shortcuts (Tier 4.2/4.25), before arbiter/LLM:
   - run `resolveSurfaceCommand(...)`
3. If it returns high-confidence resolved command:
   - execute via surface executor
4. If unresolved/low-confidence:
   - continue to arbiter/LLM

This means:
- no regex tier
- no Phase 5 scope dependency
- no LLM needed for obvious seeded surface commands

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

Use seeded DB rows as the phrase source of truth.

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

## Seed Retrieval

### Who retrieves seeds

The resolver calls a **dedicated server-side API route**: `POST /api/chat/surface-command/lookup`

This route:
1. Normalizes the input text via `normalizeForStorage()` (`lib/chat/routing-log/normalization`)
2. Computes an embedding via `computeEmbedding()` (`lib/chat/routing-log/embedding-service`)
3. Queries `chat_routing_memory_index` for rows where:
   - `user_id = '__curated_seed__'` (canonical curated-seed owner from `ROUTING_MEMORY_CURATED_SEED_USER_ID`)
   - `tenant_id = 'default'` (Option A tenant from `OPTION_A_TENANT_ID`)
   - `scope_source = 'curated_seed'`
   - `intent_id LIKE 'surface_manifest:%'`
   - `is_deleted = false`
   - `semantic_embedding IS NOT NULL`
   - Ordered by cosine similarity (`semantic_embedding <=> $embedding`)
   - `LIMIT 3`
4. Returns top candidates with `slots_json`, `similarity_score`, `intent_id`

This is independent of Phase 5 hint retrieval — no `detectHintScope()` dependency.

### Client-side reader

A bounded-await client function `lookupSurfaceCommand()` in `lib/chat/surface-resolver.ts`:
- Posts to `/api/chat/surface-command/lookup`
- Timeout: 1500ms (fail-open, returns null on timeout/error)
- Gated by env flag: `NEXT_PUBLIC_SURFACE_COMMAND_RESOLVER_ENABLED`

## Resolver Contract

### Thresholds and ownership rules

| Gate | Value | Rationale |
|------|-------|-----------|
| Similarity floor | `≥ 0.88` | Same as note manifest Phase 4 validator |
| Near-tie margin | `≥ 0.03` | Prevents ambiguous picks between close candidates |
| Candidate source | `from_curated_seed = true` | Only curated seeds, not learned rows |
| Single winner | Top candidate must pass both floor and margin | No multi-candidate execution |

### Ownership rule

- **Strong match** (passes all gates): branch owns the turn. Returns `handled: true` on success or bounded error on failure. No LLM fallthrough.
- **Weak/no match** (fails any gate): returns null. Normal routing continues. No interception.

This matches the note manifest Phase 4 pattern where B1 cache hits own the turn once validated.

### Resolution steps

Add a dedicated module: `lib/chat/surface-resolver.ts`

It should:

1. Call `lookupSurfaceCommand()` to retrieve seeded candidates
2. Apply gates: similarity floor, near-tie margin, curated-seed-only
3. Validate winning candidate against live manifest:
   - `findSurfaceEntry(surfaceType, containerType)` exists
   - `findSurfaceCommand(surfaceType, containerType, intentFamily, intentSubtype)` exists
   - `handlerId` matches
   - `executionPolicy` matches
4. Validate against runtime context:
   - container matches (`runtimeContext.containerType === seed.containerType`)
   - visible surface exists if `requiresVisibleSurface` (check `runtimeContext.visibleSurfaceTypes`)
   - duplicate instance resolves if needed (future multi-instance slice)
5. On all validations passing: produce `ResolvedSurfaceCommand`
6. On strong match but validation failure: return a separate error shape `{ matchedStrongly: true, validationError: string }` so the executor can produce a bounded error. Do not use `ResolvedSurfaceCommand` for errors — its `confidence` type only allows `'high' | 'medium' | 'low'`.
7. On weak/no match: return null

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

If no strong candidate:
- normal routing continues

## What This Replaces

Do not use:
- `detectHintScope()` gating
- Phase 5 hint piggybacking
- regex phrase detection for surfaces

Phase 5 remains for:
- memory replay
- semantic hints to LLM
- history/navigation families

## Minimal First Slice

Implement first for:
- `recent.state_info.list_recent`

With seed examples like:
- `list my recent entries`
- `show my recent entries`

Not:
- `what did I open recently?`

## Testing

Add dispatcher-level tests for:
- strong seeded recent query → resolved surface command → bounded answer
- no visible recent surface → bounded deterministic failure
- wrong container → bounded deterministic failure
- weak/no seed → no interception
- imperative recent → old known-noun path unchanged
- duplicate-instance surface later: links panel B resolves specific instance

## Rollout

1. Design doc (this document)
2. Add `surface-resolver.ts`
3. Wire a narrow pre-LLM surface resolver branch (Tier 4.3)
4. Implement recent only
5. Verify logs/provenance
6. Extend to multi-instance surfaces later
