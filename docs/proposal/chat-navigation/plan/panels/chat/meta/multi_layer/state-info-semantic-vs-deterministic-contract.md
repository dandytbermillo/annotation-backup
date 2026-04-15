# Semantic vs Deterministic Contract

## Purpose

This file freezes the app-wide rule for how semantic retrieval, bounded
deterministic handling, and runtime execution should interact.

The filename is historical. The contract is no longer only about widget/panel
state-info. It applies globally across the routing system.

It exists to prevent future drift between:

- semantic retrieval
- bounded deterministic handling
- downstream execution sources such as runtime registries, validated action
  executors, and bounded clarification flows

This is a contract document, not a replacement for the main plan or the more
specific addenda.

Primary references:

- `known-noun-policy-contract-plan.md`
- `state-info-runtime-registry-addendum.md`
- `no-clarifier-convergence-plan.md`

## Global Hard Rule

The app must follow this split:

1. semantic retrieval handles freeform query understanding, validation, and
   scoping
2. bounded deterministic handling stays limited to live bounded option
   selection
3. execution reads from the correct authoritative runtime source for the already
   resolved/scoped intent

No implementation should collapse those three concerns into one mixed lane.

This is not a "deterministic first, semantic second" ladder for freeform input.
For freeform understanding, semantic retrieval is the primary path from the
start. Deterministic handling applies only after the user is already replying to
a live bounded option set.

## Semantic Retrieval Responsibilities

Semantic retrieval is the required layer for freeform understanding.

It is responsible for:

- recognizing the likely intent family
- using seeded/learned rows plus rich metadata
- validating family, instance, dashboard, workspace, and surface scope
- producing a resolved candidate set or resolved intent for execution

Semantic retrieval may also use bounded retrieval aids such as:

- rewrite-assisted re-query for typo/noise recovery
- shared candidate shaping
- near-tie demotion
- scoped validation before execution

When semantic retrieval returns lower-threshold but still relevant candidates,
those candidates remain part of the bounded semantic candidate set.

They may still be used for:

- bounded LLM validation within that candidate set
- typo/noise interpretation within that candidate set
- clarification built from that candidate set when no execution-safe winner
  exists

This does not authorize opening a second broad fallback lane.

The user query's typo/noise may be interpreted only against the bounded
semantic candidate set that retrieval produced, not against arbitrary global
fallback possibilities.

Semantic retrieval is not the final answer source for runtime truth.

Seeded/learned rows may be used for:

- retrieval
- validation
- scoping
- candidate shaping

Seeded/learned rows must not be used as the source of truth for:

- current open/active/runtime state
- current surface visibility truth
- any other live runtime fact that belongs to a registry or executor

## Deterministic Responsibilities

Bounded deterministic handling must stay narrow.

It is allowed for:

- `1`, `2`, `3`
- `first`, `second`, `third`
- equivalent bounded option-picking replies tied to a live option set

It is not allowed to become a mini-NLU layer for raw freeform queries.

That means deterministic handling must not:

- infer dashboard/workspace scope from raw freeform text
- guess family/instance meaning on its own
- rewrite broad query language to compensate for missing semantic retrieval
  coverage
- answer freeform state/runtime questions directly from raw UI fields
- bypass semantic retrieval for freeform command/question understanding

So for raw freeform queries, the contract is:

- semantic retrieval first
- bounded deterministic only when the turn is already inside a live bounded
  option context

## Global Shared Semantic Pipeline Rule

Outside bounded deterministic option-picking, the intended app-wide rule is:

1. semantic retrieval builds the shared candidate set
2. if one strong validated winner exists, it may execute directly
3. if useful candidates exist but no execution-safe winner exists, the app
   should prefer clarification from that bounded candidate set
4. bounded LLM may arbitrate only within that bounded candidate set
5. only if the shared semantic candidate set is empty may downstream generic
   LLM/navigation attempt
6. if downstream still does not produce a safe winner, the final outcome should
   be clarification rather than blind execution

Important distinction:

- the shared semantic candidate-set clarification path is the primary bounded
  clarification path
- later downstream grounding/LLM fallback is a separate, later lane
- downstream fallback must not be treated as if it were the same thing as the
  Stage 5/shared-semantic clarification path

This preserves the existing no-clarifier convergence rule:

- semantic retrieval is the main freeform retrieval system
- rewrite-assisted re-query is part of semantic retrieval, not a deterministic
  guess layer
