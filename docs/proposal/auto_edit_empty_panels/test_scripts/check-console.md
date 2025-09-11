# Console Check for Auto-Edit Mode

## Expected Console Output

When creating a new annotation panel, you should see:

1. **CanvasPanel initialization log:**
```
[CanvasPanel] Initializing edit mode: {
  panelId: "branch-xxx",
  isEmpty: true,
  branchContent: "<blockquote>...",
  branchIsEditable: true,
  defaultEditable: true,
  willStartInEditMode: true
}
```

2. **TiptapEditorPlain editable state update:**
```
[TiptapEditorPlain] Updating editable state to: true
```

## To Test:

1. Open browser console (F12)
2. Navigate to http://localhost:3001
3. Select text in the main document
4. Click Note/Explore/Promote to create annotation
5. Check console output
6. Verify the panel opens in edit mode (cursor visible)

## Quick Browser Console Commands:

```javascript
// Check if panel is editable
document.querySelector('.ProseMirror')?.contentEditable

// Check all panels
Array.from(document.querySelectorAll('.ProseMirror')).map((el, i) => ({
  index: i,
  editable: el.contentEditable,
  hasContent: el.textContent.length > 0
}))
```

## If Not Working:

1. Check if `isEmpty` is detected as `true` for new panels
2. Verify `willStartInEditMode` is `true`
3. Check if editor receives correct `isEditable` prop
4. Verify `editor.setEditable()` is being called with `true`