# Quick Reference: Title Sharing Bug Fix

## Problem
Editing any panel's title caused ALL panels to show the same title (runtime only, DB was correct).

## Root Cause
Global `'note-renamed'` event was broadcast by ALL panels and received by ALL panels, causing every panel to update its title with the event payload.

## Solution
Added two guards in `components/canvas/canvas-panel.tsx`:

### Guard 1: Event Listener (Line 162)
```typescript
// Before:
if (renamedNoteId === noteId) {

// After:
if (panelId === 'main' && renamedNoteId === noteId) {
```

### Guard 2: Event Emitter (Line 950)
```typescript
// Before:
window.dispatchEvent(new CustomEvent('note-renamed', {
  detail: { noteId, newTitle: result.title }
}))

// After:
if (panelId === 'main') {
  window.dispatchEvent(new CustomEvent('note-renamed', {
    detail: { noteId, newTitle: result.title }
  }))
}
```

## Result
- ✅ Branch panel renames only affect that branch
- ✅ Main panel renames only affect main panel
- ✅ Event still broadcast for PopupOverlay sync (main panel only)
- ✅ Performance improved: O(N) → O(1) updates per rename

## Files Changed
- `components/canvas/canvas-panel.tsx` (2 lines modified)

## Verification
1. Rename branch → only that branch updates
2. Rename main → only main updates
3. Reload → all titles persist correctly
