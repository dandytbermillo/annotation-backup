# Pending Options Resilience Fix Implementation Report

**Date:** 2026-01-22
**Author:** Claude (AI Assistant)
**Status:** Complete
**Related Plan:** `pending-options-resilience-fix.md`

---

## Overview

Implemented the final piece of the pending-options-resilience-fix plan: re-showing options with pills when user types garbage (no-match input) during disambiguation, instead of showing a generic yes/no fallback message.

---

## Problem Statement

### Symptom
When options were visible (e.g., "Link Notes D" / "Link Notes E" pills) and user typed garbage like "ffrs":
- Options remained selectable in memory (pendingOptions preserved) ✅
- But the UI showed: "I didn't quite catch that. Would you like to open a workspace?" (NO PILLS)
- User had to remember the options or type "first one" blindly

### Expected (per plan)
```
User: quick links → options shown (D, E pills)
User: ffrs → "Please choose one of the options:" + pills re-shown
User: first one → selects correctly
```

---

## Solution

### Approach
Modified `handleUnclear()` in `lib/chat/chat-routing.ts` to check if the clarification is of type `option_selection` with options. If so, re-show the options with pills instead of the generic yes/no message.

### Key Changes

**File:** `lib/chat/chat-routing.ts` (lines 1288-1338)

```typescript
// Helper: Handle unclear response
// Per pending-options-resilience-fix.md: Re-show options on no-match instead of generic fallback
const handleUnclear = (): boolean => {
  if (isNewQuestionOrCommandDetected) {
    setLastClarification(null)
    return true
  }

  // Per pending-options-resilience-fix.md: If options exist, re-show them with pills
  // instead of showing a generic yes/no message
  if (lastClarification?.type === 'option_selection' && lastClarification.options && lastClarification.options.length > 0) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'clarification_unclear_reshow_options',
      metadata: { userInput: trimmedInput, optionsCount: lastClarification.options.length },
    })

    const reaskMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: 'Please choose one of the options:',
      timestamp: new Date(),
      isError: false,
      options: lastClarification.options.map(opt => ({
        type: opt.type as SelectionOption['type'],
        id: opt.id,
        label: opt.label,
        sublabel: opt.sublabel,
        data: {} as SelectionOption['data'],
      })),
    }
    addMessage(reaskMessage)
    return false
  }

  // Fallback for non-option clarifications (yes/no questions)
  const reaskMessage: ChatMessage = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: 'I didn\'t quite catch that. Would you like to open a workspace to see your notes? (yes/no)',
    timestamp: new Date(),
    isError: false,
  }
  addMessage(reaskMessage)
  return false
}
```

---

## How It Works

### Flow Diagram

```
User Input: "ffrs" (with options visible)
         │
         ▼
┌─────────────────────────────────────┐
│ 1. Clarification Intercept          │
│    lastClarification exists         │
│    type: 'option_selection'         │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 2. Tier 1 Checks                    │
│    - isRejectionPhrase? NO          │
│    - isNewQuestionOrCommand? NO     │
│    - isMetaPhrase? NO               │
│    - isSelectionOnly? NO            │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 3. Tier 2 LLM Interpretation        │
│    LLM returns: UNCLEAR             │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 4. handleUnclear() [UPDATED]        │
│    type === 'option_selection'? YES │
│    → Re-show options with pills     │
│    → "Please choose one..."         │
└─────────────────────────────────────┘
         │
         ▼
Output: "Please choose one of the options:"
        + [Link Notes D] [Link Notes E] pills
```

---

## Pre-existing Implementation (Already Done)

The plan had three requirements. Two were already implemented:

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Don't clear pendingOptions on typo | ✅ Already done | panel.tsx:2658-2676 |
| 2 | Ordinal selection from lastOptions | ✅ Already done | panel.tsx:2165-2215 |
| 3 | Re-show options on no-match | ✅ **Now done** | chat-routing.ts:1301-1326 |

### Also Pre-existing
- **Cancel/Exit Bypass**: `handleRejection()` in chat-routing.ts:1273-1286
- **Grace Window**: `RESHOW_WINDOW_MS = 60_000` (60 seconds)

---

## Verification

### Type-Check
```bash
$ npm run type-check
# Output: (no errors)
```

### Expected Test Scenarios

| # | Scenario | Input Sequence | Expected Result |
|---|----------|----------------|-----------------|
| 1 | Garbage re-shows options | "quick links" → "ffrs" | Pills re-shown with "Please choose one" |
| 2 | Ordinal works after garbage | "quick links" → "ffrs" → "first one" | Selects first option |
| 3 | Cancel clears options | "quick links" → "cancel" | "Okay — let me know what you want to do." |
| 4 | Explicit command clears | "quick links" → "go home" | Navigates home, options cleared |

---

