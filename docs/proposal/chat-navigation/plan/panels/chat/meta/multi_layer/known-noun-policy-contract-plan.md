# Known-Noun Policy Contract

## Goal

Define a simple, semantic-first policy for known-noun queries so the system does not need separate routing logic for:

- `recent`
- `open recent`
- `widget manager`
- `open widget manager`
- `navigator`
- `open navigator`

These are different query exemplars for the same target families. They should share:

- the same semantic retrieval pipeline
- the same curated and learned candidate pool
- the same validation and ranking contract

Only the post-retrieval policy should differ.

## Plan Ownership Split

This plan is the single authoritative proposal plan for covered nouns and covered noun-questions.

It owns:

- semantic family detection for covered nouns and covered noun-question forms
- question-policy vs execute/clarify/safe-fallback policy
- runtime family validation and cardinality rules
- the top-level rules for bounded question-history and durable-save eligibility for covered noun-question turns

The detailed supporting note for question-history behavior is:

- `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/covered-app-question-history-plan.md`

So the intended split is:

- this plan remains the source of truth for how covered nouns and covered noun-questions route
- the covered-app question history document is a subordinate supporting addendum for detailed history/writeback constraints

This avoids treating covered noun-questions as a separate proposal track while still keeping their memory/writeback policy bounded.

## Proposal Status

At the proposal level, this contract is implementation-ready for the widget/panel known-noun slice.

That includes:

- `recent`
- `widget manager`
- `links panel` / `open links panel`
- `navigator` / `open navigator`

The remaining work for that slice is implementation planning, coding, and verification.

Important scope note:

- content/container concepts such as `entries` and `workspaces` may still require a separate follow-up contract if product semantics differ from widget/panel noun routing
- they should not block implementation of the duplicate-capable widget/panel family contract defined here

## Simple Mental Model

- known noun by itself means "open it" only when runtime validation proves one safe visible or resolvable target
- explicit question-shaped known noun means "tell me about it"
- duplicate-capable family noun means "ask which one" when multiple visible siblings exist
- duplicate-capable family noun behaves the same with or without the verb `open`

This model applies inside the shared semantic pipeline, not through separate routing systems.

## Turn Ownership

The known-noun policy does not override live selection context.

If the system has just shown selectable options, that active selection context gets first claim on the next user turn.

Precedence is:

1. active chat clarification options
2. active panel or widget selection options
3. normal routing, including the known-noun policy in this proposal

So the known-noun policy applies when:

- there is no live selection context
- or the user clearly breaks out of the active selection context with a new command or question

## Phase 2 Scope Boundary

Phase 2 does not apply to arbitrary noun-like input.

It applies only to nouns and noun-question forms that are intentionally covered by the current family/capability map or explicitly admitted by this proposal.

Nouns not covered by that map are out of scope for Phase 2 unless they are intentionally added later.

## Canonical Cohort / Family Table

This table is the reviewable Phase 2 cohort. It is not a hardcoded per-turn outcome map.

It exists to make explicit:

- which noun families are in scope
- what family each noun belongs to
- whether the family is duplicate-capable
- what surface or resolver owns it
- what runtime policy should decide at execution time

| Query family | Canonical examples | Family / surface | Duplicate-capable? | Runtime policy |
|---|---|---|---|---|
| Recent | `recent`, `open recent`, `open recent widget` | `recent` drawer / manifest-backed surface | No, unless product changes later | Valid visible or resolvable target -> execute |
| Widget Manager | `widget manager`, `open widget manager` | `widget manager` surface | No, unless product changes later | Valid visible or resolvable target -> execute |
| Navigator family | `navigator`, `open navigator` | navigator-family surface | Yes | One valid instance -> execute; multiple -> clarify; none -> safe fallback |
| Links Panel family | `links panel`, `open links panel`, `quick links`, `open quick links`, `links panel a/b/c/d` | links-panel family surface; `quick links` is an in-family alias, not a separate family | Yes | Specific instance with one valid target -> execute; generic family with multiple -> clarify |
| Question-shaped covered nouns | `recent?`, `links panel?`, `what is recent?`, `what is links panel?` | same family as base noun | Depends on base family | Do not auto-execute; open-vs-docs or docs/info per question policy |

Notes:

- this table defines the authoritative Phase 2 review cohort
- it does **not** mean every row has one fixed outcome
- per-turn execute vs clarify still depends on runtime target validity and family cardinality
- unsupported nouns outside this cohort remain out of scope for Phase 2 unless intentionally added later
- `links panel` and `open links panel` share the same duplicate-capable family policy
- `navigator` and `open navigator` share the same duplicate-capable family policy
- content/container concepts such as `entries` and `workspaces` are intentionally excluded from this widget/panel cohort and should follow a separate contract if admitted later

