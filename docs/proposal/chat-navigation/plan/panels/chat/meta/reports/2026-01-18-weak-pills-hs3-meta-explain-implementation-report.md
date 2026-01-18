# Implementation Report: Weak Pills & HS3 Integration for Meta-Explain Handler

**Date:** 2026-01-18
**Feature Slug:** chat-navigation
**Status:** Completed

---

## Executive Summary

This report documents the implementation of two features for the meta-explain handler:

1. **Weak Confirmation Pills** - Single-pill disambiguation for weak (low-confidence) doc matches
2. **HS3 Bounded Formatting** - LLM-based snippet formatting for improved response quality

Both features were integrated into `handleMetaExplain` in `chat-routing.ts`.

---

## Problem Statement

### Issue 1: Weak Pills Not Appearing

**Symptoms:**
- Queries returning `weak` status showed NO disambiguation pills
- Queries returning `ambiguous` status correctly showed pills
- Example: "what are widget actions" -> weak -> no pills

**Root Cause:**
`handleMetaExplain` only had a handler for `ambiguous` status, not `weak`.

### Issue 2: HS3 Not Triggered in Meta-Explain

**Symptoms:**
- Long snippets were not formatted by HS3
- Raw text with headers/prefixes displayed directly

**Root Cause:**
`handleMetaExplain` did not call `maybeFormatSnippetWithHs3`.

---

## Solution

### Weak Pills Implementation

**File:** `lib/chat/chat-routing.ts` (lines 385-454)

Added weak handler with single-pill confirmation:
- Creates `SelectionOption` from weak result
- Shows confirmation message with pill
- Sets pending options for user selection
- Logs telemetry as `meta_explain_weak_pill`

**Prerequisite:** Modified `getSmartExplanation` in `keyword-retrieval.ts` to return `options` array for weak status.

### HS3 Integration

**File:** `lib/chat/chat-routing.ts` (lines 459-490)

Added HS3 formatting to non-ambiguous path:
- Calls `maybeFormatSnippetWithHs3` with 'short' style
- Logs telemetry as `meta_explain_hs3` when successful
- Falls back to raw snippet on timeout/error

### Timeout Fix

**Problem:** HS3 timed out at 800ms while OpenAI took ~802ms.

**Fix:** Increased `HS3_TIMEOUT_MS` from 800ms to 2000ms in `doc-routing.ts`.

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/docs/keyword-retrieval.ts` | Added `options` return for weak status |
| `lib/chat/chat-routing.ts` | Added weak handler + HS3 integration |
| `lib/chat/doc-routing.ts` | Increased HS3 timeout to 2000ms |
| `app/api/chat/format-snippet/route.ts` | Cleaned up debug logs |

---

## Testing & Verification

### Test 1: Weak Pills
- Query: "what are widget actions"
- Result: Single pill displayed
- Telemetry: `meta_explain_weak_pill` logged

### Test 2: HS3 Formatting
- Query: "what is workspace"
- Raw input (157 chars): "Workspace > Workspace > Overview: ## Overview A workspace is where notes live..."
- Formatted output (148 chars): "A workspace is a place where your notes are stored..."
- Telemetry: `meta_explain_hs3` logged with trigger=long_snippet, latency=1258ms

### Type Check
```bash
$ npm run type-check
# (no errors)
```

---

## Production Configuration

| Setting | Value |
|---------|-------|
| HS3_TIMEOUT_MS | 2000ms |
| HS3_LENGTH_THRESHOLD | 600 chars |

### HS3 Triggers
1. Long snippet: > 600 chars
2. Steps request: "how to", "steps to"
3. Two chunks: >= 2 appended chunks

---

## Telemetry Actions

| Action | Description |
|--------|-------------|
| `meta_explain_weak_pill` | Weak confirmation pill shown |
| `meta_explain_hs3` | HS3 successfully formatted response |

---

## Verification Checklist

- [x] Weak pills appear for weak status
- [x] HS3 triggers for long snippets
- [x] HS3 telemetry logged
- [x] Timeout fixed (2000ms)
- [x] Type-check passes
- [x] Debug logs cleaned up
- [x] Production thresholds restored

---

*Report generated: 2026-01-18*
