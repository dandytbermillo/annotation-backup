# Panel Intent Ambiguity Guard Plan

## Problem
The current dynamic panel lookup uses fuzzy matching (ILIKE %name%) and opens the first match. This is unsafe when multiple widgets share similar names (e.g., "Links" vs "Quick Links").

## Goal
Only auto-open a panel when the match is unique; otherwise present disambiguation options (pills).

## Non-Goals
- No change to widget UI.
- No change to custom widget install flow.
- No new LLM intents; reuse existing `select` option flow.

## Proposed Behavior
1) **Exact visibleWidgets match wins**
   - If the user’s "open X" matches a visible widget title, open that exact panel ID.
2) **Exact panel_type match second**
   - Use normalized panel_type match when unambiguous.
3) **Multiple matches → disambiguate**
   - Return `action: 'select'` with options (label + sublabel + id).
4) **Fuzzy match only if unique**
   - Only auto-open when ILIKE returns a single match.

## Implementation Steps
1) Update the dynamic panel lookup in `lib/chat/intent-resolver.ts`:
   - Collect all matches from panel_type + title ILIKE queries.
   - If multiple distinct rows → return select options instead of open.
   - If exactly one row → open drawer as before.
2) Prefer exact title match using `uiContext.dashboard.visibleWidgets` (if available) before DB lookup.
3) Keep the existing panelId mapping for known widgets (recent/quick links) unchanged.

## Acceptance Criteria
- "open navigator" (single match) opens the Navigator drawer.
- "open links" (multiple matches) shows pills instead of opening.
- "open quick links" opens the correct Quick Links panel if only one matches; otherwise shows pills.
- No “Panel not found” for widgets listed in visibleWidgets.

## Tests
1) Dashboard with both "Links Overview" and "Quick Links" visible:
   - Input: "open links" → pills shown.
2) Dashboard with single "Navigator":
   - Input: "open navigator" → opens drawer.
3) VisibleWidgets exact match:
   - Input: "open widget manager" → opens drawer directly.

## Rollback
- Revert to the current fuzzy open behavior (no disambiguation).
