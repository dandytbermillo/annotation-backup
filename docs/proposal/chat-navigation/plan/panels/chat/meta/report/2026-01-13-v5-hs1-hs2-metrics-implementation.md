# V5 Hybrid Response Selection + Metrics Implementation Report

**Date:** 2026-01-13
**Status:** Complete
**Plan Reference:** `general-doc-retrieval-routing-plan.md`

---

## Summary

Implemented v5 Hybrid Response Selection (HS1/HS2) to fix the "header-only response" problem where follow-ups like "tell me more" returned bare section headers instead of meaningful body content. Also added structured metrics logging for all key retrieval events.

---

## Problem Statement

After v4 doc retrieval routing was implemented, users experienced:
- "tell me more" returning `## Workspace Actions` (header-only, no body)
- Repeated content on follow-up queries
- No metrics to track retrieval quality

Root cause: Header-only chunks scored HIGHEST because they matched query terms in headers, but contained no body content.

---

## Solution Implemented

### HS1 — Snippet Quality Guard

**Approach:** Apply a 90% scoring penalty to header-only chunks so body-containing chunks rank higher.

**File:** `lib/docs/keyword-retrieval.ts`

```typescript
// V5 HS1: Heavily penalize header-only chunks in scoring phase
const bodyText = stripMarkdownHeaders(chunk.content)
if (bodyText.length < HEADING_ONLY_MAX_CHARS) {
  normalizedScore = normalizedScore * 0.1 // 90% penalty for header-only
  explain.push(`Header-only penalty: score * 0.1`)
}
```

**Constants:**
- `MIN_BODY_CHARS = 80`
- `HEADING_ONLY_MAX_CHARS = 50`

### HS2 — Follow-up Expansion

**Approach:** Track shown chunk IDs and exclude them on follow-ups to avoid repeats.

**State Added:** `lastChunkIdsShown?: string[]` in `DocRetrievalState`

**File:** `lib/chat/chat-navigation-context.tsx:44`

**Usage:** When user says "tell me more":
1. Pass `excludeChunkIds` to `/api/docs/retrieve`
2. API filters out already-shown chunks
3. Returns next best chunk or exhaustion message

---

## Metrics Logging

Added structured `metrics` field to `DebugLogData` interface.

**File:** `lib/utils/debug-logger.ts:124-136`

```typescript
metrics?: {
  event: string;
  docSlug?: string;
  correctionPhrase?: string;
  excludedChunks?: number;
  optionCount?: number;
  selectedLabel?: string;
  upgradeAttempted?: boolean;
  upgradeSuccess?: boolean;
  bodyCharCount?: number;
  timestamp: number;
};
```

### Events Logged

| Event | Action | Location |
|-------|--------|----------|
| `correction_triggered` | `doc_correction` | Line 2783 |
| `followup_expansion` | `doc_followup_v5` | Line 2824 |
| `clarification_shown` | `clarification_shown` | Line 3120 |
| `clarification_resolved` | `selection_only_guard` | Line 3432 |
| `clarification_resolved` | `label_match_selection` | Line 3468 |
| `clarification_resolved` | `pill_click_selection` | Line 1910 |
| `snippet_quality_upgrade` | `hs1_snippet_upgrade` | Lines 3010, 3038 |

---

## Bug Fixes

### 1. handleDocSelection not setting lastDocSlug

**Problem:** After clicking a doc disambiguation pill, `docRetrievalState.lastDocSlug` was not set, so subsequent "not that" corrections failed.

**Fix:** `components/chat/chat-navigation-panel.tsx:1871-1875`

```typescript
// Update docRetrievalState so correction/"not that" works after pill selection
updateDocRetrievalState({
  lastDocSlug: docSlug,
  lastChunkIdsShown: topResult.chunkId ? [topResult.chunkId] : [],
})
```

### 2. extractSnippet collapsing newlines

**Problem:** Word-based extraction collapsed multi-line content, breaking header detection.

**Fix:** Changed to char-based extraction preserving newlines in `lib/docs/keyword-retrieval.ts`.

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/docs/keyword-retrieval.ts` | Scoring penalty, extractSnippet fix, helper functions |
| `lib/chat/chat-navigation-context.tsx` | Added `lastChunkIdsShown` to state |
| `lib/utils/debug-logger.ts` | Added `metrics` field to interface |
| `app/api/docs/retrieve/route.ts` | Added `excludeChunkIds`, `scopeDocSlug` params |
| `components/chat/chat-navigation-panel.tsx` | HS1/HS2 handlers, metrics logging, bug fix |

---

## Smoke Test Results

| Test | Result | Metric Verified |
|------|--------|-----------------|
| "workspace" → body content | PASS | N/A |
| "tell me more" → no repeat | PASS | `followup_expansion` |
| "tell me more" x3 → exhaustion | PASS | Shows "That's all I have" |
| Ambiguous term → 2 pills | PASS | `clarification_shown` (optionCount: 2) |
| Pill click → resolution | PASS | `pill_click_selection` |
| "not that" → repair loop | PASS | `doc_correction` |

---

## Database Verification

```sql
SELECT action, metadata FROM debug_logs
WHERE action IN ('clarification_shown', 'pill_click_selection', 'doc_correction')
ORDER BY created_at DESC LIMIT 5;
```

Results confirmed all metrics logging correctly.

---

## Remaining (Future Phases)

| Item | Status |
|------|--------|
| Semantic Fallback (LLM classifier) | Not implemented - gated feature |
| Unified Retrieval (docs + notes) | Not implemented - future phase |
| HS3 (LLM formatting) | Not implemented - optional |

---

## Rollback

To rollback v5:
1. Remove scoring penalty in `scoreChunk`
2. Remove `excludeChunkIds` handling
3. Remove `lastChunkIdsShown` from state
4. Revert metrics logging additions

---

## Acceptance Criteria Status

- [x] "tell me more" returns body content, not headers
- [x] Follow-ups cycle through chunks without repeats
- [x] Exhaustion message when no more chunks
- [x] Correction flow works after pill selection
- [x] All key events have structured metrics logging
- [x] Type-check passes
- [x] All smoke tests pass