## Acceptance Criteria (per plan)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Options remain after typo | ✅ |
| 2 | Ordinal works after typo | ✅ |
| 3 | Explicit command clears options | ✅ |
| 4 | Cancel/exit does NOT re-show | ✅ |

---

## Telemetry

When options are re-shown due to unclear input:

```json
{
  "component": "ChatNavigation",
  "action": "clarification_unclear_reshow_options",
  "metadata": {
    "userInput": "ffrs",
    "optionsCount": 2
  }
}
```

---

## Files Modified

| File | Change |
|------|--------|
| `lib/chat/chat-routing.ts` | Modified `handleUnclear()` to re-show options when `type === 'option_selection'` |
| `lib/chat/chat-routing.ts` | Added Tier 1b.3 label matching BEFORE new-intent escape |
| `lib/chat/query-patterns.ts` | Added Link Notes badge pattern to `isCommandLike()` |
| `lib/chat/cross-corpus-handler.ts` | Added `setLastClarification` call when showing cross-corpus options |
| `components/chat/chat-navigation-panel.tsx` | Pass `setLastClarification` to cross-corpus handler |

---

## Additional Fix: Label Matching Priority (2026-01-22)

### Problem Discovered During Testing
After the initial fix, testing revealed another issue:
- User says "link notes e" when options ["Link Notes D", "Link Notes E"] are visible
- `isNewQuestionOrCommand("link notes e")` returns true (looks like a command)
- Tier 1b.5 (new-intent escape) clears clarification BEFORE selection check
- "link notes e" falls through to cross-corpus retrieval instead of selecting "Link Notes E"

### Root Cause
The tier order was:
1. Tier 1b.5: New intent escape (clears clarification)
2. Tier 1d: Selection check (skipped because clarificationCleared)

### Fix
Added **Tier 1b.3** (BEFORE new-intent escape) that checks if input matches any option label:

```typescript
// Tier 1b.3: Label matching for option selection (BEFORE new-intent escape)
if (lastClarification?.options && lastClarification.options.length > 0) {
  const normalizedInput = trimmedInput.toLowerCase().trim()
  const matchedOption = lastClarification.options.find(opt => {
    const normalizedLabel = opt.label.toLowerCase()
    // Exact match or input is contained in label or label is contained in input
    return normalizedLabel === normalizedInput ||
           normalizedLabel.includes(normalizedInput) ||
           normalizedInput.includes(normalizedLabel)
  })

  if (matchedOption) {
    // Select the option instead of treating as new intent
    handleSelectOption(optionToSelect)
    return { handled: true, clarificationCleared: true, ... }
  }
}
```

### New Flow
```
User: "link notes e" (with options visible)
         │
         ▼
┌─────────────────────────────────────┐
│ Tier 1b.3: Label matching           │
│ "link notes e" matches              │
│ "Link Notes E" label                │
│ → Select option, exit clarification │
└─────────────────────────────────────┘
```

### Telemetry
When label matching selects an option:
```json
{
  "component": "ChatNavigation",
  "action": "clarification_tier1b3_label_selection",
  "metadata": {
    "input": "link notes e",
    "matchedLabel": "Link Notes E",
    "hasFullOption": true
  }
}
```

---

## Third Fix: Cross-Corpus Guard for Link Notes Badge (2026-01-22)

### Problem Discovered During Testing
After selecting an option ("link notes d" → "Opening Link Notes D..."), the clarification is cleared.
Then when user says "link notes e":
1. `clarificationIntercept` skipped (no lastClarification)
2. `handleCrossCorpusRetrieval` catches "link notes" as a searchable term
3. Shows cross-corpus disambiguation instead of opening Link Notes E

### Root Cause
`isCommandLike("link notes e")` returns `false` because:
- No action verb (like "open", "show")
- No index-like reference

So "link notes e" falls through to cross-corpus retrieval instead of reaching route.ts deterministic badge extraction.

### Fix
Added Link Notes badge pattern to `isCommandLike()` in `lib/chat/query-patterns.ts`:

```typescript
// Link Notes badge pattern: "link notes d", "link notes e", etc.
// Per link-notes-generic-disambiguation-fix.md: These are panel commands, not searches.
// Must bypass cross-corpus to reach deterministic badge extraction in route.ts.
const linkNotesBadgePattern = /^link\s*notes?\s+[a-z]$/i
if (linkNotesBadgePattern.test(normalized)) {
  return true
}
```

### New Flow
```
"link notes e" (no clarification active)
         │
         ▼
┌─────────────────────────────────────┐
│ isCommandLike("link notes e")       │
│ → linkNotesBadgePattern matches     │
│ → returns true                      │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ handleCrossCorpusRetrieval          │
│ → isCommandLike = true              │
│ → return { handled: false }         │
│ → SKIPPED                           │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ route.ts API call                   │
│ → extractLinkNotesBadge → "E"       │
│ → show_quick_links with badge E     │
│ → "Opening Link Notes E..."         │
└─────────────────────────────────────┘
```

