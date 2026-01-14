# Doc Retrieval Improvements - Implementation Report

**Date:** 2026-01-14
**Features:**
1. HS1-style guard for heading-only chunks
2. Risky synonym removal (docs/documents/files → notes)

**File Modified:** `lib/docs/keyword-retrieval.ts`
**Status:** Implemented and Verified

---

## Summary

Added an HS1-style guard to `retrieveByDocSlug()` that skips heading-only chunks (chunks containing only a markdown header with no body content) and returns the first chunk with meaningful body text.

This prevents the disambiguation pill flow from returning empty or near-empty content when a user clicks a pill to select a document.

---

## Problem Statement

When a user clicks a disambiguation pill, `retrieveByDocSlug(docSlug)` is called to fetch content from the selected document. Previously, it always returned chunk 0, which in many docs is just a title heading (e.g., `## Workspace`) with no body content.

**Example problematic case:**
- User types "notes"
- Disambiguation shows pills for `actions/navigation` and `actions/notes`
- User clicks a pill
- `retrieveByDocSlug` returns chunk 0: `## Navigation Actions` (heading-only, no useful content)

---

## Implementation

### Code Added (lines 1001-1014)

```typescript
// Prefer the first non-heading-only chunk for doc slug lookups (HS1-style guard)
let bestChunk = chunks[0]
let snippet = extractSnippet(bestChunk.content)
if (detectIsHeadingOnly(snippet) && chunks.length > 1) {
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i]
    const candidateSnippet = extractSnippet(chunk.content)
    if (!detectIsHeadingOnly(candidateSnippet)) {
      bestChunk = chunk
      snippet = candidateSnippet
      break
    }
  }
}
```

### Supporting Functions

**`detectIsHeadingOnly(snippet: string): boolean`** (line 623)
```typescript
function detectIsHeadingOnly(snippet: string): boolean {
  const trimmed = snippet.trim()
  // Must start with a markdown header
  if (!trimmed.startsWith('#')) return false
  // Check body content after stripping headers
  const bodyChars = calculateBodyCharCount(snippet)
  return bodyChars < HEADING_ONLY_MAX_CHARS
}
```

**`calculateBodyCharCount(snippet: string): number`** (line 615)
```typescript
function calculateBodyCharCount(snippet: string): number {
  return stripMarkdownHeaders(snippet).length
}
```

**`stripMarkdownHeaders(text: string): string`** (line 604)
```typescript
function stripMarkdownHeaders(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n')
    .trim()
}
```

**Constant:** `HEADING_ONLY_MAX_CHARS = 50` (line 590)

### Logic Flow

```
retrieveByDocSlug(docSlug)
    │
    ▼
Query all chunks for doc_slug, ORDER BY chunk_index ASC
    │
    ▼
bestChunk = chunks[0]
    │
    ▼
Is chunk[0] heading-only?
    │
    ├── NO  → Return chunk[0]
    │
    └── YES → Loop through chunks[1..n]
                  │
                  ▼
              Find first non-heading-only chunk
                  │
                  ▼
              Return that chunk (or chunk[0] if all are heading-only)
```

---

## Testing

### Test Type 1: Direct API Test (curl)

**Command:**
```bash
curl -s -X POST http://localhost:3000/api/docs/retrieve \
  -H "Content-Type: application/json" \
  -d '{"docSlug": "concepts/workspace"}' | jq .
```

**Result:**
```json
{
  "success": true,
  "status": "found",
  "results": [
    {
      "doc_slug": "concepts/workspace",
      "chunk_index": 1,
      "header_path": "Workspace > Workspace > Overview",
      "snippet": "## Overview\nA workspace is where notes live...",
      "isHeadingOnly": false,
      "bodyCharCount": 111
    }
  ]
}
```

**Verification:** Returned `chunk_index: 1` (skipped chunk 0 which is heading-only).

---

### Test Type 2: SQL Database Verification

**Command:**
```sql
SELECT doc_slug, chunk_index, header_path, content
FROM docs_knowledge_chunks
WHERE doc_slug IN ('actions/navigation', 'concepts/workspace')
ORDER BY doc_slug, chunk_index ASC;
```

**Results:**

| Doc | Chunk | Content | Heading-only? |
|-----|-------|---------|---------------|
| `actions/navigation` | 0 | `## Navigation Actions` | Yes |
| `actions/navigation` | 1 | `## Overview\nThese actions move you between entries...` | No |
| `concepts/workspace` | 0 | `## Workspace` | Yes |
| `concepts/workspace` | 1 | `## Overview\nA workspace is where notes live...` | No |

**Verification:** Both docs have heading-only chunk 0, confirming the guard is being exercised.

---

### Test Type 3: Chat UI End-to-End Test

**Steps:**
1. Open chat UI
2. Type: `notes` (bare noun to trigger disambiguation)
3. Observe: Disambiguation pills appear
4. Click: "Navigation Actions > Navigation Actions > Behavior notes" pill
5. Observe: Result shows "Navigation Actions > Navigation Actions > Overview" with body content

**Screenshot Evidence:**
- Disambiguation showed two options
- Clicked "Behavior notes" pill (which selects doc `actions/navigation`)
- Result returned "Overview" chunk with content: "These actions move you between entries, dashboards, and workspaces..."

**Verification:**
- API returned `chunk_index: 1` for `actions/navigation`
- Content has body text (not heading-only)
- Guard successfully skipped chunk 0

---

## Test Results Summary

