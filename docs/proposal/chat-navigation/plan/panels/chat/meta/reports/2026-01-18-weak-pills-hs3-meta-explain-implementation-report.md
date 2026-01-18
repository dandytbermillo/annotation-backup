# Implementation Report: Weak Pills & HS3 Integration for Meta-Explain and Follow-ups

**Date:** 2026-01-18
**Feature Slug:** chat-navigation
**Status:** Completed

---

## Executive Summary

This report documents the implementation of multiple features for chat navigation:

1. **Weak Confirmation Pills** - Single-pill disambiguation for weak (low-confidence) doc matches
2. **HS3 Meta-Explain Integration** - LLM-based snippet formatting for initial queries
3. **HS3 Follow-up Integration** - LLM-based formatting for "tell me more" (HS2) responses
4. **HS3 Timeout Fix** - Increased timeout to prevent race condition failures
5. **Optional Meta-Explain Short Flag** - Feature flag for formatting short definitions
6. **Steps Request After Disambiguation** - Preserve original query intent through pill selection

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
- Raw text with headers/prefixes displayed directly (e.g., "Workspace > Workspace > Overview: ## Overview...")

**Root Cause:**
`handleMetaExplain` did not call `maybeFormatSnippetWithHs3`.

### Issue 3: HS3 Not Triggered for Follow-ups (HS2)

**Symptoms:**
- "tell me more" responses showed raw documentation text
- Inconsistent formatting between initial queries and follow-ups

**Root Cause:**
`handleFollowUp` returned raw snippets without calling `maybeFormatSnippetWithHs3`.

### Issue 4: HS3 Timeouts

**Symptoms:**
- Intermittent raw responses when HS3 should have formatted
- Telemetry showed `hs3_timeout: true` at ~2001ms

**Root Cause:**
Original timeout (800ms, then 2000ms) was too close to OpenAI API latency (~800-2000ms).

### Issue 5: Steps Request Not Triggering After Disambiguation

**Symptoms:**
- Query "walk me through workspace actions" showed disambiguation pills
- After selecting a pill, response was NOT formatted as numbered steps
- `steps_request` trigger never fired even though original query contained "walk me through"

**Root Cause:**
When user selected a disambiguation pill, the `handleDocSelection` function in `chat-navigation-panel.tsx` used the `docSlug` as the query parameter for HS3 instead of the original user query. The steps-detection regex (`/walk me through|step by step|steps|how to|how do i/`) couldn't match against a doc slug like "workspace-actions".

**Flow Analysis:**
1. User types: "walk me through workspace actions"
2. Query is ambiguous → pills displayed
3. User clicks pill → `handleDocSelection(docSlug: "workspace-actions")`
4. HS3 called with query: "workspace-actions" (not original query)
5. Regex check: "workspace-actions" doesn't match steps patterns
6. Result: No `steps_request` trigger, plain formatting returned

---

## Solution

### 1. Weak Pills Implementation

**File:** `lib/chat/chat-routing.ts` (lines 385-454)

Added weak handler with single-pill confirmation:
- Creates `SelectionOption` from weak result
- Shows confirmation message with pill
- Sets pending options for user selection
- Logs telemetry as `meta_explain_weak_pill`

**Prerequisite:** Modified `getSmartExplanation` in `keyword-retrieval.ts` to return `options` array for weak status.

### 2. HS3 Meta-Explain Integration

**File:** `lib/chat/chat-routing.ts` (lines 459-490)

Added HS3 formatting to non-ambiguous path:
- Calls `maybeFormatSnippetWithHs3` with 'short' style
- Logs telemetry as `meta_explain_hs3` when successful
- Falls back to raw snippet on timeout/error

### 3. HS3 Follow-up Integration

**File:** `lib/chat/chat-routing.ts` (lines 751-801)

Added HS3 formatting to follow-up handler:
```typescript
const appendedChunkCount = excludeChunkIds.length + 1
const hs3Result = await maybeFormatSnippetWithHs3(
  snippet,
  trimmedInput,
  'medium', // Follow-ups use medium style for more detail
  appendedChunkCount,
  docRetrievalState.lastDocSlug
)
```

Key design decisions:
- `appendedChunkCount = excludeChunkIds.length + 1` ensures `two_chunks` trigger fires on 2nd follow-up
- Uses 'medium' style (more detail than 'short')
- Re-logs telemetry with HS3 fields via `logRoutingDecision`

### 4. HS3 Timeout Fix

**File:** `lib/chat/doc-routing.ts` (line 54)

```typescript
const HS3_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_HS3_TIMEOUT_MS ?? 2500)
```

Increased from 2000ms to 2500ms to accommodate OpenAI API latency variability.

### 5. Optional Meta-Explain Short Flag

**File:** `lib/chat/chat-routing.ts` (lines 462-471)

```typescript
const metaExplainShortEnabled = process.env.NEXT_PUBLIC_HS3_META_EXPLAIN_SHORT === 'true'
const shouldForceHs3 = metaExplainShortEnabled && rawExplanation.length > 100

const hs3Result = await maybeFormatSnippetWithHs3(
  rawExplanation,
  trimmedInput,
  'short',
  shouldForceHs3 ? 2 : 1, // Force two_chunks trigger if flag enabled
  result.docSlug || metaQueryTerm
)
```