## Selection Ownership Rules

To make turn ownership implementable, use the following normative rules.

### 1. Selection wins when the reply is selection-like

If the user reply is a selection-like response to currently live options, selection context owns the turn.

Examples:

- `1`
- `2`
- `recent`
- `links panel a`
- `the first one`
- `open the second option from chat`

If `Links Panel A` is an offered option, replying `links panel a` is treated as a selection reply, not as a fresh ambiguous family noun.

Observed runtime example:

- after `open links panel` shows a live clarification list containing `Links Panel A`
- replying `links panel a` resolves as selection and opens `Links Panel A`
- this is the intended behavior for ambiguous family labels inside a live selection context

### 2. Breakout wins when the reply is a fresh command or question

If the user reply is clearly a new command or a new question, normal routing resumes and the known-noun policy may apply.

Examples:

- `open recent`
- `show recent`
- `what is recent?`
- `open widget manager`
- `can you open recent?`

These should be treated as breakout turns, not as attempts to answer the prior selection set.

### 3. Recoverable recent options still count as live selection context

If the system is still within the recoverable selection window for recently shown options, those options still count as live selection context.

That means:

- recent message-derived option recovery still has first claim on the next turn
- known-noun defaults should not take over until that recoverable context expires or is clearly broken out of

Exception:

- recoverable recent options should **not** automatically own generic ambiguous family phrases such as:
  - `links panel`
  - `navigator`
  - `quick links`
- those generic ambiguous phrases should only be treated as selection replies when the option set is still **live** (for example, active pending options), not when it is merely recoverable

### 4. Overlapping selection contexts use precedence, and lower-priority context is suspended or cleared

When both are live, precedence is:

1. active chat clarification options
2. active panel or widget selection options
3. normal routing

The lower-priority context should not compete on the same turn. It should be treated as suspended, ignored, or explicitly cleared when the higher-priority context is restored or resumed.

For example:

- when chat clarification context is restored from message-derived options, lower-priority widget selection context may be cleared rather than kept live in parallel

### 5. Ambiguous family noun rule only applies outside selection ownership

The normal ambiguous-family rule:

- `links panel`
- `quick links`
- `navigator`

clarify as fresh turns.

But when one of those labels is already present in the **live** active selection context, the selection interpretation takes precedence.

If the context is only recoverable, generic ambiguous family phrases should not automatically resolve as selection replies.

## Anti-Pattern Guard

This proposal follows the repository anti-pattern guidance:

- do not create a second competing known-noun router
- do not gate correctness in an earlier special lane
- do not split bare-noun behavior from the shared semantic pipeline

Known nouns should be another entry form into the same semantic system, not a separate subsystem.

## Contract

### 1. Plain bare known noun -> execute

Examples:

- `recent`
- `widget manager`
- `navigator` only when one safe visible navigator-family instance exists

Policy:

- semantic retrieval runs first
- if there is one strong safe winner and one valid visible/resolvable target, execute
- the outcome should normally be a semantic execution, not a clarifier

This is the semantic equivalent of verb-form commands like:

- `open recent`
- `open widget manager`
- `open navigator`

### 2. Explicit question form -> do not execute

Examples:

- `recent?`
- `widget manager?`
- `links panel?`
- `what is recent?`
- `what is links panel?`

Policy:

- semantic retrieval still runs first
- question-shaped policy then changes the outcome:
  - trailing `?` noun form -> open-vs-docs prompt when one concrete safe target exists
  - trailing `?` noun form + multiple valid family siblings -> clarification
  - trailing `?` noun form + zero valid visible/resolvable targets but known covered family -> docs/info by default rather than generic clarification
  - full question form -> docs/info path
- do not panel-open just because semantic retrieval found a target

Ownership note:

- this plan owns the routing outcome for covered question-shaped noun forms
- this plan also owns the top-level rule that covered question turns remain semantic-first and may use bounded prior-question-history only as a secondary signal
- `covered-app-question-history-plan.md` exists only as a supporting detail document for the history/writeback constraints
- covered question turns still use the same shared semantic pipeline first; they do not bypass into a separate question router

### 3. Ambiguous family noun -> clarify

Examples:

- `links panel`
- `quick links`
- `navigator` when multiple navigator-family siblings are visible

Policy:

- semantic retrieval still runs first
- if multiple valid siblings/family members exist, clarify
- do not deterministically pick one sibling from a family noun

