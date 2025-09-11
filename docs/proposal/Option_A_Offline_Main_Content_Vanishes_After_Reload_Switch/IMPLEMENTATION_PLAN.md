# Implementation Plan: Fix Main Content Persistence in Option A Offline Mode

**Feature Slug:** `Option_A_Offline_Main_Content_Vanishes_After_Reload_Switch`  
**Date Created:** 2025-09-11  
**Status:** ✅ Completed  
**Priority:** High (Data Loss)

## Problem Statement
In Option A (offline mode without Yjs), the main panel content disappears when:
- Switching between notes for the second time
- Reloading the application after content has been saved
- Opening the same note panel multiple times

This issue ONLY affects the main panel - annotations and branch panels correctly preserve their content.

## Success Criteria
- [ ] Main panel content persists across all note switches
- [ ] Content survives application reload
- [ ] No regression in annotation/branch panel persistence
- [ ] Solution maintains Option A compliance (no Yjs dependencies)
- [ ] Debug logging available for monitoring

## Technical Investigation

### Initial Hypotheses
1. ❌ Auto-edit mode interference
2. ❌ UUID validation issues  
3. ❌ Version field overflow
4. ✅ **Race condition in content loading**
5. ✅ **Improper content prop handling with provider**

### Root Causes Identified
1. **Content Prop Conflict**: Component receiving both provider-loaded content AND prop content
2. **Loading State Race**: Content being saved while still loading from database
3. **Fallback Effect**: Fallback content effect running even with provider present

## Implementation Approach

### Phase 1: Debug Infrastructure
- [x] Create PostgreSQL debug_logs table
- [x] Add debug logging API endpoint
- [x] Build debug viewer UI at /debug-logs.html
- [x] Instrument editor with session-based logging

### Phase 2: Fix Content Loading
- [x] Remove content prop when using PlainOfflineProvider
- [x] Add loading state guards to prevent premature saves
- [x] Fix fallback content effect to respect provider presence
- [x] Add content preview logging for empty saves

### Phase 3: Validation
- [x] Manual testing across browsers
- [x] Database log analysis
- [x] Type checking and linting
- [x] Multiple reload/switch cycles

## Architecture Decisions

### Provider-Only Content Flow
When PlainOfflineProvider is active:
- Content loads ONLY via `provider.loadDocument()`
- No content prop passed to editor component
- Fallback content effects explicitly disabled

### Debounced Save Strategy
- 800ms debounce on content changes
- Content hashing to detect real changes
- Emergency save on page unload

### Debug Logging Architecture
- Server-side PostgreSQL storage
- Session ID tracking
- Action-based event flow
- Content preview truncation

## File Changes Overview

### Core Fixes
- `components/canvas/tiptap-editor-plain.tsx` - Loading logic and guards
- `components/canvas/canvas-panel.tsx` - Remove content prop
- `app/api/postgres-offline/documents/route.ts` - Clean up logging

### Debug Infrastructure
- `migrations/007_debug_logs.up.sql` - Database schema
- `app/api/debug-log/route.ts` - Logging endpoint
- `lib/debug-logger.ts` - Client utilities
- `public/debug-logs.html` - Debug viewer

## Testing Protocol

### Manual Test Cases
1. Create note → Add content → Switch away → Switch back
2. Create note → Add content → Reload app
3. Create note → Add content → Switch notes 5+ times
4. Create annotation → Verify branch panel unaffected

### Automated Validation
```bash
npm run lint
npm run type-check
npm run test
```

### Debug Verification
```sql
SELECT * FROM debug_logs 
WHERE action IN ('START_LOAD', 'CONTENT_LOADED', 'CONTENT_SET_IN_EDITOR')
ORDER BY timestamp DESC;
```

## Rollback Plan
If issues arise:
1. Revert canvas-panel.tsx to pass content prop
2. Disable debug logging to reduce overhead
3. Re-enable console.log statements for debugging

## Future Improvements
1. Add E2E tests for content persistence scenarios
2. Implement proper edit/non-edit mode toggle
3. Consider optimistic UI updates
4. Add telemetry for content loss detection

## Related Documentation
- [Main Implementation Report](reports/2025-09-11-implementation-report.md)
- [Detailed Fix Report](post-implementation-fixes/high/2025-09-11-content-persistence-fix.md)
- [Fixes Index](post-implementation-fixes/README.md)
- [CLAUDE.md](../../CLAUDE.md) - Option A specification

## Update Log
- **2025-09-11**: Initial implementation completed, all tests passing
- **2025-09-11**: Debug infrastructure added for production monitoring
- **2025-09-11**: Console.log statements cleaned up, keeping database logging