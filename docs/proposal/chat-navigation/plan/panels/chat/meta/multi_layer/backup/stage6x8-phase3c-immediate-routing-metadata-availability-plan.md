# Plan: Stage 6x.8 Phase 3c — Immediate Routing Metadata Availability

## Context

Phase 3b introduced `RecentRoutingContext` for the cross-surface arbiter, but real UI testing shows continuity is still unstable on the first immediate follow-up turn.

Observed pattern:
- `which note is open?` -> `read it` works
- `summarize this note` -> immediate `summarize that again` sometimes fails first, then succeeds when repeated
- after an explicit panel command, the first note follow-up can fail, then the same request succeeds on retry

This behavior is most consistent with a race in metadata availability:
- dispatcher reads `previousRoutingMetadata` synchronously at routing time
- `previousRoutingMetadata` is only stored after `addMessage(...)` finishes persistence and ID migration
- a fast next user turn can arrive before that async write completes

Phase 3c fixes that race by making a bounded previous-turn metadata snapshot available immediately for the next turn, while preserving the Phase 3b alignment safety rules.

## Anti-pattern applicability

`codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md` is **not applicable** here.
This work is routing-state timing and metadata transport, not isolation-provider/reactivity API expansion.
The relevant takeaway is still the same discipline:
- do not introduce a new unsafe provider/consumer contract in one step
- keep the current safe fallback behavior if metadata is unavailable or misaligned

## Goal

Guarantee that the first immediate follow-up turn can use the previous handled routing result without waiting for message persistence to complete.

## Non-goals

- No change to the semantic routing contract itself
- No expansion beyond the cross-surface arbiter in this phase
- No full chat-history injection
- No change to Stage 6 answer generation

## Files to change

- `lib/chat/cross-surface-arbiter.ts`
  - keep shared metadata types; add any narrow helper types if needed
- `lib/chat/chat-navigation-context.tsx`
  - add immediate previous-routing metadata storage and final-ID reconciliation
- `lib/chat/chat-routing-types.ts`
  - thread any new callback/type surface for immediate metadata writes
- `components/chat/chat-navigation-panel.tsx`
  - no direct metadata writing; only consume the context-provided state
- `lib/chat/routing-dispatcher.ts`
  - continue using the existing bounded recent-turn context builder with the same `previousRoutingMetadata` object, now written earlier
- `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts`
  - add immediate-follow-up regression coverage
- `__tests__/unit/chat/chat-navigation-context.test.tsx`
  - add direct context-level timing and reconciliation coverage for the Phase 3c seam

## Design

### 1. Two-phase metadata lifecycle

Keep one routing metadata object with two lifecycle phases:

- immediate phase
  - `previousRoutingMetadata` is written with the local assistant message ID
  - safe to use for immediate next-turn routing before persistence completes
- reconciled phase
  - the same `previousRoutingMetadata.assistantMessageId` is updated to the final persisted ID once persistence completes

This allows metadata to exist immediately after a handled assistant turn, without waiting for persistence.

### 2. Immediate write at assistant-message creation time

When `addMessage(message, routingMeta?)` receives an assistant message with a recognized `tierLabel`:
- write `previousRoutingMetadata` immediately using the local assistant `message.id`
- map `tierLabel` to structured metadata immediately

This state is usable for the very next turn because:
- the assistant message with the same local ID is already in `messages`
- dispatcher alignment can succeed against that local ID before persistence happens

### 3. Final-ID reconciliation after persistence

When `persistMessage(...)` returns a final database ID:
- if the stored `previousRoutingMetadata.assistantMessageId` matches the old local ID
- replace it with the persisted ID
- keep the rest of the metadata unchanged

This preserves Phase 3b alignment safety after persistence.

### 4. Keep omission on mismatch

Dispatcher safety rule remains:
- if latest assistant message ID does not match `previousRoutingMetadata.assistantMessageId`
- omit the entire `recentRoutingContext`

This means Phase 3c improves availability, but never weakens the mismatch guard.

### 5. Keep invalidation rules from Phase 3b

Still clear or omit note-scoped metadata when:
- chat reset / clear conversation
- `activeNoteId` changes
- explicit mismatch
- history hydration does not reconstruct metadata

Phase 3c must not regress these protections.

## Implementation steps

### Step 1: Refactor metadata mapping into a helper

In `chat-navigation-context.tsx`, extract a small pure helper:

