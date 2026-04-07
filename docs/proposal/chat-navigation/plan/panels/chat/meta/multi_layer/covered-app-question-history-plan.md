# Covered App Noun/Family Question History Plan

## Goal

Define a safe history-and-writeback policy for question-shaped queries about covered app nouns and families, such as:

- `what is recent?`
- `what is links panel?`
- `links panel?`
- `widget manager?`

The goal is to let the system reuse prior successful app-question turns without turning general questions into durable app-routing memory.

This proposal extends the existing semantic-first known-noun contract. It does **not** create a second router.

## Ownership Boundary

This document is a supporting addendum, not a separate authoritative proposal plan.

The single source of truth for covered nouns and covered noun-questions remains:

- `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/known-noun-policy-contract-plan.md`

That plan owns:

- semantic family detection
- question-policy vs execute/clarify/safe-fallback behavior
- runtime family validation

This addendum only elaborates the extra question-history layer for already-covered question-shaped turns:

- when bounded prior validated question turns may help
- what metadata may be durably saved
- what must never be promoted into durable memory

## Core Principle

Chat history may be used as a **secondary retrieval signal** for covered app noun/family questions.

It must not be used as an unscoped general-question memory system.

So the order is:

1. determine whether the current turn is a covered app noun/family question
2. if yes, use semantic retrieval first, plus bounded prior-history evidence only as a secondary signal
3. apply question-policy (`open-vs-docs`, `docs/info`, or clarification)
4. only then consider durable save/writeback under the normal success contract

## Scope Boundary

This plan applies only to:

- nouns and noun-question forms that are already covered by the current family/capability map
- supported question-shaped forms derived from those covered nouns
- family nouns intentionally admitted by the known-noun policy contract

Examples in scope:

- `recent?`
- `what is recent?`
- `links panel?`
- `what is links panel?`
- `widget manager?`
- `what is widget manager?`

Out of scope:

- arbitrary research questions
- open-ended general knowledge questions
- noun-like input not covered by the family/capability map
- unsupported phrases admitted only by analogy

Examples out of scope:

- `what is navigation in ux`
- `what is panel design`
- `how do website links work`
- `what is dashboard architecture`

## Why This Is Needed

The current known-noun policy correctly says covered app nouns and question-shaped forms belong to the same shared semantic system.

But question turns need an extra protection:

- they may benefit from prior successful app-question turns
- they must not pollute durable memory with unrelated general questions

So a **covered-family gate** must exist before permanent save.

## Anti-Pattern Guard

This proposal follows the repository anti-pattern guidance in spirit:

- do not create a separate history-first router
- do not let chat history replace semantic retrieval
- do not let arbitrary chat history become durable routing authority

History is supporting evidence only. Durable authority still follows the normal validated success/writeback contract.

## Retrieval Model

For a question-shaped input:

1. semantic retrieval identifies whether the query maps to a covered app noun/family
2. if the family is covered, bounded chat-history retrieval may look for:
   - exact prior covered question forms
   - close prior covered question forms
   - prior validated clarification resolutions for the same family
3. runtime policy then decides the outcome:
   - `trailing ?` with one concrete safe target -> open-vs-docs prompt
   - `trailing ?` with multiple valid family siblings -> clarification
   - `trailing ?` with zero valid visible/resolvable targets but known covered family -> docs/info by default
   - full question form -> docs/info path
   - family ambiguity -> clarification
   - no valid family match -> fall through out of this feature

History does **not** decide app relevance on its own.

Clarification:

- semantic retrieval is still the primary family-detection step
- chat history is supporting evidence only
- this plan must not be implemented as a history-first or history-only path
- if semantic retrieval does not establish a covered family, this feature does not apply

## Covered-Family Gate Before Durable Save

Before writing any question-shaped turn into durable semantic/chat memory for this feature, the system must confirm:

1. the turn is a covered app noun/family question
2. the family exists in the current family/capability map
3. the outcome was a valid app-scoped result:
   - docs/info for that family
   - open-vs-docs prompt for that family
   - bounded clarification for that family
   - or a later validated successful resolution derived from that family

If any of those checks fail, the turn must **not** be saved into covered-app question history.

## Data To Save

