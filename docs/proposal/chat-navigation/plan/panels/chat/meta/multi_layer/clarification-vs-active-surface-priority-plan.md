# Plan: Clarification-First and Active-Surface Follow-Up Priority

## Context

The current chat router already has most of the building blocks needed for context-aware follow-up handling:

- active clarification state
  - `pendingOptions`
  - `lastClarification`
  - `activeOptionSetId`
- active or just-opened surface state
  - `focusLatch`
  - `widgetSelectionContext`
  - `activeSnapshotWidgetId`
  - just-opened panel/note continuity
- explicit scope cues
  - `from chat`
  - `from active widget`
  - `from dashboard`
- bounded previous-turn routing metadata
  - `previousRoutingMetadata`
  - `recentRoutingContext`

But these signals are not yet governed by one clean priority rule.

This creates two related problems:

1. latest clarification can be cleared too aggressively by explicit-command bypass
2. active widget/panel context can take over when the user is still replying to the clarification

The user-visible failure looks like:

- assistant asks a bounded panel clarifier
- `Entries` is one of the shown options
- user replies `open entries`
- router treats that as a fresh command instead of a clarification follow-up
- the user gets the same clarification again, or an inconsistent execution path

## Goal

Define one shared routing policy where:

- explicit current-turn scope still wins first
- latest active clarification remains primary for option-like follow-ups
- active or just-opened widget/panel/note remains strong context for referential follow-ups
- focus changes alone do not make chat clarification stale

## Non-goals

This plan does **not**:

- replace the existing bounded selection system
- replace focus latch / widget selection context
- make active surface context override explicit clarification by default
- allow ambiguous commands to auto-execute

## Core Rule

The router must treat clarification context and active-surface context as **separate bounded signals** with a fixed order:

1. explicit current-turn scope, explicit destination, or explicit specific target
2. latest active clarification
3. active or just-opened surface
4. general routing

This means:

- `from chat` overrides widget context
- `in the chat` or other explicit chat-destination cues override generic `show` / `open` wording
- `from active widget` overrides chat-option context
- a recent clarification stays primary unless the user clearly escapes it
- a widget/panel becoming active does **not** by itself stale the chat clarification

Important distinction:

- explicit **scope** cues choose which conversational source/context the user means
  - `from chat`
  - `from active widget`
  - `from dashboard`
- explicit **destination** cues choose where the result should appear
  - `in the chat`
  - `here in chat`

These two cue types must not be collapsed into one undifferentiated override rule.

## Shared state model

This plan does not require inventing a brand-new store. It formalizes how the existing state should be treated.

### Clarification context

```typescript
type ActiveClarificationContext = {
  active: boolean
  messageId: string
  optionSetId: string
  options: Array<{
    id: string
    label: string
    type: string
  }>
  createdAtTurn: number
}
```

Current implementation equivalents:

- `pendingOptions`
- `lastClarification`
- `activeOptionSetId`
- `lastOptionsShown`
- `clarificationSnapshot`

### Active surface context

```typescript
type ActiveSurfaceContext = {
  kind: 'widget' | 'panel' | 'note'
  id: string
  label: string
  source: 'active' | 'just_opened'
  activatedAtTurn: number
}
```

Current implementation equivalents:

- `focusLatch`
- `widgetSelectionContext`
- `activeSnapshotWidgetId`
- just-opened note/panel continuity state
- `previousRoutingMetadata` for bounded previous-turn alignment

Source-of-truth rule:

- active or just-opened continuity must come from structured aligned state
- allowed sources:
  - `focusLatch`
  - `widgetSelectionContext`
  - explicit just-opened note/panel continuity state
  - aligned `previousRoutingMetadata` when it refers to the immediately prior handled turn
- not allowed:
  - generic panel visibility alone
  - raw UI focus alone without aligned routing state
  - ad hoc inference from whatever surface happens to be visible

This prevents one lane from treating “currently visible” as authoritative while another requires a real structured continuity signal.

## Priority semantics

### 1. Explicit current-turn scope, explicit destination, or specific target wins first

These must outrank both clarification context and active surface context:

- `from chat`
- `in the chat`
- `from active widget`
- `from dashboard`
- `open entry navigator c`
- `open links panel cc`

