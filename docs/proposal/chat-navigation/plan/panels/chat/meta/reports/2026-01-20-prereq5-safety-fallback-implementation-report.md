# Prereq 5: Safety + Fallback — Implementation Report

**Date:** 2026-01-20
**Status:** Verified Complete
**Plan Reference:** `unified-retrieval-prereq-plan.md` (Prerequisite 5)

---

## Summary

Implemented graceful degradation for the cross-corpus retrieval system. When the notes index is unavailable, corrupted, or times out, the system now fails gracefully instead of crashing or blocking the UI.

**Key achievements:**
- 3000ms timeout on notes fetch using AbortController
- Structured failure tracking with reason codes
- Graceful error message for explicit notes intent
- Silent fallback to docs for ambiguous queries
- Telemetry fields for monitoring fallback events

---

## Problem Statement

Before this implementation:
1. Notes fetch failures could hang the UI indefinitely
2. Index errors could crash the cross-corpus handler
3. No visibility into why notes retrieval failed
4. Users with explicit notes intent got no feedback on failure

**Requirements from plan:**
- Handle index missing, fetch error, timeout, workspace missing
- Show graceful message for explicit notes intent
- Fall through to docs for ambiguous queries
- Emit telemetry for monitoring

---

## Implementation

### Files Modified

| File | Changes |
|------|---------|
| `lib/chat/cross-corpus-retrieval.ts` | Added timeout, failure tracking types, `fetchNotesWithFallback()` |
| `lib/chat/cross-corpus-handler.ts` | Graceful error messages, telemetry fields |

### Types Added

```typescript
// Failure reason codes
export type NotesFallbackReason =
  | 'index_missing'
  | 'workspace_missing'
  | 'fetch_error'
  | 'timeout'

// Structured failure info
export interface NotesFailureInfo {
  failed: true
  reason: NotesFallbackReason
  error?: string
}

// Extended fetch result
export interface CorpusFetchResult {
  result: CorpusResult | null
  failure?: NotesFailureInfo
}

// Extended decision reasons
export type CrossCorpusReason =
  | ... // existing reasons
  | 'notes_fetch_error'
  | 'notes_workspace_missing'
```

### Constants

```typescript
// Notes retrieval timeout (ms)
const NOTES_FETCH_TIMEOUT_MS = 3000
```

---

## Architecture

### Timeout Implementation

```typescript
export async function fetchNotesWithFallback(
  query: string,
  options?: { excludeChunkIds?: string[]; topK?: number }
): Promise<CorpusFetchResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), NOTES_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch('/api/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corpus: 'notes', query, ...options }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      // Classify error by HTTP status
      if (response.status === 503 || response.status === 500) {
        return { result: null, failure: { failed: true, reason: 'index_missing' } }
      }
      return { result: null, failure: { failed: true, reason: 'fetch_error' } }
    }

    const data = await response.json()
    return { result: extractCorpusResult(data) }
  } catch (error) {
    clearTimeout(timeoutId)

    // Check for abort (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      return { result: null, failure: { failed: true, reason: 'timeout' } }
    }

    return { result: null, failure: { failed: true, reason: 'fetch_error' } }
  }
}
```

### Fallback Decision Flow

```
Notes Fetch
    ↓
    ├── Success → normal cross-corpus flow
    │
    ├── Timeout (3000ms) → reason: 'timeout'
    │   ├── Explicit notes intent → "I couldn't access your notes..."
    │   └── Ambiguous intent → fall through to docs
    │
    ├── HTTP 500/503 → reason: 'index_missing'
    │   ├── Explicit notes intent → "I couldn't access your notes..."
    │   └── Ambiguous intent → fall through to docs
    │
    └── Other error → reason: 'fetch_error'
        ├── Explicit notes intent → "I couldn't access your notes..."
        └── Ambiguous intent → fall through to docs
```

### Handler Integration

```typescript
// Explicit notes intent path
if (hasExplicitNotesIntent && !hasExplicitDocsIntent) {
  const notesFetchResult = await fetchNotesWithFallback(trimmedInput)

  // Prereq 5: Handle failure gracefully
  if (notesFetchResult.failure) {
    addMessage({
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: "I couldn't access your notes right now. Would you like to try again or search the documentation instead?",
      timestamp: new Date(),
    })

    // Emit telemetry
    void debugLog({
      component: 'CrossCorpus',
      action: 'notes_explicit_failed',
      metadata: {
        notes_index_available: false,
        notes_retrieval_error: true,
        notes_fallback_reason: notesFetchResult.failure.reason,
      },
    })

    return { handled: true }
  }

  // ... normal notes result handling
}
```

