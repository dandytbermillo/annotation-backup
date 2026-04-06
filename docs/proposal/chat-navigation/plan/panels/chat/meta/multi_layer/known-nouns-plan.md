# Phase 2: Semantic-First Known-Noun Convergence

## Goal

Converge known-noun queries onto the same shared semantic pipeline used by Phase 1, so noun-only inputs benefit from:

- curated and learned semantic memory
- richer target metadata
- the same strong-winner / clarification contract
- fewer unnecessary LLM calls

Known-noun logic should survive only as shared policy and validation. It should not remain a separate routing or execution lane.

## Status

This document is a proposal-level architecture plan for Phase 2 direction.

It is intended to:

- define the target semantic-first known-noun contract
- close proposal-level safety and behavior gaps
- guide the rewrite of the detailed Phase 2 implementation plan

It is **not** the final coding-ready implementation slice by itself. Implementation should still proceed from a detailed plan that translates this contract into exact file changes, ordering, tests, and rollout checks.

Current review status:

- proposal-level safety gaps for generic family nouns, temporary unknown-noun fallback UX, and bounded curated seed scope are addressed in this document
- the remaining intended caution is procedural, not architectural: this proposal should drive the detailed Phase 2 rewrite rather than be implemented from directly

## Scope

This phase covers noun-oriented queries such as:

- `recent`
- `widget manager`
- `links panel a`
- `navigator`
- typo/noise variants like `widgt managr`
- question-shaped forms like `links panel?` and `what is links panel?`

This phase does **not** change the explicit chat-list `recent` issue (`list my recent entries`, `show recent entries in the chat`), which remains a separate tracked follow-up about `intent_scope` / `intent_class` alignment.

Implementers should keep that separation explicit:

- noun seeding for `recent` must not accidentally absorb explicit list-in-chat behavior
- explicit chat-list `recent` phrases remain governed by the separate `intent_scope` / `intent_class` follow-up

## Target Contract

### 1. Known nouns are seeded into semantic memory

Add curated semantic rows for canonical noun-only forms and a small bounded alias set, with accurate metadata:

- target identity
- action type
- surface or panel family
- execution policy
- risk tier
- any policy hints needed by shared validation

Seed families should include at minimum:

- `recent`
- `widget manager`
- `navigator`
- `links panel a/b/c/d/...`

Generic family nouns should also be handled intentionally, for example:

- `links panel`
- `quick links`
- `entries`

These family nouns must not over-execute. If multiple valid siblings are present, the shared pipeline should clarify rather than choose one deterministically.

Seed authoring should live in the same curated seed source used by Phase 1:

- `scripts/seed-phase5-curated-exemplars.ts`

The intent of these seeds is:

- noun-only exact or near-exact queries can retrieve through semantic memory
- later successful clarifications can still write learned rows that outrank or complement seeds

Bound the curated seed scope:

- curate canonical noun forms
- add only a small bounded alias set where product language is already stable
- rely on semantic similarity and learned rows for most typo/noise handling
- do not try to enumerate broad typo tables in curated seeds

### 2. Known-noun queries enter the shared semantic pipeline first

For noun-only and typo/noise known-noun shapes:

- do semantic retrieval first
- use the same learned + curated candidate pool
- do not send them first to a separate known-noun router

This applies to:

- bare nouns
- typo/noise noun variants
- noun-like panel names

### 3. Known-noun logic becomes shared policy/validation only

Known-noun helpers remain useful, but only as policy layered on top of semantic candidates:

- question guard
  - `links panel?` -> open-vs-docs prompt
  - `what is links panel?` -> docs
- visibility validation
- duplicate-family validation
- near-match clarification shaping
- temporary unknown-noun fallback

The policy order should be:

1. semantic retrieval builds the shared candidate set
2. shared validation checks visibility / duplicate-family / question-shaped behavior
3. semantic arbitration decides execute / clarify / docs
4. only if semantic/shared retrieval is empty or insufficient does downstream fallback run
5. if downstream also cannot safely resolve, final outcome is clarification

### 4. Use the same decision contract as Phase 1

- one strong safe winner -> execute
- useful but not execution-safe candidates -> clarify
- only empty or insufficient shared candidate set -> downstream fallback
- if all else fails -> clarification

This is the same contract used for Phase 1 no-clarifier convergence. The only difference is the noun-focused seed coverage and noun-policy layer.

### 5. Remove known-noun as an independent execution lane

Phase 2 should end with:

- no separate Tier 4 winner lane for known nouns
- no direct `handleKnownNounRouting()` execution path
- helper functions retained only if they serve shared policy / validation

## Implementation Shape

### A. Curated seed expansion

Add or verify curated rows for noun-only known-noun forms and close variants in:

- `scripts/seed-phase5-curated-exemplars.ts`

Requirements:

- noun-only forms map to the same target identities already used by verb-form commands
- metadata should be replay-safe and consistent with existing semantic execution families
- duplicate-family targets should keep enough metadata for shared ambiguity handling

### B. Dispatcher changes

In `lib/chat/routing-dispatcher.ts`:

1. remove known-noun direct execution as a separate winner lane
2. route noun-only inputs into the shared semantic retrieval path
3. apply known-noun policy checks as shared validation over semantic candidates, not as a preemptive router

Entry-gate requirement:

- the current semantic entry gate must allow bare known-noun inputs to reach the same shared semantic pipeline
- if `detectHintScope(...)` currently requires both:
  - a broad navigation verb
  - and a target-family noun
  then bare nouns like `recent`, `navigator`, and `widget manager` will not reach Phase 5
- Phase 2 must therefore do one of the following:
  - expand `detectHintScope(...)` so bare known-noun forms can map into the navigation semantic path
  - or add a separate bare-noun entry gate that feeds the exact same shared semantic pipeline

Constraint:

- this entry-gate change must not create a new competing known-noun router
- it is only allowed as a way to admit bare nouns into the shared semantic retrieval system

Concretely:

- `handleKnownNounRouting()` should no longer be called as an independent `handled: true` execution path
- if noun-policy helpers are still consulted, they should:
  - shape the candidate outcome
  - not bypass the semantic pipeline

### C. Question-policy ordering

Question-shaped noun inputs should still use shared semantic retrieval, but the resulting execution policy differs:

- `links panel?`
  - if the target is valid and visible and not duplicate-family ambiguous:
    - show open-vs-docs prompt
  - if multiple valid family siblings exist:
    - clarify rather than pick one
  - otherwise clarify or fall through safely

- `what is links panel?`
  - prefer docs path
  - do not panel-open just because a semantic target exists

For generic family nouns outside explicit question forms:

- `links panel`
- `quick links`
- `entries`

the shared semantic pipeline may retrieve family candidates, but execution policy must be:

- if one strong safe winner exists -> execute
- if multiple valid siblings or family members exist -> clarify
- do not deterministically choose a sibling just because the family noun matched semantically

### D. Near-match / typo policy

Typo-like noun inputs such as `widgt managr` should:

- retrieve semantic candidates first
- then:
  - execute if a strong safe winner exists
  - clarify if the candidate is useful but not safe enough

Known-noun near-match helpers may still be used as a boost or disambiguation aid, but not as a separate routing lane.

### E. Temporary unknown-noun fallback

The governing detailed plan still preserves unknown-noun fallback temporarily.

That fallback should remain:

- non-blocking
- post-semantic and post-grounding
- used only when both:
  - the shared semantic candidate set is empty or insufficient
  - downstream fallback also cannot safely resolve

It should not swallow viable semantic or grounding candidates.

The temporary fallback UX should be explicit:

- it should be a clarification-style fallback, not a silent execute
- acceptable temporary form:
  - `I'm not sure what "X" refers to. Could you try again or give one more detail?`
- it should not be treated as an open-vs-docs prompt unless the question-policy layer actually detected a noun-question case
- once the parent clarification-first contract is universalized, this temporary fallback should collapse into the normal clarification outcome

Phase 4 can remove this fallback after parity is proven.

## Files Likely Affected

- `scripts/seed-phase5-curated-exemplars.ts`
- `lib/chat/routing-dispatcher.ts`
- `lib/chat/known-noun-routing.ts`
- `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts`
- any semantic lookup / ranking tests needed to prove noun-seed retrieval

## Intended Use

Use this proposal to revise the detailed Phase 2 plan into a semantic-first implementation slice.

That detailed slice should then specify:

- exact curated seed additions
- exact dispatcher changes and ordering
- exact policy hook placement
- exact automated and runtime verification

## Verification

### Automated

- `npm run type-check`
- noun-oriented dispatcher integration tests
- existing Phase 1 semantic replay tests
- any seed coverage tests affected by noun-only additions

### Runtime

- `recent` -> semantic execute
- `widget manager` -> semantic execute
- `links panel a` -> semantic execute or clarify if ambiguous
- `navigator` -> semantic execute or clarify via shared pipeline, not separate known-noun execution
- `links panel?` -> open-vs-docs
- `what is links panel?` -> docs
- `widgt managr` -> semantic candidate then execute or clarify by policy
- `xyzzy` -> only after semantic + downstream failure should the temporary unknown-noun fallback appear

## Success Criteria

Phase 2 is complete when:

- noun-only known-noun queries are retrieved through the shared semantic memory system
- known-noun behavior is preserved as policy, not routing
- unnecessary LLM calls are reduced for known-noun queries
- no separate Tier 4 known-noun execution lane remains

## Short Version

- Phase 2 should make known nouns semantic-first
- known-noun logic becomes policy, not routing
