# Plan: Repair Mode Bounded Arbiter

## Goal

Add a bounded repair mode for turns that reject or correct a recent execution, so the system is not helpless after:

- `no`
- `not that`
- `that is not what I meant`
- `wrong one`
- `I meant entry navigator c`

Repair mode should reuse the recent bounded decision context, recover the most likely intended target, and learn from the correction without letting routing restart from scratch.

## Core Rule

When a recent bounded execution exists and the next user turn is a rejection or correction, route the turn through a bounded repair arbiter before generic routing.

Routing order becomes:

1. detect repair-eligible follow-up
2. bounded repair arbiter
3. repair re-clarify with bounded context
4. generic routing only if repair context is expired, invalid, or explicitly abandoned

## What Counts As Repair-Eligible

Repair mode is eligible when all are true:

- the previous turn executed a bounded decision
  - clarifier selection
  - validated escape chosen while clarifier was active
- the current turn is adjacent enough in time / turns to reuse that decision
- the current turn is a rejection, correction, or repair follow-up

Examples:

- `no`
- `not that`
- `wrong one`
- `that is not what I meant`
- `I meant entry navigator c`
- `the other one`

Repair mode is not eligible when the user clearly starts a fresh unrelated command:

- `open recent`
- `go home`
- `open workspace x`

Those should go through the normal active-clarifier arbiter rules instead.

Pure bounded resume turns should also stay out of repair mode unless they are explicitly tied to a rejection or correction.

Examples:

- `from chat, the second one`
- `the second one`
- `that first option`

If these are being used to resume a paused/live clarifier rather than correct a rejected execution, they should stay in the active-clarifier flow, not enter repair mode.

## Repair Context To Preserve

The app must preserve a short-lived `lastDecisionContext` after each bounded execution.

It should include:

- raw user query that led to execution
- bounded candidate set that was available
- selected target
- executed command metadata
- alternative candidates that remained available
- provenance of the decision
  - `bounded_clarification`
  - `deterministic`
  - bounded validated escape
- active clarification metadata, if any
  - `messageId`
  - `activeOptionSetId`
  - option labels and ids
- active widget/panel metadata, if any
  - dashboard/screen id
  - active widget ids
  - `widgetSelectionContext`
  - focus / surface metadata
- validated escape candidates that existed at the time
- explicit scope cues used
  - `from chat`
  - `from active widget`
- turn index / timestamp / TTL metadata

## Why Metadata Is Required

Repair memory is not trustworthy without UI and routing metadata.

The system must be able to validate:

- whether the remembered option set is still the right one
- whether the same dashboard/widget state is still live
- whether the correction belongs to the previous bounded decision
- whether old repair memory should be ignored because the context changed

If the context no longer matches sufficiently, the repair arbiter must not silently reuse the old decision; it should re-clarify or fall back safely.

## Allowed Repair Arbiter Outcomes

The repair arbiter may return only one of:

- `select_alternative_option`
- `reopen_previous_clarifier`
- `escape_to_validated_target`
- `ask_repair_clarify`
- `inform`

It must not invent an unbounded candidate pool.

The repair arbiter must return a structured decision payload, not only an outcome enum.

Minimum payload fields:

- `decision`
- `selectedOptionId` when choosing an alternative option
- `targetId` when escaping to a validated external target
- `targetClass`
- `commandRef` or `resolvedActionRef`
- `sourceContext`
  - `repair_context`
  - `reopened_clarifier`
  - `validated_escape`
- `basedOnTurnIds`
- `rejectedTargetId` when applicable
- `confidence`
- `reason`

This lets the app validate the exact repaired target, identify which prior turn or execution the user was correcting, and avoid treating repair as an unstructured fresh query.

## How Repair Works

### Case 1: Rejection With Same Bounded Set

Example:

1. user: `open entries`
2. clarifier shown:
   - `Entries Widget` (`widget`)
   - `Entries Workspace` (`workspace`)
   - `entries budget100` (`entry`)
   - `entries budget200` (`entry`)
3. user: `that entries workspace`
4. app opens `Entries Workspace`
5. user: `no, that is not what I meant`

Repair mode should:

- reopen the recent bounded decision context
- exclude or de-prioritize the already rejected target
- preserve the remaining bounded alternatives
- preserve their target classes
- ask a bounded repair clarification or accept a direct correction

### Case 2: Direct Correction

