# Stage 6x.8 Phase 3c — Immediate Routing Metadata Availability Report

**Date**: 2026-03-17
**Slice**: 6x.8 Phase 3c
**Status**: Complete — race condition fixed
**Plan**: `stage6x8-phase3c-immediate-routing-metadata-availability-plan.md`
**Predecessor**: `2026-03-16-stage6x8-phase3a-imperative-note-read-bugfix.md`

---

## Summary

Phase 3b introduced `RecentRoutingContext` for cross-turn follow-up resolution, but metadata was written only after async message persistence completed. Fast follow-up turns arrived before persistence finished, causing the first referential follow-up to miss context and fail — then succeed on retry.

Phase 3c fixes this by writing routing metadata immediately after `setMessages` (synchronous, before persistence), then reconciling the assistant message ID after persistence completes.

---

## Root Cause

`addMessage` in `chat-navigation-context.tsx` is async. Phase 3b wrote `previousRoutingMetadata` inside the `if (persisted)` block — after the `await persistMessage(...)` call. A fast next user turn could read `previousRoutingMetadata` before persistence finished, finding it still null/stale from the previous turn.

---

## What Was Implemented

### Helper extraction (`chat-navigation-context.tsx`)

Extracted `buildPreviousRoutingMetadataFromTierLabel` as an exported pure function:
- Maps known arbiter/content tier labels to structured `PreviousRoutingMetadata`
- Returns `null` for unrecognized tier labels (prevents seeding context from unknown turn types)

### Immediate metadata write

Metadata is now written right after `setMessages` (line 966), before the async persistence block:

```typescript
setMessages((prev) => [...prev, message])

// 6x.8 Phase 3c: Write routing metadata immediately with local ID
if (routingMeta && message.role === 'assistant') {
  const immediateMeta = buildPreviousRoutingMetadataFromTierLabel(message.id, routingMeta)
  if (immediateMeta) {
    setPreviousRoutingMetadata(immediateMeta)
  }
}
```

The metadata uses the local `message.id`, which matches the message just added to `messages`. The dispatcher's alignment check succeeds immediately.

### ID reconciliation after persistence

The Phase 3b post-persistence metadata write (full rebuild) is replaced with a conditional ID update:

```typescript
// 6x.8 Phase 3c: Reconcile routing metadata ID after persistence
if (routingMeta && message.role === 'assistant' && message.id !== persisted.id) {
  setPreviousRoutingMetadata(current => {
    if (current?.assistantMessageId === message.id) {
      return { ...current, assistantMessageId: persisted.id }
    }
    return current  // another turn overwrote — don't clobber
  })
}
```

This preserves alignment safety: if another turn's metadata was written between the immediate write and persistence completion, the reconciliation is skipped.

---

## Safety Preservation

All Phase 3b protections remain unchanged:

| Protection | Status |
|-----------|--------|
| Mismatch guard (dispatcher omits entire context on ID mismatch) | Preserved |
| Chat reset clears metadata | Preserved |
| Workspace/note switch clears note-scoped metadata | Preserved |
| History hydration does not backfill metadata | Preserved |
| Unrecognized tier labels return null | New (Phase 3c) |

---

## Test Results

```
$ npm run type-check
→ zero errors

$ npx jest --testPathPattern "content-intent-dispatcher|routing-metadata-timing"
→ 51/51 pass

Breakdown:
  content-intent-dispatcher-integration: 39/39
  routing-metadata-timing: 12/12
```

### New tests

**`routing-metadata-timing.test.ts`** (12 tests):
- Helper returns null for unrecognized/missing tier labels (3 tests)
- Helper maps all 6 recognized tier labels correctly (6 tests)
- Immediate write uses local message ID (1 test)
- Reconciliation updates ID when local ID matches (1 test)
- Reconciliation skips when local ID doesn't match (1 test)

**`content-intent-dispatcher-integration.test.ts`** (1 new test):
- Immediate metadata with local ID allows first follow-up without retry

### Known test limitation

The helper and reconciliation logic are tested as pure functions. A provider-level test exercising the full `ChatNavigationProvider` → `addMessage` → immediate metadata → async persistence → reconciliation flow is not included. This is the same test-depth tradeoff accepted for CitationSnippets (6x.6) and persistence/hydration (6x.6). The dispatcher integration test covers the end-to-end routing behavior.

---

## Files Modified

| File | Change |
|------|--------|
| `lib/chat/chat-navigation-context.tsx` | Extracted `buildPreviousRoutingMetadataFromTierLabel`; immediate metadata write after `setMessages`; replaced Phase 3b post-persistence write with ID reconciliation |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | 1 new immediate-follow-up test |
| `__tests__/unit/chat/routing-metadata-timing.test.ts` | **NEW** — 12 helper + reconciliation tests |

---

## What This Fixes

- "summarize this note" → immediate "summarize that again" no longer fails on first try
- Follow-up turns after note-state answers resolve consistently on the first attempt
- The race between async persistence and fast follow-up input is eliminated

## What This Does Not Change

- Dispatcher alignment logic — unchanged
- Arbiter prompt and classification — unchanged
- Stage 6 content pipeline — unchanged
- Phase 3b lifecycle/invalidation rules — preserved

---

## Next Steps

- Manual smoke pass to confirm first-follow-up reliability
- Phase 3b/3c implementation report consolidation (optional)
- Phase 4 planning: extend bounded context to non-note surfaces
