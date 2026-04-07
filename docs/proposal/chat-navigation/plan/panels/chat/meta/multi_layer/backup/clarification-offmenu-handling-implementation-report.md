# Clarification Off-Menu Handling — Implementation Report

**Date:** 2026-01-25
**Status:** ✅ Complete
**Plan Reference:** `clarification-offmenu-handling-plan.md`
**Examples Reference:** `clarification-offmenu-handling-examples.md`

---

## 1. Overview

This report documents the implementation of the Clarification Off-Menu Handling feature, which provides human-like conversational behavior when users interact with option pills during clarification flows.

### Goals Achieved
- ✅ Stay polite and helpful during clarification
- ✅ Map input to options when possible
- ✅ Allow topic changes smoothly (zero-overlap escape)
- ✅ Avoid infinite loops
- ✅ Resolve in ≤3 turns most of the time
- ✅ Treat hesitation and repair phrases in a human-like way

---

## 2. Files Modified

### Core Implementation

| File | Changes |
|------|---------|
| `lib/chat/clarification-offmenu.ts` | Added prompt templates, list rejection detection, hesitation/repair handling |
| `lib/chat/chat-routing.ts` | Added Tier 0 list rejection, updated repair/no handlers, integrated consistent prompts |

### Tests

| File | Changes |
|------|---------|
| `__tests__/unit/chat/clarification-offmenu.test.ts` | Added 37 tests for all new functions |

### Documentation

| File | Changes |
|------|---------|
| `clarification-offmenu-handling-examples.md` | Fixed Example 5 to match plan ("first or second" vs "1 or 2") |

---

## 3. Implemented Features

### 3.1 Consistent Prompt Templates

All prompts now follow a consistent structure per the plan:

| Scenario | Prompt |
|----------|--------|
| **Base/Hesitation** | `**Which one do you mean — or** if neither looks right, say **"none of these"** (or **"none of those"**) or tell me one detail (where it is / what it's called).` |
| **Repair ("not that")** | `Okay — not that one. **Which one do you mean instead — or** say **"none of these"** (or **"none of those"**) or tell me what it's called.` |
| **No refusal ("no")** | `No problem. **Which one do you mean — or** say **"none of these"** (or **"none of those"**) or tell me where it is (Docs or Notes).` |
| **List rejection** | `Got it. Tell me one detail (exact name or where it lives) — or I can show more results.` |
| **Escalation (attempt 1)** | `I didn't catch that. Reply **first** or **second**, or say **"none of these"** (or **"none of those"**), or tell me one detail.` |

### 3.2 Tier 0: List Rejection → Refine Mode

**Before:** "none of these/those" triggered exit
**After:** "none of these/those" triggers Refine Mode (asks for detail, no pills)

```typescript
// lib/chat/clarification-offmenu.ts
export function isListRejectionPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  const stripped = normalized.replace(/[,.]?\s*(please|thanks|thank you|pls|thx)$/i, '').trim()

  const listRejectionPhrases = [
    'none of these', 'none of those', 'neither',
    'neither of these', 'neither of those', 'not these',
    'not those', 'none of them', 'neither one', 'neither option',
  ]

  return listRejectionPhrases.includes(stripped)
}
```

**Key design decision:** Uses exact match after stripping trailing politeness words to avoid capturing compound inputs like "none of those, open dashboard" which should fall through to topic detection.

### 3.3 Repair and "No" Handling for Any Number of Options

**Before:** Repair phrases and "no" only worked with exactly 2 options
**After:** Works with any number of options (per Example 8 with 7 workspaces)

```typescript
// lib/chat/chat-routing.ts
const hasOptions = lastClarification?.options && lastClarification.options.length > 0

if (isRepairPhrase(trimmedInput) && hasOptions) {
  // Shows repair prompt with all options
}

if (isSimpleNo && hasOptions) {
  // Shows no refusal prompt with all options
}
```

