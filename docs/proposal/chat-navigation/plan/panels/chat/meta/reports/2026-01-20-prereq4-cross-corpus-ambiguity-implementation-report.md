# Prereq 4: Cross-Corpus Ambiguity UX — Implementation Report

**Date:** 2026-01-20
**Status:** Verified Complete
**Plan Reference:** `unified-retrieval-prereq-plan.md` (Prerequisite 4)

---

## Summary

Implemented cross-corpus ambiguity detection and disambiguation UX for the unified retrieval system. When a user query could match both documentation and personal notes with similar scores, the system now shows two disambiguation pills ("Docs: ..." vs "Notes: ...") instead of guessing.

**Key achievements:**
- Explicit notes intent routing ("search my notes for...") → routes directly to notes
- Explicit docs intent routing ("in the docs, what is...") → routes directly to docs
- Ambiguous queries ("what is workspace") → shows pills when both corpora have viable results
- Handler chain ordering fixed to prioritize cross-corpus before metaExplain

---

## Problem Statement

Before this implementation:
1. All queries went through docs retrieval only
2. No way to access notes through chat
3. Ambiguous queries (e.g., "what is workspace" when user has a note titled "Workspace") would always show docs, never offering the notes option

**Requirements from plan:**
- Show cross-corpus pills when score gap < MIN_GAP (2 points)
- Detect corpus intent from query patterns
- Route explicit notes intent directly to notes corpus
- Route explicit docs intent directly to docs corpus
- Track `lastRetrievalCorpus` for follow-up continuity

---

## Implementation

### Files Created

| File | Purpose |
|------|---------|
| `lib/chat/cross-corpus-retrieval.ts` | Decision logic, parallel corpus fetching, score comparison |
| `lib/chat/cross-corpus-handler.ts` | Main handler for cross-corpus routing + pill selection |

### Files Modified

| File | Changes |
|------|---------|
| `lib/chat/query-patterns.ts` | Added `NOTES_CORPUS_PATTERNS`, `DOCS_CORPUS_PATTERNS`, `detectCorpusIntent()`, `hasNotesCorpusIntent()`, `hasDocsCorpusIntent()` |
| `lib/chat/routing-telemetry.ts` | Added `CROSS_CORPUS_AMBIGUOUS`, `CROSS_CORPUS_NOTES_EXPLICIT`, `CROSS_CORPUS_DOCS_EXPLICIT` pattern IDs |
| `lib/chat/chat-navigation-context.tsx` | Extended `DocRetrievalState` with `lastRetrievalCorpus`, `lastItemId`, `lastResourceId` |
| `lib/chat/index.ts` | Exported `CrossCorpusSelectData` type |
| `components/chat/chat-navigation-panel.tsx` | Integrated cross-corpus handler, wired pill selection, fixed handler order |

---

## Architecture

### Handler Chain (New Order)

```
User Input
    ↓
1. clarificationIntercept (pending options / pill selection)
    ↓
2. crossCorpus ← NEW (checks notes intent, ambiguity)
    ↓
3. metaExplain (handles "what is X" as explain request)
    ↓
4. correction (handles "no / not that")
    ↓
5. followUp (handles "tell me more")
    ↓
6. docRetrieval (default docs corpus)
```

**Critical fix:** Cross-corpus must run BEFORE metaExplain. Otherwise, metaExplain intercepts all "what is X" queries before cross-corpus can check notes.

### Decision Flow

```
detectCorpusIntent(query, knownTerms)
    ↓
    ├── Explicit notes intent + No docs intent
    │   → Query notes only, return result
    │
    ├── Explicit docs intent + No notes intent
    │   → Early exit, fall through to docs retrieval
    │
    └── Both intents OR Term-only OR None
        → Query both corpora in parallel
            ↓
            ├── Both viable + score gap < MIN_GAP
            │   → Show pills (Docs vs Notes)
            │
            ├── Both viable + docs wins
            │   → Fall through to docs
            │
            ├── Both viable + notes wins
            │   → Show notes result
            │
            ├── Only docs viable
            │   → Fall through to docs
            │
            └── Only notes viable
                → Show notes result
```

