# Block-Based Format Feature Implementation Plan

**Feature Slug:** block_based_format  
**Date:** 2025-09-22

## Overview
Implement a "Block Based" button in TipTap editor that inserts a ready-made Notion-like collapsible block with sample content.

## Requirements
1. **Toolbar Button**: Add "Block Based" button to editor toolbar
2. **Collapsible Block**: Insert a ready-made collapsible block (like Notion)
3. **Pre-filled Content**: Block contains hierarchical sample content
4. **Fully Editable**: All text in the block is editable
5. **Collapsible Behavior**: Click arrow to expand/collapse

## Implementation Approach

### 1. Create Custom TipTap Extension
- Create `CollapsibleBlock` node extension
- Handle collapsed/expanded state
- Render arrow icon and content

### 2. Add Toolbar Button
- Add button to `editor-toolbar.tsx`
- Execute command to insert block template

### 3. Template Structure
```
[▼ Section Title]
    Description paragraph here...
    • Main point 1
    • Main point 2
      • Sub-point 2.1
      • Sub-point 2.2
    • Main point 3
      • Sub-point 3.1
```

## Files to Modify/Create
- `/lib/extensions/collapsible-block.ts` - New TipTap extension
- `/components/canvas/editor-toolbar.tsx` - Add button
- `/components/canvas/tiptap-editor-plain.tsx` - Register extension

## Testing Plan
1. Test button insertion in dev mode
2. Verify collapsible behavior
3. Ensure all text is editable
4. Check persistence after save/reload

## Status
- [ ] Extension created
- [ ] Toolbar button added
- [ ] Template implemented
- [ ] Testing complete
- [ ] Validation gates passed