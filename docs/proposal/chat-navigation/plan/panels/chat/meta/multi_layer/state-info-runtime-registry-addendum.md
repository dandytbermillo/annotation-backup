# State-Info Runtime Registry Addendum

## Purpose

This addendum defines how current-state widget/panel questions are resolved without
entering semantic docs routing, generic grounding clarifiers, or LLM-generated
disambiguation.

It is an implementation addendum to the widget/panel known-noun contract, not a
replacement for it.

It should be treated as the concrete design addendum for Step 10 in the detailed
implementation plan, not as a parallel authority or a separate routing track.

## Scope

This addendum covers widget/panel state-info questions about the current dashboard
or workspace state, including:

- `what panel is open?`
- `what widgets are open?`
- `is recent open?`
- `which navigator is open?`
- `is links panel a open?`
- `which links panel is open?`

This addendum does not change:

- navigation/query routing for bare nouns such as `links panel` or `navigator`
- docs/info routing for question-shaped covered nouns such as `what is links panel?`
- entry/container semantics such as `entries` or `workspaces`

## Authority

This file refines the existing Step 10 implementation direction:

- add one unified state-info resolver
- use existing runtime sources
- keep state-info outside semantic docs/question routing

It should therefore be referenced from the detailed plan as the implementation design
for Step 10 follow-up work.

It should not be treated as:

- a second main proposal
- a competing routing plan
- a change to the already-settled widget/panel navigation contract

## Core Rule

State-info questions must resolve from one authoritative live widget runtime
registry.

They must not:

- enter covered-noun docs/info routing
- enter generic semantic-question handling
- fall into generic grounding clarifiers unless the state-info executor has
  no bounded answer

The resolver, routing layer, and LLM context should read the same registry-facing
state model rather than reading multiple raw app fields independently.

Freeform widget/panel state-info queries should still use semantic retrieval for
retrieval, validation, and dashboard/workspace/family/instance scoping before
execution.

Deterministic handling should remain limited to bounded option-selection forms such
as `1`, `2`, `3`, `first`, `second`, and `third`, and should not expand into raw
freeform state-info understanding.

The final state-info answer must still come only from the authoritative runtime
registry.

## Authoritative Runtime Registry

The intended design is one authoritative widget runtime registry for the current
turn/session.

Widgets/panels should register runtime state into that registry when they are
opened, activated, focused, surfaced, or otherwise become relevant to current
interaction.

That registry is the source of truth for current widget/panel state-info.

Legacy/raw app fields may still exist during migration, but they should be treated as
producer inputs to the registry builder, not as separate resolver truths.

Examples of acceptable producer inputs:

- current open panel drawer state
- widget snapshot / `openWidgets` state
- panel metadata already carried by runtime/dashboard state
- workspace runtime state, only when workspace support is intentionally in scope

But the consumers should read one registry/model only.

For the current dashboard-first implementation slice, workspace state-info remains
explicitly deferred until its concrete workspace-side runtime source is named.

## Runtime State Model

The state-info resolver should operate over a normalized registry view with shared
fields for all widget/panel instances plus widget-type-specific state manifests.

### Common fields

- `family_id`
- `display_name`
- `type`
- `instance_id`
- `instance_label`
- `title`
- `duplicate_capable`
- `open`
- `active` only if/when active-state queries are intentionally admitted later
- source surface:
  - dashboard
  - workspace

### Widget-type-specific manifest

Each widget type may attach bounded temporary/runtime state appropriate to that
widget.

Examples:

- `recent`
  - selected item
  - item count
  - current mode
- `links panel`
  - current view
  - selected entry
  - visible entry count
- `navigator`
  - current node
  - expanded groups
  - selected destination

Generic state-info routing should read only the shared/common fields unless a query
explicitly requires widget-specific state.

This registry may be assembled at read time from existing runtime structures during
migration, but the resolver-facing contract remains one authoritative registry/model.

## Resolution Classes

### 1. Generic State-Info

Examples:

- `what panel is open?`
- `what panels are open?`
- `what widgets are open?`

