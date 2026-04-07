# Plan: Stage 6x.8 Phase 5 — Note Query Memory-Exact and Replay Contract

## Context

The panel/widget replay work established a useful rule:

- `Memory-Exact` does not require a manifest
- it requires a safe replay contract
- the contract must preserve stable target identity, query specificity, and enough validator metadata to reject stale or ambiguous rows

Notes need the same treatment, but they are not panel manifests and should not be forced into the universal panel registry.

The note stack already has separate routing families and execution paths:
- `note:state_info` — e.g. `which note is open?`
- `note:read_content` — e.g. `read it`, `summarize the note`, `what does this note say about X?`
- `note:navigate` — e.g. `open note Project Plan`
- `note:mutate` — e.g. `rewrite this note`, `append this`, `rename this note`
- note capability queries — e.g. `can you summarize this note?`, `can you edit this note?`, `what can you do with this note?`

Today those families are routed, answered, or rejected through a mixture of:
- deterministic classifiers
- the cross-surface arbiter
- Stage 6 content answering
- navigate/open-note handlers
- bounded not-supported responses for mutate families

What is missing is one generic replay model for note queries that is as disciplined as the panel replay contract.

Anti-pattern applicability: **not applicable**. This is routing/replay contract work, not React/provider reactivity work.

## Goal

Create one replay contract for note queries that:

1. preserves safe `Memory-Exact` for note families that are replay-safe
2. keeps note mutation replay conservative and explicitly policy-driven
3. preserves anchor identity and query specificity for follow-up note turns such as:
   - `read it`
   - `summarize that note`
   - `can you edit this note?`
4. does **not** require note manifests or panel-registry registration

## Non-goals

This plan does **not**:
- move notes into `lib/panels/panel-registry.ts`
- redesign Stage 6 answer generation
- introduce mutation execution for note edits if it does not already exist
- make unsafe note mutations directly replayable by default
- solve multi-note compare/merge workflows in the same slice

## Core Decision

Use a **parallel note replay contract**, not the panel manifest registry.

Static panel registry is for panel/widget intent contracts.

For note queries, the static contract should live in code through:
- routed note family enums
- stable payload schemas
- deterministic validators
- explicit replay eligibility rules per family

The database remains the learned store for:
- exact successful query text
- query fingerprint
- context fingerprint
- success count
- validated replay payload

For note-family rows, replay safety must not rely on generic widget-only context.
The validator must have access to current note context:
- active note identity
- open note identities
- any validated follow-up anchor note identity

## Note Query Taxonomy

### Replay-safe families

These may become `Memory-Exact` when the validator can prove the anchored note and query intent are still compatible.

1. `note_state_info`
- Examples:
  - `which note is open?`
  - `what note am I in?`
  - `which notes are open?`
- Output type:
  - bounded answer from live UI/workspace state

2. `note_read_content`
- Examples:
  - `read it`
  - `summarize the note`
  - `what does this note say about refunds?`
  - `find where this note mentions budget`
- Output type:
  - Stage 6 grounded content answer

3. `note_capability_info`
- Examples:
  - `can you summarize this note?`
  - `can you edit this note?`
  - `what can you do with this note?`
- Output type:
  - bounded capability/support answer, not mutation execution
  - this phase must add an explicit bounded capability responder; do not assume routing alone is enough

4. `open_note`
- Examples:
  - `open note Project Plan`
  - `find note Roadmap`
- Output type:
  - existing navigation/open-note execution path
- Note:
  - do not assume an existing note-open replay path; this phase defines one explicitly

### Restricted families

These are note-targeted, but must **not** be blindly direct-replayed until explicit idempotency/confirmation rules exist.

5. `note_mutation_request`
- Examples:
  - `rewrite this note`
  - `append this to the note`
  - `rename this note to Plan B`
  - `remove that paragraph`
  - `highlight this section`
- Default policy in this phase:
  - classify and anchor them
  - allow memory to reuse the same interpretation/unsupported outcome metadata
  - do **not** direct-execute mutation side effects from `Memory-Exact` unless the mutation family later gets a dedicated safe replay rule

