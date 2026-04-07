# Show More Button Spec

**Date:** 2026-01-19  
**Status:** Draft  
**Scope:** Chat panel doc responses only  
**Related:** `general-doc-retrieval-routing-plan.md`, `cursor-style-doc-retrieval-plan.md`, `chat-show-more-button-plan.md`

---

## Goal

Provide a clear “Show more” affordance for doc‑based answers so users can open
the full doc section (Cursor‑style) without typing a follow‑up.

---

## Non‑Goals

- No changes to retrieval ranking, routing logic, or HS1/HS2.
- No actions or general LLM responses get the button.
- No notes/files corpus in this phase.

---

## Eligibility (When to Show)

Show **Show more** only when all are true:

- `doc_status` is `found` OR `weak` after user confirmation.
- A stable `docSlug` is known.
- A source `chunkId` is known **or** a safe fallback exists (open top of doc).

Do **not** show when:

- `doc_status` is `ambiguous` (pills shown instead).
- `doc_status` is `no_match`, or route is `action`/`llm`.
- There is an active clarification/correction state.

---

## Behavior

### Primary Action (Preferred)

Click **Show more**:

1) Open the docs side panel (or full‑screen doc view) for `docSlug`.
2) Scroll to `chunkId` (if present).
3) Highlight the chunk (if supported).

### Fallback (If Panel Unavailable)

- Open the doc at top/overview using `docSlug`.
- If no doc panel exists at all, optionally trigger HS2 “tell me more” with
  `excludeChunkIds` to append the next chunk.

---

## Data Contract

The chat message that renders the button must include:

- `docSlug`
- `chunkId` (optional but preferred)
- `headerPath` (optional, for breadcrumb display)

If `chunkId` is missing, use `docSlug` + first chunk as fallback.

---

## UI Placement

- Place the button directly under the assistant’s response bubble.
- Only one **Show more** per response.
- Do not attach to user messages or error messages.

Label: **Show more**

Optional sublabel (tooltip): “Open the full doc section”

---

## State + Routing Rules

- Clicking **Show more** does **not** alter `lastDocSlug` or follow‑up state.
- Only modify state if a new chunk is fetched (fallback path).
- Do not show **Show more** during active disambiguation.

---

## Telemetry (Recommended)

Log minimal events for tuning:

- `show_more_shown`  
  `docSlug`, `chunkId`, `doc_status`
- `show_more_clicked`  
  `docSlug`, `chunkId`, `action: open_panel|open_doc_top|expand_next_chunk`
- `show_more_failed` (optional)  
  `reason: no_doc|no_chunk|panel_unavailable`

---

## Acceptance Tests

1) **Definitional query**
   - Input: “what is workspace”
   - Output: short answer + **Show more**
   - Click: opens `concepts/workspace` at the overview chunk

2) **Ambiguous term**
   - Input: “home”
   - Output: pills only (no button)
   - After pill selection: **Show more** appears

3) **Action route**
   - Input: “open notes”
   - Output: action response only (no button)

4) **Follow‑up**
   - Input: “what is workspace” → “tell me more”
   - Output: HS2 chunk + **Show more** still available

---

## Open Questions

- Should the button appear on every doc response, or only when a snippet was
  truncated or HS3‑formatted?
- Should “Show more” be hidden if the docs panel is already open?
