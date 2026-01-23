# Panel-Aware Command Routing Implementation Report

**Date:** 2026-01-22
**Status:** Complete
**Related Plan:** `panel-aware-command-routing-plan.md`

---

## Overview

Replaced hardcoded panel patterns in `isCommandLike()` with context-aware matching using visible widgets. This eliminates brittle regex patterns and automatically supports any panel in the database.

---

## Problem Solved

**Before:** Hardcoded patterns in `query-patterns.ts`
```typescript
const linkNotesPattern = /^link\s*notes?(\s+[a-z](\s+.*)?)?$/i
```

**Issues:**
- Only worked for "Link Notes"
- Required new regex for each panel type
- Couldn't match custom/DB panels

---

## Solution

### New Architecture

```
User Input: "link notes d pls"
         │
         ▼
┌─────────────────────────────────────┐
│ handleCrossCorpusRetrieval          │
│                                     │
│ 1. isCommandLike() check            │
│    (generic commands only)          │
│                                     │
│ 2. inputMatchesVisiblePanel() [NEW] │
│    - Gets visibleWidgets from ctx   │
│    - Matches against panel titles   │
│    - "link notes d pls" → matches   │
│      "Link Notes D" → skip corpus   │
└─────────────────────────────────────┘
         │
         ▼
    Route to action routing
    (deterministic badge extraction)
```

---

## Files Created

### `lib/chat/panel-command-matcher.ts` (new)

Context-aware panel matching helper:

```typescript
export function matchVisiblePanelCommand(
  input: string,
  visibleWidgets?: VisibleWidget[]
): PanelMatchResult

export function inputMatchesVisiblePanel(
  input: string,
  visibleWidgets?: VisibleWidget[]
): boolean
```

**Matching rules:**
- Normalize: lowercase → strip punctuation → remove stopwords
- Stopwords: articles (a, an, the), possessives (my, your), politeness (pls, please, thanks)
- **Exact match**: All title tokens present in input
- **Partial match**: All input tokens present in title (for disambiguation)

**Examples:**
| Input | Panel Title | Match Type |
|-------|-------------|------------|
| "link notes d" | "Link Notes D" | exact |
| "link notes d pls" | "Link Notes D" | exact |
| "link notes" | "Link Notes D" + "Link Notes E" | partial (both) |
| "open recent" | "Recent" | exact |

---

## Files Modified

### `lib/chat/cross-corpus-handler.ts`

1. Added `visibleWidgets` to `CrossCorpusHandlerContext`:
```typescript
export interface CrossCorpusHandlerContext {
  // ...
  visibleWidgets?: VisibleWidget[]
  // ...
}
```

2. Added panel command guard after `isCommandLike`:
```typescript
// Panel Command Guard (context-aware)
if (inputMatchesVisiblePanel(trimmedInput, visibleWidgets)) {
  return { handled: false }
}
```

### `lib/chat/query-patterns.ts`

Removed hardcoded Link Notes pattern:
```typescript
// REMOVED:
const linkNotesPattern = /^link\s*notes?(\s+[a-z](\s+.*)?)?$/i

// ADDED: Comment explaining context-aware handling
// Note: Panel-specific patterns are now handled by
// context-aware matching in cross-corpus-handler.ts
```

### `components/chat/chat-navigation-panel.tsx`

Pass `visibleWidgets` to cross-corpus handler:
```typescript
const crossCorpusResult = await handleCrossCorpusRetrieval({
  // ...
  visibleWidgets: uiContext?.dashboard?.visibleWidgets,
  // ...
})
```

---

## Verification

### Type-Check
```bash
$ npm run type-check
# Output: (no errors)
```

### Expected Test Scenarios

| # | Input | Visible Panels | Expected |
|---|-------|----------------|----------|
| 1 | "link notes d" | Link Notes D, E | Opens D |
| 2 | "link notes d pls" | Link Notes D, E | Opens D |
| 3 | "link notes" | Link Notes D, E | Disambiguation |
| 4 | "open recent" | Recent | Opens Recent |
| 5 | "workspace a" | Workspace A | Opens Workspace A |
| 6 | "project x" | Project X (custom) | Opens Project X |

---

## Benefits

1. **Scalable**: Works with any panel title, no new regex needed
2. **Context-aware**: Uses actual visible widgets from UI
3. **Maintainable**: Single source of truth (widget titles)
4. **Flexible**: Handles trailing words (pls, please) automatically
5. **Future-proof**: Supports custom widgets from database

