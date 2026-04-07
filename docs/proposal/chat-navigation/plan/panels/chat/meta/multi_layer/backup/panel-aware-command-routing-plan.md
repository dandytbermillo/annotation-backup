# Panel-Aware Command Routing Plan

**Status:** Complete (Implemented 2026-01-22)  
**Owner:** Chat Navigation  
**Scope:** Deterministic routing for “open/show” commands based on visible panels  

---

## Problem

Command-like inputs (e.g., “open categories”, “open link notes d”) are currently matched using static patterns or hardcoded terms. This creates brittle behavior:
- Works only for specific panel names (“Link Notes” hardcode).
- Fails for custom or newly-added panels.
- Requires repeated regex additions as new panels are introduced.

---

## Goal

Make “open/show/display” commands panel-aware using **visibleWidgets** (context) rather than static patterns, so any panel title in the database can be opened deterministically.

---

## Non-Goals

- Changing LLM intent parsing logic.
- Rewriting the panel registry.
- Altering cross‑corpus retrieval behavior **except** to bypass it for panel commands.

---

## Proposed Behavior

1. **Command-like input detected** (`open/show/display/go to`).
2. **Visible panel titles** are used as the source of truth.
3. **Deterministic match** against visible panel titles:
   - Exact match (normalized)
   - Stopword-stripped, token-sorted match
4. Outcomes:
   - **Single match** → open panel directly.
   - **Multiple matches** → disambiguation pills.
   - **No matches** → fall through to existing routing.

---

## Why This Works

- Uses real UI state (visible panels), not guesses.
- Automatically supports future panels without new hardcodes.
- Keeps routing deterministic and consistent with user expectations.

---

## Integration Point (Explicit)

1) **Cross‑corpus guard (early skip)**  
   In `handleCrossCorpusRetrieval`, before intent detection:
   - If input matches a visible panel title (see matching rules below), return `{ handled: false }`
   - This ensures panel commands do **not** get intercepted by cross‑corpus retrieval.

2) **Action routing fallback**  
   In action resolution (e.g., `resolveBareName`), after workspace/entry lookup fails:
   - Try visible panel match and open the panel directly
   - If multiple matches, show disambiguation pills

---

## Acceptance Tests

1. **Custom panel**
   - Panel exists: “Project X”
   - Input: “open project x”
   - Expected: Opens the panel.

2. **Multiple panels**
   - Panels: “Link Notes D”, “Link Notes E”
   - Input: “open link notes”
   - Expected: Disambiguation pills.

3. **Nonexistent panel**
   - Input: “open categories” (no such panel visible)
   - Expected: Falls through to existing error or fallback.

4. **Normal command unaffected**
   - Input: “open recent”
   - Expected: Behaves as before (Recent panel opens).

5. **Badge without verb**
   - Panels: “Link Notes D”, “Link Notes E”
   - Input: “link notes d”
   - Expected: Opens Link Notes D

6. **Badge with trailing text**
   - Panels: “Link Notes D”, “Link Notes E”
   - Input: “link notes d pls”
   - Expected: Opens Link Notes D

---

## Notes

- This is a deterministic, context‑aware fix.  
- Eliminates the need for panel‑specific regex in `isCommandLike`.
- Scales with user‑created panels stored in the database.

---

## Matching Rules (Required)

- Normalize by: lowercase → strip punctuation → remove stopwords (my/your/the/a/an) → token sort
- Allow **badge suffix** matching:
  - Title: “Link Notes D”  
  - Input: “link notes d” or “link notes d pls” → match
- If multiple visible panels match, return disambiguation pills instead of guessing.

---

## Files to Touch (Expected)

- `lib/chat/cross-corpus-handler.ts`  
  - early skip for panel‑command matches
- `lib/chat/intent-resolver.ts`  
  - reuse centralized panel matcher during action resolution

---

## Clarifications (Implementation Details)

1) **Panel ID → Title resolution**
   - Prefer `visibleWidgets` titles directly (they already contain user‑visible names).
   - Only fall back to `panelRegistry.get(id)?.title` if you truly only have IDs.

2) **Helper function location**
   - Suggested: `lib/chat/panel-command-matcher.ts`
   - Exports:
     - `matchesVisiblePanelCommand(input, visibleWidgets): MatchResult`
     - Uses the normalization + badge rules defined above.
