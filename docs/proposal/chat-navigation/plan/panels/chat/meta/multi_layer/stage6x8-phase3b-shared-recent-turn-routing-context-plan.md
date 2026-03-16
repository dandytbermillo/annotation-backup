# Plan: Stage 6x.8 Phase 3b — Shared Recent-Turn Routing Context

## Context

Phase 3a fixes a narrow user-visible bug: imperative note-read phrasing can miss the `note.read_content` lane and fall through to unrelated routing.

But the broader architectural issue remains:

- all requests arrive through the same chat surface
- follow-up phrasing is naturally referential
- current semantic routing layers do not all receive the same recent-turn context

This produces inconsistent behavior for turns such as:

- `show me the content of that note`
- `read it`
- `summarize that again`
- `open it`
- `what about that one`

Today, the cross-surface arbiter only receives:

- `userInput`
- `activeNote`
- `noteReferenceDetected`

That is too thin for follow-up language. By contrast, the broader `/api/chat/navigate` path already receives richer chat context and full recent history.

The result is a routing disconnect:

- execute-intent style paths can use recent conversational context
- note-family semantic arbitration cannot

This plan fixes that disconnect by introducing one bounded, structured, shared recent-turn context object for semantic routing.

## Goal

Create a shared, bounded `recentRoutingContext` object that can be passed into semantic routing layers across intent families, starting with the cross-surface arbiter, so referential follow-up queries resolve consistently without turning any arbiter into a freeform chat agent.

## Non-goals

This plan does **not**:

- pass full chat history into every arbiter
- replace deterministic safety boundaries
- turn the semantic arbiter into a general conversational assistant
- change execution ownership (deterministic resolution and Stage 6 remain downstream)

## Core Principle

The fix must be **shared**, not note-only.

Because all requests live in the same chat stream, the same bounded recent-turn context contract should be reusable across semantic routing regardless of intent family:

- note
- panel_widget
- dashboard
- workspace
- navigate / non-navigate families

## Proposed shared object

```typescript
type RecentRoutingContext = {
  lastUserMessage?: string
  lastAssistantMessage?: string
  lastResolvedSurface?: 'note' | 'panel_widget' | 'dashboard' | 'workspace' | 'unknown'
  lastResolvedIntentFamily?: 'read_content' | 'state_info' | 'navigate' | 'mutate' | 'ambiguous'
  lastTurnOutcome?:
    | 'content_answered'
    | 'state_info_answered'
    | 'navigate_executed'
    | 'clarifier'
    | 'not_supported'
    | 'unresolved'
}
```

## Field bounds and sanitization

To keep this object bounded and low-risk:

- `lastUserMessage`: sanitize and cap at 160 chars
- `lastAssistantMessage`: sanitize and cap at 200 chars
- `lastResolvedSurface`: enum only
- `lastResolvedIntentFamily`: enum only
- `lastTurnOutcome`: enum only

Rules:

- preserve only plain text needed for routing
- strip citations/formatting noise if present
- prefer structured fields over raw assistant text when both are available
- if truncation would remove the entire signal, omit the field instead of sending low-value fragments

These caps should be enforced before prompt composition, not left to the model.

## Design constraints

1. **Bounded**
- only the immediately previous turn context is included
- no full chat transcript
- no unbounded message arrays

2. **Structured**
- no raw reasoning state
- only fields useful for routing disambiguation

3. **Shared**
- same object shape is defined once and reused by semantic routing layers across families
- Phase 3b adopts it in the cross-surface arbiter first
- broader convergence is a later follow-on, not part of this patch

4. **Optional**
- absence of context must not break routing
- semantic layers must still work with only current-turn input

5. **Non-executing**
- this context informs classification only
- deterministic handlers still resolve and execute

## Why this is needed

Current failure mode:

- user asks a note-related question
- assistant answers about the active note
- next user turn says: `show me the content of that note`
- note arbiter sees only the current text + active note bit
- it may classify as `navigate` or otherwise miss `read_content`
- request falls through to unrelated routing

With `recentRoutingContext`, the arbiter can see:

- what the last user asked
- what the assistant just answered
- which surface/family was last resolved
- whether the last turn was a note-content or note-state answer

That is enough to resolve most follow-up language without needing full history.

## Files to change

| File | Change |
|------|--------|
| `lib/chat/routing-dispatcher.ts` | Build and pass `recentRoutingContext` into semantic routing calls |
| `lib/chat/cross-surface-arbiter.ts` | Extend request type to include `recentRoutingContext` |
| `app/api/chat/cross-surface-arbiter/route.ts` | Accept `recentRoutingContext` and include it in prompt |
| `components/chat/chat-navigation-panel.tsx` | Pass previous-turn structured routing metadata into dispatcher input |
| `lib/chat/chat-navigation-context.tsx` | Persist bounded previous-turn routing metadata alongside chat state |
| `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase2-semantic-contract.md` | Add `recentRoutingContext` to arbiter request contract |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | Add follow-up context regression tests |
| `__tests__/unit/chat/cross-surface-arbiter.test.ts` | Add request/contract tests if this suite exists or is introduced |