### Corpus Intent Detection

**Notes Corpus Patterns:**
- "my notes", "in my notes", "search notes", "find in notes"
- "note titled", "in my files", "search files"

**Docs Corpus Patterns:**
- "in the docs", "in documentation", "help docs"

**Key distinction:**
- Explicit intent = matched a corpus pattern phrase
- Term-based intent = query contains a known doc term (e.g., "workspace")
- Only explicit docs intent skips notes query; term-based triggers both-corpus check

---

## Key Code Snippets

### Cross-Corpus Handler Entry Point

```typescript
// lib/chat/cross-corpus-handler.ts

export async function handleCrossCorpusRetrieval(
  ctx: CrossCorpusHandlerContext
): Promise<CrossCorpusHandlerResult> {
  const { trimmedInput } = ctx

  const knownTerms = getKnownTermsSync()
  const intent = detectCorpusIntent(trimmedInput, knownTerms)

  const hasExplicitDocsIntent = hasDocsCorpusIntent(trimmedInput)
  const hasExplicitNotesIntent = hasNotesCorpusIntent(trimmedInput)

  // Quick exit: Only when explicit docs intent WITHOUT any notes intent
  if (hasExplicitDocsIntent && !hasExplicitNotesIntent && intent === 'docs') {
    return { handled: false }
  }

  // Explicit notes intent takes precedence
  if (hasExplicitNotesIntent && !hasExplicitDocsIntent) {
    // Query notes corpus directly...
  }

  // Query both when: both intents OR term-only docs OR no intent
  const shouldQueryBoth =
    intent === 'both' ||
    intent === 'none' ||
    (intent === 'docs' && !hasExplicitDocsIntent)

  if (shouldQueryBoth) {
    const decision = await queryCrossCorpus(trimmedInput, knownTerms, {
      isExplicitDocsIntent: hasExplicitDocsIntent,
    })

    if (decision.showPills) {
      // Show Docs vs Notes pills...
    }
  }

  return { handled: false }
}
```

### Score Gap Decision Logic

```typescript
// lib/chat/cross-corpus-retrieval.ts

const MIN_GAP = 2

export function decideCrossCorpus(
  query: string,
  docsResult: CorpusResult | null,
  notesResult: CorpusResult | null,
  knownTerms?: Set<string> | null,
  options?: { isExplicitDocsIntent?: boolean }
): CrossCorpusDecision {
  const docsViable = docsResult && docsResult.status !== 'no_match'
  const notesViable = notesResult && notesResult.status !== 'no_match'

  // Both viable with close scores → show pills
  if (docsViable && notesViable) {
    const scoreGap = Math.abs(docsResult!.topScore - notesResult!.topScore)
    if (scoreGap < MIN_GAP) {
      return {
        showPills: true,
        docsResult,
        notesResult,
        scoreGap,
        intent,
        reason: 'both_viable_close_scores',
      }
    }
    // Scores not close → use higher scoring one
    const winner = docsResult!.topScore >= notesResult!.topScore ? 'docs' : 'notes'
    return { showPills: false, singleCorpus: winner, ... }
  }

  // ...
}
```

### Chat Panel Integration

```typescript
// components/chat/chat-navigation-panel.tsx

// After clarificationIntercept, BEFORE metaExplain
const crossCorpusResult = await handleCrossCorpusRetrieval({
  trimmedInput,
  docRetrievalState,
  addMessage,
  updateDocRetrievalState,
  setIsLoading,
  setPendingOptions,
  setPendingOptionsMessageId,
})
if (crossCorpusResult.handled) {
  return
}

// Then metaExplain...
```

---

## Debugging Journey

### Issue 1: Explicit Notes Intent Showing Pills

**Symptom:** "search my notes for workspace" showed pills instead of notes only

**Root Cause:** Condition checked `intent === 'notes'` but intent was 'both' when query had notes phrase + doc term

**Fix:** Changed to:
```typescript
if (hasExplicitNotesIntent && !hasExplicitDocsIntent) {
  // Query notes only
}
```

### Issue 2: "what is workspace" Going to Docs Directly

