# Stage 6x.8 Phase 5 Addendum — Family-Level Replay Coverage Framework

## Summary

Define a single replay-coverage framework for all **replay-safe navigation families** instead of fixing `Memory-Exact` behavior query-by-query.

The framework applies to these Phase 5 navigation families:
- `open_entry`
- `open_workspace`
- `open_panel`
- `go_home`

The goal is straightforward:
- if a query belongs to a supported replay-safe family
- and execution succeeds
- and the user does not immediately correct it
- and the system has enough stored data to reconstruct the action safely
- then later exact repeats should become eligible for `Memory-Exact`

This addendum applies to:
- [stage6x8-phase5-retrieval-backed-semantic-memory-plan.md](/Users/dandy/Downloads/annotation_project/annotation-backup/docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-retrieval-backed-semantic-memory-plan.md)
- [stage6x8-phase5-v2-broad-known-navigation-fallback-addendum.md](/Users/dandy/Downloads/annotation_project/annotation-backup/docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-v2-broad-known-navigation-fallback-addendum.md)

Anti-pattern applicability: **not applicable**. This is routing/memory replay design, not provider/reactivity work.

## Problem

Current replay behavior has been improved, but coverage has been reached through a sequence of narrow fixes driven by individual examples such as:
- `open budget100`
- `hello there open links panel b`
- `please open workspace budget100`

That is not scalable.

The product requirement is broader:
- all stable, validated, replay-safe successful navigation queries should follow the same writeback and exact-replay contract
- the system should not require per-query patches to make later exact repeats show `Memory-Exact`

The right unit of coverage is the **navigation family**, not the individual example query.

## Goal

Replace query-specific replay fixes with a family-level contract that answers these questions consistently for every approved navigation family:
1. when is a successful turn eligible for writeback?
2. what data must be stored for safe replay?
3. how is delayed promotion handled?
4. how does B1 exact replay reconstruct the action?
5. when should the badge be `Memory-Exact` rather than `Auto-Executed` or `LLM-Influenced`?

## Family Model

### 1. Entry Navigation Family
Intent:
- `open_entry`

Examples:
- `open budget100`
- `hello there open that budget100`

Execution target:
- entry/dashboard container

Required replay data:
- `entryId`
- `entryName`
- `dashboardWorkspaceId`

### 2. Workspace Navigation Family
Intent:
- `open_workspace`

Examples:
- `open workspace budget100`
- `please open the budget workspace`

Execution target:
- workspace inside an entry

Required replay data:
- `workspaceId`
- `workspaceName`
- `entryId`
- `entryName`
- `isDefault`

### 3. Panel Navigation Family
Intent:
- `open_panel`

Examples:
- `open links panel b`
- `open widget manager`
- `open recent` only when the executed resolver action is `open_panel_drawer`

Execution target:
- panel drawer / widget surface

Required replay data:
- `panelId`
- `panelTitle`

### 4. Home Navigation Family
Intent:
- `go_home`

Examples:
- `go home`
- `again pls return home`

Execution target:
- home dashboard

Required replay data:
- no target payload beyond canonical action

Important exclusion:
- `already on Home` no-op/error responses are **not** replay-eligible successes

## Core Replay Contract

### A. Write Eligibility
A navigation turn is eligible for Phase 5 writeback only if all are true:
1. the family is in approved Phase 5 replay scope
2. resolution succeeded
3. execution succeeded
4. the result is not a clarifier-only or ambiguity-only response
5. the replay payload contains all fields required for that family
6. the turn survives the existing immediate-next-turn correction suppression rule

### B. Promotion
Keep the existing one-turn delayed promotion model:
1. successful turn creates `phase5_pending_write`
2. immediate next correction drops it
3. immediate next non-correction promotes it

No new immediate client-side write path is introduced by this addendum.

### C. Replay
Later exact replay should use the existing B1 lane:
1. exact query/context lookup finds the promoted row
2. the row reconstructs a family-specific replay action
3. the replay action executes through the existing validated execution path
4. the surfaced provenance becomes `Memory-Exact`

## Design Rules

### 1. Family-first, not query-first
Do not keep adding one-off patches for individual phrases.

Instead:
- define replay behavior once per approved family
- prove it with representative examples
- treat uncovered example queries as coverage gaps inside that family