If the gate passes, durable history/writeback should store app-scoped metadata, not just raw text.

Suggested fields:

- `query_text`
- `normalized_query_text`
- `query_shape`
  - `trailing_question`
  - `full_question`
- `family_id`
- `target_kind`
  - `family`
  - `specific_target`
- `question_policy`
  - `open_vs_docs`
  - `docs_info`
  - `clarification_required`
- `resolved_target_ids` when applicable
- `source`
  - `curated`
  - `learned`
  - `history_supported`
- `precedent_strength`
  - `strong_resolved`
  - `clarification_derived_downranked`
- `validated_success`

This keeps question memory anchored to app families rather than vague text similarity.

## What Must Not Be Saved

Do **not** save:

- arbitrary general questions
- unsupported noun-like phrases
- failed question turns
- vague turns that never resolved to a covered family
- turns that only matched because of stale chat context

Do **not** promote session-local hidden conversation context directly into durable memory.

Normal success, validation, and writeback rules still govern any durable save.

If a question-history row comes from a clarification-derived outcome, it must not be reused as a strong direct precedent.

It may be saved only as down-ranked / non-direct-use evidence for the same family.

## Decision Rule

For question-shaped turns:

1. if the query is not in the covered family/capability map -> this feature does not apply
2. if it is covered -> use semantic retrieval first
3. optionally use bounded chat history as supporting evidence for the same family
4. apply question-policy:
   - one concrete safe target + trailing `?` -> open-vs-docs
   - multiple valid family siblings + trailing `?` -> clarification
   - zero valid visible/resolvable targets + trailing `?` but known covered family -> docs/info
   - full question form -> docs/info
5. only if the final result is a valid covered-family outcome may the turn be durably saved
6. if a saved row came from a clarification-derived outcome, it must remain down-ranked / non-direct-use
7. if all app-scoped checks fail, fall back to the normal non-feature path without durable covered-question save

## Relationship To Existing Known-Noun Contract

This proposal does **not** change the base contract:

- bare known noun -> execute after one strong safe semantic winner and valid target resolution
- explicit question form -> do not execute
- ambiguous family noun -> clarify

It only adds:

- a bounded chat-history support path for covered app questions
- a mandatory covered-family gate before permanent save

Supporting split:

- `known-noun-policy-contract-plan.md`
  - is the single authoritative proposal plan
  - owns the base behavior for covered nouns and covered noun-questions
  - owns semantic family detection
  - owns question-policy vs execute/clarify policy
- `covered-app-question-history-plan.md`
  - is a subordinate supporting addendum
  - details the extra history/writeback rules for those question-shaped turns
  - details when prior validated question turns may help
  - details what can and cannot be durably saved

## Examples

Should use this feature:

- `what is links panel?`
  - family identified: `links_panel`
  - prior covered question history may help
  - final outcome: docs/info
  - durable save allowed if validated

- `links panel?`
  - family identified: `links_panel`
  - one concrete safe target -> open-vs-docs
  - multiple siblings -> clarification
  - zero valid targets but known family -> docs/info
  - durable save allowed if validated

- `what is recent?`
  - family identified: `recent`
  - final outcome: docs/info
  - durable save allowed if validated

Should **not** use this feature:

- `what is dashboard architecture`
  - not a covered family noun question
  - no covered-question save

- `how do links work on websites`
  - general question
  - no covered-question save

## Verification

Expected behavior:

- `what is links panel?` uses the shared semantic pipeline, not a separate history router
- covered prior app-question history may improve family recognition or reduce LLM use
- unsupported/general questions do not get durably stored as covered app-question memory
- repeated covered question forms may resolve more efficiently after validated prior success
- family ambiguity still clarifies when required
- clarification-derived saved rows remain down-ranked / non-direct-use rather than acting as strong resolved precedents
- selection ownership still takes precedence over known-noun defaults where applicable

## Intended Use

This is a supporting addendum to the semantic-first known-noun policy.

It should be used to:

- keep app-question history bounded to covered families
- improve reuse of prior validated app-question turns
- prevent general question history from polluting durable app-routing memory
- preserve one shared semantic pipeline instead of adding a separate history router
- support the authoritative contract in `known-noun-policy-contract-plan.md`, not replace it
