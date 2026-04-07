# Dynamic Typo Suggestions Fixes (Recent + Quick Links Badges)

**Status:** IMPLEMENTED
**Implementation Date:** 2026-01-05

## Purpose
Improve typo fallback for:
- “open/show/list recent”
- “quick links D” (badge-specific variants)

## Root Cause
- Recent phrases do not include verb variants.
- Quick Links badge variants are not in the suggestion vocabulary.
- `buildDynamicVocabulary()` skips `quick-links-*` manifests, so badge-specific candidates never appear.

## Changes
### 1) Expand Recent Phrases
Add verb patterns to the static vocabulary entry for Recent:
- “open recent”, “show recent”, “list recent”, “view recent”

### 2) Badge-Specific Quick Links Candidates
Derive badge variants from visible panels:
- If `visiblePanels` includes `quick-links-d`, add candidate:
  - label: “Quick Links D”
  - phrases: “quick links d”, “quick link d”, “show quick links d”, “open quick links d”
  - panelId: “quick-links-d”

This avoids re‑adding all quick-links manifests (prevents duplicates) and only surfaces
badges that actually exist in the current dashboard.

### 3) “Quick Links” Without Badge = List/Choose
When multiple Quick Links panels exist:
- Treat bare “quick links” as a **collection**, not a specific badge.
- Primary action should be **list/choose** (not open last badge).
- Only use lastQuickLinksBadge when:
  - Exactly one Quick Links panel exists, OR
  - User explicitly says “my last quick links”.

## Behavior Rules
- “quick links” → show list of Quick Links panels (A/B/C/…)
- “quick links D” → open D directly
- “my last quick links” → open lastQuickLinksBadge

## Implementation Steps
1) `lib/chat/typo-suggestions.ts`
   - Update the Recent command phrases.
   - Add a helper to convert visible panel IDs into badge candidates.
   - Merge badge candidates into the dynamic vocabulary before matching.

2) `app/api/chat/navigate/route.ts`
   - Ensure `visiblePanels` is passed in suggestionContext (already done).

## Tests
- [x] "oopen recent" → suggests **Recent** (high confidence).
- [x] "shwo quick links d" → suggests **Quick Links D** (not generic Quick Links).
- [x] "show quick links e" when E is visible → suggests **Quick Links E**.
- [x] "quick links z" when Z not visible → no badge suggestion.
- [x] "quik links" with multiple panels visible → shows multiple badge options.

## Rollback
- Revert to current dynamic vocabulary merging logic.

## Isolation Reactivity Anti-Patterns
Not applicable. No Isolation context changes.