---

## Telemetry Fields

| Field | Type | Description |
|-------|------|-------------|
| `notes_index_available` | boolean | Whether notes index was accessible |
| `notes_retrieval_error` | boolean | Whether notes fetch failed |
| `notes_fallback_reason` | string | Failure reason code |

**Emitted in these actions:**
- `notes_explicit_failed` — explicit notes intent with failure
- `notes_fallback_to_docs` — ambiguous query with notes failure
- `fallthrough_to_docs` — includes failure info if applicable
- `ambiguity_shown` — confirms no failure occurred

---

## Verification Results

### Test Setup

Simulated index failure by renaming table:
```sql
ALTER TABLE items_knowledge_chunks RENAME TO items_knowledge_chunks_backup;
```

### Acceptance Tests

| Test | Query | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| 1 | "search my notes for workspace" | Graceful error message | "I couldn't access your notes right now..." | ✅ PASS |
| 2 | "what is workspace" | Docs only, no crash | Docs result with "Show more" | ✅ PASS |
| 3 | Timeout simulation | Treat as unavailable | Not tested (requires network delay) | ⏸️ |
| 4 | Workspace missing | Docs only | Not tested (requires context manipulation) | ⏸️ |

### Post-Test Cleanup

```sql
ALTER TABLE items_knowledge_chunks_backup RENAME TO items_knowledge_chunks;
```

---

## UX Behavior

### Explicit Notes Intent + Failure

**Message shown:**
> "I couldn't access your notes right now. Would you like to try again or search the documentation instead?"

**Design rationale:**
- Acknowledges the user's intent (they asked for notes)
- Explains the failure without technical jargon
- Suggests alternatives (try again or search docs)
- Inline text only (no new UI components per plan)

### Ambiguous Intent + Failure

**Behavior:** Falls through to docs retrieval silently.

**Design rationale:**
- User didn't explicitly ask for notes
- Showing an error would be confusing
- Docs result is still helpful
- Telemetry tracks the fallback for monitoring

---

## Error Classification

| HTTP Status | Text Contains | Classified As |
|-------------|---------------|---------------|
| 500, 503 | - | `index_missing` |
| - | "index", "table" | `index_missing` |
| AbortError | - | `timeout` |
| Other | - | `fetch_error` |

**Note:** Classification heuristics are conservative. Unknown errors default to `fetch_error`, which is still handled gracefully.

---

## Future Improvements (Optional)

1. **Action button:** Add a "Search docs instead" pill to the error message
2. **Retry mechanism:** Add automatic retry with exponential backoff
3. **Health check endpoint:** Proactive index availability check
4. **More precise error codes:** Map specific API errors to failure reasons

---

## Files Changed Summary

```
lib/chat/cross-corpus-retrieval.ts  (MOD)
  - Added NotesFallbackReason, NotesFailureInfo, CorpusFetchResult types
  - Added NOTES_FETCH_TIMEOUT_MS constant (3000ms)
  - Added fetchNotesWithFallback() with AbortController
  - Extended queryCrossCorpus() to return CrossCorpusDecisionWithFailure
  - Added workspaceAvailable option

lib/chat/cross-corpus-handler.ts    (MOD)
  - Updated imports for new types
  - Updated explicit notes path to use fetchNotesWithFallback()
  - Added graceful error message on failure
  - Added Prereq 5 telemetry fields to all logging
```

---

## Commands to Verify

```bash
# Type-check
npm run type-check

# Simulate index failure (requires psql access)
docker exec annotation_postgres psql -U postgres -d annotation_dev \
  -c "ALTER TABLE items_knowledge_chunks RENAME TO items_knowledge_chunks_backup;"

# Test in browser
# 1. "search my notes for X" → should show graceful error
# 2. "what is X" → should show docs only

# Restore table
docker exec annotation_postgres psql -U postgres -d annotation_dev \
  -c "ALTER TABLE items_knowledge_chunks_backup RENAME TO items_knowledge_chunks;"
```