Phrase-level examples do not define family membership by themselves.
Family membership is determined by the executed resolver action.

Examples:
- `open recent` may execute as panel navigation or recent-workspace navigation depending on resolver outcome
- `open widget manager` belongs to the panel family only when the executed action is `open_panel_drawer`

### 2. Stored target data must be execution-grade
Replay must use stored family-specific target data, not synthetic text re-resolution.

Allowed:
- store enough fields to reconstruct a valid `IntentResolutionResult`
- execute through `executeAction(...)`

Not allowed:
- convert a stored row into a synthetic text command like `open budget100 B`
- send that back through the normal LLM/resolver path and call it `Memory-Exact`

### 3. Family selection must use executed action, not classifier label
Writeback and replay family selection must be derived from the executed resolver action, not only from the bounded-LLM intent label.

Canonical mapping rule:
- `navigate_entry` -> `open_entry`
- `navigate_workspace` -> `open_workspace`
- `navigate_home` -> `go_home`
- `open_panel_drawer` -> `open_panel`

This prevents noisy queries classified as `resolve_name` from being excluded from replay writeback even when they executed successfully as a supported navigation family.

### 4. Replay query key must use the original user query
Replay/writeback query keying must use the original trimmed user query text, not the panel-normalized transport message sent to the LLM.

Allowed:
- keep panel-normalized text for bounded-LLM classification
- preserve the original trimmed user query as the replay/writeback source of truth

Not allowed:
- key B1 exact replay from raw user text while keying writeback from wrapper-stripped transport text
- silently change replay eligibility by changing only transport normalization

### 5. B1 lookup and writeback must share the same replay snapshot source
Exact replay lookup and Phase 5 navigation writeback must use the same replay snapshot source.

Required invariant:
- dispatcher computes one replay snapshot from live UI state
- B1 exact lookup uses that snapshot directly
- navigate writeback receives and reuses that same snapshot

Fail-open fallback is allowed only when the forwarded snapshot is missing or malformed. It must not be the primary writeback key source.

### 6. Incomplete replay rows must be rejected
If a family-specific payload does not contain the required replay fields, the write builder must return `null`.

Do not persist replay rows with placeholder values such as:
- `''`
- partial workspace references
- partial entry references

### 7. Replay success must follow confirmed execution
The replay branch must not surface a success message or success provenance until `executeAction(...)` confirms success.

If replay execution fails:
- do not show `Memory-Exact` success UI
- do not log the turn as a successful replayed execution

## Architecture

### 1. Shared Replay Eligibility Layer
Use one family-aware eligibility rule for successful navigation turns:
- supported family
- successful resolution
- successful execution
- complete family payload
- no immediate correction

The implementation can expose this through a shared builder or eligibility function, but the contract must be uniform across all approved families.

### 2. Family-Specific Replay Payloads
Payload builders must store the fields required to reconstruct the real action shape.

Entry family payload:
- `entryId`
- `entryName`
- `dashboardWorkspaceId`

Workspace family payload:
- `workspaceId`
- `workspaceName`
- `entryId`
- `entryName`
- `isDefault`

Panel family payload:
- `panelId`
- `panelTitle`

Home family payload:
- canonical `go_home` action only

### 3. First-Class Replay Actions
B1 replay should reconstruct a first-class navigation replay action, for example:
- `{ type: 'open_entry', ... }`
- `{ type: 'open_workspace', ... }`
- `{ type: 'open_panel', ... }`
- `{ type: 'go_home' }`

This replay action is then converted into a proper `IntentResolutionResult` and executed through the existing execution contract.

### 4. Existing Execution Contract Only
Replay execution must still go through:
- `executeAction(resolution)`

No parallel executor.
No synthetic text re-resolution.
No bypass around existing validators.

## Context Keying Policy

Exact replay still needs a context key, but replay should not be blocked by unrelated volatility.

The framework therefore requires a family-by-family audit of which context fields are truly replay-relevant.

### Entry Family
Likely relevant:
- current entry/workspace mode

Potentially too volatile:
- unrelated panel-open state
- ephemeral suggestions/clarifiers if they do not affect target validity

### Workspace Family
Likely relevant:
- parent entry context
- workspace navigation validity

Potentially too volatile:
- unrelated open drawers

### Panel Family
Likely relevant:
- panel visibility/runtime availability

