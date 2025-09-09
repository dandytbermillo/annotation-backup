# Option A Tooltip – Cache‑First Branch Preview (No Yjs)

Status: Proposal (patch preview only)

Problem
- Popup shows annotated text or “Loading notes…” instead of actual branch notes in Option A (offline).
- Causes:
  - ID mismatch: UI uses `branch-<uuid>` while Plain provider/DB use raw `<uuid>`.
  - Fragile `noteId` detection (from URL) instead of editor’s `data-note`.
  - Prefers API first even when content exists in local caches, racing with debounced saves.
  - Conflicting tooltip CSS blocks; `.visible` doesn’t always reveal the element.

Proposed Changes (No code applied)
1) Normalize IDs in tooltip logic
   - `uiId = branchId`
   - `dbId = uiId.replace(/^branch-/, '')`
   - Use `dbId` for branch metadata lookups; use `uiId` for document content keys.

2) Prefer local sources first (fast, offline)
   - `noteId` from `role="textbox"[data-note]`.
   - UI store: `window.canvasDataStore.get(uiId)` for title/originalText/content.
   - Provider cache: `plainProvider.getDocument(noteId, uiId)` (HTML or PM JSON).
   - Build preview by stripping HTML or extracting text from PM JSON.

3) API fetch as a late fallback
   - GET `/api/postgres-offline/documents/<noteId>/<uiId>` only if local preview is empty.
   - Avoid branch list matching on wrong id shape.

4) Tooltip CSS
   - Ensure a single canonical `.annotation-tooltip` block where `.visible` sets `visibility: visible` and `pointer-events: auto`.

Files in this proposal
- `option-a-tooltip-cache-first.patch` – unified diff with the above changes for:
  - `components/canvas/annotation-decorations.ts`
  - `components/canvas/tiptap-editor-plain.tsx`

Rollout Notes
- Option A only; no Yjs dependency.
- Zero behavior change to data model; purely UI data resolution and CSS.
- If desired, add a short delayed re-fetch (~1s) after creation to cover debounced saves.