### 3.4 Hesitation Detection (Tier A0)

Hesitation phrases do NOT increment `attemptCount`:

```typescript
export function isHesitationPhrase(input: string): boolean {
  const exactHesitations = [
    'hmm', 'hmmm', 'hmmmm', 'hm', 'hmn',
    'umm', 'ummm', 'um', 'uh', 'uhh',
    'idk', 'dunno', 'i dunno', 'i donno',
    'not sure', "i'm not sure", 'im not sure',
    "i don't know", 'i dont know', "don't know", 'dont know',
    'no idea', 'unsure', 'maybe', 'perhaps',
    'let me think', 'thinking', 'hold on',
  ]
  // ... pattern matching
}
```

### 3.5 Zero-Overlap Escape

When user input has zero token overlap with all option labels, it escapes clarification and routes normally:

| Input | Options | Behavior |
|-------|---------|----------|
| `open recent` | [Links Panel D, Links Panel E] | Escapes → Opens Recent |
| `open demo widget` | [Links Panel D, Links Panel E] | Escapes → Opens Demo Widget |
| `open panel d` | [Links Panel D, Links Panel E] | Stays (partial overlap: "panel", "d") |

### 3.6 Escalation Ladder

| Attempt | Message | Exit Pills |
|---------|---------|------------|
| 1 | "I didn't catch that. Reply first or second..." | No |
| 2 | "Which one is closer to what you need?" | Yes |
| 3+ | "Which one is closer, or tell me the feature in 3-6 words..." | Yes |

---

## 4. Decision Flow (Order of Evaluation)

```
User Input
    │
    ▼
┌─────────────────────────────────────┐
│ Tier 0: List Rejection?             │
│ "none of these/those/neither"       │
│ → Refine Mode (no pills)            │
└─────────────────────────────────────┘
    │ No
    ▼
┌─────────────────────────────────────┐
│ Tier 1a: Exit Phrase?               │
│ "cancel/stop/never mind"            │
│ → Clear clarification               │
└─────────────────────────────────────┘
    │ No
    ▼
┌─────────────────────────────────────┐
│ Tier A0: Hesitation?                │
│ "hmm/idk/not sure"                  │
│ → Soft prompt (no attemptCount++)   │
└─────────────────────────────────────┘
    │ No
    ▼
┌─────────────────────────────────────┐
│ Tier E1: Repair Phrase?             │
│ "not that/the other one"            │
│ → Repair prompt + pills             │
└─────────────────────────────────────┘
    │ No
    ▼
┌─────────────────────────────────────┐
│ Tier E2: Simple "No"?               │
│ "no/nope/nah"                       │
│ → No refusal prompt + pills         │
└─────────────────────────────────────┘
    │ No
    ▼
┌─────────────────────────────────────┐
│ Tier 1b: Label/Ordinal Match?       │
│ "first/Links Panel D"               │
│ → Select option                     │
└─────────────────────────────────────┘
    │ No
    ▼
┌─────────────────────────────────────┐
│ Tier C: Zero-Overlap Escape?        │
│ No overlap with option tokens       │
│ → Route as new topic                │
└─────────────────────────────────────┘
    │ No
    ▼
┌─────────────────────────────────────┐
│ Tier D: Escalation                  │
│ Increment attemptCount              │
│ → Escalation prompt + pills         │
└─────────────────────────────────────┘
```

---

## 5. Test Results

### Unit Tests: 37 passed

```
PASS __tests__/unit/chat/clarification-offmenu.test.ts
  isHesitationPhrase (10 tests)
  isRepairPhrase (8 tests)
  isExitPhrase (4 tests)
  isListRejectionPhrase (7 tests)
  getEscalationMessage (3 tests)
  getHesitationPrompt (1 test)
  Consistent Prompt Templates (4 tests)
```

### Manual Testing: All scenarios pass

