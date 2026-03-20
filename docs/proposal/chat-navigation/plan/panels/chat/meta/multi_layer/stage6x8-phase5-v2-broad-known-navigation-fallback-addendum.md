# Stage 6x.8 Phase 5 V2 Addendum — Broad Known-Navigation Fallback

## Summary

Extend Phase 5 from the current runtime scope of:
- `history_info`
- `go_home`

to a broader set of **known validated navigation families**:
- `open_entry`
- `open_panel`
- `open_workspace`
- optional `show_recent` when its resolver path is already stable

The purpose is to make noisy conversational navigation phrasing resolve consistently across known navigation commands, not just Home.

This addendum applies to:
- [stage6x8-phase5-retrieval-backed-semantic-memory-plan.md](/Users/dandy/Downloads/annotation_project/annotation-backup/docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-retrieval-backed-semantic-memory-plan.md)
- [stage6x8-phase5-wrapper-heavy-retrieval-recall-addendum.md](/Users/dandy/Downloads/annotation_project/annotation-backup/docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-wrapper-heavy-retrieval-recall-addendum.md)

Anti-pattern applicability: **not applicable**. This is routing/fallback scope expansion, not provider/reactivity work.

## Problem

Current runtime behavior is inconsistent across navigation commands:

- `go_home` benefits from Phase 5 scope detection, tier-chain bypass, semantic hinting, and bounded-LLM fallback
- broader known navigation commands often do not

Examples of the current inconsistency:
- `take me home now pls` -> resolves correctly
- `hi there open the budget100` -> may fall into a clarifier
- `hey there i want you to open the links panel b` -> may fall into unrelated disambiguation


From the user’s perspective, these are all navigation requests. The product should not make only the Home subset robust against noisy conversational phrasing.

## Goal

Make broader known navigation commands behave like the current `go_home` subset:

1. explicit and deterministic navigation still works first
2. semantic retrieval still helps when available
3. bounded LLM fallback still rescues noisy conversational phrasing
4. validators/resolvers remain the execution authority

This addendum does **not** make semantic memory the owner of all navigation. It expands the fallback contract for known validated navigation families.

## Design Rule

Keep the architecture unchanged:

1. deterministic / explicit routing first
2. exact memory / semantic retrieval second
3. bounded LLM fallback third
4. resolver / validator last

Semantic memory and the bounded LLM help infer likely intent.  
Resolvers and validators still decide:
- exact target ID
- ambiguity
- current-state validity
- execute vs clarify

## Scope

### Included in V2

- `go_home`
- `open_entry`
- `open_panel`
- `open_workspace`
- optional `show_recent` only if all of the following are already true:
  - an existing deterministic or validated resolver path already handles it
  - ambiguity behavior is already defined and tested
  - adding it does not broaden V2 into a generic catch-all for `open X` nouns

### Not included in V2

- content-intent Q&A
- cross-surface current-state questions
- create / rename / delete flows
- non-navigation semantic lanes outside already-supported validated navigation families

## Proposed Change

### 1. Rename the current runtime scope honestly

Until V2 ships, the docs/reporting should stop describing the current runtime behavior as generic `navigation`.

Use wording like:
- `history_info + go_home`

Reason:
- current Phase 5 runtime behavior does not yet cover broader navigation families such as `open_entry` and `open_panel`

### 2. Broaden Phase 5 scope detection for known navigation families

Expand the current scope detector so it can recognize noisy conversational requests likely intended for known navigation commands such as:
- `open the budget100`
- `open links panel b`
- `open recent` only if `show_recent` is included under the optional gate above
- `open workspace budget100`

This broader detector should be limited to already-supported validated navigation families. It must not become a general semantic catch-all for every action in the product.

Activation rule:
- broad known-navigation scope should only activate when the query contains both:
  - a navigation/action cue consistent with an already-supported navigation family
  - a target-family signal that maps to a known validated family (`entry`, `panel`, `workspace`, or approved `show_recent`)

