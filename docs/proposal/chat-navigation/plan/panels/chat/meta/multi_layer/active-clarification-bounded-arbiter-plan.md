# Plan: Active Clarification Bounded Arbiter

## Goal

Replace the current fragmented active-clarification routing with one bounded arbitration step so the live chat clarifier stays authoritative while it is active.

This plan keeps:

- ordinal replies deterministic
- explicit validated eaarewhscapes possible
- cross-class target resolution available as bounded evidence

This plan removes:

- competing preemption by multiple regex/question gates
- widget context silently taking over a live chat clarifier
- lane-by-lane drift in badge/provenance behavior

## Core Rule

When a live chat clarification exists, routing order is:

1. ordinal deterministic
2. bounded LLM arbiter
3. re-clarify with the same bounded option set
4. general routing only after explicit exit / expiry / validated escape

No other lane may preempt step 2 while the clarifier is still live.

## Inputs To The Arbiter

The bounded arbiter receives:

- active clarification option set
- active clarification metadata
  - `messageId`
  - `activeOptionSetId`
  - current turn / TTL status
- explicit scope or destination cues
  - `from chat`
  - `from active widget`
  - `in the chat`
- validated explicit escape targets
  - note / entry / workspace / widget / panel targets already resolved by bounded source
- active widget/panel context as secondary evidence only
  - `focusLatch`
  - `widgetSelectionContext`
  - recent active surface metadata
- target class metadata for active clarification options
  - `widget`
  - `workspace`
  - `entry`
  - other supported target classes

The raw user query must be passed through unchanged.

## Allowed Arbiter Outcomes

The arbiter may return only one of:

- `select_clarifier_option`
- `escape_to_validated_target`
- `ask_clarify`
- `inform`

It must not invent new free-form candidate pools.

The arbiter must return a structured decision payload, not only an outcome enum.

Minimum payload fields:

- `decision`
- `selectedOptionId` when `decision = select_clarifier_option`
- `targetId` when `decision = escape_to_validated_target`
- `targetClass`
- `commandRef` or `resolvedActionRef`
- `sourceContext`
  - `active_clarifier`
  - `from_chat`
  - `validated_escape`
  - `repair_context` when applicable
- `basedOnTurnIds`
- `confidence`
- `reason`

This is especially important when the user is referring to a previous turn in the current conversation. The app needs to know not just that the arbiter chose `select_clarifier_option`, but which option id, from which source context, and based on which recent turn slice.

## Deterministic Rules

Deterministic execution remains limited to ordinal / pill-style replies:

- `1`
- `2`
- `first`
- `second`
- `the first one`
- `option 1`

Not deterministic:

- `entries`
- `entries workspace`
- `open entries`
- `that entries`
- `can you open that entries workspace`

Those go to the bounded arbiter.

`open entries` must be treated first as a broad name-match query across multiple target classes, not as a panel-only phrase. The live clarifier and the arbiter must preserve target-class metadata for every shown option.

## Clarifier Ownership Rules

While active clarification is live:

- chat clarification remains the primary conversational context
- widget/panel context must not silently take over
- active surface may inform arbitration but not replace the option set by default

Widget or panel takeover is allowed only when:

- the user gives explicit widget scope
- or the arbiter chooses a validated widget/panel target as an escape
- or the arbiter decides there is a conflict and asks for clarification

## Escape Rules

The arbiter may return `escape_to_validated_target` only when all are true:

- the target is outside the active clarification option set
- the target is validated by a bounded source
- explicit-target escape outranks the active clarifier for this turn
- the raw query is better explained as a new command than as a reply to the shown clarifier options

Examples:

- `open budget100`
- `open recent`
- `go home`
- `open workspace x`
- `open my last note`
- `link panel b`

This rule also covers commands that are unrelated to both:

- the active clarifier
- the active widget/panel context

If the user clearly starts a different command such as `open recent`, `go home`, or `open workspace x`, the arbiter should treat that as a new command. If the target validates, execute it and pause the clarifier. If it does not validate, return `ask_clarify` or `inform`; do not trap the turn inside the old clarifier.

If a target is not validated, do not escape.

If both the clarifier and the external target are plausible, return `ask_clarify`.

### Escape state handling

When the arbiter returns `escape_to_validated_target`:

- the live chat clarifier is **paused**, not silently cleared
- the paused clarifier keeps:
  - `messageId`
  - option set
  - source scope
  - turn / TTL metadata
- the paused clarifier may be resumed on the next turn if the user returns to it with a bounded follow-up such as:
  - `the second one`
  - `from chat`
  - `that first option`

If the user continues with unrelated commands, the paused clarifier expires through normal TTL rules.

This preserves:

- validated escape behavior
- resumability of the original clarification
- clear separation between “escaped for one turn” and “clarifier fully ended”

Paused-clarifier precedence rule:

- if a paused chat clarifier exists and widget/panel context is also live, the paused chat clarifier resumes first
- widget context does not outrank paused chat clarification by default
- widget context may still win only when:
  - explicit widget scope is given
  - or the arbiter chooses a validated widget/panel escape
  - or the arbiter returns a bounded conflict clarification

## Question And Request Handling

Question-shaped or polite phrasing must not be handled by scattered gates while clarification is active.