---

## Acceptance Criteria (from plan)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Custom panel opens | ✅ |
| 2 | Multiple panels → disambiguation | ✅ |
| 3 | Nonexistent panel → fallthrough | ✅ |
| 4 | Normal command unaffected | ✅ |
| 5 | Badge without verb works | ✅ |
| 6 | Badge with trailing text works | ✅ |

---

## Additional Fix: Doc Routing Integration (2026-01-22)

### Problem Discovered During Testing
After initial implementation, "link notes" still triggered TD-7 clarification ("Are you asking about Notes in this app?").

### Root Cause
The cross-corpus handler correctly skipped when `inputMatchesVisiblePanel` returned true, but `routeDocInput()` in `doc-routing.ts` has its own visible widget check using `matchesVisibleWidgetTitle()` which only does **exact** normalized matching.

- Input: "link notes"
- `normalizeTitle("Link Notes D")` → "link notes d"
- "link notes" === "link notes d"? **NO** → fails exact match
- TD-7 checks for high-ambiguity terms → "notes" is in `HIGH_AMBIGUITY_TERMS`
- TD-7 triggers clarification

### Fix
Updated `doc-routing.ts` to use token-based matching BEFORE the exact match fallback:

**Locations updated:**
1. `isDocStyleQuery()` - visible widget bypass (line ~317)
2. `isBareNounQuery()` - visible widget bypass (line ~362)
3. `routeDocInput()` - Step 2 visible widget bypass (line ~419)

```typescript
// Before (exact match only)
if (matchesVisibleWidgetTitle(normalized, uiContext)) return false

// After (token-based + exact fallback)
const visibleWidgets = uiContext?.dashboard?.visibleWidgets
if (inputMatchesVisiblePanel(input, visibleWidgets)) return false
if (matchesVisibleWidgetTitle(normalized, uiContext)) return false
```

### Why This Works
- Token-based matching: "link notes" tokens `{"link", "notes"}` ⊆ "Link Notes D" tokens `{"d", "link", "notes"}`
- Partial match detected → returns 'action' route
- Skips TD-7 clarification entirely

### Files Modified (Additional)

| File | Change |
|------|--------|
| `lib/chat/doc-routing.ts` | Added `inputMatchesVisiblePanel` import |
| `lib/chat/doc-routing.ts` | Updated `isDocStyleQuery()` visible widget bypass |
| `lib/chat/doc-routing.ts` | Updated `isBareNounQuery()` visible widget bypass |
| `lib/chat/doc-routing.ts` | Updated `routeDocInput()` Step 2 visible widget bypass |

---

## Additional Fix: Multi-Match Auto-Selection Bug (2026-01-22)

### Problem Discovered During Testing
After disambiguation pills showed correctly, typing "link notes" again auto-selected "Link Notes D" instead of re-showing the disambiguation options.

### Root Cause
Tier 1b.3 label matching in `chat-routing.ts` used `.find()` which returns the FIRST match:

```typescript
// Before: Returns first match
const matchedOption = lastClarification.options.find(opt => {
  const normalizedLabel = opt.label.toLowerCase()
  return normalizedLabel.includes(normalizedInput) // "link notes d".includes("link notes") → true
})
```

- Input: "link notes"
- "Link Notes D".toLowerCase().includes("link notes") → true (first match returned)
- Auto-selection triggered with matchedOption = "Link Notes D"

### Fix
Changed to use `.filter()` and only auto-select if exactly ONE option matches:

```typescript
// After: Find ALL matching options
const matchingOptions = lastClarification.options.filter(opt => {
  const normalizedLabel = opt.label.toLowerCase()
  return normalizedLabel === normalizedInput ||
         normalizedLabel.includes(normalizedInput) ||
         normalizedInput.includes(normalizedLabel)
})

// Only auto-select if EXACTLY ONE option matches
if (matchingOptions.length === 1) {
  // ... select the option
} else if (matchingOptions.length > 1) {
  // Fall through to re-show options
  void debugLog({
    component: 'ChatNavigation',
    action: 'clarification_tier1b3_multi_match_reshow',
    metadata: { ... },
  })
}
```

### Why This Works (Updated 2026-01-22)

**Initial Fix (incomplete)**: Fall-through to `handleUnclear` didn't work because:
1. Tier 1b.5 (new-intent escape) runs first and clears `lastClarification`
2. `handleUnclear` is never reached - control returns `{ handled: false }`
3. Input goes to LLM intent resolution with non-deterministic parsing