**Symptom:** Query never hit cross-corpus handler, went straight to docs

**Root Cause 1:** `DOCS_CORPUS_PATTERNS` included `/\bwhat is (a|an|the)?\s*(widget|panel|dashboard|workspace|navigator)\b/i`

**Fix 1:** Removed "what is X" patterns from `DOCS_CORPUS_PATTERNS`

**Root Cause 2:** `handleMetaExplain` was intercepting "what is X" before cross-corpus could run. The `isMetaExplainOutsideClarification` pattern matched all "what is X" queries.

**Fix 2:** Moved cross-corpus handler to run BEFORE metaExplain in the handler chain.

---

## Verification Results

### Acceptance Tests

| Test | Query | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| 1 | "search my notes for workspace" | Notes result, no pills | Notes result, no pills | PASS |
| 2 | "what is workspace" (with note titled "Workspace") | Pills (Docs vs Notes) | Pills shown | PASS |
| 3 | "in the docs, what is workspace" | Docs result only | Docs result only | PASS |

### Console Log Verification

```
[CrossCorpus] >>> HANDLER ENTERED for: what is workspace
[CrossCorpus] Intent: docs | ExplicitDocs: false | ExplicitNotes: false
[CrossCorpus] shouldQueryBoth: true
[CrossCorpus] Querying both corpora...
[CrossCorpus] Decision: { showPills: true, scoreGap: 1.2, ... }
[ChatPanel] INTERCEPTED by crossCorpus
```

---

## Telemetry Events

New telemetry fields added to routing events:

| Field | Type | Description |
|-------|------|-------------|
| `cross_corpus_ambiguity_shown` | boolean | Whether pills were displayed |
| `cross_corpus_choice` | 'docs' \| 'notes' | User's pill selection |
| `cross_corpus_score_gap` | number | Score difference between corpora |
| `cross_corpus_intent` | CorpusIntent | Detected intent (docs/notes/both/none) |
| `cross_corpus_explicit_docs` | boolean | Whether docs intent was from explicit phrase |
| `cross_corpus_explicit_notes` | boolean | Whether notes intent was from explicit phrase |
| `cross_corpus_docs_status` | string | Docs retrieval status |
| `cross_corpus_notes_status` | string | Notes retrieval status |

---

## State Management

### DocRetrievalState Extensions

```typescript
interface DocRetrievalState {
  // Existing fields...

  // New for cross-corpus
  lastRetrievalCorpus?: 'docs' | 'notes'
  lastItemId?: string      // For notes
  lastResourceId?: string  // Unified ID (docSlug or itemId)
}
```

This enables follow-up queries ("tell me more") to stay within the same corpus.

---

## Cleanup Performed

- Removed all debug `console.log` statements from:
  - `lib/chat/cross-corpus-handler.ts` (9 statements)
  - `components/chat/chat-navigation-panel.tsx` (8 statements)
- Type-check passed with no errors

---

## Future Improvements (Optional)

1. **Unit tests:** Add tests for `decideCrossCorpus` decision logic
2. **Follow-up continuity:** Verify "tell me more" works correctly after notes selection
3. **Notes-explicit path:** Further verify notes-only routing for various phrases
4. **Prereq 5:** Implement safety fallback when items index is unavailable

---

## Files Changed Summary

```
lib/chat/cross-corpus-retrieval.ts     (NEW)  — Decision logic
lib/chat/cross-corpus-handler.ts       (NEW)  — Main handler
lib/chat/query-patterns.ts             (MOD)  — Corpus patterns
lib/chat/routing-telemetry.ts          (MOD)  — Telemetry events
lib/chat/chat-navigation-context.tsx   (MOD)  — State types
lib/chat/index.ts                      (MOD)  — Type exports
components/chat/chat-navigation-panel.tsx (MOD) — Handler integration
```

---

## Commands to Verify

```bash
# Type-check
npm run type-check

# Run dev server and test
npm run dev
# Then in chat panel:
# - "what is workspace" → should show pills
# - "search my notes for X" → should show notes only
# - "in the docs, what is X" → should show docs only
```
