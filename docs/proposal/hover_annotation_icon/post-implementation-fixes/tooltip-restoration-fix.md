# Tooltip Restoration Fix - Complete Journey

## Issue Timeline

### Initial Problem
User reported that tooltips were not showing the original design with proper structure and auto-scrollbar functionality.

### Discovery Process

1. **First Attempts** - Created new tooltip implementations that didn't match original
   - Custom tooltip in annotation-decorations-fixed.ts
   - Missing proper CSS classes and structure
   - User feedback: "this is not the original tooltip"

2. **Finding the Original** - Located the working tooltip in backup repository
   - Found at: https://github.com/dandytbermillo/annotation-backup.git
   - Original in: components/canvas/annotation-decorations.ts
   - Key discovery: Complex API flow with branch metadata fetch first

3. **Understanding the Flow**
   ```
   1. Fetch branch metadata: /api/postgres-offline/branches?noteId={noteId}
   2. Find branch by ID (raw UUID without 'branch-' prefix)
   3. Fetch document content: /api/postgres-offline/documents/{noteId}/{branchId}
   4. Extract text from HTML or ProseMirror JSON
   5. Display in tooltip with auto-scrollbar
   ```

## Solution Architecture

### 1. Extracted Shared Tooltip Module (annotation-tooltip.ts)
- Centralized tooltip logic for plain mode
- Preserves functionality:
  - ID normalization (UI format vs DB format)
  - Two-step API fetch process
  - Text extraction from both HTML and ProseMirror JSON
  - Auto-scrollbar detection and activation
  - Proper error handling for edge cases

### 2. Connected to Square Hover Icon (plain mode)
- `AnnotationDecorationsHoverOnly` shows the square icon
- On icon hover, calls the shared `showAnnotationTooltip(...)`
- Separation of concerns:
  - Hover icon: UI interaction without blocking clicks
  - Tooltip: Data fetching and display logic

### 3. CSS Structure Preserved
```html
<div class="annotation-tooltip visible">
  <div class="tooltip-header">
    <span class="tooltip-icon">📝</span>
    <span class="tooltip-title">Note annotation</span>
  </div>
  <div class="tooltip-content">Branch content here...</div>
  <div class="tooltip-footer">Click to open panel</div>
</div>
```

## Key Implementation Details

### ID Normalization
- UI Format: `branch-04742759-d6f5-4f2c-9139-1234567890ab`
- DB Format: `04742759-d6f5-4f2c-9139-1234567890ab`
- API uses DB format, UI elements use UI format

### Auto-Scrollbar Logic
```typescript
function checkTooltipScrollable() {
  const contentEl = tooltipElement.querySelector('.tooltip-content')
  if (contentEl.scrollHeight > contentEl.clientHeight) {
    tooltipElement.classList.add('has-scroll')
    contentEl.style.overflowY = 'auto'
  }
}
```

### Content Extraction
- HTML: Strip tags with regex
- ProseMirror JSON: Recursive traversal of content nodes
- Fallback: "No notes added yet" when empty

## Files Involved

1. **annotation-tooltip.ts** (plain mode) — shared tooltip implementation
2. **annotation-decorations-hover-only.ts** (plain mode) — square icon using the shared tooltip
3. **annotation-decorations.ts** (Yjs) — emoji icon with inline tooltip logic
4. **tiptap-editor-plain.tsx / tiptap-editor.tsx** — CSS styles for tooltip appearance and scrollbars

Notes:
- In Yjs mode, the tooltip logic lives inline in `annotation-decorations.ts` (not the shared module) and follows the same auto-scroll pattern.
- The icon differs by editor: square (plain) vs magnifier emoji (Yjs).

### CSS Height Differences
- Yjs tooltip container: max height ~400px with `overflow-y: auto`.
- Plain tooltip content area: max height ~250px with `overflow-y: auto`.

## Validation

### User Confirmation
- Tooltip shows correct structure with header, content, footer
- Auto-scrollbar appears for long content
- Branch data loads and displays correctly
- Square icon successfully triggers tooltip on hover

### Technical Verification
- API calls logged in console show correct flow
- ID normalization handles both formats
- Error cases handled gracefully
- No interference with cursor placement; caret placement handled by the dedicated cursor-fix plugin in plain mode

### Safety Notes
- Tooltip content is sanitized to text (HTML stripped / PM JSON traversed)
- Only first‑party API calls are used; no external scripts/iframes
- Title (`branch.title`) is inserted via `innerHTML`; treat as trusted or HTML‑escape in a future hardening pass
