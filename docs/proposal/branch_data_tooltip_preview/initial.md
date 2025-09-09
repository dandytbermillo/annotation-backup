# Feature Request — Branch Data Tooltip Preview

Feature: `branch_data_tooltip_preview`
Status: completed
Created: 2025-09-08 (retroactive)
Migrated from: `context-os/docs/proposal/annotation_system/branch_data_tooltip_preview/` on 2025-09-09

## Summary
When users hover over annotated text in the editor, show a magnifier icon (🔎) that, when hovered, displays a tooltip with the actual branch annotation content (what the user typed in the annotation panel), not the selected text or raw JSON.

## Problem Statement
Users were seeing raw ProseMirror JSON in tooltips instead of readable branch content:
- Tooltips displayed: `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"branch"}]}]}`
- Expected: The actual notes typed in the annotation panel
- Root cause: Wrong data precedence and improper JSON handling

## Requirements

### Functional Requirements
1. Show hover icon (🔎) when hovering annotated text
2. Display tooltip when hovering the icon (not the text directly)
3. Show actual branch notes content, not selected text
4. Handle both HTML and ProseMirror JSON content formats
5. Provide meaningful fallbacks when no content exists

### Technical Requirements
1. Support both Yjs (collaboration) and Plain (Option A) modes
2. No Yjs imports in plain mode files
3. Handle ID format differences (UI: `branch-<uuid>`, DB: `<uuid>`)
4. Prevent race conditions with async content fetching
5. O(1) performance for common case (data in cache)

## User Experience

### Interaction Flow
1. User hovers over annotated text → magnifier icon appears
2. User hovers over magnifier icon → tooltip appears with branch content
3. User moves away → icon and tooltip hide after 300ms delay

### Content Display Priority
1. Branch notes (what user typed in annotation panel)
2. Original selected text (fallback if no notes)
3. "No notes added yet" (final fallback)

## Implementation Approach
Use branch-first data precedence with proper ID normalization and async guards. Create separate implementations for Yjs and Plain modes to maintain Option A compliance.

## Acceptance Criteria
- [x] Tooltips show readable text, never raw JSON
- [x] Branch content is prioritized over document content
- [x] ID mismatches are handled correctly
- [x] Race conditions are prevented
- [x] Both modes work consistently
- [x] No Yjs dependencies in plain mode

## ERRORS
### Error 1: Tooltips showing raw JSON
- **Root Cause**: Branch content stored as ProseMirror JSON string wasn't being parsed
- **Solution**: Added JSON detection and extraction logic
- **Files Fixed**: `annotation-decorations-plain.ts`, `annotation-decorations.ts`

### Error 2: Wrong content precedence
- **Root Cause**: Provider document (editor content) prioritized over branch content
- **Solution**: Changed to branch-first precedence
- **Files Fixed**: Both decoration files

### Error 3: ID format mismatches
- **Root Cause**: UI uses `branch-<uuid>`, DB uses raw `<uuid>`
- **Solution**: Added `normalizeIds()` function
- **Files Fixed**: Both decoration files

## ATTEMPT HISTORY
1. **Initial implementation** - Basic tooltip with provider-first precedence (showed JSON)
2. **JSON parsing fix** - Added extraction but wrong precedence (still showed wrong content)
3. **Branch-first fix** - Applied unified patch, working solution achieved
4. **Documentation** - Created retroactive implementation plan and structure

## Notes
- Feature was implemented urgently due to user-facing issue
- Multiple iterations were needed to identify root cause
- Solution pattern can be reused for similar tooltip features