Important duplicate-capable family rule:

- the presence or absence of the verb `open` must not change the family-level policy
- `links panel` and `open links panel` must share the same runtime family rule
- `navigator` and `open navigator` must share the same runtime family rule
- if current `open links panel` behavior clarifies correctly with multiple siblings, bare `links panel` must do the same under the same runtime state
- if `open navigator` and `navigator` differ under the same runtime sibling state, that difference is a bug, not a feature

## Retrieval Model

These outcomes should come from one shared semantic model:

1. curated noun and verb exemplars point to the same target family
2. learned rows can outrank or complement curated seeds
3. shared validation applies after retrieval
4. policy chooses execute / docs / clarify

The system should not maintain:

- one router for bare nouns
- another router for verb-form commands
- another router for noun questions

Instead:

- different surface forms map into the same candidate universe
- policy decides the correct user-facing outcome

For generic duplicate-capable family nouns specifically:

- semantic retrieval should identify family identity first, not only a concrete panel winner
- runtime sibling/cardinality inspection should run before concrete instance resolution
- concrete instance resolution should only happen after runtime policy has decided execution is safe

For covered noun-question forms specifically:

- semantic retrieval remains first
- question policy remains part of this plan
- bounded question-history support, if used, is secondary and remains governed by this plan's semantic-first contract
- `covered-app-question-history-plan.md` may be referenced for detail, but it is not a second authoritative proposal plan

## Covered Question History Support

Covered noun-question forms stay inside this same proposal plan.

For covered noun-question forms such as:

- `recent?`
- `what is recent?`
- `links panel?`
- `what is links panel?`

the contract is:

1. semantic retrieval identifies whether the query maps to a covered family
2. bounded prior validated question history may be used only as a secondary signal
3. question-policy decides `open-vs-docs`, `docs/info`, or clarification
4. durable save is allowed only for validated covered-family outcomes
5. clarification-derived history rows, if saved, must be marked as down-ranked / non-direct-use evidence rather than a strong resolved precedent

This means:

- covered app noun/family questions are not a separate router
- covered app noun/family questions are not a separate proposal track
- the extra history/writeback rules are subordinate to the semantic-first known-noun contract

## Runtime Validation Model

Semantic retrieval is not the only input, and runtime widget names alone are not enough.

The intended flow is:

1. semantic retrieval identifies the likely family or target candidate
2. a live per-turn runtime registry or snapshot of visible or resolvable widget targets is consulted
3. post-retrieval policy decides execute vs clarify vs safe fallback

That runtime registry should reflect current dashboard or workspace state at routing time, not just app-load state.

If widgets are duplicated, closed, moved, renamed, or otherwise changed, routing should use the latest visible or resolvable snapshot.

The runtime registry should provide enough information for safe validation, including:

- family identity
- visible or resolvable target ids
- current availability
- sibling count
- metadata needed to build a safe open or a clarification

Runtime validation is therefore:

- not a replacement for semantic retrieval
- not only “store widget names temporarily”
- not only “currently open drawer widgets”

It is a live routing-time target registry used after semantic retrieval to decide whether the current target is safely executable or requires clarification.

## Family / Capability Metadata

The proposal should distinguish between:

1. authoritative product metadata
2. runtime routing outcome

What should be authoritative in product metadata:

- family identity
- whether a family is duplicate-capable at all
- what surface, manifest, or resolver owns that family
- whether a family is genuinely non-duplicable in the product
- whether a product term is a canonical family alias, for example `quick links` as an alias in the links-panel family

What should **not** be hardcoded as static noun behavior:

- always execute
- always clarify
- always fallback

Those outcomes depend on current runtime state, not just noun label.

So the intended split is:

- family/capability map says what a noun belongs to
- runtime registry says how many valid targets currently exist
- policy decides execute vs clarify vs fallback

For duplicate-capable panel/widget nouns this means:

- generic `links panel` / `open links panel` must be treated as the Links Panel family first
- generic `navigator` / `open navigator` must be treated as the Navigator family first
- explicit instance forms such as `links panel b` or `navigator b` may still resolve directly

This avoids treating widget nouns like `navigator` or `links panel` as permanently fixed behavior buckets when the real outcome depends on current visible or resolvable instances.

## Capability-Based Generalization

The current implementation slice is still anchored on concrete examples such as:

- `links panel`
- `open links panel`
- `navigator`
- `open navigator`

But the governing rule should be capability-based, not name-based.

That means the long-term contract is:

- any duplicate-capable widget family that supports generic noun routing uses family-first routing
- any singleton-safe widget family that supports generic noun routing may use direct validated open
- any selector-specific instance form may resolve directly when valid
- question-shaped forms remain governed by question-policy rather than auto-execution

So the distinction is:

- duplicate-capable vs singleton-safe
- generic family form vs explicit instance form

not:

- built-in widget A vs built-in widget B vs future widget C

### Automatic Coverage Rule

A future widget family is automatically covered by this contract only if it declares the metadata needed for routing.

This applies equally to:

- future built-in dashboard widgets
- third-party widgets

The router should not special-case origin. It should special-case capability and routing metadata.

### Required Routing Metadata

At minimum, an automatically covered widget family should expose:

- `family_id`
- canonical display name
- aliases or retrieval labels
- `duplicate_capable: true | false`
- selector semantics or `selector_mode`
- `supports_generic_noun_routing: true | false`
- `supports_question_policy: true | false`
- runtime visible or resolvable instances grouped by `family_id`

If that metadata is missing, the family should not be auto-covered by generic noun routing.

### Alias Collision And Precedence

Automatic coverage must also define collision safety for display labels and aliases.

If two or more widget families claim the same canonical noun, alias, or retrieval label:

- automatic generic noun routing must not silently pick one family
- the router must apply a deterministic precedence rule or reject automatic coverage for the colliding alias
- built-in versus third-party origin alone is not enough; the precedence rule must be reviewable and explicit

Minimum safe behavior:

- exact alias collision with no explicit precedence -> no automatic generic noun routing on that alias
- safe fallback, explicit clarification, or narrower selector-only routing instead
- only non-colliding aliases may participate in automatic generic noun routing by default

### Resulting Contract

If the metadata is present:

- duplicate-capable family + generic noun -> family-first routing
- singleton-safe family + generic noun -> direct validated open
- explicit instance form -> direct instance resolution
- question-shaped form -> question-policy

If the metadata is absent:

- no automatic generic noun routing
- safe fallback or narrower explicit routing only

### Phase 2 Implementation Scope vs Long-Term Rule

Phase 2 implementation still targets the currently active duplicate-capable families:

- Links Panel family
- Navigator family

But they are examples of the rule, not the final closed set.

So the intended evolution is:

1. implement the family-first contract for the currently active duplicate-capable families
2. generalize automatic coverage to any built-in or third-party widget family that exposes the required metadata

## Seed Guidance

Curated semantic seeding should treat noun and verb forms as the same family:

- `recent`
- `open recent`
- `open recent widget`

and:

- `widget manager`
- `open widget manager`

and:

- `navigator`
- `open navigator`

These can be separate seed rows, but they should share:

- `intent_id`
- action family
- target metadata
- validation expectations

For duplicate-capable panel/widget nouns:

- bare noun and `open` verb forms are separate exemplars of the same family-level request
- they must not diverge into separate routing policies
- generic duplicate-capable seeds should behave as family-level candidates first
- explicit instance seeds may remain concrete and selector-specific

This improves:

- exact matching for noun-only inputs
- semantic recall for wrapped/noisy inputs
- reduced LLM reliance
- more consistent clarification behavior

## Runtime Family Cardinality Rule

For duplicate-capable widget families, execute vs clarify should be decided by runtime target lookup, not only by a static noun bucket or regex class.

That runtime lookup must consider:

- visible targets that are already present in the current UI state
- resolvable targets that are not currently open, but can still be safely opened through the existing manifest, registry, or navigation contract

It should **not** be reduced to:

- only currently open drawer widgets
- only text-shape matching

Regex can help detect input shape, but it cannot determine:

- how many matching targets are actually available
- whether a noun maps to a duplicate-capable family
- whether the target is safe right now

Rule:

- non-duplicable or currently-singleton-safe known widget noun + valid target -> execute
- duplicate-capable family noun + one valid safe visible/resolvable instance -> execute
- duplicate-capable family noun + multiple valid visible/resolvable siblings -> clarify
- no valid visible or resolvable target -> safe fallback

Ordering rule:

1. identify the family
2. inspect runtime sibling count
3. decide execute vs clarify vs fallback
4. only if execution is safe, resolve a concrete instance

This is the intended behavior for:

- `links panel`
- `open links panel`
- `navigator`
- `open navigator`

This means:

- keep an authoritative family/capability map
- do **not** keep an authoritative per-turn outcome map

Per-turn outcome must come from runtime state plus policy, not from noun label alone.

This is better than treating all known nouns the same, and better than hardcoding a noun like `navigator` as always-execute or always-clarify.

Important caution:

- “one visible safe instance” should be read together with “valid visible or resolvable target”
- singleton drawer or panel opens such as `recent` or `widget manager` must not regress just because the target is not already open at the moment of the query
- if the target is resolvable through the normal safe open contract, direct execution can still be correct
- selection ownership and question-policy still sit above this default execute behavior
- some nouns may still be true product invariants because their families are genuinely non-duplicable, but that should come from family/capability metadata, not ad hoc noun bucketing

## Policy Summary

- bare known noun -> execute after one strong safe semantic winner and valid target resolution; for duplicate-capable families, "valid" includes family-cardinality validation first
- explicit question form -> do not execute; open-vs-docs or docs/info
- duplicate-capable family noun -> clarify when multiple visible siblings exist
- duplicate-capable family noun, with or without `open`, shares one runtime family policy

This is intentionally simpler than treating every bare known noun as execute-or-clarify-or-docs by default, while still letting runtime cardinality decide family behavior.

## Decision Rule

After semantic retrieval:

1. explicit question form -> do not execute; question-policy preempts default execute and chooses open-vs-docs, docs/info, or clarification
2. duplicate-capable family noun + multiple valid visible/resolvable siblings -> clarify; family-cardinality validation preempts default execute
3. one strong safe winner + one valid visible/resolvable target -> execute
4. useful but not safe candidate -> clarify
5. only if semantic/shared retrieval is empty or insufficient does downstream fallback run
6. if all else fails, final outcome is clarification

## Implementation Implications

This proposal implies:

- known nouns should bypass earlier non-semantic special handling when necessary to reach the shared semantic pipeline
- bare known nouns and covered noun-question forms should not be intercepted by older arbiter/state-info logic before semantic retrieval, unless the current turn is actually a surface-state question
- helper functions such as question guards, visibility checks, duplicate-family checks, and visible-panel resolution should remain policy helpers only
- active selection context still owns the next turn before normal known-noun defaults apply

## Bounded Arbiter-Bypass Cohort

The arbiter-bypass rule should be explicit and bounded.

It should apply only to:

- known noun forms present in the current family/capability map
- supported question-shaped forms derived from those same nouns
- any generic family nouns that are intentionally admitted by the current Phase 2 scope

It should **not** apply to:

- arbitrary noun-like input
- unsupported noun phrases outside the current family/capability map
- open-ended fuzzy noun guesses without a covered family
- surface-state questions that should remain on the state-info / arbiter path, for example `is recent open?` or `which navigator is open?`

This keeps the bypass as an ordering rule into the shared semantic pipeline, not as a second broad router.

## Verification

Expected outcomes:

- `recent` -> execute
- `open recent` -> execute
- `widget manager` -> execute
- `open widget manager` -> execute
- `navigator` -> execute when one valid visible/resolvable safe instance exists; clarify when multiple navigator-family siblings exist
- `open navigator` -> same runtime family-cardinality rule
- `navigator` and `open navigator` -> same outcome under the same runtime sibling state
- `links panel?` -> open-vs-docs prompt with one concrete safe target; clarify if family ambiguity prevents a concrete target; docs/info if the family is known but zero valid targets exist
- `what is links panel?` -> docs/info
- `links panel` -> execute when one valid visible/resolvable safe instance exists; clarify when multiple links-panel siblings exist
- `open links panel` -> same runtime family-cardinality rule
- `links panel` and `open links panel` -> same outcome under the same runtime sibling state
- `quick links` -> same family behavior as `links panel`; clarify for generic family use unless runtime validation collapses to one safe target
- `is recent open?` -> state-info path, not the covered noun-question bypass path
- `which navigator is open?` -> state-info path, not the covered noun-question bypass path

With live selection context:

- active chat clarification or panel/widget selection gets first claim on the next turn
- known-noun defaults apply only when the user is not currently inside that active selection flow, or clearly breaks out of it
- selection wins examples:
  - `1`
  - `links panel a`
  - `open the second option from chat`
- breakout wins examples:
  - `open recent`
  - `show recent`
  - `what is recent?`
  - `open widget manager`
- recoverable recent options still count as live selection context until they expire or the user clearly breaks out
- recoverable recent options do **not** automatically claim generic ambiguous family phrases like `links panel` unless the option set is still live
- runtime-confirmed example:
  - `open links panel` -> live clarifier with `Links Panel A`
  - reply `links panel a` -> selection resolves and opens `Links Panel A`

## Intended Use

This is a proposal-level policy contract.

It should be used to:

- simplify the detailed Phase 2 plan
- keep bare known nouns and verb-form known commands in the same semantic family
- prevent a return to separate routing lanes for known nouns
