# Link Notes Deterministic Badge Extraction Fix

**Date:** 2026-01-22
**Author:** Claude (AI Assistant)
**Status:** Complete
**Related Plan:** `link-notes-generic-disambiguation-fix.md`

---

## Overview

Implemented deterministic badge extraction for Link Notes panels to ensure consistent behavior regardless of LLM variance. When a user explicitly specifies a badge (e.g., "open link notes f"), the system now **always** returns the same result.

---

## Problem Statement

### Symptom
The same input "open link notes f" produced inconsistent responses:
- Sometimes: "No Link Notes panel with badge 'F' found." ✅
- Sometimes: "Did you mean **Link Notes D**?" (fuzzy match f→d) ❌
- Sometimes: "Multiple Link Notes panels found..." (disambiguation) ❌
- Sometimes: "Failed to parse LLM response" ❌

### Root Causes

1. **LLM Variance**: The LLM sometimes extracted the badge correctly, sometimes didn't
2. **No Deterministic Fallback**: Badge extraction was entirely dependent on LLM
3. **Typo Suggestions Override**: When LLM returned `unsupported`, typo suggestions fuzzy-matched "f" to "d"
4. **Outdated Regex**: `extractQuickLinksBadge` only matched "quick links", not "link notes"

### Plan Requirement
> "Keep deterministic action routing (no LLM dependence)"
> — link-notes-generic-disambiguation-fix.md

---

## Solution

### Approach
Add deterministic badge extraction as the **primary** method, with LLM extraction as fallback. This ensures consistent behavior regardless of LLM variance.

### Key Changes

1. **Deterministic Badge Extraction**: Extract badge from user input using regex before LLM processing matters
2. **Intent Override**: If explicit badge detected but LLM returned wrong intent, override to `show_quick_links`
3. **Typo Suggestion Guard**: Skip typo suggestions when explicit badge is present (no fuzzy-matching badge letters)
4. **Updated Regex**: Match "link notes" pattern (not just "quick links")

---

## Files Modified

### 1. `lib/chat/ui-helpers.ts`

**Change:** Updated `extractLinkNotesBadge` (renamed from `extractQuickLinksBadge`)

```typescript
// Before
export function extractQuickLinksBadge(title?: string): string | null {
  if (!title) return null
  const match = title.match(/quick\s*links?\s*([a-z])/i)
  return match ? match[1].toLowerCase() : null
}

// After
export function extractLinkNotesBadge(input?: string): string | null {
  if (!input) return null
  // Match "link notes X" or "link note X" where X is a single letter
  const match = input.match(/\blink\s*notes?\s+([a-z])\b/i)
  return match ? match[1].toUpperCase() : null
}

// Backward-compatible alias (deprecated)
export const extractQuickLinksBadge = extractLinkNotesBadge
```

### 2. `app/api/chat/navigate/route.ts`

**Changes:**

#### a. Import added
```typescript
import { extractLinkNotesBadge } from '@/lib/chat/ui-helpers'
```

#### b. Deterministic badge detection (after line ~496)
```typescript
// Deterministic badge detection for Link Notes
// Per link-notes-generic-disambiguation-fix.md: "Keep deterministic action routing (no LLM dependence)"
// If user explicitly says "link notes f", extract badge deterministically
const explicitLinkNotesBadge = extractLinkNotesBadge(userMessage)
```

#### c. Intent override (after badge detection)
```typescript
// Deterministic intent override for explicit Link Notes badge
// If user explicitly said "link notes X" but LLM returned wrong intent, override to show_quick_links
// This ensures consistent behavior regardless of LLM variance
if (explicitLinkNotesBadge && intent.intent !== 'show_quick_links') {
  void debugLog({
    component: 'ChatNavigation',
    action: 'deterministic_link_notes_override',
    metadata: {
      originalIntent: intent.intent,
      explicitBadge: explicitLinkNotesBadge,
      userMessage: userMessage.substring(0, 50),
    },
  })
  intent = {
    intent: 'show_quick_links',
    args: {
      ...intent.args,
      quickLinksPanelBadge: explicitLinkNotesBadge,
    },
  }
}
```

#### d. Typo suggestion guard (at line ~584)
```typescript
// Explicit Link Notes badge guard
// Per link-notes-generic-disambiguation-fix.md: When user explicitly says "link notes F",
// NEVER fuzzy-match to another badge - show clear error if not found
const hasExplicitLinkNotesBadge = !!explicitLinkNotesBadge

// Added to condition:
if (!resolution.success && ... && !hasExplicitLinkNotesBadge) {
```

