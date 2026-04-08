# Duplicate-Capable Family-First Routing Plan

## Goal

Fix the remaining routing inconsistency for duplicate-capable widget/panel nouns such as:

- `links panel`
- `open links panel`
- `navigator`
- `open navigator`

These are real widget/panel nouns. The app already knows they are duplicate-capable. The remaining problem is that routing still tends to retrieve a concrete `open_panel` winner first and only apply duplicate-family checks later.

This proposal makes family identity the primary routing object for generic duplicate-capable nouns.

The existing `open links panel` behavior with multiple visible siblings is the correct behavioral reference:

- multiple links-panel siblings -> clarify with panel names

The proposal keeps that user-facing behavior, but applies it through one unified family-first contract for both:

- bare noun forms like `links panel`, `navigator`
- verb forms like `open links panel`, `open navigator`

It does **not** include `entries` or `workspaces`. Those are a separate content/container-navigation problem.

## Current Problem

The app already has duplicate-awareness:

- duplicate family IDs are defined in `lib/dashboard/duplicate-family-map.ts`
- panel creation persists `duplicate_family` / `instance_label`
- `visibleWidgets` exposes `duplicateFamily` / `instanceLabel` to chat routing

But the chat router still behaves too concretely too early:

- semantic seeds still produce concrete `open_panel` candidates
- helper resolution still resolves by exact title or type
- replay re-resolution still falls back toward title-based winners
- duplicate-family checks act as late guards rather than the primary contract

Symptoms:

- generic `navigator` can collapse to one concrete visible navigator-family panel
- generic `links panel` can collapse to one concrete links-panel sibling
- `open links panel` may clarify correctly while `links panel` remains more concrete
- behavior depends too much on whichever concrete winner was retrieved first

## Desired Contract

For duplicate-capable widget/panel nouns, generic forms must route as **family-level candidates first**.

### Generic Family Nouns

Examples:

- `links panel`
- `open links panel`
- `navigator`
- `open navigator`

Behavior:

1. semantic retrieval identifies the widget/panel family
2. runtime inspects visible/resolvable instances for that family
3. policy decides:
   - one valid visible/resolvable instance -> execute
   - multiple siblings -> clarify with panel names
   - zero valid instances -> safe fallback

Generic family nouns must not be treated as direct concrete instance winners.

Important rule:

- the presence or absence of the verb `open` must not change the family-level policy
- `links panel` and `open links panel` must share the same runtime family rule
- `navigator` and `open navigator` must share the same runtime family rule

### Explicit Instance Nouns

Examples:

- `links panel a`
- `links panel b`
- `navigator b`

Behavior:

- explicit selector-specific forms may resolve directly to the named instance
- selector metadata remains authoritative when present

## Non-Goals

This proposal does not change:

- singleton widget/panel nouns like `recent` or `widget manager`
- content/container nouns like `entries` or `workspaces`
- question-history durability rules

## Root Cause

The issue is not missing duplicate-family knowledge. The issue is that duplicate-family knowledge is not used early enough as the routing identity.

Today the stack still often does this:

1. retrieve a concrete `open_panel` candidate
2. resolve it to a concrete visible widget by title/type or replay metadata
3. apply duplicate-family checks later

For duplicate-capable nouns this is the wrong ordering.

The correct ordering is:

1. identify family
2. inspect runtime sibling count
3. decide execute vs clarify
4. only then resolve a concrete instance

## Proposal

### 1. Make Generic Duplicate-Capable Nouns Family-Level Candidates

For:

- `links panel`
- `open links panel`
- `navigator`
- `open navigator`

the routing system should carry family identity, not only `action_type: open_panel` + concrete target assumptions.

Conceptually the candidate should expose:

- `target_kind: family`
- `family_id`
- `duplicate_capable: true`
- `execution_policy: runtime_family_resolution`

Exact field names may differ in implementation, but the contract must be family-first.

Behavioral target:

- preserve the current successful `open links panel` outcome when multiple siblings exist
- generalize that same clarify-first family behavior to bare nouns like `links panel`
- apply the same unified behavior to `navigator` / `open navigator`

### 2. Keep Explicit Instance Nouns Concrete

Selector-specific forms still resolve directly:

- `links panel a`
- `links panel b`
- `navigator b`

These may carry:

- `family_id`
- `instanceLabel`
- `selectorSpecific: true`

### 3. Stop Using Title/Type Resolution as the Primary Meaning for Generic Family Nouns

Helpers like `resolveToVisiblePanel()` are acceptable only after runtime family cardinality says execution is safe.

For generic duplicate-capable nouns they must not be the first interpretation layer.

### 4. Keep Duplicate-Family Guards as Safety Backstops

Existing duplicate-family checks remain necessary:

- Stage 5 replay
- trailing-question path
- active-clarifier semantic escape execution

But those checks should be backup safety, not the primary architecture.

## Implementation Scope

Primary scope:

- `links panel`
- `open links panel`
- `navigator`
- `open navigator`

Out of scope:

- `entries`
- `workspaces`
- content/item-navigation clarification

## Acceptance Criteria

### No Clarifier Active

- `navigator` with one visible/resolvable navigator-family instance -> execute
- `navigator` with multiple visible/resolvable navigator-family siblings -> clarify
- `links panel` with one visible/resolvable links-panel instance -> execute
- `links panel` with multiple visible/resolvable links-panel siblings -> clarify
- `open navigator` follows the same runtime family rule as `navigator`
- `open links panel` follows the same runtime family rule as `links panel`
- if `open links panel` currently clarifies correctly with multiple siblings, `links panel` must do the same under the same runtime state
- if `open navigator` currently differs from `navigator`, that difference is a bug, not a feature

### Explicit Instance Forms

- `links panel b` opens Links Panel B when valid
- `navigator b` opens Navigator B when valid
- selector-specific forms do not degrade into generic-family clarification if the named instance is valid

### Active Clarifier

- generic duplicate-capable nouns must not auto-open one sibling merely because a concrete semantic escape candidate existed
- if multiple siblings exist, active-clarifier escape must re-clarify rather than execute a concrete panel

## Required Tests

1. `navigator` with one visible navigator-family instance -> executes.
2. `navigator` with multiple visible navigator-family siblings -> clarifies.
3. `open navigator` with multiple visible navigator-family siblings -> clarifies.
4. `links panel` with one visible links-panel instance -> executes.
5. `links panel` with multiple visible links-panel siblings -> clarifies.
6. `open links panel` with multiple visible links-panel siblings -> clarifies.
7. `links panel` and `open links panel` produce the same outcome under the same runtime sibling state.
8. `navigator` and `open navigator` produce the same outcome under the same runtime sibling state.
9. active-clarifier semantic escape for generic `links panel` with multiple siblings -> does not auto-open; re-clarifies.
10. active-clarifier semantic escape for generic `navigator` with multiple siblings -> does not auto-open; re-clarifies.
11. explicit `links panel b` with valid visible target -> executes exact instance.
12. explicit `navigator b` with valid visible target -> executes exact instance.

## Success Condition

The routing system should behave as if it knows this rule natively:

- singleton widget nouns can open directly when valid
- duplicate-capable generic widget nouns must be family-resolved first
- explicit instance widget nouns may execute directly

That is the behavior the runtime metadata already supports. This proposal makes the routing architecture respect it early enough.