| Test Type | Method | Result |
|-----------|--------|--------|
| Direct API | `curl` with `docSlug` parameter | PASS - Returns chunk 1, not chunk 0 |
| SQL Verification | Query `docs_knowledge_chunks` table | PASS - Confirms chunk 0 is heading-only |
| Chat UI E2E | Disambiguation pill click | PASS - Returns meaningful content |

---

## Important Clarifications

1. **`isHeadingOnly: false` in API response** refers to the **returned chunk**, not chunk 0. The guard skipped the heading-only chunk 0 and returned chunk 1 which has body content.

2. **Pill selection is doc-level, not chunk-level.** Clicking a pill like "Behavior notes" selects the document `actions/navigation`, then `retrieveByDocSlug` returns the best chunk from that doc. The guard ensures that "best chunk" has body content.

3. **Guard is a no-op for docs where chunk 0 has body content.** The guard only affects the outcome when chunk 0 is heading-only.

---

## Files Changed

| File | Change |
|------|--------|
| `lib/docs/keyword-retrieval.ts` | Added HS1-style guard logic (lines 1001-1014) |

---

## Related Documentation

- `docs/proposal/chat-navigation/plan/panels/chat/meta/general-doc-retrieval-routing-plan.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/report/2026-01-11-general-doc-retrieval-routing-complete-report.md`

---

## Acceptance Criteria

- [x] `retrieveByDocSlug` skips heading-only chunk 0
- [x] Returns first chunk with body content (bodyCharCount >= 50)
- [x] Verified via direct API test
- [x] Verified via SQL database query
- [x] Verified via chat UI end-to-end test

---

# Feature 2: Risky Synonym Removal

## Summary

Removed risky synonyms from the `SYNONYMS` constant that incorrectly mapped documentation-related terms to "notes". This prevents users asking about "docs" from being incorrectly redirected to notes content.

---

## Problem Statement

The `SYNONYMS` constant contained mappings that caused confusion:

```typescript
// BEFORE (problematic)
const SYNONYMS: Record<string, string> = {
  // ...
  docs: 'notes',       // User asking about documentation gets notes
  documents: 'notes',  // Ambiguous - could mean many things
  files: 'notes',      // Too generic
  // ...
}
```

**Risk:** When a user typed "docs" (meaning documentation), the system would search for "notes" instead, returning incorrect results.

---

## Implementation

### Code Removed (lines 34-36)

```diff
 const SYNONYMS: Record<string, string> = {
   shortcuts: 'quick links',
   homepage: 'home',
   main: 'home',
-  docs: 'notes',
-  documents: 'notes',
-  files: 'notes',
   folder: 'navigator',
   folders: 'navigator',
   // ...
 }
```

### Remaining Safe Synonyms

```typescript
const SYNONYMS: Record<string, string> = {
  shortcuts: 'quick links',
  homepage: 'home',
  main: 'home',
  folder: 'navigator',
  folders: 'navigator',
  tree: 'navigator',
  history: 'recent',
  bookmarks: 'quick links',
  favorites: 'quick links',
  navigate: 'navigation',
}
```

---

## Testing

### Test Type 1: Direct API Test (curl)

**Commands:**
```bash
# Test "docs"
curl -s -X POST http://localhost:3000/api/docs/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "docs"}' | jq '{status, results}'

# Test "documents"
curl -s -X POST http://localhost:3000/api/docs/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "documents"}' | jq '{status, results}'

# Test "files"
curl -s -X POST http://localhost:3000/api/docs/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query": "files"}' | jq '{status, results}'
```

**Results:**

| Query | Before Patch | After Patch |
|-------|--------------|-------------|
| `"docs"` | Mapped to "notes" → score 3 | Literal search → score 1 (weak) |
| `"documents"` | Mapped to "notes" → results | **no_match** |
| `"files"` | Mapped to "notes" → results | **no_match** |
| `"notes"` | Direct match → score 3 | Direct match → score 3 (unchanged) |

---

### Test Type 2: Chat UI End-to-End Test

**Steps:**
1. Open chat UI
2. Type: `docs`
3. Type: `documents`
4. Type: `files`

**Screenshot Evidence:**

All three queries returned the graceful fallback message:
> "I'm best at helping with this app. Try asking about workspaces, notes, widgets, or navigation."

**Verification:**
- No incorrect mapping to "notes" content
- Helpful guidance provided to users
- Users can still ask about "notes" directly if that's what they mean

---

## Test Results Summary

| Query | Expected Behavior | Actual Behavior | Result |
|-------|-------------------|-----------------|--------|
| `docs` | No synonym mapping, fallback message | Fallback with suggestions | PASS |
| `documents` | No synonym mapping, no_match | Fallback with suggestions | PASS |
| `files` | No synonym mapping, no_match | Fallback with suggestions | PASS |
| `notes` | Direct match, unchanged | Disambiguation (score 3) | PASS |

---

## Risk Analysis

| Synonym Removed | Risk of Keeping | Risk of Removing |
|-----------------|-----------------|------------------|
| `docs: 'notes'` | **High** - System has actual docs | Low - Users can ask "notes" directly |
| `documents: 'notes'` | **Medium** - Ambiguous term | Low - Graceful fallback |
| `files: 'notes'` | **Medium** - Too generic | Low - Graceful fallback |

**Conclusion:** Removing these synonyms improves accuracy with minimal UX impact.

---

## Acceptance Criteria

- [x] Removed `docs: 'notes'` synonym
- [x] Removed `documents: 'notes'` synonym
- [x] Removed `files: 'notes'` synonym
- [x] Verified via direct API test (no synonym mapping)
- [x] Verified via chat UI test (fallback message shown)
- [x] "notes" direct query still works unchanged