## Query Coverage Matrix

| Query class | Example | Family | Memory-Exact policy |
|-------------|---------|--------|---------------------|
| active-note state | `which note is open?` | `note_state_info` | allowed via live state resolver replay |
| open-notes list | `which notes are open?` | `note_state_info` | allowed via live state resolver replay |
| anchored read | `read it` | `note_read_content` | allowed |
| anchored summary | `summarize the note` | `note_read_content` | allowed |
| anchored Q&A | `what does this note say about X?` | `note_read_content` | allowed |
| anchored find-text | `find refunds in this note` | `note_read_content` | allowed |
| capability support | `can you summarize this note?` | `note_capability_info` | allowed |
| capability editability | `can you edit this note?` | `note_capability_info` | allowed |
| explicit note navigation | `open note Project Plan` | `open_note` | allowed via note-open contract |
| note mutation | `rewrite this note` | `note_mutation_request` | classification/history reuse only, no blind direct replay |

## Replay Contract

### Shared fields for note rows

Every note-family replay row should store, when applicable:
- `action_type`
- `noteFamily`
- `selectorSpecific`
- `anchorSource`

And may store target note identity when that family actually has a stable single-note target:
- `noteId`
- `noteTitle`

Where:
- `noteFamily` is one of:
  - `note_state_info`
  - `note_read_content`
  - `note_capability_info`
  - `note_mutation_request`
  - `open_note`
- `selectorSpecific` means the target note was specifically identified either:
  - explicitly by user naming
  - or by a validated follow-up anchor that is safe to replay
- `anchorSource` is one of:
  - `active_note`
  - `resolved_reference`
  - `followup_anchor`

Important:
- `note_state_info` rows must not assume a single-note target by default
- pure live-state questions may have no stable `noteId`

### Family-specific fields

#### 1. `note_state_info`
Add:
- `stateSubtype`
- `stateTargetMode`
- `activeNoteId` (optional)
- `openNoteIds` (optional)

Allowed values:
- `active_note`
- `open_notes`
- `workspace_note_state`

Allowed `stateTargetMode` values:
- `live_state_only`
- `active_note_target`

Rules:
- `which note is open?` may store `activeNoteId`, but replay must re-run the live deterministic resolver
- `which notes are open?` should not require a single `noteId`; store `openNoteIds` only if useful for validation/telemetry
- `note_state_info` replay should reuse the live resolver, not a stale stored answer

#### 2. `note_read_content`
Add:
- `readSubtype`
- `contentAnchorSpecific`

Allowed `readSubtype` values:
- `summary`
- `question`
- `find_text`
- `read_full`
- `explain`

`contentAnchorSpecific` means:
- user explicitly named the note or used a valid follow-up anchor
- not merely that a note happened to be active

This phase must explicitly extend the note/content anchor contract so `followup_anchor`
is a real produced source, not just a replay-only label.

Invariant for `note_read_content` rows:
- `contentAnchorSpecific` is the family-specific safety bit
- when `anchorSource === 'followup_anchor'`, `selectorSpecific` should also be `true`
- when `anchorSource === 'active_note'` and the user did not explicitly name the note, `selectorSpecific` should remain `false`

`followup_anchor` staleness policy in this phase:
- valid only when it is derived from aligned recent-turn routing metadata
- valid only for the immediately following eligible turn
- valid only if the anchored note is still open and still matches the carried anchor
- otherwise the validator must reject replay and fall through to live routing

#### 3. `note_capability_info`
Add:
- `capabilitySubtype`

Allowed values:
- `can_read`
- `can_summarize`
- `can_edit`
- `can_append`
- `can_rename`
- `general_capabilities`

#### 4. `note_mutation_request`
Add:
- `mutationSubtype`
- `mutationExecutionPolicy`

Allowed `mutationExecutionPolicy` values in this phase:
- `no_direct_replay`
- `confirm_only`

Default in this phase:
- `no_direct_replay`