Potentially too volatile:
- unrelated workspace content state

### Home Family
Likely relevant:
- whether navigation to Home is a true success or an `already on Home` no-op/error

This addendum does not require four separate snapshot schemas immediately, but it does require explicit family-level context-key review instead of treating every query as if the same exact fingerprint policy is always correct.

## Coverage Matrix

Maintain a coverage table per family with these questions:
- first-turn execution works?
- pending write emitted?
- promotion occurs?
- B1 replay supported?
- later exact repeat becomes `Memory-Exact`?
- exclusions documented?

Required families in the matrix:
- `open_entry`
- `open_workspace`
- `open_panel`
- `go_home`

## Required Tests

### Entry Family
- successful `open_entry` turn emits `phase5_pending_write`
- missing `dashboardWorkspaceId` produces no write
- replay row reconstructs a valid entry replay action
- later exact repeat can surface `Memory-Exact`

### Workspace Family
- successful `open_workspace` turn emits `phase5_pending_write`
- missing `entryId`, `entryName`, or `isDefault` produces no write
- replay row reconstructs a valid workspace replay action
- later exact repeat can surface `Memory-Exact`

### Panel Family
- real `open_panel_drawer` resolver output emits non-null writeback
- replay row reconstructs panel replay action from stable `panelId`
- later exact repeat can surface `Memory-Exact`

### Home Family
- true successful `navigate_home` turn emits `phase5_pending_write`
- `already on Home` no-op/error emits no write
- later exact repeat can surface `Memory-Exact` only for the real success path

### Shared Tests
- correction suppresses pending write
- failed execution emits no write
- clarifier-only turn emits no write
- replay branch surfaces success only after confirmed execution
- incomplete replay payload is rejected
- replay/writeback keying uses the original trimmed user query rather than transport-normalized text
- dispatcher B1 lookup snapshot and navigate writeback snapshot come from the same replay snapshot source

## Exclusions

These remain outside positive replay writeback:
- unresolved ambiguities
- clarifier-only turns
- failed turns
- corrected turns
- incomplete replay payloads
- no-op/error responses such as `already on Home`
- unsafe or otherwise non-replay-safe actions

## Rollout Plan

### Phase A. Coverage Audit
1. enumerate approved navigation families
2. list required replay fields per family
3. list current writeback and replay seams per family
4. record family-specific gaps
5. produce an explicit per-family context-key decision, including which fingerprint fields are required, ignored, or stripped for replay matching
6. confirm replay-query source-of-truth parity and replay-snapshot-source parity across dispatcher, panel, and navigate route

### Phase B. Payload Hardening
1. reject incomplete replay payloads
2. remove empty-string placeholder persistence
3. align route-to-builder data shapes for every family

### Phase C. Replay Reconstruction
1. ensure B1 can reconstruct every approved family as a first-class replay action
2. route replay through `executeAction(...)`
3. confirm no family falls back to synthetic text re-resolution

### Phase D. Family Validation
1. validate entry-family replay
2. validate workspace-family replay
3. validate panel-family replay
4. validate home-family replay on a true success path

### Phase E. Reporting
Produce a short implementation report with:
- the family coverage matrix
- documented exclusions
- known remaining gaps
- proven `Memory-Exact` examples by family

## Acceptance Criteria

This addendum is complete when:
1. all approved navigation families have explicit replay contracts
2. successful replay-safe turns write consistently under the same policy
3. incomplete payloads are rejected rather than stored
4. exact repeats can become `Memory-Exact` across all approved families
5. no-op/error paths do not write
6. replay uses stored targets rather than synthetic text re-resolution
7. tests exist per family and for the shared exclusion rules
8. family selection is derived from executed resolver action rather than phrase shape or LLM intent label alone
9. per-family context-key policy is explicitly defined rather than left implicit
10. replay/writeback keying uses the original trimmed user query rather than transport-normalized text
11. B1 lookup and Phase 5 writeback share the same replay snapshot source

## Immediate Next Steps

1. build the family coverage matrix for:
- `open_entry`
- `open_workspace`
- `open_panel`
- `go_home`

2. finish payload-hardening where replay rows can still be incomplete

3. validate `go_home` from a non-Home starting state

4. add shared correctness tests for:
- replay-success-after-confirmed-execution
- incomplete replay payload rejection
