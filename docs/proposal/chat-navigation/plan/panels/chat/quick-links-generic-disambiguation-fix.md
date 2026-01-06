# Quick Links Generic Disambiguation Fix

## Goal
When the user says "quick links" (no badge), always show a selection list if multiple Quick Links panels exist (A/B/C/…). Do not open a single panel implicitly.

## Problem
Current behavior opens a specific panel (“Opening panel…”) even when multiple Quick Links panels exist and the user did not specify a badge. This is confusing and inconsistent with the UI.

## Root Cause (likely)
One of the following is happening:
- The resolver treats focus/last‑badge as an implicit badge and opens that panel.
- The visibility list only contains one quick‑links panel, so it looks like there’s no ambiguity.
- The prompt maps “quick links” directly to a single panel intent without explicit badge.

## Proposed Fix

### 1) Explicit badge detection only
- Only treat `quickLinksPanelBadge` as present if the user explicitly said a letter (A/B/C/D/E).
- If no explicit badge and multiple panels exist → return `select` with options.

### 2) Disambiguation rule in resolver
- In `resolveShowQuickLinks`:
  - Query all visible quick‑links panels (or all for the entry if no visibility context).
  - If count > 1 and no explicit badge → return disambiguation options.
  - Do **not** fall back to focus/last‑badge for “quick links” generic.

### 3) Prompt clarification rule
- Add: “If user says ‘quick links’ without a badge and multiple panels exist, ask which one.”

### 4) Visibility correctness check
- Ensure each Quick Links widget registers a unique panelId (e.g., `quick-links-a`, `quick-links-d`).
- Confirm visiblePanels includes all quick‑links widgets on the dashboard.

### 5) Debug logging
- Log: panel count, explicit badge detected, visiblePanels list.

## Acceptance Tests
1) Multiple panels exist
   - User: “quick links” → selection list with A/B/D/E.
2) Explicit badge
   - User: “quick links D” → opens D.
3) Single panel only
   - User: “quick links” → opens that panel (no disambiguation).
4) Visibility regression guard
   - If quick‑links widgets unmounted, still disambiguate from DB panels in entry.

## Files to Touch (expected)
- `lib/chat/intent-resolver.ts`
- `lib/chat/intent-prompt.ts`
- `components/dashboard/widgets/QuickLinksWidget.tsx` (verify panelId registration)
- `lib/chat/chat-navigation-context.tsx` (if visibility list normalization needed)