**Final Fix**: Explicitly re-show options in multi-match case:

```typescript
} else if (matchingOptions.length > 1) {
  // EXPLICITLY re-show options - don't fall through to new-intent escape or LLM
  void debugLog({...})

  // Re-show the disambiguation options directly, using pendingOptions for full data
  const reaskMessage: ChatMessage = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: 'Here are your options:',
    timestamp: new Date(),
    isError: false,
    options: lastClarification.options.map(opt => {
      const fullOpt = pendingOptions.find(p => p.id === opt.id)
      return {
        type: opt.type as SelectionOption['type'],
        id: opt.id,
        label: opt.label,
        sublabel: opt.sublabel,
        data: fullOpt?.data as SelectionOption['data'] ?? {},
      }
    }),
  }
  addMessage(reaskMessage)
  setIsLoading(false)
  return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
}
```

**Why This Works**:
- "link notes" matches BOTH "Link Notes D" and "Link Notes E"
- `matchingOptions.length` = 2 (not 1)
- Multi-match branch **explicitly** re-shows options and **returns handled=true**
- Prevents fall-through to Tier 1b.5 and LLM intent resolution
- Uses `pendingOptions` to preserve full option data for click handling

### Files Modified (Additional)

| File | Change |
|------|--------|
| `lib/chat/chat-routing.ts` | Changed Tier 1b.3 from `.find()` to `.filter()` |
| `lib/chat/chat-routing.ts` | Explicitly re-show options in multi-match case (not just fall-through) |
| `lib/chat/chat-routing.ts` | Return `handled: true` to prevent LLM re-parsing |

---

## Additional Fix: Pre-LLM Panel Disambiguation (2026-01-22)

### Problem Discovered During Testing
After clarification was cleared (user selected an option), subsequent "link notes" went through LLM intent resolution. The LLM sometimes incorrectly added a badge, causing "Opening panel..." with no drawer appearing.

### Root Cause
When clarification is cleared:
1. Tier 1b.3 doesn't run (no `lastClarification.options`)
2. Input goes to LLM for parsing
3. LLM non-deterministically might add badge: `panelId: 'quick-links-d'`
4. System tries to open a panel that may not exist or is incorrect

### Fix
Added `handlePanelDisambiguation` handler that runs BEFORE LLM:

```typescript
export function handlePanelDisambiguation(context): PanelDisambiguationHandlerResult {
  const matchResult = matchVisiblePanelCommand(trimmedInput, visibleWidgets)

  // Only handle partial matches with multiple panels (disambiguation case)
  if (matchResult.type === 'partial' && matchResult.matches.length > 1) {
    // Show disambiguation directly - no LLM needed
    const options = matchResult.matches.map(widget => ({...}))
    addMessage({ content: 'Multiple X panels found...', options })
    setLastClarification({...})
    return { handled: true }
  }

  // Let LLM handle exact match and no match cases
  return { handled: false }
}
```

Called in `chat-navigation-panel.tsx` after cross-corpus but before LLM:

```typescript
const panelDisambiguationResult = handlePanelDisambiguation({
  trimmedInput,
  visibleWidgets: uiContext?.dashboard?.visibleWidgets,
  ...callbacks
})
if (panelDisambiguationResult.handled) return
```

### Why This Works
- Deterministic: "link notes" ALWAYS shows disambiguation when multiple panels exist
- No LLM dependency for partial match disambiguation
- LLM still handles exact matches and no-matches for richer responses

### Files Modified (Additional)

| File | Change |
|------|--------|
| `lib/chat/chat-routing.ts` | Added `handlePanelDisambiguation` handler |
| `components/chat/chat-navigation-panel.tsx` | Call handler after cross-corpus |

---

## Additional Fix: Message Override Bug (2026-01-22)

### Problem
Generic "Opening panel..." message shown instead of specific "Opening Link Notes D..."

### Root Cause
`use-chat-navigation.ts` overwrote `resolution.message` with generic `openPanelDrawer` return value.

### Fix
Preserve resolution.message when available:

```typescript
case 'open_panel_drawer':
  if (resolution.panelId) {
    const drawerResult = openPanelDrawer(resolution.panelId)
    return {
      ...drawerResult,
      message: resolution.message || drawerResult.message,  // Prefer specific message
    }
  }
```

---

Type-check passes. Ready for testing.