#### 5. `open_note`
Do not assume an existing note-open replay contract.

This phase must add one explicitly for note navigation:
- `action_type: open_note`
- `noteId`
- `noteTitle`
- `workspaceId`
- `entryId`
- additional display fields only if the current note-open execution path needs them for surfaced messages

Validator must reject stale note targets before replay execution.

## Critical Distinction: target identity vs query specificity

Exactly like duplicate-family panels:

- `noteId` is **target identity**
- `selectorSpecific` is **user specificity**

These are not the same.

Examples:
1. only one note is open, user says `read it`
- `noteId` is known
- `selectorSpecific` should be `true` only if the follow-up anchor is valid and replay-safe

2. user says `summarize the note`
- `noteId` may resolve from active note
- `selectorSpecific` may still be `false` if the request was generic and later note context changes would make replay unsafe

3. user says `open note Project Plan`
- `noteId` is known
- `selectorSpecific = true`

## Safe Replay Rules

### Rule 1: target note must still be valid
If the stored `noteId`:
- no longer exists
- is no longer open when the family requires an open-note anchor
- is no longer the active note when the family requires the active note
then reject replay.

Suggested reason codes:
- `target_note_missing`
- `target_note_not_open`
- `target_note_not_active`

### Rule 2: legacy rows must not become overly permissive
If a row has no note-family metadata:
- fall back to current behavior
- do not assume replay safety merely because a `noteId` exists

This avoids the same stale-row problem seen in duplicate-family panel replay.

### Rule 3: generic note rows must stay generic
If:
- the row has note-family metadata
- but `selectorSpecific !== true`
then the validator must re-check whether the original generic phrasing is still safe under current context.

Examples:
- `summarize the note` should not replay to a different active note silently
- `which note is open?` is safe only if replay re-runs the pure current-state resolver

For `note_read_content`, validator logic should use both:
- `selectorSpecific`
- `contentAnchorSpecific`

Meaning:
- explicit note name or validated follow-up anchor -> replay may be allowed
- generic active-note phrasing -> must stay generic and be revalidated against current context

### Rule 4: explicit note rows may replay only on selector match
If `selectorSpecific === true`, allow replay only if:
- target note still matches
- required anchor state still matches
- family-specific subtype still makes sense in current context

Otherwise reject with:
- `target_note_selector_mismatch`

### Rule 5: note mutations are not direct-replay actions by default
For `note_mutation_request` rows:
- do not return a direct execution replay action in this phase
- replay can reuse classification/support metadata only
- if the current product path still returns a bounded unsupported response, that repeated outcome may be reused safely
- actual mutation execution replay is deferred until a dedicated mutation confirmation/idempotency plan exists

B1 policy for mutation rows in this phase:
- allow B1 to serve only bounded non-executing outcomes
- never serve a direct mutation execution replay action
- if the current mutation path does not yield a stable bounded response shape, exclude that mutation family from B1 and fall through to live routing

## Upsert Policy

This plan should not repeat the stale-row trap from panel replay.

When a query+context exact row already exists, the UPSERT must refresh:
- `intent_id`
- `slots_json`
- `target_ids`
- `risk_tier`
- `last_success_at`
- `success_count`

Not just increment counts.

Reason:
- old rows must self-upgrade to the new note replay contract
- one-time cleanup should not be required forever

## Note Context Validation Contract

The note-family validator must receive note-specific live context, not just generic panel/widget state.

Required live validation inputs:
- `activeNoteId`
- `openNoteIds`
- optional `validatedFollowupAnchorNoteId`

Recommended implementation shape:
- extend the replay validation inputs with a note-context object
- keep the existing generic snapshot/fingerprint for cross-family consistency
- add note-family validation checks on top, rather than overloading generic widget validation

Fingerprint policy for note families:
- note-family rows may continue using the existing exact-query/context fingerprint path
- but correctness must not depend on the generic fingerprint alone
- validator-side note-context checks are authoritative for:
  - active-note drift
  - open-note drift
  - follow-up-anchor drift

