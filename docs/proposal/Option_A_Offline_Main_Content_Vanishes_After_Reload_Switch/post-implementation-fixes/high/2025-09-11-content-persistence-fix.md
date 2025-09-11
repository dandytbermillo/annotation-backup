# Fix Report: Main Panel Content Persistence Issue

**Date:** 2025-09-11  
**Severity:** High  
**Issue:** Main panel content disappeared on second load/switch  
**Resolution:** Fixed race conditions and improper content prop handling

## Problem Description
Users reported that main panel content would persist correctly on first load but disappear when:
1. Switching to another note and back (second time)
2. Reloading the app (second time)
3. Opening the same note panel twice

The issue only affected the main panel - annotations and branch panels preserved their content correctly.

## Root Cause Analysis

### Primary Issues Identified:
1. **Improper content prop passing**: `canvas-panel.tsx` was passing `content={currentBranch.content}` even when using PlainOfflineProvider, triggering fallback content effects
2. **Race condition in content loading**: Empty content was being saved during the loading phase
3. **Fallback effect interference**: The fallback content useEffect was running even with a provider present
4. **Panel ID normalization mismatch**: Initial attempts revealed batch endpoint using wrong UUID coercion

## Changes Made

### 1. `components/canvas/canvas-panel.tsx`
```
Line 848: Removed content prop when using PlainOfflineProvider
- content={currentBranch.content}
+ // DON'T pass content when using provider to avoid triggering fallback effect
```

### 2. `components/canvas/tiptap-editor-plain.tsx`
Multiple critical fixes:
- **Line 167**: Removed `setLoadedContent(null)` during loading to prevent triggering fallback
- **Line 360-382**: Added loading check to prevent saving during content load
- **Line 552-570**: Added explicit provider check to prevent fallback content application
- **Line 370-381**: Added warning logging for empty content saves

### 3. Debug Infrastructure
Added comprehensive debug logging system:
- Database table: `debug_logs` 
- API endpoint: `/api/debug-log`
- Debug viewer: `/debug-logs.html`
- Session-based tracking for content flow analysis

## Validation Steps

### Commands Run:
```bash
# Type checking
npm run type-check  # ✅ Pass

# Linting
npm run lint  # ✅ Pass

# Database verification
docker exec annotation_postgres psql -U postgres -d annotation_dev \
  -c "SELECT * FROM debug_logs ORDER BY timestamp DESC LIMIT 30;"
```

### Manual Testing Protocol:
1. Started dev server: `npm run dev`
2. Created new note with content "Test content 123"
3. Switched to different note
4. Switched back - content preserved ✅
5. Repeated switch 5+ times - content remained ✅
6. Reloaded app - content persisted ✅
7. Created annotations - unaffected ✅

### Debug Log Analysis:
Confirmed proper sequence:
- `START_LOAD` → `CONTENT_LOADED` → `CONTENT_SET_IN_EDITOR`
- No `EMPTY_CONTENT_SAVE` warnings after fix
- Version numbers incrementing correctly

## Browser Testing Matrix

| Browser | First Load | Second Switch | Reload | Annotations |
|---------|------------|---------------|---------|-------------|
| Chrome 120+ | ✅ | ✅ | ✅ | ✅ |
| Safari 17+ | ✅ | ✅ | ✅ | ✅ |
| Firefox 120+ | ✅ | ✅ | ✅ | ✅ |
| Electron | ✅ | ✅ | ✅ | ✅ |

## Key Discoveries

### Version Field Overflow
- PostgreSQL INTEGER max: 2,147,483,647
- Was using Date.now() (milliseconds since epoch)
- Fixed by using incremental version numbers

### UUID Normalization Pattern
- Panel IDs normalized using: `uuidv5('${noteId}:${panelId}', uuidv5.DNS)`
- Main panel → deterministic UUID per note
- Ensures consistent storage/retrieval

### PlainOfflineProvider Behavior
- Content should ONLY come from provider's `loadDocument()`
- Never pass content prop when provider exists
- Fallback content is only for non-provider mode

## Risks & Limitations

### Current:
- Edit/non-edit mode toggle disabled (always editable)
- Debug logging adds slight overhead (acceptable for monitoring)

### Mitigated:
- Race conditions resolved via loading state checks
- Content loss prevented via proper prop handling
- Emergency saves on page unload implemented

## Performance Impact
- Debounced saves (800ms) reduce database writes
- Content hashing prevents duplicate saves
- Debug logging async, non-blocking

## Next Steps
1. Re-enable edit/non-edit mode toggle when ready
2. Consider removing debug logging in production
3. Add automated E2E tests for content persistence
4. Monitor debug logs for edge cases

## Related Issues
- Auto-edit mode for empty panels (deferred)
- Hover icon visibility in edit mode (separate fix)

## Files Changed
- `components/canvas/tiptap-editor-plain.tsx`
- `components/canvas/canvas-panel.tsx`  
- `app/api/postgres-offline/documents/route.ts`
- `app/api/postgres-offline/documents/batch/route.ts`

## Related Links
- [Main Implementation Report](../../reports/2025-09-11-implementation-report.md)
- [Implementation Plan](../../IMPLEMENTATION_PLAN.md)
- [CLAUDE.md Option A Specification](../../../../CLAUDE.md)
- [Debug Logs Viewer](/debug-logs.html)