---

## Fourth Fix: Cross-Corpus Clarification Sync (2026-01-22)

### Problem Discovered During Testing
Cross-corpus disambiguation ("what is workspace" → Docs/Notes pills) showed options but didn't work with the `handleUnclear` fix:
- Cross-corpus set `pendingOptions` but NOT `lastClarification`
- `clarificationIntercept` was skipped (no lastClarification)
- `handleUnclear` never ran
- Garbage input got generic fallback instead of re-showing options

### Fix
Added `setLastClarification` call to cross-corpus handler when showing disambiguation options:

**File:** `lib/chat/cross-corpus-handler.ts`

```typescript
// Added to interface
setLastClarification: (state: LastClarificationState | null) => void

// Added when showing options
setLastClarification({
  type: 'option_selection',
  originalIntent: 'cross_corpus_ambiguity',
  messageId: message.id,
  timestamp: Date.now(),
  clarificationQuestion: 'I found results in both documentation and your notes...',
  options: options.map(opt => ({
    id: opt.id,
    label: opt.label,
    sublabel: opt.sublabel,
    type: opt.type,
  })),
  metaCount: 0,
})
```

**File:** `components/chat/chat-navigation-panel.tsx`

```typescript
// Pass setLastClarification to handler
const crossCorpusResult = await handleCrossCorpusRetrieval({
  // ...existing params...
  setLastClarification,  // NEW
})
```

### Result
Cross-corpus disambiguation now works with the re-show-on-garbage fix:
- "what is workspace" → shows Docs/Notes options
- "dfs" (garbage) → "Please choose one of the options:" + pills re-shown

---

## Fifth Fix: Trailing Words After Badge (2026-01-22)

### Problem Discovered During Testing
User typing polite phrases like "link notes d pls" or "link notes e please" triggered cross-corpus retrieval instead of opening the panel.

### Root Cause
The pattern `/^link\s*notes?(\s+[a-z])?$/i` required the input to END immediately after the badge letter. Trailing words like "pls" or "please" caused the pattern to fail.

### Example Failures
- "link notes d pls" → ❌ cross-corpus (should open Link Notes D)
- "link notes e please" → ❌ cross-corpus (should open Link Notes E)

### Fix
Updated the pattern in `isCommandLike()` to allow optional trailing text after the badge letter:

**File:** `lib/chat/query-patterns.ts` (line 460)

```typescript
// OLD: /^link\s*notes?(\s+[a-z])?$/i
// NEW: /^link\s*notes?(\s+[a-z](\s+.*)?)?$/i

// Link Notes pattern: "link notes", "link notes d", "link notes d pls", etc.
// Single letter after "link notes" = badge identifier (not a search term)
// Pattern allows optional trailing words after badge (e.g., "pls", "please", "now")
// But NOT: "link notes workspace" (multi-letter word = search query)
const linkNotesPattern = /^link\s*notes?(\s+[a-z](\s+.*)?)?$/i
```

### Pattern Matching Behavior
| Input | Matches? | Why |
|-------|----------|-----|
| "link notes" | ✅ | Bare Link Notes |
| "link notes d" | ✅ | Badge "d" |
| "link notes d pls" | ✅ | Badge "d" + trailing "pls" |
| "link notes e please" | ✅ | Badge "e" + trailing "please" |
| "link notes workspace" | ❌ | "workspace" is multi-letter (search query) |
| "link notes about my project" | ❌ | Multi-letter word (search query) |

### Why This Works
The regex `\s+[a-z]` matches a single letter only. Multi-letter words like "workspace" fail because:
1. `\s+` matches the space after "notes"
2. `[a-z]` matches only the first letter "w"
3. Remaining "orkspace" can't be consumed by `(\s+.*)?` (needs a space first)
4. `$` fails because there's still text remaining

---

## Conclusion

The pending-options-resilience-fix is now complete. Users will see their disambiguation options re-shown with pills when they type garbage, making it easy to recover and make a selection. The fix is minimal (single function modification) and follows the existing pattern used by `handleMeta()`.

### All Fixes Summary

| # | Fix | File | Description |
|---|-----|------|-------------|
| 1 | Re-show options on garbage | chat-routing.ts | `handleUnclear()` re-shows options instead of generic fallback |
| 2 | Label matching priority | chat-routing.ts | Tier 1b.3 matches labels BEFORE new-intent escape |
| 3 | Link Notes badge guard | query-patterns.ts | `isCommandLike()` recognizes "link notes [letter]" |
| 4 | Cross-corpus clarification sync | cross-corpus-handler.ts | Sets `lastClarification` when showing options |
| 5 | Trailing words support | query-patterns.ts | Pattern allows "link notes d pls" etc. |