## Family-by-Family Implementation Plan

### Phase 0. Extend note routing contract for capability queries
If this phase keeps `note_capability_info` in scope, the note-routing contract must be expanded explicitly rather than assumed.

Add `capability_info` support to the semantic routing contract for note queries.
Also add a bounded capability responder path so capability queries can produce
deterministic replay-safe answers instead of only being classified.

Likely files:
- `lib/chat/cross-surface-arbiter.ts`
- `app/api/chat/cross-surface-arbiter/route.ts`
- arbiter prompt/schema files under `lib/chat/`
- dispatcher responder files under `lib/chat/`
- any tests that lock the typed arbiter response

If that contract work is not approved, defer `note_capability_info` from this phase instead of leaving it implicit.

### Phase 0b. Extend note anchor contract for follow-up replay
If this phase keeps follow-up note reads like `read it` and `summarize that note` replay-safe,
the note/content anchor contract must explicitly support `followup_anchor`.

Add:
- `followup_anchor` to the produced note anchor / content anchor types
- the logic that emits it from recent-turn routing context when a follow-up is valid
- tests that prove `followup_anchor` is only emitted when the anchor is still valid
- tests that prove the anchor expires after the immediate eligible follow-up turn

Likely files:
- `lib/chat/content-intent-classifier.ts`
- `lib/chat/stage6-tool-contracts.ts`
- `lib/chat/routing-dispatcher.ts`
- any recent-turn / routing-metadata files that currently preserve note follow-up context

If that anchor-contract work is not approved, narrow this phase so `note_read_content`
replay covers only anchors produced by currently supported anchor sources.

### Phase 1. Define note replay schema
Add note-family payload shapes and reason codes to the routing-memory types.

Files:
- `lib/chat/routing-log/memory-write-payload.ts`
- `lib/chat/routing-log/memory-validator.ts`
- `lib/chat/routing-log/memory-action-builder.ts`
- `lib/chat/routing-log/types.ts`
- note-context snapshot / validator-input types wherever the current replay validator receives live state

### Phase 2. Build note writeback emitters
Wire writeback emitters for:
1. `note_state_info`
2. `note_read_content`
3. `note_capability_info`
4. `open_note`
5. `note_mutation_request` classification/support rows

Likely files:
- `lib/chat/routing-dispatcher.ts`
- `components/chat/chat-navigation-panel.tsx`
- `app/api/chat/navigate/route.ts`
- Stage 6 content-answer completion path files
- bounded capability responder files if capability queries remain in scope

### Phase 3. Add note-family validator
Validator must understand:
- open-note requirement
- active-note requirement
- follow-up anchor requirement
- stale target-note rejection
- restricted mutation replay policy
- note-context live inputs (`activeNoteId`, `openNoteIds`, optional follow-up anchor note)

### Phase 4. Add note-family replay reconstruction
Replay action builder should reconstruct only safe replay actions.

Allowed in this phase:
- bounded state-info replay via live deterministic resolver
- bounded capability answer replay
- note-open replay
- note-read-content replay skips routing/classification and re-enters the existing validated answer path

`note_read_content` replay semantic in this phase:
- do **not** return a cached stored answer
- do **not** treat replay as a zero-latency deterministic action
- `Memory-Exact` means:
  - the exact note/read query is reused safely
  - routing/classification work is skipped
  - the answer is regenerated through the current validated Stage 6 content path against the current note content

Reason:
- cached note-content answers can go stale when note content changes
- fresh generation preserves correctness while still benefiting from exact replay of intent/anchor selection

Deferred in this phase:
- blind direct note mutation replay

### Phase 5. Self-upgrade old exact rows
Update the memory UPSERT path so old note rows upgrade to the new payload shape when the same exact query succeeds again.

### Phase 6. Runtime coverage sweep
Validate at least these flows:

#### State info
- `which note is open?`
- repeat -> `Memory-Exact`

#### Read content
- `read it`
- repeat -> `Memory-Exact`
- `summarize the note`
- repeat -> `Memory-Exact`

