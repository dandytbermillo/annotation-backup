# Shift+Click Range Selection (Plain Mode) – Fix Notes

## Background
- **Issue:** In plain mode, Shift+clicking collapsible blocks only highlighted the most recently clicked block instead of the full range.
- **Regression source:** The CollapsibleBlock NodeView intercepted modifier clicks, fired duplicate selection commands, and prevented the selection plugin from maintaining its anchor/head state.

## Root Cause
1. The NodeView consumed Shift/Ctrl mouse events (`preventDefault`/`stopPropagation`) and dispatched its own selection transactions. When the plugin fallback could not find an anchor, it defaulted to “single” mode.
2. Subsequent Shift clicks on blocks already inside the range fired another `setCollapsibleBlockRange`, collapsing the range back to a single block.
3. Because the NodeView never surfaced plugin state, the existing CSS could not render multi-block highlights even when the plugin snapshot contained multiple blocks.

## Fix
- Allow the plugin to own selection state while still seeding anchors from the NodeView:
  - Plain header clicks call `selectCollapsibleBlock` so the plugin always has an anchor/head before a Shift gesture.
  - Shift clicks call `setCollapsibleBlockRange(selectionPos)` but skip issuing a new command if the block is already included in a range/multi snapshot.
  - Ctrl/Cmd clicks always call `toggleCollapsibleBlockSelection(selectionPos)` so blocks can be deselected even inside an existing range.
- Listen to the plugin’s `collapsible-selection-change` event and expose `data-collapsible-selected` / `data-collapsible-selection-head` on the NodeView wrapper, letting the existing stylesheet highlight every block in the range.
- Added structured debug logs (`plain_select_block`, `shift_set_range_deferred`, `meta_toggle_selection_deferred`, `NODEVIEW_*`) to validate the flow through the Postgres `debug_logs` table.

## Key Code (excerpt)
```tsx
const handleHeaderMouseDownCapture = (event: React.MouseEvent<HTMLDivElement>) => {
  // …omitted for brevity…
  if (event.shiftKey) {
    const snapshot: any = selectionSnapshot
    const alreadySelected = snapshot?.blocks?.some?.((block: any) => block?.pos === nodePos) ?? false
    if (snapshot && alreadySelected && (snapshot.mode === 'range' || snapshot.mode === 'multi')) {
      event.preventDefault()
      event.stopPropagation()
      shouldEditTitleOnClickRef.current = false
      return
    }

    const commandPos = selectionPos
    if (commandPos != null) {
      event.preventDefault()
      event.stopPropagation()
      editor?.view?.focus()
      editor?.commands.setCollapsibleBlockRange(commandPos)
    }
    shouldEditTitleOnClickRef.current = false
    return
  }

  if (event.metaKey || event.ctrlKey) {
    const commandPos = selectionPos
    if (commandPos != null) {
      event.preventDefault()
      event.stopPropagation()
      editor?.view?.focus()
      editor?.commands.toggleCollapsibleBlockSelection(commandPos)
    }
    shouldEditTitleOnClickRef.current = false
    return
  }

  // Plain click seeds the anchor
  const commandPos = selectionPos ?? nodePos
  if (commandPos != null) {
    editor?.view?.focus()
    editor?.commands.selectCollapsibleBlock(commandPos)
  }
  event.preventDefault()
  event.stopPropagation()
}

useEffect(() => {
  if (!editor) {
    setIsBlockSelected(false)
    setIsSelectionHead(false)
    return
  }

  updateBlockSelectionState()
  const handleSelectionChange = (snapshot: CollapsibleSelectionSnapshot) => {
    updateBlockSelectionState(snapshot)
  }

  editor.on('collapsible-selection-change', handleSelectionChange)
  return () => {
    editor.off('collapsible-selection-change', handleSelectionChange)
  }
}, [editor, updateBlockSelectionState])

return (
  <NodeViewWrapper
    data-collapsible-block
    data-collapsible-selected={isBlockSelected ? 'true' : undefined}
    data-collapsible-selection-head={isSelectionHead ? 'true' : undefined}
    // …
  >
```

## Affected Files
- `lib/extensions/collapsible-block.tsx`

## Verification
- Set `NEXT_PUBLIC_DEBUG_COLLAPSIBLE_SELECTION=true`, reproduce Shift/ Ctrl flows, and confirm `plain_select_block`, `shift_set_range_deferred`, `meta_toggle_selection_deferred`, `CMD_SET_RANGE`, and `CMD_TOGGLE_MULTI` entries appear in `debug_logs`.
- Manually confirmed plain click + Shift+click highlights every block between anchor and head, and Ctrl/Cmd+click toggles individual blocks without collapsing the range.