## Step 1: Define shared bounded context contract

Add the `RecentRoutingContext` type in the semantic arbiter request contract.

Updated request shape:

```typescript
type CrossSurfaceArbiterRequest = {
  userInput: string
  activeNote?: { itemId: string; title: string | null }
  noteReferenceDetected?: boolean
  recentRoutingContext?: RecentRoutingContext
}
```

This should be documented in the Phase 2 semantic contract as an approved extension to the request payload.

## Step 1a: Define the source of prior routing metadata

The dispatcher must not infer prior routing metadata from freeform assistant text.

Phase 3b requires one explicit bounded source:

```typescript
type PreviousRoutingMetadata = {
  assistantMessageId?: string
  surface?: 'note' | 'panel_widget' | 'dashboard' | 'workspace' | 'unknown'
  intentFamily?: 'read_content' | 'state_info' | 'navigate' | 'mutate' | 'ambiguous'
  turnOutcome?:
    | 'content_answered'
    | 'state_info_answered'
    | 'navigate_executed'
    | 'clarifier'
    | 'not_supported'
    | 'unresolved'
}
```

Implementation seam:

- `chat-navigation-panel.tsx` stores the immediately previous handled routing metadata after each assistant turn
- `chat-navigation-context.tsx` keeps only the latest bounded value in chat state
- dispatcher input receives that structured metadata on the next turn

Turn-alignment rule:

- `assistantMessageId` must be the exact message ID of the assistant message produced by the handled routing result
- `assistantMessageId` must track the final persisted assistant message ID if the temporary local message ID is rewritten after persistence
- `lastAssistantMessage` may only be included in `recentRoutingContext` when it matches `previousRoutingMetadata.assistantMessageId`
- if the latest assistant message and stored metadata do not match, omit both the structured metadata and `lastAssistantMessage` for safety rather than mixing turns

This is required for Phase 3b. If that metadata is not wired into dispatcher input, the structured fields in `recentRoutingContext` must remain omitted.

Initial Phase 3b source rules:

- `lastUserMessage`:
  - source: latest prior `ctx.messages` entry where `role === 'user'`
  - must exclude the current turn input being routed now
  - never duplicate `ctx.trimmedInput` back into `recentRoutingContext.lastUserMessage`

- `lastAssistantMessage`:
  - source: latest prior `ctx.messages` entry where `role === 'assistant'`
  - sanitized and capped per the bounds above

- `lastResolvedSurface`:
  - source: `previousRoutingMetadata.surface`
  - Phase 3 initial mapping:
    - `tierLabel === 'arbiter_content_answered'` -> `note`
    - `tierLabel === 'arbiter_note_state_info'` -> `note`
    - `tierLabel === 'content_intent_answered'` -> `note`
    - otherwise omit unless a later phase adds an explicit persisted source

- `lastResolvedIntentFamily`:
  - source: `previousRoutingMetadata.intentFamily`
  - Phase 3 initial mapping:
    - `arbiter_content_answered` / `content_intent_answered` -> `read_content`
    - `arbiter_note_state_info` -> `state_info`
    - otherwise omit unless explicitly known

- `lastTurnOutcome`:
  - source: `previousRoutingMetadata.turnOutcome`
  - Phase 3 initial mapping:
    - `tierLabel === 'arbiter_content_answered'` or `tierLabel === 'content_intent_answered'` -> `content_answered`
    - `tierLabel === 'arbiter_note_state_info'` -> `state_info_answered`
    - `tierLabel === 'arbiter_mutate_not_supported'` -> `not_supported`
    - `tierLabel === 'arbiter_ambiguous'` -> `clarifier`
    - otherwise omit

`safe_clarifier` by itself is too broad and must not be used as a standalone derivation source for `lastTurnOutcome`.

If the dispatcher does not have a trustworthy structured source for one of these fields, it must omit the field rather than guess.

## Step 1b: Define lifecycle and reset rules

`previousRoutingMetadata` is bounded state and must be replaced or cleared explicitly.

Required rules:

- **new conversation / clear chat**
  - clear `previousRoutingMetadata`

- **history hydration / loading older messages**
  - do not reconstruct or backfill `previousRoutingMetadata` from historical messages
  - Phase 3b only uses metadata captured during the live current session

- **handled assistant turn**
  - replace `previousRoutingMetadata` only when the turn produced a handled assistant outcome with a concrete assistant message ID

- **error turn without a trustworthy handled result**
  - clear `previousRoutingMetadata` or leave it unchanged only if the prior value is still definitely tied to the latest assistant message
  - never synthesize new metadata from generic error UI

- **workspace/session switch**
  - if the switch invalidates the prior surface context, clear `previousRoutingMetadata`
  - at minimum, note-scoped metadata must not survive a workspace change that invalidates the referenced note context

- **message/metadata mismatch**
  - if `assistantMessageId` no longer points to the latest assistant message in scope, clear the stored metadata before building `recentRoutingContext`