#### e. Resolution context updated
```typescript
const resolutionContext = {
  // ... existing fields ...
  explicitLinkNotesBadge,  // NEW
}
```

### 3. `lib/chat/resolution-types.ts`

**Change:** Added `explicitLinkNotesBadge` to `ResolutionContext` type

```typescript
export interface ResolutionContext {
  // ... existing fields ...

  // Explicit Link Notes badge extracted from user input (deterministic)
  // Per link-notes-generic-disambiguation-fix.md: overrides LLM-extracted badge
  explicitLinkNotesBadge?: string
}
```

---

## How It Works

### Flow Diagram

```
User Input: "open link notes f"
         │
         ▼
┌─────────────────────────────────────┐
│ 1. Deterministic Badge Extraction   │
│    extractLinkNotesBadge("open link │
│    notes f") → "F"                  │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 2. LLM Intent Parsing               │
│    May return: show_quick_links,    │
│    unsupported, panel_intent, etc.  │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 3. Intent Override Check            │
│    IF explicitBadge AND             │
│       intent !== show_quick_links   │
│    THEN override to show_quick_links│
│         with badge "F"              │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 4. Resolution                       │
│    resolveShowQuickLinks()          │
│    → Query for badge "F"            │
│    → Not found                      │
│    → Return error                   │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ 5. Typo Suggestion Guard            │
│    hasExplicitLinkNotesBadge = true │
│    → SKIP typo suggestions          │
│    → No fuzzy match f→d             │
└─────────────────────────────────────┘
         │
         ▼
Output: "No Link Notes panel with badge 'F' found."
```

### Key Guarantees

1. **Deterministic Extraction**: Badge is extracted from raw user input, not LLM
2. **Intent Override**: Correct intent is forced regardless of LLM response
3. **No Fuzzy Matching**: Explicit badges are never fuzzy-matched to other letters
4. **Consistent Output**: Same input always produces same output

---

## Test Results

### Before Fix
| Input | Attempt 1 | Attempt 2 | Attempt 3 |
|-------|-----------|-----------|-----------|
| "open link notes f" | Error ✅ | Fuzzy: "D" ❌ | Disambiguation ❌ |

### After Fix
| Input | Attempt 1 | Attempt 2 | Attempt 3 | Attempt 4 |
|-------|-----------|-----------|-----------|-----------|
| "open link notes f" | Error ✅ | Error ✅ | Error ✅ | Error ✅ |

### Full Test Matrix

| Input | Expected | Actual | Status |
|-------|----------|--------|--------|
| "open link notes f" | "No Link Notes panel with badge 'F' found." | Same | ✅ PASS |
| "open link notes d" | Opens Link Notes D | "Opening panel..." | ✅ PASS |
| "open link notes e" | Opens Link Notes E | "Opening panel..." | ✅ PASS |
| "open link notes" | Disambiguation (D/E pills) | Same | ✅ PASS |

---

## Acceptance Criteria (per plan)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Multiple panels, generic command → disambiguation | ✅ |
| 2 | Specific badge (exists) → opens panel | ✅ |
| 3 | Missing badge → clear error message | ✅ |
| 4 | No legacy naming ("Quick Links") | ✅ |
| 5 | Deterministic routing (no LLM dependence) | ✅ |

---

## Verification

```bash
# Type-check passes
npm run type-check
# Output: (no errors)
```

---

## Telemetry

When deterministic override is triggered, the following is logged:

```json
{
  "component": "ChatNavigation",
  "action": "deterministic_link_notes_override",
  "metadata": {
    "originalIntent": "unsupported",
    "explicitBadge": "F",
    "userMessage": "open link notes f"
  }
}
```

---

## Related Changes

This fix builds on the earlier "Link Notes Rename" implementation (same date):
- Renamed "Quick Links" to "Link Notes" in all user-facing strings
- Updated typo suggestions vocabulary
- Fixed disambiguation messages

See: `2026-01-22-link-notes-rename-implementation-report.md`

---

## Future Considerations

1. **Apply same pattern to other panels**: If other panels have similar LLM variance issues, apply deterministic extraction
2. **Unit tests**: Add tests for `extractLinkNotesBadge` function
3. **Metrics**: Track how often deterministic override is triggered vs LLM correctly extracts badge

---

## Conclusion

The deterministic badge extraction fix ensures consistent behavior for Link Notes commands regardless of LLM variance. Users will now always receive the correct response when specifying a badge, whether the panel exists or not.
