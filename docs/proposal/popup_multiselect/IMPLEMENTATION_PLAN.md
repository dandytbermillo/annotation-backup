# Feature: Popup Multi-Select (popup_multiselect)

**Feature Slug:** `popup_multiselect`

**Created:** 2025-10-03

**Status:** Planning → Implementation

---

## Overview

Add multi-select functionality to the popup overlay component (`components/canvas/popup-overlay.tsx`), allowing users to select multiple items (notes/folders) within a popup using keyboard modifiers (Ctrl/Cmd, Shift) similar to the existing implementation in `notes-explorer-phase1.tsx`.

---

## Goals

1. **Per-Popup Multi-Select** - Each popup maintains independent selection state
2. **Keyboard Modifiers** - Support Ctrl/Cmd+Click (toggle), Shift+Click (range), Regular Click (single)
3. **Visual Feedback** - Highlight selected items distinctly from preview hover
4. **Actions Bar** - Display actions (Delete, Clear) when items are selected
5. **Consistent UX** - Match behavior from notes-explorer-phase1.tsx

---

## Scope

### In Scope
- ✅ Selection state management (per popup)
- ✅ Click handlers with modifier detection
- ✅ Visual selection highlighting
- ✅ Multi-select actions bar (Delete, Clear buttons)
- ✅ Range selection (Shift+Click within same popup)
- ✅ Selection cleared on popup close

### Out of Scope
- ❌ Cross-popup selection (defer to future phase)
- ❌ Drag multiple items (separate feature)
- ❌ Move/organize operations (separate feature)
- ❌ Keyboard navigation (arrow keys) (defer)

---

## Technical Approach

### 1. State Management (PopupOverlay)

- Add `popupSelections` (`Map<popupId, Set<childId>>`) and `lastSelectedIds` (`Map<popupId, childId>`)
  state to `PopupOverlay`. Always clone the outer `Map` **and** the specific inner
  `Set` when mutating so React registers updates.
- Add a `useEffect` that watches the `popups` prop and deletes any selection entries
  whose popup IDs are no longer rendered (covers close, persistence reload, or parent
  resets).

### 2. Selection Handler

- Extend `renderPopupChildRow` so the row wrapper receives an `onClick` handler that
  stops propagation and dispatches selection logic.
- `Ctrl/Cmd+Click` toggles the target id in the cloned `Set`.
- `Shift+Click` builds a range using the popup’s current `children` array (available
  where we compose `renderChildRow`). Store the most recently selected id per popup in
  `lastSelectedIds`.
- Default click clears previous selections and selects only the clicked item.
- Apply the handler for both the inline map branch and the `VirtualList` branch so
  large popups behave identically.

### 3. Visual Feedback

- Derive `isSelected` before rendering the row. Update the class logic so selection
  takes precedence over the existing “active preview” styling while keeping preview
  cues intact. Example order: selected → active preview → default.
- Ensure icons remain visible (e.g., keep the hover opacity rule but force full
  opacity when selected for readability).

### 4. Actions Bar & Parent Callback

- When a popup has selections, render a footer inside the popup card (above the
  existing “Level • N items” footer) summarising the count and exposing two buttons:
  `Clear` (local only) and `Delete`.
- `Clear` wipes the popup’s entry from `popupSelections` and `lastSelectedIds`.
- `Delete` invokes a new optional prop `onDeleteSelected?.(popupId, selectedIds)` so
  the parent (`annotation-app.tsx`) can run real deletes against the API and refresh
  tree data. Provide a no-op default when the callback is absent so existing callers
  keep working.

### 5. Cleanup Hooks

- Keep the existing `onClosePopup` behaviour, but call the same cleanup helper used by
  the `popups` watcher so closing a popup removes any lingering selection state.
- If the Delete callback succeeds, have the parent trigger its existing tree refresh
  path; `PopupOverlay` will observe the new `popups` array and clear selections
  automatically.

---

## Files to Modify

### Primary Changes
- `components/canvas/popup-overlay.tsx` - Add multi-select logic

### No New Files
- All changes contained within existing popup-overlay.tsx

---

## Testing Strategy

### Manual Testing
1. Open a popup overlay (click folder eye icon).
2. Ctrl/Cmd+Click multiple notes → verify toggle selection without preview regressions.
3. Shift+Click within the same popup → verify continuous range selection.
4. Verify selected rows show the new highlight while preview hover still works.
5. Use the Delete button → confirm backend delete fires (or is skipped when callback absent) and popups refresh.
6. Use Clear → verify selection state resets without API calls.
7. Close the popup → ensure any selection badges disappear when reopening.

### Type Check
```bash
npm run type-check
```

### Integration
- Verify no conflicts with existing preview/hover behavior
- Verify no conflicts with drag/pan behavior
- Verify no performance degradation with large lists

---

## Acceptance Criteria

- [ ] Ctrl/Cmd+Click toggles individual item selection
- [ ] Shift+Click selects range within popup
- [ ] Regular click selects single item (clears others)
- [ ] Selected items show visual highlight (bg-indigo-500)
- [ ] Actions bar appears when items selected
- [ ] Delete button removes selected items with confirmation
- [ ] Clear button deselects all items
- [ ] Selection cleared when popup closes
- [ ] Type-check passes
- [ ] No console errors

---

## Risks & Considerations

1. **Event Bubbling** - Must prevent selection clicks from triggering preview/folder actions
2. **Performance** - Selection state updates should not cause re-renders of other popups
3. **UX Confusion** - Must clearly distinguish selection highlight from preview highlight
4. **Popup Height** - Actions bar adds height; ensure popups don't overflow

---

## Implementation Steps

1. Create a safety backup for `components/canvas/popup-overlay.tsx`.
2. Add selection state + cleanup effect to `PopupOverlay`.
3. Implement the row click handler (toggle, range, single) and wire it in both render paths.
4. Update row styling to reflect selection precedence.
5. Render the selection footer and expose the `onDeleteSelected` prop.
6. Hook `onDeleteSelected` up inside `annotation-app.tsx` (API calls + refresh) and pass it down.
7. Ensure popup close/delete paths clear selection state.
8. Test all interaction modes and run `npm run type-check`.
9. Capture results in an implementation report.

---

## References

- **Source Implementation:** `components/notes-explorer-phase1.tsx:149-151` (state), `2692-2811` (handlers)
- **Current File:** `components/canvas/popup-overlay.tsx`
- **CLAUDE.md Conventions:** Feature workspace structure, backups, testing requirements

---

## Next Steps After Implementation

1. Add drag multiple items support (separate feature)
2. Add Move/organize operations (separate feature)
3. Consider keyboard navigation (arrow keys + Space/Enter)
