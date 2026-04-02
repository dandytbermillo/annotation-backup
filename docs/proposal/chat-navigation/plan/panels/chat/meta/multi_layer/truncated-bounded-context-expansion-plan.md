# Plan: Truncated Bounded Context With On-Demand Expansion

## Goal

Give the bounded LLM enough conversation context to make strong decisions without sending the full raw conversation every time.

The system should:

- send a compact structured context by default
- truncate long text fields and long turn bodies
- allow the bounded LLM to request expansion of specific truncated lines or turns when needed

This keeps arbitration focused, reduces noise, and still allows deeper inspection when the compact view is insufficient.

## Problem

Sending the full raw conversation on every bounded LLM call is a bad default because it:

- increases prompt size
- adds irrelevant noise
- makes it harder for the LLM to focus on the active bounded decision
- encourages accidental dependence on stale history

But sending too little context is also bad because the LLM may miss:

- the active clarifier state
- the meaning of `from chat`
- why the user is rejecting a prior result
- the exact wording of a recent correction

So the system needs a middle path:

- compact structured context first
- targeted expansion second

## Core Rule

Every bounded LLM call should receive a truncated structured context package first.

If the LLM cannot decide safely from that package, it may request:

- the full text of a specific truncated turn
- the full text of a specific truncated line
- a small bounded expansion window around a specific turn

The LLM must not request arbitrary full-history dumps by default.

## Default Context Package

The default package should contain only the most relevant bounded context:

- current raw user query
- recent relevant current-session conversation
- active clarifier state, if any
- active clarifier turn, if any
- active option set with hidden metadata
  - option id
  - target class
  - executable command payload or command reference
  - source scope
  - current validity status
- current validated escape targets
- recent execution / repair context
- source scopes relevant to the current turn
- relevant app memory
- relevant user memory
- relevant repair memory
- a compact recent-turn transcript

In practice, the bounded LLM should usually receive this core package:

- recent relevant chat turns from the current session
- the active clarifier turn
- option metadata
- recent execution / repair context
- source scopes
- validated escape targets
- target class metadata
- truncation markers and expansion ids

## Compact Recent-Turn Transcript

The transcript sent by default should be:

- structured
- recent
- relevance-filtered
- truncated

Recommended content:

- the current user turn
- the last assistant clarifier turn
- the most recent execution turn, if any
- the most recent rejection/correction turn, if any
- recent scope-cue turns such as `from chat`

The transcript should be built from the actual current-session conversation, not from a clarifier-only summary. If the current session becomes too long, reduce by recency and relevance before truncating turn text.

Each turn should carry:

- turn id
- speaker
- timestamp or recency index
- turn type
  - query
  - clarifier
  - execution
  - repair
  - informative
- truncated text
- whether truncation occurred

## Truncation Rules

Long turn bodies and long option descriptions should be truncated in the default package.

Each truncated item should include:

- a stable id
- visible prefix text
- visible suffix text when useful
- truncation marker
- byte or character count metadata

Example:

- `turn_18.text = "I asked for clarification because multiple items matched ... [truncated]" `

The LLM should be able to see that more text exists without receiving all of it immediately.

## Expansion Protocol

The bounded LLM may request expansion only through structured expansion intents.

Allowed expansion requests:

- `expand_turn_text(turnId)`
- `expand_line(lineId)`
- `expand_turn_window(centerTurnId, radius)`

The app should then return only the requested bounded expansion, not the entire transcript.

Hard limits:

- expansion must stay inside the current session
- expansion must stay inside the bounded recent-turn window used for the current arbitration
- no more than 2 expansion requests per arbitration attempt
- `expand_turn_window` must use a small fixed radius
- if expansion still does not produce a safe decision, the arbiter must return `ask_clarify` or `inform` rather than continue expanding

After processing the compact package and any requested expansion, the bounded LLM should return the same structured decision payload used by the bounded arbiter plans, not only an outcome label.

Minimum payload fields:

- `decision`
- `selectedOptionId` or `targetId`
- `targetClass`
- `commandRef` or `resolvedActionRef`
- `sourceContext`
- `basedOnTurnIds`
- `confidence`
- `reason`

This is especially important when the current query refers to a previous response in the conversation. The app needs to know which prior turn ids and which source context the bounded LLM used before it validates and executes the chosen command reference.

## When Expansion Is Appropriate

Expansion is appropriate when the truncated package is not enough to safely decide:

- which active source `from chat` refers to
- whether the user is rejecting a prior result
- which exact option wording was shown
- whether the user correction was to another bounded option or to an external validated target
- whether a prior informative answer changed the current repair state

Expansion is not appropriate for:

- broad full-history browsing
- arbitrary transcript mining
- discovering new targets outside the bounded context
- reconstructing the full conversation through repeated expansion requests

## Hidden Conversation Copy

The app may maintain a private structured copy of the visible conversation for bounded arbitration.

That private copy should include hidden metadata not shown in the UI:

- option ids
- target classes
- executable command payloads or command references
- source scope
- active clarifier ids
- repair context links
- validation state

This private copy is especially useful for:

- `from chat`
- `the second one from chat`
- `open that option from chat`
- repair mode after a wrong execution

The bounded LLM should receive only the relevant slice of this private copy, not the whole conversation store.

## Source-Scope Support

This plan should make source cues like `from chat` more reliable.

Example:

1. a clarifier is shown in chat
2. later a widget is also active
3. user says `open option 2 from chat`

The bounded LLM should receive:

- the active chat option set
- the hidden option metadata for that clarifier
- the source scope marker showing those options came from chat

It can then resolve the request against the correct hidden option set without guessing.

## Compatibility With Seeded And Learned Rows

This plan must remain compatible with the existing DB-backed curated-seed and learned-row system.

Rules:

- truncated conversation context does not replace seeded/learned retrieval for fresh command interpretation
- DB-backed curated seeds and eligible learned rows still run upstream and may provide:
  - validated escape candidates
  - candidate hints
  - app-memory snippets
- those DB-backed results remain bounded and hint-oriented unless some other existing validated path already permits deterministic execution
- the truncated-context package is an input to bounded arbitration, not a replacement for the existing seed/learned memory contract

The private conversation copy and compact transcript are session-local context. They must not weaken:

- same-user boundaries for learned rows
- curated-seed partition rules
- existing TTL / compatibility filters

The hidden conversation copy must not be promoted directly into learned rows just because the bounded LLM saw it. Normal success, validation, and writeback rules still govern any durable memory writes.

## Interaction With Repair Mode

Repair mode should use the same truncated-first approach.

Default repair package:

- recent bounded decision context
- rejected target
- remaining alternatives
- truncated nearby turns

If that is not enough, the repair arbiter may request:

- the full rejection turn
- the full prior clarifier turn
- the full prior execution turn

This keeps repair mode compact by default while still allowing deeper inspection when needed.

Repair expansion must stay:

- in the current session
- within the recent decision window for the same repair context
- bounded to the rejected execution and nearby related turns

## Safety Rules

Must always remain true:

- expansion stays bounded to recent relevant turns
- expansion stays inside the current session and current bounded arbitration window
- expansion does not authorize execution by itself
- hidden command payloads still require runtime validation before execution
- the LLM may choose among bounded options, not invent arbitrary new commands
- the private structured conversation copy is advisory input, not unconditional execution authority
- session-local truncated context does not bypass upstream seeded/learned retrieval
- session-local hidden conversation data does not become durable learned memory without the existing writeback contract

## Provenance And Diagnostics

The system should log:

- whether the bounded LLM decided from the compact package alone
- whether expansion was requested
- which turns/lines were expanded
- whether the final decision used expanded context

This will help tune truncation length and determine where compact context is insufficient.

## Implementation Order

### Slice A: Define Truncated Context Schema

- structured recent-turn representation
- truncation markers
- hidden option metadata shape
- expansion request schema

### Slice B: Build Compact Context Generator

- select recent relevant turns
- truncate long text
- attach turn ids and expansion metadata

### Slice C: Add Expansion Handler

- expand only requested turn text, line text, or small windows
- keep expansion bounded and auditable

### Slice D: Preserve DB-Memory Compatibility

- keep curated-seed / learned-row retrieval upstream
- pass DB-derived hints and validated escape candidates into the compact package
- do not let session-local conversation context replace or auto-write durable routing memory

### Slice E: Integrate With Active Clarifier Arbiter

- use compact context by default
- support expansion before final bounded decision

### Slice F: Integrate With Repair Mode

- use compact repair context
- allow targeted expansion of nearby rejection/correction turns

## Regression Tests

Must pass:

- active clarifier + compact context only -> bounded decision succeeds
- active clarifier + `from chat` -> hidden chat option metadata allows correct source resolution
- repair mode + compact context only -> bounded repair succeeds
- repair mode + truncated rejection line -> arbiter requests expansion and then resolves correctly
- active clarifier + active widget context + `from chat` -> expansion stays chat-bounded, not widget takeover

Must not happen:

- full raw conversation sent by default on every bounded call
- arbitrary full-history dump requested by the LLM
- truncated hidden command metadata executed without runtime validation
- expansion creating new unbounded candidate discovery
