# Notes "Show more" Extension

**Status:** ✅ IMPLEMENTED (2026-01-21)
**Implementation Report:** `reports/2026-01-21-notes-show-more-implementation.md`

---

This extension gives notes results the same "Show more" affordance as docs.

Anti‑pattern check: Not applicable. This change touches chat UI + note viewing only; no isolation
context/provider changes. Provider/consumer contracts unchanged.

  Goal

  - Give notes results the same “Show more” affordance as docs: click to open full note content in
    the existing drawer/view panel.

  Non‑Goals

  - No new retrieval logic; no changes to ranking/HS1‑HS3.
  - No new editor features; just opening existing note content.

  UI Behavior

  - For any notes result message (cross‑corpus pill selection or direct notes intent), display a
    Show more button beneath the message.
  - On click: open the existing drawer/view panel to the full note.
  - If the note is already open in the drawer, focus it (no duplicate panel).
  - Optional: add a Show all button that opens the drawer to the full note and scrolls to the
    matched section (if chunkId is present).

  Data/State Needed

  - Message metadata must carry corpus: 'notes', itemId, and workspaceId (already available from
    notes retrieval).
  - Optional: chunkId for potential highlight/scroll in the drawer; ok to ignore initially.

  Interaction Flow

  1. User selects a Notes pill → notes snippet displayed → Show more button visible.
  2. User clicks Show more → drawer opens to full note content.
  3. Subsequent “tell me more” uses follow‑up retrieval; Show more remains on each note snippet.

  Error/Fallback

  - If the note is missing or inaccessible: show “I couldn’t open that note right now.” Keep the
    chat response intact.

  Telemetry (Optional but useful)

  - show_more_clicked with fields: corpus, itemId, workspaceId, messageId.

  Acceptance Tests

  - [x] Notes selection shows Show more.
  - [x] Clicking Show more opens the drawer to the correct note.
  - [x] Docs behavior unchanged (docs still use existing show‑more flow).
  - [x] If note deleted, show friendly error, no crash.

---

## Implementation Summary (2026-01-21)

### Files Modified
- `lib/chat/chat-navigation-context.tsx` - Added `itemId`, `itemName`, `corpus` to ChatMessage
- `lib/chat/cross-corpus-handler.ts` - Populated notes metadata (3 locations)
- `lib/chat/chat-routing.ts` - Populated notes metadata in follow-up handler
- `components/chat/ShowMoreButton.tsx` - Extended props for both corpora
- `components/chat/ChatMessageList.tsx` - Updated rendering condition
- `components/chat/chat-navigation-panel.tsx` - Updated handleShowMore handler

### API Used
- Notes: `POST /api/retrieve` with `{ corpus: 'notes', resourceId, fullContent: true }`
- Docs: `POST /api/docs/retrieve` (unchanged)

### Known Limitations
- Typos bypass cross-corpus pills (expected - downstream handles correctly)

### Phase 6 Completed
- `viewPanelItemId` tracking is now fully implemented
- "Show more" button hides when ViewPanel displays the same note
