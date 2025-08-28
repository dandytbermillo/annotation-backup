# Fixes Documentation

This folder contains documentation of all fixes applied to the annotation system. Each fix is documented with the problem, root cause, solution, and testing instructions.

## Index of Fixes

### 2024-08-27
1. **[Y.js Content Duplication Fix](./2024-08-27-yjs-duplication-fix.md)**
   - Fixed content duplicating on page reload
   - Updated TipTap editor and Y.js provider
   - Added auto-compaction for PostgreSQL

2. **[Note Switching Empty Editor Fix](./2024-08-27-note-switching-fix.md)**
   - Fixed empty editor when switching between notes
   - Implemented smart cache management
   - Improved user experience with instant content display

3. **[Async Y.Doc Loading Fix](./2024-08-27-async-loading-fix.md)**
   - Fixed race condition where editor rendered before content loaded
   - Added loading state tracking for Y.Docs
   - Shows "Loading content..." while waiting for PostgreSQL
   - Eliminates empty editor state completely

4. **[TipTap Content Deletion Fix](./2024-08-27-tiptap-deletion-fix.md)**
   - Fixed content being deleted when switching between notes
   - Removed aggressive Y.Doc cleanup from destroyNote()
   - Added protection against persisting empty updates
   - Content now preserved when navigating between notes

5. **[Y.Doc Cross-Note Contamination Fix](./2024-08-27-ydoc-cross-note-fix.md)**
   - Fixed Y.Docs being shared between different notes
   - Implemented composite keys (noteId-panelId) for proper isolation
   - Fixed Next.js 15 API route params handling
   - Fixed Awareness import errors from y-protocols

6. **[Reload Content Fix - Fragment Field Mismatch](./2024-08-27-reload-content-fix.md)**
   - Fixed both notes showing same content after reload
   - Removed small update filtering that was discarding keystrokes
   - Added dynamic fragment detection (default vs prosemirror)
   - Backward compatible solution without data migration

7. **[Post-Reload Persistence Fix](./2024-08-27-post-reload-persistence-fix.md)**
   - Fixed changes not saving after reload
   - Added persistence handler tracking and setup
   - Ensures all Y.Doc retrieval paths have proper persistence
   - Fresh closure variables prevent stale state issues

8. **[Multiple Reload Persistence Fix](./2024-08-27-multiple-reload-persistence-fix.md)**
   - Fixed persistence breaking after second reload
   - Enhanced handler tracking with WeakMap and metadata
   - Intelligent handler detection prevents duplicates
   - Works across unlimited reload cycles

9. **[Persistence Handler Closure Fix](./2024-08-27-persistence-handler-closure-fix.md)**
   - Fixed stale closure preventing persistence after reload
   - Changed to object-based state to avoid closure capture
   - Always remove old handlers before setting up new ones
   - Added extensive debug logging for visibility

10. **[Infinite Load Loop Fix](./2024-08-27-infinite-load-loop-fix.md)**
    - Fixed continuous /api/persistence/load requests
    - Memoized Y.Doc retrieval in component
    - Added guards against concurrent loads
    - Prevents duplicate handler setup

## Fix Documentation Template

When documenting a new fix, please use this template:

```markdown
# [Issue Title]
**Date**: YYYY-MM-DD  
**Issue**: Brief description  
**Author**: Your name

## Problem Description
What was happening?

## Root Cause
Why was it happening?

## Solutions Applied
### 1. [Component/File Name]
**File**: `path/to/file.ts`
- What was changed
- Code snippets if helpful

## Testing
How to verify the fix works

## Related Files
- List of related files
```

## Important Notes
- Always test fixes against the PRP requirements
- Ensure PostgreSQL persistence continues working
- Verify both web and Electron platforms
- Don't reintroduce previously fixed issues