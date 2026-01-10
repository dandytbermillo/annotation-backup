# Panel Intent Ambiguity Guard - Test Cases

**Feature:** Panel Intent Ambiguity Guard
**Date:** 2025-01-09

---

## Prerequisites

- At least 2 Quick Links panels exist (e.g., Quick Links D, Quick Links E)
- Dashboard is visible with widgets (Navigator, Quick Capture, etc.)

---

## Test Suite 1: Disambiguation Flow

### TC1.1: Basic "open links" disambiguation

**Input:** "open links"
**Expected:**
- Message: "Multiple panels match 'quick-links'. Which one would you like to open?"
- Pills shown: "Quick Links D (links_note_tiptap)", "Quick Links E (links_note_tiptap)"
**Status:** ✅ PASS

### TC1.2: "show links" disambiguation

**Input:** "show links"
**Expected:**
- Message: "Multiple panels match 'quick-links'. Which one would you like to open?"
- Pills shown with badge differentiation
**Status:** ✅ PASS

### TC1.3: Typo tolerance

**Input:** "can youu ppls open links"
**Expected:**
- Same disambiguation as TC1.1
**Status:** ✅ PASS

### TC1.4: "links" bare keyword

**Input:** "links"
**Expected:**
- Disambiguation if multiple Quick Links exist
**Status:** ✅ PASS

---

## Test Suite 2: Selection from Disambiguation

### TC2.1: Number selection - first option

**Precondition:** Disambiguation pills are shown
**Input:** "1"
**Expected:**
- Message: "Opening Quick Links D..."
- Quick Links D drawer opens
**Status:** ✅ PASS

### TC2.2: Number selection - second option

**Precondition:** Disambiguation pills are shown
**Input:** "2"
**Expected:**
- Message: "Opening Quick Links E..."
- Quick Links E drawer opens
**Status:** ✅ PASS

### TC2.3: Click selection

**Precondition:** Disambiguation pills are shown
**Action:** Click "Quick Links D" pill
**Expected:**
- Message: "Opening Quick Links D..."
- Quick Links D drawer opens
**Status:** ✅ PASS

---

## Test Suite 3: Explicit Badge Bypass

### TC3.1: Explicit badge - D

**Input:** "open quick links D"
**Expected:**
- Message: "Opening Quick Links D..."
- No disambiguation shown
- Quick Links D drawer opens directly
**Status:** ✅ PASS

### TC3.2: Explicit badge - E

**Input:** "open quick links E"
**Expected:**
- Message: "Opening Quick Links E..."
- No disambiguation shown
- Quick Links E drawer opens directly
**Status:** ✅ PASS

### TC3.3: Lowercase badge

**Input:** "open links d"
**Expected:**
- Same as TC3.1 (case-insensitive)
**Status:** ✅ PASS

---

## Test Suite 4: Widget Panel Opening (Step 0)

### TC4.1: Open Navigator

**Precondition:** Navigator widget is visible on dashboard
**Input:** "open Navigator"
**Expected:**
- Navigator opens in drawer immediately
- No disambiguation
**Status:** ✅ PASS

### TC4.2: Open Quick Capture

**Precondition:** Quick Capture widget is visible on dashboard
**Input:** "open Quick Capture"
**Expected:**
- Quick Capture opens in drawer immediately
**Status:** ✅ PASS

### TC4.3: Open Widget Manager

**Precondition:** Widget Manager widget is visible on dashboard
**Input:** "open Widget Manager"
**Expected:**
- Widget Manager opens in drawer immediately
**Status:** ✅ PASS

---

## Test Suite 5: Edge Cases

### TC5.1: Single Quick Links panel

**Precondition:** Only one Quick Links panel exists
**Input:** "open links"
**Expected:**
- Opens directly, no disambiguation
**Status:** Not tested (requires single-panel setup)

### TC5.2: No Quick Links panels

**Precondition:** No Quick Links panels exist
**Input:** "open links"
**Expected:**
- Error message: "Panel not found"
**Status:** Not tested (requires no-panel setup)

### TC5.3: Widget not visible

**Precondition:** Navigator widget is NOT on dashboard
**Input:** "open Navigator"
**Expected:**
- Fallback to DB lookup (Step 1-3)
- May show error if no matching panel_type
**Status:** Not tested

---

## Test Suite 5b: Fuzzy Match Confirm Pill

### TC5b.1: Single fuzzy match shows confirm pill

**Precondition:** Panel titled "My Custom Notes" exists, no exact match for "notes"
**Input:** "open notes"
**Expected:**
- Message: `Did you mean "My Custom Notes"?`
- Single pill shown: `[My Custom Notes] →`
- No auto-open (requires user click)
**Status:** Pending test

### TC5b.2: Confirm pill selection opens panel

**Precondition:** Confirm pill is shown from TC5b.1
**Action:** Click the confirm pill
**Expected:**
- Panel opens in drawer
- Message: "Opening My Custom Notes..."
**Status:** Pending test

### TC5b.3: Multiple fuzzy matches show disambiguation

**Precondition:** Panels "Notes Panel A" and "Notes Panel B" exist
**Input:** "open notes"
**Expected:**
- Message: `Multiple panels match "notes". Which one would you like to open?`
- Two pills shown
**Status:** Pending test

### TC5b.4: Exact match bypasses confirm pill

**Precondition:** Panel titled "Recent" exists
**Input:** "open recent"
**Expected:**
- Opens directly (exact match, no confirm pill)
**Status:** Pending test

---

## Test Suite 6: LLM Consistency

### TC6.1: Repeated "open links" commands

**Input:** "open links" (5 times)
**Expected:**
- All 5 should return `panelId: "quick-links"` (no badge suffix)
- All 5 should show disambiguation
**Status:** ✅ PASS (after prompt fix)

### TC6.2: Varied phrasings

**Inputs:**
- "open links"
- "show links"
- "links please"
- "can you open quick links"

**Expected:**
- All should trigger disambiguation (no badge guessing)
**Status:** ✅ PASS

---

## Regression Tests

### RT1: Workspace opening still works

**Input:** "open workspace 6"
**Expected:** Workspace 6 opens
**Status:** Verify

### RT2: Note opening still works

**Input:** "open note Project Plan"
**Expected:** Note search/open flow works
**Status:** Verify

### RT3: Dashboard navigation still works

**Input:** "go to dashboard"
**Expected:** Returns to dashboard
**Status:** Verify

---

## Test Matrix

| Input | LLM panelId | Step | Result |
|-------|-------------|------|--------|
| "open links" | quick-links | Bare handler | Disambiguation |
| "open links D" | quick-links-d | Specific badge | Direct open |
| "open Navigator" | navigator | Step 0 | Direct open |
| "open Quick Capture" | quick-capture | Step 0 | Direct open |
| "open Recent" | recent | Step 0/1 | Direct open |

---

## Manual Test Checklist

- [ ] Disambiguation shows badge-differentiated labels ("Quick Links D" not "Quick Links (TipTap)")
- [ ] Pills are clickable
- [ ] Number selection ("1", "2") works
- [ ] Drawer opens with correct panel content
- [ ] Explicit badge bypasses disambiguation
- [ ] Widget names work (Navigator, Quick Capture, etc.)
- [ ] Typos are tolerated ("opn links", "quik links")
- [ ] Case-insensitive ("open LINKS", "open links d")
