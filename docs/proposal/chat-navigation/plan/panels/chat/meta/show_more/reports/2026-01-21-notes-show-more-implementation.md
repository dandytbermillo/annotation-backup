# Implementation Report: Notes "Show More" Button

**Date:** 2026-01-21
**Feature:** Extend "Show more" button to notes corpus
**Status:** Implemented and Verified

---

## Summary

Extended the existing "Show more" button functionality (previously docs-only) to support notes results. Users can now click "Show more" on any notes response to open the full note content in the ViewPanel, mirroring the docs behavior.

---

## Design Decisions

1. **Add `itemId` field to ChatMessage** (alongside `docSlug`) - clean separation between docs and notes
2. **Use ViewContentType.TEXT** for notes - plain text from retrieval matches docs pattern
3. **Keep docs flow untouched** - Docs continue using `/api/docs/retrieve`
4. **Notes use `/api/retrieve`** with `corpus: 'notes'` and `fullContent: true`
5. **Backward compatible props** - `itemName` is optional (nice-to-have for panel title)

---

## Files Modified

### 1. `lib/chat/chat-navigation-context.tsx`
**Change:** Extended `ChatMessage` interface with notes metadata

```typescript
// NEW: Notes retrieval metadata for "Show more" button
itemId?: string
itemName?: string
corpus?: 'docs' | 'notes'
```

### 2. `lib/chat/cross-corpus-handler.ts`
**Change:** Populated notes metadata in 3 locations

- **Lines ~167-175**: Explicit notes intent result
- **Lines ~332-344**: Single corpus notes decision
- **Lines ~439-457**: Pill selection (conditional based on corpus)

Each location now includes:
```typescript
itemId: notesResult.topResourceId,
itemName: notesResult.topTitle,
corpus: 'notes',
```

### 3. `lib/chat/chat-routing.ts`
**Change:** Populated notes metadata in notes follow-up handler (~lines 682-692)

```typescript
itemId: docRetrievalState.lastItemId,
itemName: topResult.title,
chunkId: topResult.chunkId,
corpus: 'notes',
```

### 4. `components/chat/ShowMoreButton.tsx`
**Change:** Extended props for both docs and notes support

```typescript
interface ShowMoreButtonProps {
  docSlug?: string       // existing - for docs
  itemId?: string        // NEW - for notes
  itemName?: string      // NEW (optional) - nicer panel title
  chunkId?: string
  headerPath?: string
  onClick: (docSlug?: string, itemId?: string, chunkId?: string) => void
  disabled?: boolean
}
```

- Button renders if either `docSlug` or `itemId` is present
- Returns `null` if neither provided

### 5. `components/chat/ChatMessageList.tsx`
**Change:** Updated rendering condition and props

- Added `viewPanelItemId` prop for visibility tracking
- Changed condition from `message.docSlug &&` to `(message.docSlug || message.itemId) &&`
- Passes all new props to ShowMoreButton

### 6. `components/chat/chat-navigation-panel.tsx`
**Change:** Updated `handleShowMore` handler for unified flow

```typescript
const handleShowMore = useCallback(
  (docSlug?: string, itemId?: string, chunkId?: string) => {
    if (docSlug) {
      // EXISTING: Docs flow - use /api/docs/retrieve
    } else if (itemId) {
      // NEW: Notes flow - use /api/retrieve
      const response = await fetch('/api/retrieve', {
        body: JSON.stringify({ corpus: 'notes', resourceId: itemId, fullContent: true }),
      })
    }
  }
)
```

- Set `itemId` on ViewPanelContent when opening notes (line 1422)
- Extract `viewPanelItemId` from `viewPanelState.content?.itemId` (line 2934)
- Passed `viewPanelItemId` to ChatMessageList for button visibility tracking

### 7. `lib/chat/view-panel-types.ts`
**Change:** Extended `ViewPanelContent` interface for notes tracking (Phase 6)

```typescript
export interface ViewPanelContent {
  // ... existing fields ...
  docSlug?: string       // For doc content - tracks which doc is displayed
  itemId?: string        // NEW: For note content - tracks which note is displayed
}
```

---

## Additional Fixes (Same Session)

### Fix 1: User Message Text Cutoff
**File:** `components/chat/ChatMessageList.tsx`

**Problem:** User messages were being clipped at the edge instead of wrapping.

**Root Cause:** Parent flex container lacked `w-full`, making `max-w-[90%]` ineffective.

**Solution:**
- Added `w-full` to parent container (line 126)
- Added explicit inline styles for word wrapping (lines 147-149)

### Fix 2: excludeChunkIds Parsing Bug
**File:** `lib/docs/items-retrieval.ts`

**Problem:** Notes follow-up returned same content repeatedly.

**Root Cause:** Chunk ID parsing used wrong format (`itemId-` instead of `itemId#chunk-`).

**Solution:**
```typescript
// Before (incorrect):
.filter(id => id.startsWith(itemId + '-'))
.map(id => parseInt(id.split('-')[1], 10))

// After (correct):
.filter(id => id.startsWith(itemId + '#chunk-'))
.map(id => parseInt(id.split('#chunk-')[1], 10))
```

---

## Verification

### Type-Check
```bash
$ npm run type-check
> tsc --noEmit -p tsconfig.type-check.json
# No errors
```

### Manual Testing

| Test Case | Result |
|-----------|--------|
| Notes explicit query shows "Show more" button | ✅ |
| Cross-corpus pills → Notes selection shows button | ✅ |
| Notes follow-up shows button on each result | ✅ |
| Button click opens ViewPanel with full note content | ✅ |
| ViewPanel displays complete note (all chunks combined) | ✅ |
| Docs "Show more" flow unchanged | ✅ |
| User message text wraps correctly | ✅ |
| Notes "tell me more" shows different content each time | ✅ |
| "Show more" hides when ViewPanel displays same note (Phase 6) | ✅ |

### Telemetry Verified

```
CrossCorpus → pill_selected → Selected notes: New Note - Nov 30, 3:06 PM
ChatNavigation → show_more_clicked → itemId present
```

---

## Known Limitations

1. **Typo handling in cross-corpus:** Typos like "workaspce" bypass cross-corpus pills because keyword retrieval doesn't fuzzy-match. This is expected behavior - downstream doc routing handles it correctly.

---

## API Contracts Used

### `/api/retrieve` (Notes)
```typescript
POST /api/retrieve
{
  corpus: 'notes',
  resourceId: itemId,
  fullContent: true
}
```

Returns:
```typescript
{
  success: true,
  results: [{
    title: string,
    snippet: string,  // Full content when fullContent=true
    path: string,
    chunkId: string,
    ...
  }]
}
```

### `/api/docs/retrieve` (Docs - unchanged)
```typescript
POST /api/docs/retrieve
{
  docSlug: string,
  fullContent: true
}
```

---

## Next Steps (Optional)

1. **Fuzzy matching enhancement:** Add typo normalization to cross-corpus retrieval
2. **Progress indicator:** Show "Chunk X of Y" for long notes with many chunks

---

## Phase 6 Completion (2026-01-21)

**viewPanelItemId tracking** is now fully implemented:

### Files Modified
- `lib/chat/view-panel-types.ts` - Added `itemId?: string` to ViewPanelContent
- `components/chat/chat-navigation-panel.tsx`:
  - Line 1421: Set `itemId` when creating ViewPanelContent for notes
  - Line 2934: Extract `viewPanelItemId` from `viewPanelState.content?.itemId`

### Behavior
When a note is displayed in ViewPanel via "Show more", the button now hides for that specific note (same as docs behavior).
