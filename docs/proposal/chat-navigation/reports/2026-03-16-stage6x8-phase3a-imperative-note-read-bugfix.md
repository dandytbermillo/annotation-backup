# Stage 6x.8 Phase 3a — Imperative Note-Read Bugfix Report

**Date**: 2026-03-16
**Slice**: 6x.8 Phase 3a
**Status**: Complete — runtime-proven
**Plan**: `stage6x8-phase3-imperative-note-read-bugfix-plan.md`
**Predecessor**: `2026-03-15-stage6x8-phase3-cross-surface-arbiter-implementation.md`

---

## Summary

Phase 3 shipped the cross-surface arbiter for note families. Summary/explain-style note reads worked, but command-shaped note-read requests ("show me the content of that note") fell through to entry disambiguation instead of producing a content answer.

Two root causes:
1. The arbiter prompt had no imperative note-read examples, making misclassification plausible
2. When the arbiter correctly classified `note.read_content` but Stage 6 did not produce `content_answered`, the dispatcher fell through to legacy routing instead of returning a bounded fallback

Both are fixed.

---

## What Was Implemented

### Arbiter prompt strengthening (`app/api/chat/cross-surface-arbiter/route.ts`)

Added imperative note-read examples and disambiguation rule to the prompt:

```
IMPORTANT: Imperative verbs like "show", "read", "display", "tell me" do NOT imply navigation
when the object is clearly note content. These are read_content requests:
- "show me the content of that note" → read_content (summary)
- "show the text of this note" → read_content (summary)
- "read that note" → read_content (summary)
- "display the contents of my note" → read_content (summary)

Use "navigate" ONLY when the user is asking to open, go to, switch to, or move somewhere in the UI.
```

### Bounded fallback for S6 non-answer (`lib/chat/routing-dispatcher.ts`)

Added after the Stage 6 try/catch block in the arbiter `note.read_content` path. When the arbiter classifies `note.read_content` but Stage 6 does not produce `content_answered` (abort, timeout, null, throw), the dispatcher now:

1. Shows: "I couldn't read enough of the current note to answer that. Try asking a more specific question about the note."
2. Sets `contentIntentMatchedThisTurn = true` (suppresses Stage 5 + later tiers)
3. Writes routing log with arbiter telemetry
4. Returns early — never falls through to legacy entry/panel disambiguation

### Regression tests (`content-intent-dispatcher-integration.test.ts`)

3 new tests:

| Test | Verifies |
|------|----------|
| Arbiter `note.read_content` + S6 abort → bounded fallback | Message says "couldn't read enough", `handled: true`, tier label = `arbiter_read_content_fallback` |
| Arbiter `note.read_content` + S6 returns null → bounded fallback | Same behavior |
| Arbiter `note.read_content` + S6 throws → bounded fallback | Same behavior |

---

## Classification Verification (Manual API Validation)

Direct API calls to the arbiter after prompt change — all 4 imperative phrases classify correctly:

| Phrase | Surface | Intent | Confidence |
|--------|---------|--------|------------|
| "show me the content of that note" | note | read_content | 0.95 |
| "show the text of that note" | note | read_content | 0.90 |
| "read that note" | note | read_content | 0.90 |
| "display the contents of this note" | note | read_content | 0.95 |

---

## Runtime Proof

Durable log entries after deployment:

| Query | Arbiter Result | S6 Outcome | Status |
|-------|---------------|------------|--------|
| "pls show me the content of that note please? thanks" | `note:read_content` | `content_answered` | executed |
| "can you show me the content of that note please?" | `note:read_content` | `content_answered` | executed |
| "can you summarize the content of that note please?" | (deterministic) | `content_answered` | executed |

All queries now produce content answers with Sources and Show more. No entry disambiguation. No legacy fallthrough.

---

## Test Results

```
$ npm run type-check
→ zero errors

$ npx jest --testPathPattern content-intent-dispatcher
→ 36/36 pass (33 existing + 3 new)
```

---

## Files Modified

| File | Change |
|------|--------|
| `app/api/chat/cross-surface-arbiter/route.ts` | Added imperative note-read examples + disambiguation rule to prompt |
| `lib/chat/routing-dispatcher.ts` | Added bounded fallback after S6 non-answer in arbiter `note.read_content` path |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | 3 new fallback regression tests |

---

## What This Fixes

- "show me the content of that note" no longer falls through to entry disambiguation
- "read that note", "display the contents of this note" now classify as `note.read_content`
- If Stage 6 aborts after correct classification, user sees a bounded message instead of unrelated budget100/300/300B options

## What This Does Not Change

- Deterministic classifier fast path (SUMMARY/QUESTION/FIND_TEXT) — unchanged
- Stage 6 content pipeline — unchanged
- Arbiter schema and migrated-family gate — unchanged
- Non-note surface routing — unchanged

---

## Next Steps

- **Phase 3b**: Add shared recent-turn routing context to the arbiter for cross-turn follow-up handling