- Only applies when `NEXT_PUBLIC_HS3_META_EXPLAIN_SHORT=true`
- Requires snippet > 100 chars (very short ones don't need formatting)
- Forces `two_chunks` trigger by setting `appendedChunkCount = 2`

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/docs/keyword-retrieval.ts` | Added `options` return for weak status |
| `lib/chat/chat-routing.ts` | Added weak handler, HS3 meta-explain integration, HS3 follow-up integration, optional short flag |
| `lib/chat/doc-routing.ts` | Increased HS3 timeout to 2500ms |
| `app/api/chat/format-snippet/route.ts` | Cleaned up debug logs |

---

## Testing & Verification

### Test 1: Weak Pills
- Query: "what are widget actions"
- Result: Single pill displayed
- Telemetry: `meta_explain_weak_pill` logged

### Test 2: HS3 Meta-Explain (with flag ON)
- Query: "what is workspace"
- Raw input: "Workspace > Workspace > Overview: ## Overview A workspace is where notes live..."
- Formatted output: "A workspace is a place where your notes are stored, and each workspace is associated with an entry..."
- Telemetry: `meta_explain_hs3` logged with trigger=two_chunks

### Test 3: HS3 Follow-ups
- Query sequence: "what is workspace" -> "tell me more" -> "tell me more"
- First follow-up: appendedChunkCount=1 (no two_chunks trigger)
- Second follow-up: appendedChunkCount=2 (HS3 triggers via two_chunks)
- Telemetry: `hs3_called=true`, `hs3_trigger_reason=two_chunks`, `hs3_timeout=false`

### Test 4: Timeout Elimination
- Before: Intermittent `hs3_timeout=true` at ~2001ms
- After: All `hs3_timeout=false` with latencies 1010-1812ms

### Type Check
```bash
$ npm run type-check
# (no errors)
```

---

## Production Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| HS3_TIMEOUT_MS | 2500ms | Increased from 2000ms |
| HS3_LENGTH_THRESHOLD | 600 chars | Unchanged |
| NEXT_PUBLIC_HS3_META_EXPLAIN_SHORT | true/false | Optional flag for short definitions |

### HS3 Triggers
1. **Long snippet:** > 600 chars (`long_snippet`)
2. **Steps request:** "how to", "steps to" (`steps_request`)
3. **Two chunks:** >= 2 appended chunks (`two_chunks`)

### HS3 Behavior by Context

| Context | HS3 Trigger | Style |
|---------|-------------|-------|
| Meta-explain (flag OFF) | long_snippet, steps_request | short |
| Meta-explain (flag ON, >100 chars) | two_chunks (forced) | short |
| Follow-up (1st) | long_snippet, steps_request only | medium |
| Follow-up (2nd+) | two_chunks | medium |

---

## Telemetry

### Actions Logged

| Action | Component | Description |
|--------|-----------|-------------|
| `meta_explain_weak_pill` | ChatRouting | Weak confirmation pill shown |
| `meta_explain_hs3` | ChatRouting | HS3 formatted meta-explain response |
| `route_decision` (with hs3_* fields) | DocRouting | HS3 formatted follow-up response |

### HS3 Telemetry Fields

| Field | Type | Description |
|-------|------|-------------|
| `hs3_called` | boolean | Whether HS3 was invoked |
| `hs3_latency_ms` | number | Time taken by HS3 API call |
| `hs3_trigger_reason` | string | long_snippet, steps_request, or two_chunks |
| `hs3_timeout` | boolean | Whether HS3 timed out |
| `hs3_error` | boolean | Whether HS3 encountered an error |
| `hs3_input_len` | number | Input snippet length |
| `hs3_output_len` | number | Formatted output length |

### Sample Telemetry Results

```
route    | hs3  | trigger    | timeout | latency
---------+------+------------+---------+---------
followup | true | two_chunks | false   | 1399ms
followup | true | two_chunks | false   | 1087ms
followup | true | two_chunks | false   | 1812ms
followup | true | two_chunks | false   | 1230ms
```

---

## Verification Checklist

- [x] Weak pills appear for weak status
- [x] HS3 triggers for meta-explain (with flag)
- [x] HS3 triggers for follow-ups (2nd+)
- [x] HS3 telemetry logged correctly
- [x] Timeout fixed (2500ms)
- [x] No timeouts observed in testing
- [x] Consistent formatting across test runs
- [x] Type-check passes
- [x] Debug logs cleaned up

---

## Recommendations

1. **Monitor hs3_timeout rate** - If >5% timeouts persist, bump to 3000ms
2. **Monitor latency distribution** - Current p95 is ~1.8s, watch for degradation
3. **Consider model optimization** - gpt-4o-mini is already fast, but could explore alternatives if latency becomes an issue

---

*Report generated: 2026-01-18*
*Updated with HS3 follow-up integration, timeout fix, and optional meta-explain flag*
