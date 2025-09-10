# Relevant Code Files for Safari Cursor Research

## Core Files to Include

### 1. Main Editor Component
**File**: `components/canvas/tiptap-editor-plain.tsx`
- Contains the editor setup and plugin registration
- Shows how isEditable prop is handled
- Has the CSS styles applied to annotations

### 2. Current Safari Fixes (Potentially Problematic)
**File**: `components/canvas/safari-proven-fix.ts`
- Applies inline-block and other CSS dynamically
- May be causing the click issue

**File**: `components/canvas/safari-manual-cursor-fix.ts`
- Handles mousedown events on annotations
- Should be disabled in edit mode but might not be working

**File**: `components/canvas/browser-specific-cursor-fix.ts`
- Contains browser detection and cursor handling
- May have conflicting event handlers

### 3. Read-Only Guard
**File**: `components/canvas/read-only-guard.ts`
- Controls edit permissions
- Might be interfering with clicks

### 4. CSS Styles
**File**: `app/globals.css`
- Contains annotation styles
- Look for `.annotation` class

### 5. Other Potentially Relevant Files
- `components/canvas/annotation-decorations.ts`
- `components/canvas/annotation-start-boundary-fix.ts`
- `components/canvas/clear-stored-marks-plugin.ts`

## Key Code Sections to Highlight

### The Problem Area (tiptap-editor-plain.tsx, lines 318-340)
```css
.tiptap-editor .annotation {
  background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%);
  padding: 1px 2px;
  border-radius: 2px;
  cursor: text !important;
  position: relative;
  transition: background 0.2s ease;
  font-weight: 600;
  border-bottom: 1px solid transparent;
  
  /* PROVEN FIXES from research document */
  display: inline-block !important;
  margin-right: 1px;
  vertical-align: middle;
  line-height: 1;
  
  /* Safari-specific fixes */
  -webkit-user-modify: read-write-plaintext-only;
  -webkit-user-select: text;
  user-select: text;
  caret-color: auto;
}
```

### The Edit Mode Logic (tiptap-editor-plain.tsx, line 179)
```typescript
editable: true, // ALWAYS editable to allow cursor placement
```

### The Issue Summary
In Safari/Electron, when in EDIT MODE:
- Annotated text CANNOT be clicked to place cursor ❌
- Annotated text CAN be edited when cursor moved via arrow keys ✅
- Normal text works fine with clicks ✅

This suggests the annotations ARE editable, but something is blocking click events specifically on annotation spans when in edit mode.

## Files to Package

Create a ZIP with:
```
safari-cursor-research/
├── DEEP_RESEARCH_PLAN.md
├── RELEVANT_CODE_FILES.md
├── code/
│   ├── tiptap-editor-plain.tsx
│   ├── safari-proven-fix.ts
│   ├── safari-manual-cursor-fix.ts
│   ├── browser-specific-cursor-fix.ts
│   ├── read-only-guard.ts
│   └── globals.css
└── previous-research/
    ├── Investigating_Safari_Caret_Issues.pdf
    └── Refining_Inline_Annotation_Behavior.pdf
```

## Critical Information for Researcher

1. **The paradox**: Arrow keys work but clicks don't - this means:
   - The text IS editable (contenteditable is working)
   - The cursor CAN be placed in annotations (via keyboard)
   - Something is specifically blocking MOUSE CLICKS

2. **Browser specific**: Works in Firefox, broken in Safari/Electron

3. **Mode specific**: Only broken in EDIT mode, works in READ-ONLY mode

4. **What we've tried**:
   - Multiple CSS approaches (inline-block, webkit-user-modify)
   - Various event handling strategies
   - Different plugin configurations
   - All based on research that said inline-block SHOULD fix it

5. **Key observation**: The research said inline-block fixes cursor placement, but in our case it might be CAUSING the click issue in edit mode.