Phase 3b should prefer omission over stale carry-forward.

## Step 2: Build recent context in the dispatcher

The dispatcher already has access to:

- current messages
- current UI state
- previous-turn structured routing metadata once the client/context seam above is added

Build `recentRoutingContext` from those values.

Priority order:

1. last user message from `ctx.messages`
   - must be the most recent user turn before the current input
2. last assistant message from `ctx.messages` only if it matches `previousRoutingMetadata.assistantMessageId`
3. last resolved surface / family from trustworthy structured metadata only
4. last turn outcome from trustworthy structured metadata only

If a field is unavailable, omit it.

## Step 3: Pass the bounded context into the cross-surface arbiter

When the dispatcher calls `callCrossSurfaceArbiter(...)`, include the new `recentRoutingContext`.

Example:

```typescript
const arbiterResult = await callCrossSurfaceArbiter({
  userInput: ctx.trimmedInput,
  activeNote: activeNoteId ? { itemId: activeNoteId, title: activeNote?.title ?? null } : undefined,
  noteReferenceDetected,
  recentRoutingContext,
})
```

## Step 4: Update arbiter prompt to use prior-turn context conservatively

Add a prompt section such as:

- Previous user turn: `{lastUserMessage}`
- Previous assistant turn: `{lastAssistantMessage}`
- Previous resolved surface: `{lastResolvedSurface}`
- Previous resolved intent family: `{lastResolvedIntentFamily}`
- Previous outcome: `{lastTurnOutcome}`

Prompt rule:

- use recent context only to resolve referential language like `that`, `it`, `again`, `that note`, `that panel`
- do not override explicit current-turn language when it clearly points elsewhere
- if recent context does not make the current request clearer, ignore it and classify from the current request alone
- explicit current-turn nouns and verbs always outrank prior-turn context
- structured prior metadata outranks raw `lastAssistantMessage`

## Step 5: Adopt in the arbiter first, keep the contract reusable

The same `recentRoutingContext` object should become the standard reusable input for future semantic routing layers, not a note-only custom field.

Phase 3b scope:

- implement the contract in the cross-surface arbiter only

Later convergence can reuse it for:

- cross-surface arbiter
- `/api/chat/navigate` semantic classification if convergence work happens later
- future surface-specific semantic routers

## Step 6: Add regression tests for follow-up phrasing

Add routing tests for cases where the immediately previous assistant turn should help classify the current turn.

Examples:

1. previous turn answered note state
- assistant: `The active note is Main Document.`
- user: `show me the content of that note`
- expect: `note.read_content`

2. previous turn answered note content
- assistant: note summary shown
- user: `summarize that again`
- expect: `note.read_content`

3. previous turn answered state-info
- assistant: `The open note is Main Document.`
- user: `read it`
- expect: `note.read_content`

4. current turn is explicit and should override prior context
- previous turn about note
- user: `show links panel`
- expect: navigation path, not note read

5. message/metadata mismatch
- stored `assistantMessageId` does not match the latest assistant message in scope
- expect: omit structured recent-turn metadata and `lastAssistantMessage`

6. clear chat / new conversation
- prior metadata existed in the previous conversation
- expect: no `recentRoutingContext` structured metadata passed into the arbiter

7. workspace switch invalidates prior note context
- prior metadata is note-scoped
- workspace changes before the next turn
- expect: note-scoped prior metadata cleared or omitted

8. history hydration / older-message load
- historical messages load into chat state
- expect: no synthetic backfilled `previousRoutingMetadata` from hydrated history

## Step 7: Maintain strict safety boundaries

Recent-turn context must **not** bypass:

- exact deterministic wins
- hard safety exclusions
- mutate non-execution policy
- migrated-family gate
- Stage 6 anchor requirements

It only improves semantic classification of ambiguous follow-up language.

## Expected outcome

After this plan:

- follow-up phrasing works more consistently across chat turns
- semantic routing stops behaving differently depending on which family happened to receive more context
- the note arbiter no longer operates as an isolated current-turn classifier
- future semantic routing families can share the same bounded context contract

## Verification

1. `npm run type-check`
2. `npx jest --testPathPattern content-intent-dispatcher-integration`
3. `npx jest --testPathPattern cross-surface-arbiter` if a dedicated arbiter suite is added; otherwise cover request-shape assertions in existing integration tests
4. manual follow-up tests:
   - `which note is open?` -> answer
   - then `show me the content of that note` -> content answer
   - note summary shown -> `summarize that again` -> content answer
   - prior note context present -> `show links panel` -> still navigation
5. lifecycle safety checks:
   - clear chat -> next turn sends no stale recent-turn metadata
   - workspace switch -> next note follow-up does not inherit invalid prior note metadata

## Success criteria

- semantic routing receives one shared bounded recent-turn context object in the cross-surface arbiter
- referential follow-up phrasing resolves correctly across note-family turns
- explicit current-turn commands still override prior context
- no full-history coupling is introduced
- stale or mismatched prior-turn metadata is omitted rather than reused