```ts
function buildPreviousRoutingMetadata(
  assistantMessageId: string,
  routingMeta?: { tierLabel?: string }
): PreviousRoutingMetadata | null
```

Behavior:
- returns structured metadata for known arbiter/content tier labels
- returns `null` for turns that should not seed recent-turn context

Recognized mappings should remain the same as Phase 3b:
- `content_intent_answered` -> `note/read_content/content_answered`
- `arbiter_content_answered` -> `note/read_content/content_answered`
- `arbiter_note_state_info` -> `note/state_info/state_info_answered`
- `arbiter_mutate_not_supported` -> `not_supported`
- `arbiter_ambiguous` -> `clarifier`
- `arbiter_read_content_fallback` -> `clarifier`

### Step 2: Write metadata immediately inside `addMessage`

In `chat-navigation-context.tsx`:
- after `setMessages((prev) => [...prev, message])`
- if `message.role === 'assistant'` and `routingMeta` maps to structured metadata
- call `setPreviousRoutingMetadata(...)` immediately using local `message.id`

This is the core Phase 3c fix. The change is still small, but it is not just a literal line move:
- extract the mapping helper first
- write immediate local-ID metadata
- reconcile that same metadata object after persistence

### Step 3: Reconcile ID after persistence

In the existing persistence-success branch:
- if persisted ID differs from local ID
- update `previousRoutingMetadata.assistantMessageId` from local ID to persisted ID when it matches
- do not rebuild metadata from scratch unless necessary

This avoids races and keeps alignment stable before and after persistence.

### Step 4: Preserve clear/invalidation behavior

Do not remove the existing Phase 3b protections:
- `clearMessages()` clears metadata
- `setUiContext(...)` clears note-scoped metadata when `activeNoteId` changes
- history hydration still does not create metadata

### Step 5: Dispatcher behavior stays bounded

In `routing-dispatcher.ts`:
- keep the existing `recentRoutingContext` builder
- no broadening of what fields are included
- no fallback to stale partial context

The only expected effect is that first immediate follow-ups now see the same `previousRoutingMetadata` earlier and more reliably.

## Edge cases

### Immediate follow-up before persistence returns

Expected behavior after Phase 3c:
- previous assistant local ID is already stored in metadata
- latest assistant message still has the same local ID in `messages`
- alignment succeeds
- `recentRoutingContext` is available on the first follow-up turn

### Persistence returns a different final ID

Expected behavior:
- metadata assistant ID is updated to final ID
- future turns still align correctly

### Persistence fails or conversation ID is unavailable

Expected behavior:
- immediate metadata still exists for the current session turn sequence
- if persistence never happens, local-ID alignment still works while the message remains in local state
- no crash, no unsafe fallback

### Mismatch / stale carry-forward

Expected behavior:
- if assistant ID mismatch occurs, omit the whole `recentRoutingContext`
- never partially pass old metadata

### Workspace/note invalidation

Expected behavior:
- note-scoped metadata is cleared when `activeNoteId` changes
- first follow-up after a workspace/note switch should not inherit stale note referents

## Tests

### Dispatcher integration tests

Add or update tests in `content-intent-dispatcher-integration.test.ts`:

1. `immediate previousRoutingMetadata allows first follow-up without persistence delay`
- seed context with a handled assistant turn using local ID metadata
- immediate follow-up `read it`
- assert `recentRoutingContext` is passed on the first try

2. `metadata survives local->persisted ID reconciliation`
- simulate local assistant ID first
- then persisted ID replacement
- assert next turn still gets aligned context

3. `mismatch still omits entire recentRoutingContext`
- preserve existing test

4. `workspace/note invalidation still clears note-scoped metadata`
- preserve or strengthen existing test

### Required direct context tests

Add a context-focused test to verify:
- `addMessage(..., routingMeta)` writes immediate metadata before persistence settles
- persisted ID reconciliation updates the stored `assistantMessageId`

## Verification

1. `npm run type-check`
2. `npx jest --runInBand __tests__/unit/chat/content-intent-dispatcher-integration.test.ts`
3. `npx jest --runInBand __tests__/unit/chat/chat-navigation-context.test.tsx`
4. Manual:
   - `summarize this note` -> immediate `summarize that again`
   - `which note is open?` -> immediate `read it`
   - `show links panel` -> immediate `hey pls summarize that note?`

## Success criteria

Phase 3c is complete when:
- the first immediate referential follow-up works without requiring a retry
- mismatch and invalidation safety still hold
- no regression in mutate, clarifier, or explicit-current-turn override behavior