| Scenario | Input | Expected | Actual | Status |
|----------|-------|----------|--------|--------|
| Hesitation | `hmmm` | Soft prompt + pills | ✅ | PASS |
| Repair | `not that` | Repair prompt + pills | ✅ | PASS |
| No refusal | `no` | No problem prompt + pills | ✅ | PASS |
| List rejection | `none of those` | Refine prompt (no pills) | ✅ | PASS |
| Ordinal | `the first option` | Opens selection | ✅ | PASS |
| Escalation | `asdf` | Escalation prompt + pills | ✅ | PASS |
| Zero-overlap | `open recent` | Escapes to new topic | ✅ | PASS |
| Exit | `cancel` | Clears clarification | ✅ | PASS |

---

## 6. Behavior Changes Summary

| Input | Before | After |
|-------|--------|-------|
| `none of these` | Exit clarification | **Refine Mode** (asks for detail) |
| `none of those` | Exit clarification | **Refine Mode** (asks for detail) |
| `not that` (7 options) | Not handled | **Repair prompt** + all options |
| `no` (7 options) | Not handled | **No refusal prompt** + all options |
| `hmm` | Random soft prompt | **Consistent template** |
| `open recent` (during clarification) | Stayed in clarification | **Escapes** (zero-overlap) |

---

## 7. Edge Cases Handled

### 7.1 Polite List Rejection
```
"none of those please" → Refine Mode ✅
"neither, thanks" → Refine Mode ✅
```

### 7.2 Compound Inputs (Not List Rejection)
```
"none of those, open dashboard" → Falls through to topic detection ✅
```

### 7.3 Typos in Exit
```
"cacancel" → Exit (contains "cancel") ✅
```

### 7.4 Partial vs Full Match
```
"open panel d" → Stays in clarification (partial overlap) ✅
"open links panel d" → Selects Links Panel D (full match) ✅
```

---

## 8. Acceptance Tests Status

| # | Test | Status |
|---|------|--------|
| 1 | "settings please" maps if only one option matches | ✅ |
| 2 | "preferences" re-asks A/B (no global synonym) | ✅ |
| 3 | "show me my profile" exits clarification | ✅ |
| 4 | "idk" soft prompt, no attemptCount increment | ✅ |
| 5 | After 2+ attempts, guidance + exits shown | ✅ |
| 6 | "cancel / never mind" exits clarification | ✅ |
| 7 | "none of those" → Refine Mode | ✅ |
| 8 | "first" selects first option | ✅ |
| 9 | "link notesx" re-shows options (typo recovery) | ✅ |
| 10 | "Can you show me the settings?" maps correctly | ✅ |
| 11 | "settings" with both options matching → re-ask A/B | ✅ |
| 12 | "manage settings" (overlaps both) → re-ask + increment | ✅ |
| 13 | "hmm" / "i don't know" → no attemptCount increment | ✅ |
| 14 | "not that" stays in clarification | ✅ |
| 15 | List rejection phrase → Refine Mode | ✅ |

---

## 9. Future Considerations

1. **Sticky List Window** - Plan mentions keeping list available for 1 turn after selection. Not yet implemented but structure supports it.

2. **hesitationCount Tracking** - Plan mentions separate hesitation counter. Currently using attemptCount only.

3. **Soft-confirm for Broad Mappings** - Plan suggests "Got it — I'll use X. If you meant the other one, pick it below." Not yet implemented.

---

## 10. Conclusion

The Clarification Off-Menu Handling feature has been successfully implemented according to the plan. All acceptance tests pass, manual testing confirms correct behavior, and the implementation provides a ChatGPT/Cursor-like conversational experience during clarification flows.

The key improvements are:
- **Human-like handling** of hesitation, repair, and rejection phrases
- **Zero-overlap escape** for clean topic switching
- **Consistent prompt templates** that teach users their options
- **Refine Mode** for list rejection (vs hard exit)
- **Works with any number of options** (not just 2)
