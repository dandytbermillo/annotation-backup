# General Doc Retrieval Routing Implementation Report

**Date:** 2026-01-11
**Plan:** `general-doc-retrieval-routing-plan.md`
**Status:** IMPLEMENTED

---

## Summary

Implemented doc-style query routing so questions like "what is X", "how do I X", "tell me about X" are answered from documentation retrieval instead of falling through to LLM.

---

## Changes Made

### 1. Type Extension
**File:** `lib/chat/chat-navigation-context.tsx` (line 80)
- Added `'doc_disambiguation'` to `LastClarificationState.type` union

### 2. Detection Helpers
**File:** `components/chat/chat-navigation-panel.tsx` (lines 401-460)

**`isDocStyleQuery(input)`** - Detects doc-style queries:
- Matches: `what is/are`, `how do I/to/can I`, `tell me about`, `explain`, `what does`, `where can I`, `how can I`
- Also matches: help/guide/instructions/documentation keywords
- Excludes: queries with action verbs (open/list/show/go/create/rename/delete)
- Excludes: bare meta-explain phrases (handled elsewhere)

**`extractDocQueryTerm(input)`** - Extracts search term:
- Strips doc-style prefixes and articles
- E.g., "how do I add a widget" → "add widget"

### 3. Routing Branch
**File:** `components/chat/chat-navigation-panel.tsx` (lines 2259-2386)
- Positioned after meta-explain outside clarification, before question-first bypass
- Handles all response statuses:
  - `found` → Shows doc answer directly
  - `weak` → Shows confirmation message
  - `ambiguous` → Shows option pills with doc_disambiguation state
  - `no_match` → Asks "Which part would you like me to explain?"

### 4. Disambiguation Selection (Follow-up Fix)
**Files:**
- `lib/chat/use-chat-navigation.ts` (lines 656-772)
  - Added `'doc'` to `selectOption` type union
  - Added handler for `type === 'doc'` that dispatches `chat-select-doc` event
- `lib/docs/keyword-retrieval.ts` (lines 755-825)
  - Added `retrieveByDocSlug(docSlug)` function for direct doc lookup
- `app/api/docs/retrieve/route.ts` (lines 27-35)
  - Added `docSlug` parameter support
- `components/chat/chat-navigation-panel.tsx` (lines 1400-1460)
  - Added `chat-select-doc` event listener that fetches and displays doc content

---

## Acceptance Test Results

| Test | Query | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| 1 | "workspace" | Doc answer | weak: Workspace Actions | PASS |
| 2 | "add widget" | Doc answer | weak: Widget and Panel Actions | PASS |
| 3 | "home" | Doc answer | weak: Home | PASS |
| 4a | "notes" | Ambiguous (2 options) | ambiguous: Navigation vs Notes | PASS |
| 4b | Select "actions/notes" | Doc content via docSlug | found: Note Actions | PASS |
| 5 | "quantum physics" | No match | no_match | PASS |
| 6 | "open workspace 6" | Bypass retrieval | Not routed (action verb detected) | PASS |

---

## Verification

```bash
npm run type-check  # PASS - no errors
```

---

## API Behavior

The routing uses `/api/docs/retrieve` with default mode (smart retrieval):
- Returns `status: weak/ambiguous/no_match/found`
- Returns `results[]` with matched chunks
- Returns `clarification` message for user display

---

## Routing Order (Updated)

1. Selection fast paths (ordinals/labels) with pending options
2. Clarification handling (YES/NO/META) when clarification active
3. Meta-explain outside clarification
4. **General doc retrieval routing (this plan)** ← NEW
5. Question-first bypass to LLM
6. Typo fallback
7. Normal LLM routing