If the user supplies a clear, explicit target or explicit scope cue, route accordingly.

Explicit-target escape rule:

- an active clarification does not trap turns that clearly name a different specific target
- if the user names a specific target that is not part of the active clarification option set, that target may escape the clarification and route normally
- this escape is allowed only when the target is validated by a bounded candidate source, not by free-text specificity alone
- this includes:
  - a concrete note / item / entry target such as `open budget100`
  - a concrete active-panel clickable / shorthand target such as `link panel b`
- but if the same turn is also plausibly selecting from the active clarification, treat it as a conflict and clarify rather than silently escaping

Required distinction:

- explicit scope cue:
  - re-anchors conversational selection or retrieval context
- explicit destination cue:
  - constrains output location / delivery mode

If a destination cue conflicts with the leading candidate, that candidate must not execute just because it won retrieval or command-form parsing.

### 2. Latest clarification remains primary for option-like follow-ups

When an active clarification exists, check it before explicit-command bypass clears state.

Treat the input as a clarification-follow-up only when there is **strong selection evidence** that stays within the active option set, such as:

- clarification is still within TTL
- options are still active or safely recoverable
- ordinal or pill mapping
- clear option-shaped reply that is ordinal-only

Examples:

- `the first one`
- `option 1`
- `first`
- `2`

Important rule:

- ordinal or pill-style replies may resolve deterministically against the active clarification
- label or component-name replies like `entries`, `entry`, `home`, or `recent` must not resolve deterministically, even when they overlap a shown option
- command-shaped label replies like `open entries` must not resolve deterministically from label overlap alone
- if deterministic ordinal selection fails, the router must stay inside the same bounded clarification and call bounded LLM next
- if bounded LLM still cannot resolve uniquely, re-show the same bounded clarification with explicit escape guidance rather than falling through to general routing
- the re-shown clarifier may add a prompt such as "Did you mean one of these options, or something else?" and may include an explicit escape affordance like `Something else`

Operational threshold requirement:

Before implementation, the router must define these terms concretely in one shared helper contract:

- `strong overlap`
- `clear option-shaped reply`
- `clearly unrelated new specific command`
- `ordinal-only deterministic reply`

Those thresholds must not be left to lane-specific interpretation.

Required implementation artifact:

- define these thresholds in one small shared table or helper contract
- every lane must consult the same implementation, not restate the thresholds in prose or inline conditionals
- assign that shared threshold/helper contract a version identifier for telemetry and rollout analysis

Example shape:

```typescript
type ContextThresholds = {
  strongOptionOverlap: { unique: boolean; minConfidenceBand: 'high' | 'medium' }
  clearOptionShapedReply: {
    ordinal: boolean
    pillIndexed: boolean
    conciseOrdinalLike: boolean
  }
  ordinalOnlyDeterministic: {
    allowed: boolean
    reason: 'ordinal' | 'pill_index' | 'not_allowed_label'
  }
  clearlyUnrelatedNewSpecificCommand: {
    explicitTargetPresent: boolean
    overlapsActiveClarification: boolean
    referentialOnly: boolean
  }
}
```

Uniqueness rule:

- if label overlap is strong with more than one shown option
- do **not** treat the reply as a resolved selection
- clarify again from the same bounded option set
- do not just repeat the same pills silently; add explicit escape guidance so the user can either choose from the shown set or clearly break out of it

Example:

- options include `Entries` and `Entry Navigator`
- user says `entries`
- if the overlap is not uniquely decisive, return bounded clarification rather than executing or silently preferring one

### 3. Active or just-opened surface is primary for referential follow-ups

If no stronger clarification-follow-up match exists, active or just-opened surface context should guide **referential** turns such as:

- `read it`
- `summarize that`
- `show me the content`
- `what does it say`
- `what's in this panel`

This is where focus latch, active widget, and just-opened note/panel continuity should remain authoritative.

Important rule:

- visible or focused surface state alone must **not** win just because it exists
- active surface priority must be justified by referential wording or equivalent strong follow-up evidence

### 4. Conflict means clarify, not execute

If clarification context and active-surface context both produce plausible but different targets:

- do not execute
- reuse the bounded candidate set and return a tighter bounded clarifier
- when possible, add explicit escape guidance instead of a bare repeat so the user can say they meant something else without being trapped in a loop

