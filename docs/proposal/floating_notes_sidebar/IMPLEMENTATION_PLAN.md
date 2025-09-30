# Feature: floating_notes_sidebar

## Summary
Convert the notes sidebar from being fixed on the note layer to a floating, draggable widget that appears on right-click, similar to the PostgreSQL Persistence Monitor widget.

## Requirements
1. Remove notes sidebar from note layer (left side of screen)
2. Create a floating notes widget component
3. Widget should appear when user right-clicks on any canvas
4. Widget should be draggable (not fixed position like monitor)
5. Widget should have same functionality as current notes sidebar
6. Note layer area becomes empty (will be used for settings in future)

## Architecture Changes
- Remove notes sidebar rendering from `annotation-app.tsx`
- Create new `FloatingNotesWidget` component
- Add right-click handler to canvas areas
- Widget positioning: appears at right-click position initially, then draggable
- High z-index to appear above canvases (similar to monitor at z-index 9999)

## Files to Modify
1. `components/annotation-app.tsx` - Remove sidebar from note layer
2. Create `components/floating-notes-widget.tsx` - New floating widget
3. Update canvas components to handle right-click for widget trigger

## Implementation Steps
1. Create backup of files before editing
2. Read and understand current notes-explorer implementation
3. Create new FloatingNotesWidget component
4. Remove sidebar from annotation-app.tsx
5. Add right-click handler
6. Implement draggable behavior
7. Test functionality