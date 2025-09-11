# Option A — Auto‑Edit When Note Is Empty

> Goal: In Option A (offline, no Yjs), the main note panel should automatically enter edit mode when its document is empty. The caret must be visible and the “📝 Edit” button should be hidden while already editing. Non‑empty documents open read‑only with the toggle visible. Collaboration/Yjs behavior remains unchanged.

## Scope
- Mode: Option A only (plain/offline). No Yjs dependencies introduced.
- Panels: Main note panel (`main`), with consistent behavior for other panels if empty.
- Toolbar: Hide the Edit toggle in Option A while editing; always show in collaboration mode.

## Motivation
Opening a new note (empty document) sometimes showed the “📝 Edit” button and didn’t focus the editor, breaking the “type immediately” flow. Root causes were async document loading in Option A and mode detection races.

## Design

- Mode Detection (authoritative): Use `isPlainModeActive()` from `lib/collab-mode` to decide Option A vs. collaboration. Avoid provider‑presence checks (they can race on first render).
- Initial Edit State (Option A): If the current branch content is empty (robust checks for HTML and ProseMirror JSON), start in edit mode. Otherwise, respect `isEditable` semantics (main panel defaults to read‑only if non‑empty).
- Focus Reinforcement (Option A): After mounting or becoming editable, perform several delayed `focus()` attempts (50/200/400ms) to ensure a blinking caret across browsers.
- Post‑Load Fallback (Option A): Once the plain provider is initialized, load the actual main‑panel document; if truly empty, force `setIsEditing(true)` and focus. This removes timing races for brand‑new notes.
- Toolbar Visibility: In Option A, hide the Edit toggle while editing; in collaboration, always show the toggle (unchanged).
- Title Preservation (Option A): Keep the familiar main title by reading the note record via the plain adapter and updating the main panel title (e.g., “AI in Healthcare Research”, “New Note 2”).

## Implementation

Updated files (runtime):
- `components/canvas/canvas-panel.tsx`
  - Hoisted `isPlainMode` (via `isPlainModeActive()`) above initial `useState`.
  - Auto‑edit logic only in Option A for empty documents.
  - Focus reinforcement only in Option A.
  - Post‑load fallback: fetch doc with `plainProvider.loadDocument(noteId, panelId)`; force edit/focus if empty.
  - Passed `isPlainMode` and `isEditing` down to the toolbar.
- `components/canvas/editor-toolbar.tsx`
  - New props: `isEditing?`, `isPlainMode?`.
  - Show Edit toggle when (not Option A) OR (Option A and not editing).
- `components/annotation-canvas-modern.tsx`
  - Replaced provider‑presence checks with `isPlainModeActive()` to prevent Yjs seed path in Option A.
- `components/canvas/canvas-context.tsx`
  - Option A: update main panel title from plain adapter’s `getNote(noteId)` (no Yjs).

Empty checks:
- HTML: `''`, `'<p></p>'`, or stripped HTML length `0`.
- ProseMirror JSON: missing `content` or `content.length === 0`.

## Validation

Manual scenarios (Option A):
1) New note → main panel titled with the note’s title, enters edit mode, caret blinking, no Edit button.
2) Non‑empty note → opens read‑only, Edit button visible; clicking Edit enables typing.
3) Rapid note switching → empty documents still flip to edit within ~400ms; caret blinks.
4) Titles preserved from note records (e.g., “AI in Healthcare Research”).

Collaboration/Yjs:
- Behavior unchanged; Edit toggle visible per existing rules; no auto‑edit injected.

## Risks & Mitigations
- First‑load timing race (brand‑new notes): Mitigated by post‑load fallback after provider init.
- Mode detection race: Eliminated by `isPlainModeActive()`.
- Toolbar desync: Avoided by computing visibility from `isPlainMode` + `isEditing`.

## Acceptance Criteria
- ✅ Empty doc in Option A → auto‑edit + blinking caret; Edit toggle hidden.
- ✅ Non‑empty doc in Option A → read‑only; Edit toggle visible.
- ✅ No changes to collaboration/Yjs behavior.
- ✅ Main panel title reflects note record in Option A.

## Deliverables
- This implementation plan and linked runtime changes.
- Optional: add a dated report with screenshots under `reports/` if requested.

## Attempt History (abridged)
- Initial: Auto‑edit from branch metadata → intermittent due to async load.
- Fix: Option A gating + focus reinforcement + post‑load fallback.

## Errors (abridged)
- “can’t access lexical declaration … before initialization” — fixed by hoisting `isPlainMode` above `useState` in `CanvasPanel`.
- Incorrect mode pick from provider presence — fixed by `isPlainModeActive()` checks.