Examples:
- `open the budget100` -> eligible only if the target-family resolution path can treat `budget100` as an entry/workspace candidate under existing validated rules
- `open links panel b` -> eligible because `links panel` is a known panel family
- `open workspace budget100` -> eligible because `workspace` explicitly constrains the family

Family-ambiguous nouns may enter broad known-navigation fallback scope, but execution must never proceed without resolver disambiguation when multiple families remain viable.

Non-example:
- `open something for me` -> not eligible; too unconstrained for broad known-navigation scope

### 3. Apply the same Phase 5 fallback contract to broad known navigation

When broad known-navigation scope is detected:

1. deterministic routing still gets first chance
2. exact-hit and semantic retrieval still run
3. if exact-hit or strong unambiguous retrieval already suffices, complete without the bounded LLM
4. if retrieval is weak or empty, bypass brittle tier-chain clarifiers and send the panel-normalized query to navigate
5. attach retrieval hints when available, but do not require them
6. if retrieval is near-tied across conflicting targets or actions, clarify directly by default

This is the same contract already established for the current Phase 5 fallback behavior. V2 expands the set of navigation intents that can use it.

### 4. Expand semantic hint coverage for broader known navigation

Add curated seeds and learned exemplar coverage for the included navigation families.

Seed policy:
- curated seeds should cover stable built-in command families and canonical phrasing
- curated seeds should not attempt to enumerate user-specific targets such as `budget100`, `budget200`, project names, or other tenant-specific labels
- user-specific targets are expected to resolve through:
  - broad known-navigation scope detection
  - bounded-LLM fallback when retrieval is weak or empty
  - normal resolver target resolution and ambiguity handling

Examples of appropriate curated seeds:
- `open links panel b`
- `open navigator`
- `open workspace budget100` only when `workspace` is the stable family cue rather than a tenant-specific alias

Non-goal:
- do not seed every user-specific navigation target variant in advance

Navigation/fallback examples:
- `open budget100`
- `open links panel b`
- `open recent` only if `show_recent` is included under the optional gate above
- `open workspace budget100`

This improves retrieval quality, but retrieval remains hint-only evidence. It does not become direct execution authority.

Successful user-specific navigation should be written back to memory after validated execution so future similar queries can benefit from semantic matching without requiring curated seeds.

Writeback contract for V2 broad known-navigation:
- use the same existing Phase 5 delayed-promotion model already approved for `history_info`
- successful approved navigation turns create `phase5_pending_write`, not an immediate client-side memory write
- immediate next correction drops the pending write
- immediate next non-correction promotes it
- the original successful user query text remains the writeback source so repeated identical noisy phrasing can later qualify for B1 `Memory-Exact`

### 5. Keep the current fallback transport contract

The bounded LLM fallback continues to receive the **panel-normalized user query**.

The original raw query remains preserved for:
- logging
- telemetry
- UI display
- writeback exemplars

This addendum does not require changing that transport seam.

## Guardrails

### 1. No execution from retrieval alone

Retrieval may suggest:
- likely intent family
- likely target candidate

But it must not directly authorize:
- `open_entry`
- `open_panel`
- `open_workspace`
- `show_recent`

### 2. Resolvers remain authoritative

Resolvers/validators must still decide:
- whether the target exists
- whether multiple targets conflict
- whether the action is currently valid
- whether to execute or clarify

Examples:
- `budget100` vs `budget100 B` -> clarify if ambiguous
- `links panel` with multiple badge variants -> clarify if ambiguous
- `open workspace budget100` -> only execute if the exact workspace target is valid

### 3. Near-tie policy stays conservative

If retrieval returns a near-tie across conflicting actions or conflicting targets:
- direct clarification is required by default
- bounded-LLM comparison remains disabled unless a future policy explicitly defines allowed tie classes

### 4. No broad action-lane expansion by accident

V2 should expand only to already-supported validated navigation families.

It should not silently pull in:
- create flows
- rename flows
- delete flows
- general content intents
- generic “do something” semantics

## Implementation Slices

### Slice 1 — Scope Rename and Documentation Cleanup