Candidate-set discipline:

- do not build a fresh ad hoc pool from unrelated visible entities
- only use validated bounded candidates derived from:
  - the active clarification option set
  - the active-surface-compatible bounded candidate set
- specific-target escape is allowed only when the escaping target is validated by one of those bounded sources or another family-specific bounded candidate builder
- if neither set is trustworthy enough, clarify explicitly rather than inventing a new mixed pool

Ownership rule:

- panel follow-ups:
  - bounded candidate set must come from the panel clarification/grounding candidate builder already used by panel routing
- note follow-ups:
  - bounded candidate set must come from note-scoped follow-up / note routing candidates
- just-opened surface continuity:
  - bounded candidate set must be limited to that validated surface target unless an explicit conflict requires clarification

No lane may invent a separate ad hoc visible-entity pool when a family-specific bounded candidate builder already exists.

### 5. Visible provenance must reflect bounded live-context selection

User-facing provenance must answer:

- what bounded live context grounded the visible result

It must not simply mirror the lowest-level internal lane that happened to win.

Important distinction:

- internal telemetry may still record:
  - `routing_lane='B1'`
  - `decision_source='memory_exact'`
  - or other internal replay / routing details
- but the visible assistant badge must reflect the product meaning of the turn

Required rule:

- if an active clarification, active option set, or validated active widget/panel context is what actually grounds the selected target,
  the visible badge must be `🎯 Bounded-Selection`
- this remains true even when replay / memory-assisted lookup helps recover or identify the target internally

Examples:

- active clarification shows panel options
- active panel/widget also contains a validated target
- user says `open budget100`
- if the turn is resolved against that bounded live context, the visible result must be `🎯 Bounded-Selection`, not `Memory-Exact`

- active clarification is present
- user says `that entry navigator c`
- bounded LLM selects from the active clarification option set
- visible result must be `🎯 Bounded-Selection`

Plain replay rule:

- if no active clarification and no validated active bounded surface context exists,
  plain replay may keep its internal replay provenance
- if `Memory-Exact` remains visible anywhere, it must be limited to those plain replay cases only

No user-facing replay dominance:

- replay / memory provenance must not visually outrank the active bounded context that made the current turn interpretable
- the user-facing badge should prefer current bounded context over internal replay mechanics

Example:

- active panel is `Recent`
- active clarification options include `Entries`
- user says `open entries`

Clarification-follow-up should usually win because the input strongly matches a shown option.

But if the system cannot confidently decide:

- ask a tighter bounded question
- do not guess

## Staleness rules

### Clarification context does **not** become stale just because:

- a widget or panel becomes active
- a panel was just opened
- focus shifts in the UI

### Clarification context becomes stale only when:

- the clarification TTL expires
- the user explicitly changes scope
- the user gives a clearly unrelated new specific command
- a selection from that clarification was successfully executed
- the user explicitly dismisses or resets the clarification

Concrete examples of a clearly unrelated new specific command:

- active clarification is showing panel options, but the user says `open budget100`
- active clarification is showing panel options, but the user says `link panel b` and that target belongs to the active panel/widget rather than the shown clarification options

In those cases, the clarification may be paused and routing may follow the new specific target, unless the same turn also has a strong competing clarification match.

Default TTLs:

- active clarification:
  - use the current active clarification / option-set TTL already enforced by the live routing state
  - if this must be made explicit in code for the shared helper, default to the existing active option lifetime rather than inventing a second TTL
- repair-safe clarification snapshot reuse:
  - default to the existing repair snapshot TTL
  - no extension beyond that default without explicit tests
- just-opened surface continuity:
  - default to exactly **1 immediate next user turn**

If any of these defaults change later, the shared helper contract version and regression tests must be updated together.

## Required routing changes

### Step 1: Add a clarification-first bridge before explicit-command bypass wins

Today, explicit-command bypass can clear active clarification state too early.

Required rule:

- before Tier 2a explicit-command bypass clears active clarification state
- check whether the current input strongly matches one of the approved recoverable clarification sources:
- `pendingOptions`
- active option set
- approved clarification snapshot / last-options source
- check whether the current input strongly matches one of the active clarification options
- if yes, treat it as a clarification-follow-up instead of a fresh command

