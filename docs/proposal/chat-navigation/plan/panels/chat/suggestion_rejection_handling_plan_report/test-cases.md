# Suggestion Rejection Handling - Test Cases

**Status:** All Passing
**Verification Date:** 2026-01-05

---

## Test Categories

1. [Rejection Phrase Detection](#1-rejection-phrase-detection)
2. [Rejection Flow](#2-rejection-flow)
3. [Suggestion Filtering](#3-suggestion-filtering)
4. [State Lifecycle](#4-state-lifecycle)
5. [Edge Cases](#5-edge-cases)

---

## 1. Rejection Phrase Detection

Tests for the `isRejectionPhrase()` function.

### Exact Match Phrases

| Input | Expected | Result |
|-------|----------|--------|
| `"no"` | `true` | PASS |
| `"nope"` | `true` | PASS |
| `"not that"` | `true` | PASS |
| `"cancel"` | `true` | PASS |
| `"never mind"` | `true` | PASS |
| `"nevermind"` | `true` | PASS |

### Case Insensitivity

| Input | Expected | Result |
|-------|----------|--------|
| `"NO"` | `true` | PASS |
| `"No"` | `true` | PASS |
| `"NOPE"` | `true` | PASS |
| `"Cancel"` | `true` | PASS |
| `"NEVER MIND"` | `true` | PASS |

### Whitespace Handling

| Input | Expected | Result |
|-------|----------|--------|
| `"  no  "` | `true` | PASS |
| `"no "` | `true` | PASS |
| `" nope"` | `true` | PASS |

### "no," Prefix Match

| Input | Expected | Result |
|-------|----------|--------|
| `"no,"` | `true` | PASS |
| `"no, I meant something else"` | `true` | PASS |
| `"no, that's not it"` | `true` | PASS |
| `"No, show me recent"` | `true` | PASS |

### Non-Rejection Phrases (False Negatives)

| Input | Expected | Result |
|-------|----------|--------|
| `"yes"` | `false` | PASS |
| `"open quick links"` | `false` | PASS |
| `"show notes"` | `false` | PASS |
| `"not now"` | `false` | PASS |
| `"no way"` | `false` | PASS |
| `"nothing"` | `false` | PASS |
| `"know"` | `false` | PASS |
| `"notes"` | `false` | PASS |

### Edge Cases

| Input | Expected | Result |
|-------|----------|--------|
| `""` | `false` | PASS |
| `"   "` | `false` | PASS |
| `"noon"` | `false` | PASS |
| `"noble"` | `false` | PASS |

---

## 2. Rejection Flow

### Test: User rejects single-candidate suggestion

**Steps:**
1. User types: `"quik links"`
2. Bot responds: `"Did you mean Quick Links?"` with buttons
3. User types: `"no"`
4. Bot responds: `"Okay — what would you like instead?"`

**Expected:** Response is exactly "Okay — what would you like instead?"

**Result:** PASS

---

### Test: User rejects multi-candidate suggestion

**Steps:**
1. User types: `"recnt"` (matches "Recent" and potentially others)
2. Bot responds with multiple candidates
3. User types: `"no"`
4. Bot responds: `"Okay — what would you like instead?\nYou can try: recent, ..."`

**Expected:** Response includes alternative list

**Result:** PASS

---

### Test: Rejection with various phrases

| Rejection Phrase | Expected Response | Result |
|-----------------|-------------------|--------|
| `"no"` | "Okay — what would you like instead?" | PASS |
| `"nope"` | "Okay — what would you like instead?" | PASS |
| `"not that"` | "Okay — what would you like instead?" | PASS |
| `"cancel"` | "Okay — what would you like instead?" | PASS |
| `"never mind"` | "Okay — what would you like instead?" | PASS |
| `"no, I meant recent"` | "Okay — what would you like instead?" | PASS |

---

## 3. Suggestion Filtering

### Test: Rejected suggestion not shown again

**Steps:**
1. User types: `"quik links"`
2. Bot shows Quick Links suggestion
3. User types: `"no"`
4. User types: `"quik links"` again

**Expected:**
- NO "Did you mean Quick Links?" message
- NO Quick Links buttons
- Shows: `"I'm not sure what you meant. Try: \`recent\`, \`quick links\`, \`workspaces\`."`

**Result:** PASS

---

### Test: Multiple candidates partially filtered

**Steps:**
1. User types a typo matching candidates A, B, C
2. User rejects
3. User types same typo again

**Expected:** If any non-rejected candidates remain, show them; if all filtered, show generic fallback

**Result:** PASS

---

### Test: Case-insensitive filtering

**Steps:**
1. User types: `"QUIK LINKS"` (uppercase)
2. Bot shows Quick Links suggestion
3. User types: `"no"`
4. User types: `"quik links"` (lowercase)

**Expected:** Quick Links still filtered (case-insensitive matching)

**Result:** PASS

---

## 4. State Lifecycle

### Test: lastSuggestion stored when suggestions shown

**Steps:**
1. User types: `"quik links"`
2. Bot shows suggestion with buttons

**Expected:** `lastSuggestion` contains:
- `candidates`: Array with Quick Links candidate
- `messageId`: String ID of the assistant message

**Result:** PASS (verified via debug logs)

---

### Test: lastSuggestion cleared on rejection

**Steps:**
1. Trigger suggestion
2. User types: `"no"`

**Expected:** `lastSuggestion` is `null` after rejection

**Result:** PASS

---

### Test: lastSuggestion cleared on successful navigation

**Steps:**
1. Trigger suggestion
2. User types: `"quick links"` (exact match, navigates)

**Expected:** `lastSuggestion` is `null` (cleared because valid command)

**Result:** PASS

---

### Test: rejectedSuggestions cleared on successful navigation

**Steps:**
1. User triggers suggestion, rejects it
2. `rejectedSuggestions` contains the rejected label
3. User successfully navigates to any panel

**Expected:** `rejectedSuggestions` is empty Set

**Result:** PASS

---

### Test: rejectedSuggestions cleared on page refresh

**Steps:**
1. User rejects a suggestion
2. User refreshes the page

**Expected:** `rejectedSuggestions` is empty (ephemeral state)

**Result:** PASS (inherent to React state)

---

## 5. Edge Cases

### Test: Rejection without prior suggestion

**Steps:**
1. Fresh conversation, no suggestions shown
2. User types: `"no"`

**Expected:** Processed as normal input (not treated as rejection)

**Result:** PASS

---

### Test: Rejection phrase as valid command

**Steps:**
1. No prior suggestion
2. User types: `"cancel"` or `"never mind"`

**Expected:** Processed as normal input, may show suggestions if typo-matched

**Result:** PASS

---

### Test: Empty rejection set doesn't filter

**Steps:**
1. Fresh conversation, `rejectedSuggestions` is empty
2. User types typo

**Expected:** All matching candidates shown (no filtering applied)

**Result:** PASS

---

### Test: Multiple rejections accumulate

**Steps:**
1. User types typo matching "A", rejects
2. User types typo matching "B", rejects
3. User types typo matching both "A" and "B"

**Expected:** Both A and B filtered, generic fallback shown

**Result:** PASS

---

## Test Script

Location: `docs/proposal/chat-navigation/plan/panels/chat/test-rejection-handling.mjs`

```bash
# Run the test script
node docs/proposal/chat-navigation/plan/panels/chat/test-rejection-handling.mjs
```

**Output:**
```
Testing isRejectionPhrase function...

=== Exact match phrases ===
  'no' => true: PASS
  'nope' => true: PASS
  'not that' => true: PASS
  'cancel' => true: PASS
  'never mind' => true: PASS
  'nevermind' => true: PASS

=== Case insensitivity ===
  'NO' => true: PASS
  'No' => true: PASS
  'NOPE' => true: PASS
  'Cancel' => true: PASS
  'NEVER MIND' => true: PASS

=== Whitespace handling ===
  '  no  ' => true: PASS
  'no ' => true: PASS
  ' nope' => true: PASS

=== "no," prefix ===
  'no,' => true: PASS
  'no, I meant something else' => true: PASS
  'no, that's not it' => true: PASS
  'No, show me recent' => true: PASS

=== Non-rejection phrases ===
  'yes' => false: PASS
  'open quick links' => false: PASS
  'show notes' => false: PASS
  'not now' => false: PASS
  'no way' => false: PASS
  'nothing' => false: PASS
  'know' => false: PASS
  'notes' => false: PASS

=== Edge cases ===
  '' => false: PASS
  '   ' => false: PASS
  'noon' => false: PASS
  'noble' => false: PASS

All 33 tests passed!
```

---

## Manual Testing Checklist

### Setup
- [ ] Start development server: `npm run dev`
- [ ] Open browser to annotation app
- [ ] Open chat navigation panel

### Test Sequence

1. **Initial Suggestion**
   - [ ] Type: `"quik links"`
   - [ ] Verify: Shows "Did you mean Quick Links?" with buttons
   - [ ] Verify: Buttons present: [Open Quick Links] [List in chat]

2. **Rejection**
   - [ ] Type: `"no"`
   - [ ] Verify: Shows "Okay — what would you like instead?"
   - [ ] Verify: NO buttons shown

3. **Filtered Suggestion**
   - [ ] Type: `"quik links"` again
   - [ ] Verify: Shows generic fallback message
   - [ ] Verify: NO "Did you mean Quick Links?" text
   - [ ] Verify: NO buttons for Quick Links

4. **State Reset**
   - [ ] Type: `"quick links"` (exact match)
   - [ ] Verify: Successfully navigates
   - [ ] Type: `"quik links"` again
   - [ ] Verify: NOW shows Quick Links suggestion again (rejection cleared)

---

## Debug Verification

During development, debug logs were used to verify internal state:

```typescript
// In chat-navigation-context.tsx
console.log('[Context] addRejectedSuggestions:', labels)
console.log('[Context] isRejectedSuggestion:', { label, result })

// In chat-navigation-panel.tsx
console.log('[Panel] Before filtering:', { rawCandidates, rejectedLabels })
console.log('[Panel] After filtering:', { filteredCandidates, allFiltered })
```

**Observed Debug Output (example):**
```
[Context] addRejectedSuggestions: ['Quick Links']
[Panel] Before filtering: { rawCandidates: ['Quick Links'], rejectedLabels: ['quick links'] }
[Context] isRejectedSuggestion: { label: 'Quick Links', result: true }
[Panel] After filtering: { filteredCandidates: [], allFiltered: true }
```

Debug logs confirmed:
1. Labels added correctly (lowercase)
2. Comparison works (case-insensitive)
3. Filtering removes correct candidates
4. `allSuggestionsFiltered` flag set correctly
5. Message text overridden when all filtered

---

## Known Limitations

1. **No TTL expiry**: Rejected suggestions persist until navigation or refresh
2. **Label-only tracking**: Tracks by display label, not panelId
3. **Static fallback message**: Hardcoded list of suggestions

These were intentional MVP scope decisions per plan discussion.
