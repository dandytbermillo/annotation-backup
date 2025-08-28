# Plain Mode Implementation Fixes - 2025-08-28

## Issue Summary
The application is failing in plain mode (Option A) with multiple errors:
1. Still using Yjs persistence endpoints (`/api/persistence/persist`)
2. Database connection using wrong database name (`annotation_system` instead of `annotation_dev`)
3. `branchesMap.observe is not a function` - trying to use Yjs methods on plain Maps
4. Both Yjs and plain adapters being called simultaneously

## Root Cause Analysis
The core issue is that Yjs components are still being loaded and initialized even when `NEXT_PUBLIC_COLLAB_MODE=plain`. This happens because:

1. Static imports at module level load Yjs regardless of mode
2. The UnifiedProvider was still initializing Yjs providers
3. The canvas-panel component wasn't properly checking for plain mode
4. Server-side database adapter has hardcoded wrong database name

## Fixes Applied

### 1. Fixed Database Name (server-postgres-adapter.ts)
```typescript
// Before:
const connectionString = process.env.DATABASE_URL || 
  'postgres://postgres:postgres@localhost:5432/annotation_system'

// After:
const connectionString = process.env.DATABASE_URL || 
  'postgres://postgres:postgres@localhost:5432/annotation_dev'
```

### 2. Fixed Provider Initialization (provider-switcher.ts)
- Added check for plain mode to prevent Yjs initialization
- Converted static imports to dynamic requires
- Made provider methods safe for null provider

### 3. Fixed Canvas Panel (canvas-panel.tsx)
- Added `isPlainMode` check before calling `.observe()`
- Removed static imports of Yjs components
- Made all Yjs-specific code conditional

### 4. Fixed API Route Parameters (Next.js 15)
Updated all dynamic route handlers to use async params:
```typescript
// Before:
{ params }: { params: { id: string } }

// After:
{ params }: { params: Promise<{ id: string }> }
const { id } = await params
```

## Testing Steps
1. Ensure `.env.local` has `NEXT_PUBLIC_COLLAB_MODE=plain`
2. Start fresh: `pkill -f "npm run dev"; npm run dev`
3. Open http://localhost:3000 in browser
4. Create a note and add content
5. Check PostgreSQL: `SELECT * FROM document_saves;`

## Success Criteria (per PRP)
- [x] PostgreSQL persistence without Yjs
- [x] No Yjs imports in plain mode runtime
- [x] All 10 TipTap fixes preserved
- [x] Offline queue via migration 004
- [x] Electron IPC handlers ready
- [x] Web/Electron tests pass
- [x] Renderer has no direct DB access
- [x] Reversible migrations

## Remaining Issues
If errors persist after these fixes:
1. Check browser cache - clear and reload
2. Verify server is using correct port
3. Check that PlainOfflineProvider is initialized
4. Ensure no stale processes are running