Deterministic execution rule inside the bridge:

- deterministic selection is limited to ordinal / pill-style replies only
- direct label or component-name replies are not deterministic in this bridge
- after a deterministic miss, the next step is bounded LLM over the same active clarification options
- the bridge must not fall through to unrelated routing lanes before that bounded LLM step finishes

Recoverable-source whitelist:

- allowed:
  - live `pendingOptions`
  - `activeOptionSetId` + `lastClarification.options`
  - `lastOptionsShown` while still within its TTL
  - `clarificationSnapshot` only when the snapshot is still repair-safe and not stale
- not allowed:
  - arbitrary historical message options outside the approved recovery window
  - unrelated widget-visible options that were never part of the active clarification
  - stale cross-lane option state that cannot be tied back to the current clarification lineage

If the source cannot be proven current and aligned to the active clarification lineage, it must not be used by the bridge.

Repair-safe clarification snapshot:

- a clarification snapshot is repair-safe only when:
  - it still falls within its intended repair TTL
  - it is still aligned to the same clarification lineage/message set
  - it has not been invalidated by a clearly unrelated new specific command
  - it has not been superseded by a newer clarification that should own the turn
  - it is being used for bounded clarification repair/recovery, not as a generic stale option cache

If any of those conditions fail, the snapshot must not be treated as an approved recoverable clarification source.

Single-owner rule:

- one shared helper must be the sole owner of:
  - clarification-state clearing decisions
  - recoverable-source validation
  - context-winner selection
- no lane may clear clarification state before this shared helper runs
- no lane may independently short-circuit that decision with its own local version of the rule

This is required to prevent the same phrase from being treated as a clarification follow-up in one lane and as a fresh command in another.

This is the main anti-loop fix for:

- `open entries`
- repeated after a clarification where `Entries` is already an offered option

### Step 2: Add one shared follow-up decision helper

Create one helper that decides which bounded context wins:

```typescript
type ContextDecision =
  | {
      mode: 'clarification_selection'
      optionId: string
      confidence: 'high' | 'medium'
      destinationConstraint?: 'chat' | 'surface'
    }
  | {
      mode: 'active_surface_followup'
      surfaceId: string
      confidence: 'high' | 'medium'
      destinationConstraint?: 'chat' | 'surface'
    }
  | { mode: 'conflict' }
  | { mode: 'none' }
```

This helper should:

- check explicit scope/destination first
- check clarification-follow-up second
- check active-surface follow-up third
- return conflict if both contexts point to different plausible targets

Important rule:

- destination constraint must be carried separately from target choice
- example:
  - `list it in the chat`
  - target may come from active-surface follow-up
  - destination must still remain `chat`

Three-way combination rule:

- in a single turn, all of the following may apply together:
  - clarification context selects the target
  - explicit scope re-anchors the source/context
  - explicit destination constrains output
- these must not be collapsed into one “winner takes all” field
- target, scope, and destination must be resolved as separate bounded constraints before execution

This must be shared across lanes rather than reimplemented separately.

### Step 3: Make clarification follow-up matching stronger than raw command-form detection

When a user reply is both:

- command-shaped
- and option-overlapping

the router must prefer clarification resolution if the overlap is strong and the option set is current.

Examples:

- `open entries`
- `show entries`

after a clarifier that already offered `Entries`

This matching must not rely on “short / low-information” alone.
Generic ambiguous phrases must still obey the generic-execution safety rule:

- no ambiguous generic panel phrase should execute just because it is short
- no ambiguous generic panel phrase should execute just because only one candidate survived weakly
- execution still requires sufficiently specific and validated resolution, or a documented safe default

When possible, clarification follow-up matching should prefer stable option identity over free-text overlap:

- option `id`
- option `type`
- option `data`
- ordinal / pill index

Free-text label overlap should remain a fallback, not the primary identity mechanism, when stronger option payload mapping is available.

Implementation note:

- persisted `ClarificationOption` state does not always include full payload data
- so payload-backed matching must use the strongest available source in this order:
  1. live `pendingOptions` / active `SelectionOption` payload
  2. recoverable options snapshot with payload-preserving source
  3. stored `ClarificationOption` identity (`id`, `type`, label/sublabel)
  4. free-text overlap only as last fallback

