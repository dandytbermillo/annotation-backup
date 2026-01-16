# Chat Show More Button Plan

**Date:** 2026-01-15  
**Status:** Draft  
**Scope:** Chat panel doc responses only  
**Related:** `general-doc-retrieval-routing-plan.md` (v5), `definitional-query-fix-proposal.md`

---

## Goal

Provide a simple, human-friendly "Show more" affordance after doc-based answers so
users can open the full documentation section without typing a follow-up.

---

## Non-Goals

- No new retrieval mode or ranking logic.
- No changes to action routes or general LLM chat.
- No notes/files integration in this phase.

---

## Eligibility (When to Show the Button)

Show **Show more** only when all are true:

- `doc_status` is `found`, or `weak` after the user confirms the doc.
- `docSlug` is known (and stable).
- A source chunk is known (`chunkId`) or a doc panel can open from the slug.

Do **not** show the button when:

- `doc_status` is `ambiguous` (pills shown instead).
- `doc_status` is `no_match` or route is `llm` or `action`.
- The system is in correction/clarification mode.

---

## Behavior

### Primary Action (Preferred)

Click **Show more** opens the docs panel anchored to the current doc:

- Open the doc panel with `docSlug`.
- Scroll to the source chunk (by `chunkId`).
- Highlight the chunk if supported.

### Fallback Action (If Panel Not Available)

If the docs panel cannot open:

- Call the same HS2 flow as "tell me more".
- Use `excludeChunkIds` to avoid repeats.
- Append the next chunk in chat.

---

## State and Routing

- Initial doc response sets:
  - `lastDocSlug`
  - `lastChunkIdsShown`
- **Do not** set `lastDocSlug` for `weak` results until the user confirms.
- **Show more** should not change routing state unless it fetches a new chunk.

---

## Telemetry (Recommended)

Add a lightweight event so the UX can be tuned:

- `show_more_shown`
  - `docSlug`, `chunkId`, `doc_status`
- `show_more_clicked`
  - `docSlug`, `chunkId`, `action: open_panel | expand_next_chunk`
- `show_more_failed` (optional)
  - `reason: no_doc | no_chunk | panel_unavailable`

---

## UI Copy

Button label: **Show more**

Optional tooltip: "Open the full doc section"

---

## Acceptance Tests

1) **Definitional query**
   - Input: "what is workspace"
   - Output: short summary + **Show more**
   - Click: opens `concepts/workspace` section

2) **Ambiguous term**
   - Input: "home"
   - Output: pills only (no **Show more**)
   - After pill selection: **Show more** appears

3) **Action route**
   - Input: "open notes"
   - Output: action response only (no **Show more**)

4) **Follow-up**
   - Input: "what is workspace" → "tell me more"
   - Output: HS2 chunk + **Show more** still available

---

## Open Questions

- Should **Show more** be visible on every doc response, or only when the
  snippet is truncated?
- Should the button be shown alongside pills or only after a doc is confirmed?