Example:

1. recent execution opened `Entries Workspace`
2. user: `no, I meant the budget200 entry`

Repair mode should choose:

- `select_alternative_option`

and execute `entries budget200` if that target is still valid in the preserved bounded set.

### Case 3: Repair Escape

Example:

1. recent execution opened `Entries Workspace`
2. user: `no, I meant budget100`

If `budget100` is validated by a bounded source, repair mode may choose:

- `escape_to_validated_target`

Otherwise it must ask a bounded repair clarification instead of guessing.

## Rejection And Correction Memory

When the user corrects a previous decision, store a repair-memory record with:

- prior query
- prior chosen target
- correction text
- corrected target
- bounded option set / escape set present at the time
- target class for every shown option and corrected target
- UI/routing metadata fingerprint
- whether the correction was:
  - alternative option
  - validated escape
  - explanation / dissatisfaction only

This memory is advisory. It may improve later bounded decisions, but it must never outrank the current live bounded context.

Repair mode is compatible with normal learned-row writeback:

- if a weak or ambiguous query is recovered through repair or clarification and then ends in a final validated successful outcome, that successful phrasing may later become learned routing evidence through the existing writeback and promotion pipeline
- the repair-memory record itself is not the same thing as a promoted learned row
- correction history may guide future arbitration, but durable routing authority still follows the normal success/validation/promotion contract

## Memory Reuse Rules

Repair memory may be reused only when:

- the current bounded context is sufficiently similar
- the visible option set or validated target family matches
- the target classes are still compatible
- the dashboard/widget/surface fingerprint is compatible
- the reuse would not override stronger current evidence

Repair memory must not:

- blindly replay an old correction in a different screen/widget state
- override a live active clarifier with different options
- create a new target that is not present in the current bounded context or validated escape set

## Clarifier And Widget Rules During Repair

During repair mode:

- the most recent bounded decision context is primary
- active widget/panel context is secondary evidence unless the repair decision explicitly escapes there
- a live chat clarifier must not be replaced by widget-only options during repair

If both previous clarifier context and live widget context are plausible, return:

- `ask_repair_clarify`

not silent takeover.

## Inform Rules

If the user is not correcting the target but asking about the prior result, repair mode may return:

- `inform`

Examples:

- `why did you open that one?`
- `what is the entries workspace?`

`inform` does not clear repair context or active clarification by itself.

## Provenance Rules

User-facing provenance should reflect repair outcomes:

- `select_alternative_option` -> `bounded_clarification`
- `reopen_previous_clarifier` -> bounded repair clarifier / bounded clarification-family badge
- `escape_to_validated_target` during repair -> `bounded_clarification`
- `ask_repair_clarify` -> bounded repair clarifier / bounded clarification-family badge
- `inform` -> non-executing informative badge if present

Internal logs may retain lower-level lane metadata separately.

## Implementation Order

### Slice A: Preserve `lastDecisionContext`

- store the recent bounded execution context
- add TTL / turn expiry
- include UI/routing metadata needed for validation

### Slice B: Add Repair Eligibility Detection

- rejection phrases
- direct corrections
- short follow-up repair turns
- exclude clearly unrelated fresh commands

### Slice C: Add Repair Arbiter Contract

- bounded repair inputs
- bounded structured outputs
- no unbounded candidate discovery

### Slice D: Add Repair Memory Recording

- record user rejection/correction
- record corrected target and metadata fingerprint
- keep reuse advisory only

### Slice E: Add Repair Provenance And UI

- show bounded repair executions as `bounded_clarification`
- support reopening the previous clarifier cleanly

## Regression Tests

Must pass:

- bounded selection -> `no` -> bounded repair clarifier
- bounded selection -> `no, I meant the budget200 entry` -> opens corrected option
- bounded selection -> `the other one` -> bounded repair clarification or bounded selection
- bounded selection -> `no, I meant budget100` -> validated repair escape or repair clarification
- bounded selection + active widget context -> repair stays bounded to recent decision first
- bounded selection + `why did you open that one?` -> `inform`, no execute
- bounded selection + repair correction + same visible context later -> advisory memory may improve arbitration

Must not happen:

- `no` treated as a fresh unrelated routing turn by default
- repair memory replayed across incompatible dashboard/widget state
- old correction overriding a different live clarifier option set
- widget-only clarifier replacing the recent bounded decision during repair