Update wording in plans/reports:
- current runtime scope = `history_info + go_home`
- V2 target scope = broader known navigation fallback

### Slice 2 — Broad Navigation Scope Detection

Expand Phase 5 scope detection to cover the approved V2 navigation families:
- `open_entry`
- `open_panel`
- `open_workspace`
- optional `show_recent` only if it passes the inclusion gate defined above

### Slice 3 — Dispatcher Fallback Expansion

Use the same dispatcher-level fallback contract already proven for the current Phase 5 subset:
- direct validated resolution on exact/strong retrieval when possible
- bounded-LLM fallback on weak/empty retrieval
- direct clarification on near-tie by default

### Slice 4 — Retrieval Coverage Expansion

Add curated seeds and writeback coverage for broader known-navigation families so retrieval can assist more often and reduce unnecessary LLM calls.

Clarification:
- curated seeds are for stable built-in command families, not per-user target inventories
- user-specific targets should be learned from successful real usage via writeback rather than pre-seeded exhaustively
- successful broad-navigation writeback must reuse the existing `phase5_pending_write` -> delayed promotion pipeline rather than a new immediate write path in the panel
- repeated identical successful noisy navigation queries should become eligible for B1 `Memory-Exact` replay after promotion

### Slice 5 — Validation/Resolver Proof

Add regression coverage proving that V2 expansion does not weaken:
- ambiguity handling
- current-state validation
- execute-vs-clarify decisions

## Tests

### Unit / Integration

- `hi there open the budget100` -> resolves through broad-navigation fallback
- `hey there i want you to open the links panel b` -> resolves through broad-navigation fallback
- `can you open recent` -> resolves through broad-navigation fallback only if `show_recent` is included
- `please open workspace budget100` -> resolves through broad-navigation fallback
- `hey can please open the budget100` -> resolves without requiring a curated `budget100` seed
- `hey can please open the budget` -> bounded LLM fallback identifies the navigation family and the resolver clarifies among matching targets
- first `hi there open that budget100` -> validated success + pending write
- next non-correction turn -> pending navigation write promoted
- later `hi there open that budget100` -> eligible for B1 `Memory-Exact`
- strong exact/semantic retrieval can still complete without bounded LLM when the validated resolver already suffices
- weak/empty retrieval still reaches the bounded LLM fallback
- near-tie across conflicting entries clarifies directly
- near-tie across conflicting panels clarifies directly
- bounded LLM fallback still cannot bypass validation

### Negative Tests

- `open budget100 and links panel b` does not collapse into one action
- `did I open budget100?` does not get treated as `open_entry`
- `open links panel` with multiple badge variants does not guess
- entry/workspace label collision clarifies instead of guessing the family
- unconstrained `open X` phrasing without known-target-family evidence does not enter broad known-navigation fallback
- broader navigation fallback does not accidentally absorb content-answer or cross-surface state-info queries
- absence of a curated seed for a user-specific target does not force direct safe clarification when bounded-LLM fallback plus resolver validation can still resolve or clarify correctly

### Smoke Tests

- `hi there open the budget100`
- `hey there i want you to open the links panel b`
- `can you open recent`
- `please open workspace budget100`
- ambiguous entry target
- ambiguous panel target
- regression:
  - `take me home`
  - `what was my last action?`
  - `open budget100`
  - `open links panel b`

## Acceptance

This addendum is successful when:

- noisy conversational phrasings for known navigation commands resolve consistently, not just `go_home`
- exact/strong navigation retrieval still preserves a real no-LLM path when the validated resolver already suffices
- weak/empty retrieval still reaches bounded-LLM fallback for the approved V2 navigation families
- ambiguous targets still clarify directly
- validators/resolvers remain the execution authority
- the product no longer behaves as though only Home navigation has robust fallback handling

## Decision

Use this as the next Phase 5 scope expansion.

Do not replace normal validated navigation with semantic memory.
Do not use retrieval as direct execution authority.
Do not broaden V2 into unrelated semantic lanes.
Do expand the proven fallback pattern from `go_home` to the broader set of known validated navigation commands.
