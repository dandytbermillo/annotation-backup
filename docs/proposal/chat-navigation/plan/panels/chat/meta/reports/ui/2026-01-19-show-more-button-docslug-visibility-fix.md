# Show More Button DocSlug Visibility Fix

**Date:** 2026-01-19
**Feature:** Chat Navigation - Show More Button
**Type:** Bug Fix / UX Improvement

---

## Summary

Fixed the "Show more" button visibility logic to only hide when the ViewPanel is displaying the **same document** as the message, rather than hiding whenever the ViewPanel is open with any content.

---

## Problem Statement

### Observed Behavior
1. User asks a doc query (e.g., "what is note actions")
2. User clicks "Show more" → ViewPanel opens with "Note Actions" doc
3. User asks another doc query (e.g., "what is workspace")
4. Response appears with workspace explanation
5. **Bug:** "Show more" button does NOT appear on the new workspace response
6. ViewPanel still shows old "Note Actions" content

### Root Cause
The original implementation used a simple boolean `isViewPanelOpen` to hide the "Show more" button:

```typescript
// Original condition (too broad)
!isViewPanelOpen && // Hide when ViewPanel is already open
```

This hid the button for ALL messages whenever the ViewPanel was open, regardless of what content the ViewPanel was displaying.

### Expected Behavior
The "Show more" button should only be hidden for a message if the ViewPanel is already displaying **that specific document**. Other messages with different docs should still show their "Show more" buttons.

---

## Solution

Track which `docSlug` is currently displayed in the ViewPanel and compare it per-message.

### Key Changes

#### 1. Added `docSlug` to ViewPanelContent Type

**File:** `lib/chat/view-panel-types.ts`

```typescript
export interface ViewPanelContent {
  type: ViewContentType
  title: string
  subtitle?: string
  // ... other fields

  // Metadata
  sourceIntent?: string
  sourceMessageId?: string
  docSlug?: string       // NEW: Tracks which doc is displayed
}
```

#### 2. Set docSlug When Opening Panel via "Show more"

**File:** `components/chat/chat-navigation-panel.tsx` (handleShowMore function)

```typescript
const viewContent: ViewPanelContent = {
  type: ViewContentType.TEXT,
  title: result.title || docSlug,
  subtitle: result.header_path || result.category,
  content: result.snippet || 'No content available',
  docSlug: docSlug, // NEW: Track which doc is displayed
}
```

#### 3. Extract viewPanelDocSlug from State

**File:** `components/chat/chat-navigation-panel.tsx`

```typescript
const { state: viewPanelState } = useViewPanel()
const isViewPanelOpen = viewPanelState.isOpen
// NEW: Track which doc is currently displayed
const viewPanelDocSlug = viewPanelState.isOpen
  ? viewPanelState.content?.docSlug
  : undefined
```

#### 4. Updated ChatMessageList Props

**File:** `components/chat/ChatMessageList.tsx`

```typescript
// Before
export interface ChatMessageListProps {
  // ...
  isViewPanelOpen?: boolean
}

// After
export interface ChatMessageListProps {
  // ...
  viewPanelDocSlug?: string  // More specific: which doc is shown
}
```

#### 5. Updated ShowMoreButton Visibility Condition

**File:** `components/chat/ChatMessageList.tsx`

```typescript
// Before (too broad)
{message.role === 'assistant' &&
  !message.isError &&
  message.docSlug &&
  !message.options?.length &&
  !isViewPanelOpen &&  // Hides for ANY open panel
  onShowMore && (
    <ShowMoreButton ... />
  )}

// After (precise)
{message.role === 'assistant' &&
  !message.isError &&
  message.docSlug &&
  !message.options?.length &&
  viewPanelDocSlug !== message.docSlug &&  // Hides only if showing THIS doc
  onShowMore && (
    <ShowMoreButton ... />
  )}
```

---

## Edge Cases Handled

| Scenario | viewPanelDocSlug | message.docSlug | Condition Result | Button Visible |
|----------|------------------|-----------------|------------------|----------------|
| Panel closed | `undefined` | `'workspace'` | `true` | Yes |
| Panel shows list (no doc) | `undefined` | `'workspace'` | `true` | Yes |
| Panel shows same doc | `'workspace'` | `'workspace'` | `false` | No (hidden) |
| Panel shows different doc | `'note-actions'` | `'workspace'` | `true` | Yes |
| Message has no docSlug | N/A | `undefined` | N/A | No (earlier condition fails) |

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/view-panel-types.ts` | Added `docSlug?: string` to `ViewPanelContent` interface |
| `components/chat/chat-navigation-panel.tsx` | Added `docSlug` to viewContent in handleShowMore; Added `viewPanelDocSlug` derived state; Updated prop passed to ChatMessageList |
| `components/chat/ChatMessageList.tsx` | Changed prop from `isViewPanelOpen?: boolean` to `viewPanelDocSlug?: string`; Updated ShowMoreButton condition |

---

## Validation

### Type Check
```bash
npm run type-check
# Result: Pass (no errors)
```

### Manual Testing
1. Open chat panel
2. Ask "what is note actions" → Response with "Show more" button
3. Click "Show more" → ViewPanel opens with Note Actions doc
4. "Show more" button on Note Actions message disappears (correct)
5. Ask "what is workspace" → Response with "Show more" button appears (fixed)
6. Click "Show more" on workspace → ViewPanel updates to Workspace doc
7. "Show more" on workspace message disappears, Note Actions button reappears

---

## Design Considerations

### Why docSlug instead of messageId?
- **Semantic correctness:** Same doc from different messages should be treated as the same content
- **User expectation:** If ViewPanel shows "Workspace", clicking "Show more" on another workspace message shouldn't re-open the same content

### Why optional field?
- **Backwards compatibility:** Other ViewPanel content types (lists, Quick Links, etc.) don't have a docSlug
- **Graceful handling:** `undefined !== message.docSlug` correctly shows the button for non-doc panel content

### Why prop drilling instead of Context?
- **Simplicity:** Only one level of prop passing (parent → child)
- **Explicitness:** Clear data flow, easy to trace
- **Performance:** No additional context subscription overhead

---

## Related Specifications

- `docs/proposal/chat-navigation/plan/panels/chat/show-more-button-spec.md`
- `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/ui/` (this report)

---

## Future Considerations

1. **Generic content tracking:** If other content types need similar tracking (noteId, fileId), consider a more generic `contentId` field
2. **Show more once per doc:** Could add logic to only show "Show more" for the most recent message of each doc
3. **Panel history:** Could track previously viewed docs to offer quick switching

---

## Conclusion

This fix provides precise control over "Show more" button visibility by tracking which specific document is displayed in the ViewPanel. The implementation is minimal, type-safe, handles all edge cases correctly, and follows existing patterns in the codebase.
