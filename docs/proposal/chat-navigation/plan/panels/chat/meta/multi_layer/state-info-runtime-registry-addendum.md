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

This addendum covers deterministic state-info questions about the current dashboard
or workspace state, including:

- `what panel is open?`
- `what widgets are visible?`
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
- keep deterministic state-info outside semantic docs/question routing

It should therefore be referenced from the detailed plan as the implementation design
for Step 10 follow-up work.

It should not be treated as:

- a second main proposal
- a competing routing plan
- a change to the already-settled widget/panel navigation contract

## Core Rule

State-info questions must resolve from shared live runtime widget state.

They must not:

- enter covered-noun docs/info routing
- enter generic semantic-question handling
- fall into generic grounding clarifiers unless the deterministic state resolver has
  no bounded answer

## Existing Runtime Sources

The implementation should reuse existing runtime sources rather than introduce a
parallel registry:

- `uiContext.dashboard.visibleWidgets`
- `uiContext.dashboard.openDrawer`
- workspace runtime state already attached to the turn when in workspace mode,
  including the active workspace identity and any workspace-scoped visible/open
  widget state exposed through the same UI context or snapshot path
- widget UI snapshot registry
- panel metadata already carried by runtime/dashboard state:
  - `type`
  - `duplicateFamily`
  - `instanceLabel`
  - `title`

The required model is one unified read layer over those existing sources.

Workspace coverage must not be left implicit. If workspace state-info is in scope for
the current turn, the implementation must name and use the concrete workspace-side
runtime source rather than falling back to dashboard-only assumptions.

## Runtime State Model

The state-info resolver should operate over a normalized runtime view with:

- `family_id`
- `display_name`
- `type`
- `instance_id`
- `instance_label`
- `title`
- `duplicate_capable`
- `visible`
- `open`
- source surface:
  - dashboard
  - workspace

This model may be assembled at read time from existing runtime structures. It does
not require a second persistence layer.

## Resolution Classes

### 1. Generic State-Info

Examples:

- `what panel is open?`
- `what widgets are visible?`

Resolution rule:

- answer directly from shared runtime state
- no noun binding required

Expected outcomes:

- `what panel is open?` -> current open drawer title, or `No panel drawer is currently open.`
- `what widgets are visible?` -> bounded list of currently visible widget titles

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
- state-info noun -> answer current state deterministically

## Active Clarification Precedence

State-info questions are breakout turns.

They must not be swallowed by an unrelated live clarification/selection context just
because `pendingOptions` or `lastClarification` is active.

Examples:

- `is recent open?`
- `which navigator is open?`
- `what panel is open?`

These should exit the bounded-selection ownership path and route to the deterministic
state-info resolver.

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

Deterministic state-info should prefer bounded answers over generic clarifiers.

Allowed:

- `No navigator is currently open.`
- `The open navigator is Entry Navigator C.`
- `The visible links panels are Links Panel A, Entries Links Panel CC, and Links Panel B.`

Not allowed:

- generic semantic clarification such as `Which option did you mean?`
- LLM-influenced option sets for state-info queries when runtime state already has a
  bounded answer

If deterministic resolution truly cannot identify the noun/family/instance, a bounded
state-info clarification may be used, but only from runtime widget identities and not
from free semantic grounding.

Any such bounded state-info clarification must:

- use only already-supported option types
- use runtime widget/family identities already recognized by the selection handler
- avoid introducing new ad hoc option payload shapes

## Snapshot Registry Constraint

The widget UI snapshot registry may be used only for widget/panel shell state facts
relevant to state-info resolution.

It must not be used as a source of item-level grounding for state-info answers about
widget/panel state.

Examples of allowed snapshot usage:

- widget title
- widget visibility/presence
- widget current view summary when explicitly needed for state description

Examples of disallowed snapshot usage for this addendum:

- list items inside the widget
- item labels such as `summary100` or `budget200` when answering widget/panel
  open-state questions

## Built-In And Third-Party Widgets

This addendum must work for both built-in and third-party widgets that already expose
the routing/runtime metadata required by the main widget/panel contract.

Automatic coverage depends on existing metadata being available to the runtime state
reader, especially:

- `family_id` or duplicate family identity
- instance identity/label
- title/display name
- visibility/open state

## Test Matrix

Minimum deterministic tests:

- `what panel is open?`
- `what widgets are visible?`
- `is recent open?`
- `what is recent open state?`
- `which navigator is open?`
- `is navigator open?`
- `is links panel a open?`
- `which links panel is open?`
- duplicate-capable family with zero open instances
- duplicate-capable family with one open instance
- duplicate-capable family with multiple visible/open instances

Negative/regression tests:

- state-info questions do not enter semantic-question docs routing
- state-info questions do not produce generic grounding clarifiers
- state-info questions do not produce unsupported option types in selection handling

## Non-Goals

This addendum does not define:

- durable question-history/writeback behavior
- entry/container navigation contracts
- widget content/item grounding inside a widget list

Those remain governed by their own plans.