Resolution rule:

- answer directly from the shared runtime registry
- no noun binding required

Expected outcomes:

- `what panel is open?` -> bounded list of widget-shell titles whose current registry `open` state is true
- `what panel are open?` / `what panels are open?` -> bounded list of widget-shell titles whose current registry `open` state is true
- `what widgets are open?` -> bounded list of widget-shell titles whose current registry `open` state is true
- `what is the active panel?` / `which panel is active?` -> the current active panel/widget from the registry, or a bounded negative answer if none is active
- `what is the active widget?` / `which widget is active?` -> the current active panel/widget from the registry, or a bounded negative answer if none is active

Normalization clarification:

- if the product keeps the phrase `what widgets are visible?`, the current state-info
  slice should normalize it centrally to the same meaning as `what widgets are open?`
- that phrase must not silently map to dashboard inventory/presence
- that normalization choice must live in one centralized resolver/query-normalization
  path and be tested consistently; different resolver branches must not assign
  different meanings to the same phrase

Open-widget-shell definition:

- an "open widget" for this addendum means a widget shell that has been opened and
  remains open until explicitly closed by the product
- "open" is not limited to the one currently active drawer or the most recently
  surfaced panel
- widgets should self-register into the runtime registry when they become open and
  should update that registry when they close
- the registry may additionally track active/currently surfaced state separately
  when needed, but `open` and `active` must not be conflated
- closed widgets may either:
  - unregister from the runtime registry
  - or remain registered with `open: false`
- whichever approach is chosen, current-state answers must read the current `open`
  state only
- the implementation must not silently mix dashboard inventory semantics into
  `what widgets are open?` just because a registry producer is incomplete

### 2. Singleton Noun State-Info

Examples:

- `is recent open?`
- `is widget manager visible?`

Resolution rule:

- bind the noun to its singleton family
- answer from current runtime state for that family

Expected outcomes:

- yes/no if the question is boolean
- a bounded sentence if the question asks for state description

### 3. Duplicate-Capable Family State-Info

Examples:

- `which navigator is open?`
- `is links panel open?`

Resolution rule:

- bind the noun to the family
- inspect live siblings in the runtime model
- answer from the current sibling set rather than selecting one by semantic winner

Expected outcomes:

- none open -> bounded negative answer
- one open -> name that instance
- multiple open -> bounded list of open instances

For boolean forms such as `is links panel open?`, the default answer shape should be:

- strict yes/no first
- optionally followed by bounded supporting detail naming the open instance or
  instances

Example:

- `Yes. Links Panel A and Entries Links Panel CC are currently open.`

For `open` questions, the resolver must use open-state only.

`what panel is open?`, `what panel are open?`, `what panels are open?`, and
`what widgets are open?` all refer to:

- all widget entries whose current registry `open` state is true

Even when the user phrases the question in singular form, `open` still means
opened-and-not-closed, not merely the one currently active drawer.

If the product also needs current-focus/current-drawer answers, those must be
handled as separate active/current-state questions rather than by narrowing the
meaning of open-state.

For `active` questions, the resolver must use active/current-state only.

`what is the active panel?`, `what is the active widget?`, `which panel is active?`,
and `which widget is active?` refer to the current active/currently focused
registry entry.

Expected active-state outcomes:

- none active -> bounded negative answer
- one active -> name that panel/widget

In the normal dashboard drawer case, there should be at most one active panel/widget
at a time.

Visible-but-not-open siblings must not be reported as matching `which X is open?`
or `is X open?`

For `visible` questions, the resolver may use visibility state instead.

These questions must not collapse into generic family clarification intended for
navigation commands.

### 4. Specific Instance State-Info

Examples:

- `is links panel a open?`
- `is entry navigator c visible?`

Resolution rule:

- bind to the exact instance selector first
- answer for that instance only

Expected outcomes:

- exact yes/no or exact current-state answer

## Binding Rules

State-info binding should reuse the same canonical noun/family identity already used
by the widget/panel routing contract:

- singleton noun -> singleton family
- duplicate-capable noun -> family identity
- explicit selector form -> specific instance identity

The difference from navigation routing is only the outcome:

- navigation noun -> execute / clarify / fallback
- state-info noun -> retrieve/validate/scope first, then answer current state from the registry

## Active Clarification Precedence

State-info questions are breakout turns.

They must not be swallowed by an unrelated live clarification/selection context just
because `pendingOptions` or `lastClarification` is active.

Examples:

- `is recent open?`
- `which navigator is open?`
- `what panel is open?`

These should exit the bounded-selection ownership path and route to the state-info
path, where semantic retrieval handles scoping and the registry-backed executor
returns the answer.

## Cross-Surface Precedence

If the same family can appear in more than one surface context, the state-info
resolver must apply one consistent precedence rule.

Default precedence:

- current active surface first
- then the current dashboard/workspace runtime context already attached to the turn
- do not merge unrelated surfaces into one answer unless the question explicitly asks
  for all visible/open instances across surfaces

This prevents answers from mixing dashboard and workspace state in a way that feels
arbitrary to the user.

## Clarification Constraint

Registry-backed state-info execution should prefer bounded answers over generic clarifiers.

Allowed:

- `No navigator is currently open.`
- `The open navigator is Entry Navigator C.`
- `The visible links panels are Links Panel A, Entries Links Panel CC, and Links Panel B.`

Not allowed:

- generic semantic clarification such as `Which option did you mean?`
- LLM-influenced option sets for state-info queries when runtime state already has a
  bounded answer

If semantic retrieval plus runtime validation still cannot identify the
noun/family/instance, a bounded state-info clarification may be used, but only from
runtime widget identities already present in the registry and not from free semantic
grounding.

Any such bounded state-info clarification must:

- use only already-supported option types
- use runtime widget/family identities already recognized by the selection handler
- avoid introducing new ad hoc option payload shapes

## Snapshot Registry Constraint

Widget self-registration / snapshot infrastructure may be used only as a producer for
the authoritative runtime registry, and only for widget/panel shell state facts
relevant to state-info resolution.

It must not be used as an item-level grounding source for state-info answers about
widget/panel state.

Examples of allowed producer data:

- widget title
- widget current open state
- widget current active state if admitted later
- widget current view summary when explicitly needed for state description

Examples of disallowed snapshot usage for this addendum:

- list items inside the widget
- item labels such as `summary100` or `budget200` when answering widget/panel
  open-state questions

## Built-In And Third-Party Widgets

This addendum must work for both built-in and third-party widgets that already expose
the routing/runtime metadata required by the main widget/panel contract and can
register current runtime state into the authoritative registry.

Automatic coverage depends on existing metadata being available to the runtime state
reader, especially:

- `family_id` or duplicate family identity
- instance identity/label
- title/display name
- open state
- widget-type-specific runtime manifest where relevant

## Test Matrix

Minimum deterministic tests:

- `what panel is open?`
- `what widgets are open?`
- if `what widgets are visible?` remains product-valid, it must be tested against
  the one centralized normalization choice
- `is recent open?`
- `what is recent open state?`
- `which navigator is open?`
- `is navigator open?`
- `is links panel a open?`
- `which links panel is open?`
- duplicate-capable family with zero open instances
- duplicate-capable family with one open instance
- duplicate-capable family with multiple visible/open instances
- widget installed/configured but not opened -> excluded from `what widgets are open?`
- surfaced widget behavior -> explicitly pinned to the chosen open-widget-shell
  definition

Negative/regression tests:

- state-info questions do not enter semantic-question docs routing
- state-info questions do not produce generic grounding clarifiers
- state-info questions do not produce unsupported option types in selection handling
- installed/dashboard inventory state must not leak into `what widgets are open?`

## Non-Goals

This addendum does not define:

- durable question-history/writeback behavior
- entry/container navigation contracts
- widget content/item grounding inside a widget list
- dashboard inventory queries such as `what widgets are on the dashboard?` or
  `which widgets are installed in this dashboard?`

Those remain governed by their own plans.
