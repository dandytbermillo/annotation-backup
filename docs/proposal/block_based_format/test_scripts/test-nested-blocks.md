# Testing Nested Collapsible Blocks

## How to Test Nested Blocks

1. **Insert First Block**:
   - Click Format → Block Based (▦)
   - A collapsible block appears with sample content

2. **Insert Nested Block**:
   - Click inside the expanded block content area
   - Position cursor where you want the nested block
   - Click Format → Block Based (▦) again
   - A new collapsible block will be inserted inside the first one

3. **Expected Behavior**:
   - Each block can be independently collapsed/expanded
   - Each block's title can be edited separately
   - You can nest multiple levels deep
   - All content remains editable

## Example Structure
```
[▼ Parent Section]
    Description of parent...
    • Point 1
    
    [▼ Nested Section]
        Nested content here...
        • Nested point 1
        • Nested point 2
        
        [▼ Deeply Nested Section]
            Even deeper content...
    
    • Point 2
```

## Technical Details
- The `content: 'block+'` schema allows any block content
- `NodeViewContent` component handles nested editing
- Each block maintains its own collapsed state
- No limit on nesting depth (though UX may suffer beyond 3-4 levels)

## Current Status
✅ Nesting is fully supported in the current implementation
✅ No additional changes needed