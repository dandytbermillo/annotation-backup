# Link Notes Generic Disambiguation Fix

**Status:** Complete
**Owner:** Chat Navigation
**Scope:** Link Notes panel disambiguation + naming consistency
**Completed:** 2026-01-22
**Implementation Reports:**
- `reports/2026-01-22-link-notes-rename-implementation-report.md`
- `reports/2026-01-22-link-notes-deterministic-badge-fix-report.md`

---

## Problem

When users issue a generic command like “open link notes” or “open links,” and multiple Link Notes panels exist (e.g., D/E), the system may:
- auto‑select the wrong panel,
- show inconsistent/legacy naming (“Quick Links”), or
- surface a generic fallback instead of a clear choice.

---

## Goals

1. Always show a **disambiguation choice** when multiple Link Notes panels exist.
2. Use **consistent, current naming** (“Link Notes”), no legacy terms.
3. Keep deterministic action routing (no LLM dependence).

---

## Non‑Goals

- Renaming or removing panels.
- Changing underlying storage or panel IDs.
- Altering unrelated action routing (recent, widgets, navigation).

---

## Proposed Behavior

**If exactly one Link Notes panel exists:**  
→ Open it directly.

**If multiple Link Notes panels exist:**  
→ Show a disambiguation prompt + pills (“Link Notes D”, “Link Notes E”).

**If user specifies a badge (e.g., “link notes D”):**  
→ Open that panel; if missing, show “No Link Notes panel with badge X found.”

**If no Link Notes panels exist:**  
→ Show a clear error (“No Link Notes panels found.”).

---

## Implementation Notes (No Code)

1. **Centralized panel matching**  
   Use a single normalization helper (lowercase, strip punctuation, stopword removal, token‑sort) for all Link Notes matches.

2. **Disambiguation path**  
   When the resolved set > 1, return a selection action with Link Notes labels and badges.

3. **Naming cleanup**  
   Ensure all user‑facing strings, suggestions, and fallback messages use **Link Notes** (no “Quick Links” / “Links Overview”).

---

## Acceptance Tests

1. **Multiple panels, generic command**  
   - Input: “open link notes”  
   - Expected: prompt + pills (Link Notes D/E/etc)

2. **Specific badge**  
   - Input: “open link notes D”  
   - Expected: opens D

3. **Missing badge**  
   - Input: “open link notes F”  
   - Expected: “No Link Notes panel with badge ‘F’ found.”

4. **Legacy naming does not appear**  
   - Input: any Link Notes command  
   - Expected: no “Quick Links” / “Links Overview” strings

---

## Telemetry (Optional)

- `link_notes_disambiguation_shown`  
- `link_notes_opened_badge`  
- `link_notes_missing_badge`

---

## Open Questions

None. This is a behavior‑level cleanup focused on disambiguation and naming consistency.