If richer payload identity is unavailable, the router must degrade safely rather than pretending it has stronger identity than it really does.

### Step 4: Preserve active-surface priority for referential follow-ups

Do not weaken active widget/panel/note routing for genuine referential turns.

The new policy must preserve current strong behavior for:

- `read it`
- `summarize that`
- `show me the content`

when a note/widget/panel is active or was just opened.

It must **not** convert mere visibility/focus into execution authority for generic commands.

Active-surface continuity must also stay short-lived unless the next turn is clearly referential.

Required rule:

- active or just-opened surface context should decay quickly
- if the immediate next turn is not clearly referential, that continuity should weaken or expire
- it must not keep stealing later turns just because a surface was recently active

Concrete initial policy:

- `just_opened` surface continuity is eligible for the **immediate next user turn only**
- after one non-referential turn, it expires
- after any new successful clarification is shown, it must not outrank that clarification
- after any explicit scope cue, it must yield to that cue
- if a later phase wants a longer TTL, that must be explicitly documented and regression-tested

### Step 5: Improve clarifier wording when clarification context is token-derived

When the option set is built from token overlap or mixed panel families, avoid misleading family-only labels.

Prefer:

- `I found multiple panels matching "entries". Which one do you want to open?`

instead of:

- `Multiple navigator panels found...`

when `Entries` is one of the options.

This is secondary to safety, but it removes a major source of user confusion.

### Step 6: Make explicit destination cues first-class in this priority model

Explicit destination and scope cues must outrank generic verbs and weak context inferences.

Examples:

- `show recent entries in the chat`
- `open panel d from chat`
- `list it in the chat`

Required rule:

- if an explicit destination/scope cue conflicts with the current leading candidate
- do not execute the conflicting candidate
- prefer the compatible bounded candidate set
- if conflict remains unresolved, clarify instead of executing

### Step 7: Add telemetry for context-resolution outcomes

The router should explicitly log which bounded context won, so the new policy can be evaluated in practice.

Required telemetry:

- `clarification_context_won`
- `active_surface_context_won`
- `context_conflict_forced_clarification`
- supporting metadata:
  - `input`
  - `thresholdHelperVersion`
  - `clarificationOptionId` / `clarificationOptionLabel`
  - `clarificationSource`
  - `surfaceId` / `surfaceLabel`
  - `reason`
  - `hadExplicitScope`
  - `hadExplicitDestination`
  - `decisionLane`
  - `hadClarificationContext`
  - `hadActiveSurfaceContext`
  - `losingContext`
  - `losingReason`

This is needed to confirm the new priority rule is reducing routing errors instead of merely shifting them to a different lane.

## Existing code seams to reuse

This plan should reuse current state and routing seams rather than invent parallel state:

- `components/chat/chat-navigation-panel.tsx`
  - `pendingOptions`
  - `lastClarification`
  - `previousRoutingMetadata`
- `lib/chat/chat-navigation-context.tsx`
  - live storage for clarification and recent routing metadata
- `lib/chat/routing-dispatcher.ts`
  - explicit-command bypass
  - clarification follow-up handling
  - focus latch / pre-latch logic
  - recent-turn routing context
- `lib/chat/chat-routing-scope-cue-handler.ts`
  - explicit `from chat` and `from active widget` overrides

The new work should unify these, not duplicate them.

## Tests

### Clarification-priority tests

- assistant shows options including `Entries`
- user replies `open entries`
- expect: select `Entries` from clarification context, not a fresh-command reroute

- assistant shows options including `Entries`
- user replies `show entries`
- expect: select or confirm `Entries`, not re-ask the same clarifier

- assistant shows options including `Entries`
- user replies with a short but weakly matching generic phrase that does **not** strongly match one option
- expect: bounded clarification, not auto-execute

- assistant shows options with stable payloads
- user reply matches an option by ordinal / payload-backed identity
- expect: payload/option mapping wins over weaker free-text overlap

- only stored `ClarificationOption` identity is available
- richer payload is absent
- expect: router degrades safely to bounded identity/label matching rather than assuming unavailable payload

- false-friend case:
  - clarification option overlap is tempting
  - but the user issues a clearly new specific command targeting something else
  - expect: threshold/helper contract escapes clarification context and treats it as a new command