#### Capability
- `can you summarize this note?`
- repeat -> `Memory-Exact`
- `can you edit this note?`
- repeat -> consistent bounded answer, eligible for `Memory-Exact`

#### Navigation
- `open note Project Plan`
- repeat -> `Memory-Exact`

#### Mutation safety
- `rewrite this note`
- repeat should NOT silently direct-execute a mutation

## Files to Change

| File | Change |
|------|--------|
| `lib/chat/routing-log/memory-write-payload.ts` | Add note-family payload support |
| `lib/chat/routing-log/memory-validator.ts` | Add note-family validation and reason codes |
| `lib/chat/routing-log/memory-action-builder.ts` | Add safe note replay reconstruction |
| `lib/chat/routing-log/types.ts` | Extend note replay enums/contracts |
| `app/api/chat/routing-memory/route.ts` | Refresh `slots_json`/targets on UPSERT conflict |
| note-context validation input types/files | Pass active/open note context into note-family replay validation |
| `lib/chat/cross-surface-arbiter.ts` | Extend typed contract if `note_capability_info` remains in scope |
| `app/api/chat/cross-surface-arbiter/route.ts` | Support note capability routing if kept in scope |
| Note arbiter prompt/schema files under `lib/chat/` | Add `capability_info` family if kept in scope |
| `lib/chat/content-intent-classifier.ts` | Extend note anchor contract if `followup_anchor` remains in scope |
| `lib/chat/stage6-tool-contracts.ts` | Extend note/content anchor types for `followup_anchor` if kept in scope |
| `lib/chat/routing-dispatcher.ts` | Emit note-family pending writes for deterministic/arbiter paths |
| `components/chat/chat-navigation-panel.tsx` | Commit pending writes for client-side note flows |
| `app/api/chat/navigate/route.ts` | Preserve note replay metadata for server-driven note-open flows |
| Stage 6 note-answer completion files | Emit `note_read_content` replay-safe pending writes after confirmed answer |
| Capability responder files under `lib/chat/` | Emit bounded `note_capability_info` answers if capability queries remain in scope |
| `__tests__/unit/chat/...` | Add note replay contract/unit tests |
| `__tests__/integration/chat/...` | Add end-to-end note replay tests |

## Tests

### Unit tests
1. write payload shape for each note family
2. `selectorSpecific` vs `noteId` separation
3. legacy-row fallback
4. stale target-note rejection
5. mutation replay blocked by policy
6. UPSERT conflict refreshes `slots_json`
7. follow-up-anchor row sets `selectorSpecific: true` only when anchor is validated
8. generic active-note row keeps `selectorSpecific: false` even when `noteId` is resolved
9. `followup_anchor` expires after the immediate eligible follow-up turn
10. mutation rows never reconstruct a direct execution replay action
11. note validator rejects replay when `activeNoteId` drift invalidates an active-note family row
12. note-read replay reconstructs a re-answer action, not a cached answer payload

### Integration tests
1. `which note is open?` -> second/third turn `Memory-Exact`
2. `read it` after `which note is open?` -> `Memory-Exact`
3. `summarize the note` -> `Memory-Exact`
4. `can you summarize this note?` -> `Memory-Exact`
5. `can you edit this note?` -> bounded supported/unsupported answer, replay-safe
6. `open note Project Plan` -> `Memory-Exact`
7. `rewrite this note` -> never blind direct replay execution

## Acceptance Criteria

This plan is complete when:
1. note queries have a replay contract without using panel manifests
2. safe note families can become `Memory-Exact`
3. note mutations are explicitly constrained rather than accidentally replayed
4. stale exact rows self-upgrade on conflict
5. follow-up note queries like `read it` remain anchored and validator-safe
6. note replay logic is generic by family, not a pile of per-query patches

## Decision

Do **not** add note manifests.

Use:
- note-family routing contracts for static semantics
- routing memory rows for learned exact reuse
- validator-enforced replay safety for note targets and anchored follow-ups

That keeps note replay parallel to panel replay without forcing the wrong abstraction.
