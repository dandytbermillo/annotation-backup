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

This plan fixes that disconnect by introducing one bounded, structured, universal recent-turn context object for semantic routing.

## Goal

Create a shared, bounded `recentRoutingContext` object that can be passed into semantic routing layers across intent families, so referential follow-up queries resolve consistently without turning any arbiter into a freeform chat agent.

## Non-goals

This plan does **not**:

- pass full chat history into every arbiter
- replace deterministic safety boundaries
- turn the semantic arbiter into a general conversational assistant
- change execution ownership (deterministic resolution and Stage 6 remain downstream)

## Core Principle

The fix must be **universal**, not note-only.

Because all requests live in the same chat stream, bounded recent-turn context should be available to semantic routing regardless of intent family:

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

## Design constraints

1. **Bounded**
- only the immediately previous turn context is included
- no full chat transcript
- no unbounded message arrays

2. **Structured**
- no raw reasoning state
- only fields useful for routing disambiguation

3. **Universal**
- same object shape used by semantic routing layers across families

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
| `components/chat/chat-navigation-panel.tsx` | Optional: expose same bounded context to future semantic callers if needed |
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

## Step 2: Build recent context in the dispatcher

The dispatcher already has access to:

- current messages
- current UI state
- the last routing result metadata for the immediately previous assistant turn

Build `recentRoutingContext` from those values.

Priority order:

1. last user message from `ctx.messages`
2. last assistant message from `ctx.messages`
3. last resolved surface / family from the prior routing result if available
4. last turn outcome from prior routing provenance / tier result if available

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

## Step 5: Keep this universal for future semantic routing callers

The same `recentRoutingContext` object should become the standard input for future semantic routing layers, not a note-only custom field.

That means later phases can reuse it for:

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
3. `npx jest --testPathPattern cross-surface-arbiter`
4. manual follow-up tests:
   - `which note is open?` -> answer
   - then `show me the content of that note` -> content answer
   - note summary shown -> `summarize that again` -> content answer
   - prior note context present -> `show links panel` -> still navigation

## Success criteria

- semantic routing receives one shared bounded recent-turn context object
- referential follow-up phrasing resolves correctly across note-family turns
- explicit current-turn commands still override prior context
- no full-history coupling is introduced