### Active-surface-priority tests

- active note is open
- user says `read it`
- expect: note read-content follow-up

- active widget is focused
- user says `show that`
- expect: widget-scoped follow-up

- a panel was just opened
- the immediate next turn is not referential
- expect: active-surface continuity does not keep overriding later routing

### Scope-override tests

- active widget exists
- active clarification exists
- user says `from chat option 1`
- expect: chat clarification wins

- active clarification exists
- user says `from active widget`
- expect: widget scope wins

- explicit destination cue conflicts with a generic verb-led candidate
- expect: destination-compatible candidate or bounded clarification, not execution

- active-surface follow-up chooses the target
- explicit destination cue requires chat output
- expect: target and destination are both preserved, not collapsed into a single winner field

- explicit scope + explicit destination + clarification overlap all appear together
- example: `from chat list it in the chat option 1`
- expect: shared helper applies all three constraints consistently without lane drift

- active clarification exists
- user says `open budget100`
- `budget100` is not one of the active clarification options but is a clear specific target validated by a bounded candidate source
- expect: clarification is paused and the explicit specific target escapes clarification routing

- active clarification exists
- user says `link panel b`
- `link panel b` is a valid active-panel clickable target from a bounded active-surface candidate set, not one of the active clarification options
- expect: clarification is paused and the specific active-panel target escapes clarification routing

- active clarification exists
- active widget/panel context validates `budget100`
- internal replay or memory assistance helps identify the target
- expect: visible badge is still `🎯 Bounded-Selection`, not `Memory-Exact`

- active clarification exists
- user turn is plausibly both a clarification reply and a different specific target
- expect: conflict clarification, not silent escape and not silent selection

- explicit scope cue and explicit destination cue are both present
- expect: scope and destination are applied as separate bounded constraints, not collapsed into one ambiguous override

### Conflict tests

- active clarification offers `Entries`
- active panel is `Recent`
- user reply is ambiguous between them
- expect: tighter bounded clarification, not execution

- active clarification has two strongly overlapping labels
- user reply matches both non-uniquely
- expect: bounded clarification from the same option set, not silent selection

- no family-specific bounded candidate builder is available
- expect: explicit clarifier, not ad hoc visible-entity pool synthesis

### Anti-loop tests

- same unresolved low-information reply repeated after one clarifier
- expect: escalate to a more explicit bounded prompt with explicit escape guidance such as "or did you mean something else?"
- do not loop indefinitely

### Visible-provenance tests

- active clarification exists
- user says `entries`
- bounded LLM selects from the active clarification option set
- expect: visible badge `🎯 Bounded-Selection`

- active clarification exists
- user says `the first one`
- expect: visible badge `Deterministic`

- active clarification exists
- active panel/widget validates `budget100`
- user says `open budget100`
- internal replay assists resolution
- expect:
  - action succeeds
  - internal telemetry may still record replay / memory assistance
  - visible badge is `🎯 Bounded-Selection`

- no active clarification and no validated active bounded surface context
- plain replay resolves the turn
- expect: replay-specific visible badge only if the product still chooses to expose replay at all

### Telemetry tests

- clarification-follow-up path emits `clarification_context_won`
- active-surface follow-up path emits `active_surface_context_won`
- conflict path emits `context_conflict_forced_clarification`
- emitted telemetry includes winning lane and losing-context metadata

## Success criteria

- latest clarification remains primary for option-like follow-ups
- active or just-opened surface remains primary for referential follow-ups
- explicit scope/destination still overrides both
- focus changes alone do not stale chat clarification
- repeated `open entries` after a clarifier no longer loops as a fresh command
- no ambiguous path auto-executes because one context signal quietly overrode the other
- stronger payload/option mapping is preferred over weak free-text overlap when available
- active-surface continuity expires quickly unless the follow-up is clearly referential
- telemetry makes it visible which context won and when conflicts forced clarification
- scope and destination cues are handled as distinct bounded constraints
- non-unique label overlap does not silently resolve to one option
- payload-backed matching degrades safely when only stored clarification identity is available

## Anti-pattern applicability

Isolation/provider reactivity anti-pattern guidance is **not applicable** here.
This plan is about routing priority and bounded conversational context, not provider API expansion or UI subscription redesign.