- bounded LLM may use candidate-local typo/noise interpretation, but only
  inside the bounded semantic candidate set already produced by retrieval
- bounded LLM is a bounded arbitration aid, not a replacement for semantic
  retrieval or runtime truth
- unresolved freeform turns should end in clarification rather than a growing
  prompt-only fallback policy engine

This means prompt files such as `intent-prompt.ts` may carry thin safety
guardrails, but they must not become a second business-logic lane for freeform
understanding, routing, or runtime truth.

## Widget/Panel State-Info Specialization

Widget/panel state-info is one concrete application of the global rule.

For widget/panel state-info:

1. semantic retrieval handles freeform query understanding, validation, and
   scoping
2. bounded deterministic handling remains limited to option selection only
3. final state-info answers come only from one authoritative runtime
   snapshot/registry

### Semantic responsibilities for state-info

Semantic retrieval is responsible for recognizing and scoping queries such as:

- `what panel is open?`
- `what panels are open?`
- `what widgets are open?`
- `what is the active panel?`
- `what is the active widget?`
- `is recent open?`
- `which navigator is open?`
- `is links panel a open?`

### Runtime truth for state-info

Final widget/panel state-info answers must come from one authoritative runtime
snapshot/registry only.

That runtime model is the source of truth for:

- `open`
- `active`
- family identity
- instance identity
- current surface context

Legacy/raw app fields may still exist during migration, but only as producer
inputs to the registry builder.

They must not be treated as separate answer sources.

So widget/panel state-info execution must not answer directly from:

- `openDrawer`
- `visibleWidgets`
- snapshot internals
- ad hoc dashboard/workspace raw state

Those may feed the runtime registry during migration, but the executor reads the
registry only.

## State-Info Query Families

### Open-State Queries

These queries are the same open-state family:

- `what panel is open?`
- `what panel are open?`
- `what panels are open?`
- `what widgets are open?`
- `what widgets are visible?` only if the product intentionally keeps this as an
  alias

They must answer from:

- all registry entries whose current `open` state is true

If A is opened, then B is opened, and A was not explicitly closed, both A and B
must still be returned by open-state queries.

That includes singular phrasing such as `what panel is open?` when the product
uses `open` to mean opened-and-not-closed rather than only the currently active
drawer.

### Active-State Queries

These queries are the active-state family:

- `what is the active panel?`
- `what is the active widget?`
- `which panel is active?`
- `which widget is active?`
- `what panel is active?`
- `what widget is active?`

They must answer from:

- the single current active/currently focused registry entry

Normal expectation:

- none active -> bounded negative answer
- one active -> name that panel/widget

## Required Execution Split

The required execution path is:

1. semantic retrieval recognizes and scopes the query
2. runtime validation confirms the intended family/instance/surface scope
3. the correct executor reads the authoritative runtime source for that intent
4. the response is produced from runtime state or validated execution results
   only

If that path does not produce a safe winner, the final outcome should be
clarification rather than prompt-grown fallback answering.

This must not be replaced with:

- direct raw-field reads as final truth
- semantic retrieval payloads as final runtime truth
- broad deterministic query-shape guessing
- expanding prompt-only fallback logic as a parallel routing/execution system

## Explicit Non-Goals

This contract does not authorize:

- dashboard inventory answers for open-state queries
- generic docs routing for widget/panel current-state queries
- broad deterministic pattern growth for freeform state-info
- using seeded rows as current runtime truth
- letting deterministic become a general freeform fallback when semantic
  retrieval is weak

## Implementation Guardrails

Before implementation, confirm all of the following:

- freeform understanding uses semantic retrieval first
- deterministic is limited to bounded option selection only
- rewrite-assisted re-query stays inside the semantic retrieval layer
- bounded LLM only arbitrates within a bounded candidate set
- unresolved freeform turns end in clarification rather than blind LLM fallback
- the final answer path reads the correct authoritative runtime source
- open-state and active-state queries are not conflated
- inventory/presence is not conflated with open-state
- no older fallback path answers the same query family from a different source
- prompt-only guidance is not acting as a second policy engine

## Summary

The permanent rule is:

- semantic retrieval decides what scoped query family the user is asking
- bounded deterministic handles only ordinal/numbered option picking
- bounded LLM may arbitrate only within a bounded semantic candidate set
- if no safe winner exists, the final freeform outcome is clarification
- the final answer or action comes from the correct authoritative runtime source,
  not from raw UI fields or semantic rows themselves