Instead:

- ordinals still resolve deterministically
- all other live-clarifier replies go to the bounded arbiter
- the arbiter decides whether the input is:
  - a clarifier selection
  - a validated escape
  - a real question / explanation request
  - a re-clarify case

Examples that should still be eligible for bounded arbitration:

- `can open that entries in the list`
- `can you open that entries workspace`
- `pls open that entries`
- `that entries workspace`

Examples that should not execute:

- `what is entries?`
- `which one is entries workspace?`
- `why are there multiple entries?`
- `can you explain how to open entries?`

## Re-Clarify Rules

If the arbiter cannot choose safely:

- re-show the same bounded option set
- keep the same clarifier context active
- include escape guidance

Suggested guidance:

- `Did you mean one of these options, or something else?`

Do not switch to an unrelated widget-only option set.
Do not fall through to Stage 6 or generic downstream routing first.

## Inform Rules

If the arbiter returns `inform`:

- do not execute
- do not silently replace the active clarification with another context
- keep the active clarification live unless the arbiter explicitly marks the turn as an exit or validated escape

This preserves follow-up behavior such as:

- `what is entries?`
- then `the first one`

So `inform` is explanatory, not clarifier-destroying.

## Conflict Rules

If both the active chat clarifier and active widget/panel context produce plausible targets for the same turn, the arbiter must return `ask_clarify`.

Conflict handling rules:

- do not auto-execute either side
- do not silently let widget context replace the live chat clarifier
- do not merge arbitrary candidate pools into one undifferentiated list

The conflict prompt must stay bounded and source-aware.

It should identify the competing bounded sources explicitly, for example:

- one option from the active chat clarifier
- one validated widget/panel target

The prompt may:

- re-show the active chat option set with an explicit escape hint
- or present a bounded two-source clarification

But it must not:

- create a fresh unrelated widget-only clarifier
- create an unbounded mixed candidate pool
- fall through to Stage 6 or generic downstream routing

## Provenance Rules

User-facing provenance must reflect the bounded decision outcome:

- `select_clarifier_option` -> `bounded_clarification`
- ordinal deterministic -> `deterministic`
- validated escape chosen by the active-clarifier arbiter -> `bounded_clarification`
- generic non-clarifier execution outside this flow -> `llm_executed`

Internal routing logs may still preserve lower-level lane details separately.

## Learned-Row Alignment

This plan must remain aligned with the existing durable memory contract.

Rules:

- a weak or ambiguous query that succeeds through clarification-mediated resolution may later become learned routing evidence through the normal validated writeback and promotion pipeline
- clarification-mediated success does not become deterministic authority immediately from a single success
- any durable promotion still depends on the existing success, validation, and promotion-tier rules
- the active-clarifier arbiter may improve the chance of a correct clarified success, but it does not replace the durable memory writeback contract

## Implementation Order

### Slice A: Add One Arbiter Contract

- define the arbiter input/output contract
- route all live-clarifier non-ordinal replies through it

### Slice B: Remove Chat-Clarifier Preemption

- remove unconditional widget-selection bypass while chat clarification is live
- stop semantic/question gates from making separate execution decisions during active clarification

### Slice C: Keep Widget Context Secondary

- allow widget context only as:
  - evidence
  - validated escape source
  - conflict source

### Slice D: Normalize Provenance

- all arbiter-driven clarifier selections or validated escapes show `bounded_clarification`

### Slice E: Diagnostics

Add structured debug fields:

- whether active clarification was live
- whether widget context was also live
- whether ordinal deterministic fired
- arbiter outcome
- whether escape target was validated
- whether fallback re-clarified

## Regression Tests

Must pass:

- active clarifier + `the first one` -> `Deterministic`
- active clarifier + `entries` -> `Bounded-Selection`
- active clarifier + `that entries workspace` -> `Bounded-Selection`
- active clarifier + `can open that entries in the list` -> `Bounded-Selection`
- active clarifier + `open budget100` -> validated escape or re-clarify
- active clarifier + `open recent` -> validated escape or re-clarify
- active clarifier + `go home` -> validated escape or re-clarify
- active clarifier + `open workspace x` -> validated escape or re-clarify
- active clarifier + validated escape + `the second one` -> paused clarifier resumes correctly
- paused chat clarifier + active widget context + `the second one` -> paused chat clarifier resumes first
- active clarifier + active widget context + `that entries` -> still chat-bounded arbitration first
- active clarifier + active widget context + plausible target on both sides -> conflict clarification, not widget takeover
- active clarifier + `what is entries?` -> not execute
- active clarifier + `what is entries?` + `the first one` -> clarifier still live and resumes correctly
- active clarifier + `which one is entries workspace?` -> not execute
- active clarifier + `open that workspace option from chat` -> `Bounded-Selection`

Must not happen:

- live chat clarifier replaced by unrelated widget-only clarifier
- Stage 6 execution before active-clarifier arbiter is exhausted
- plain widget context overriding live chat clarification without explicit scope or validated escape

## Notes

This is a proposal file only. It does not modify the current main plan yet.

Anti-pattern applicability:

- not applicable
- this is routing/context arbitration policy work, not provider/reactivity work
