# Annotation Creation and Infinite Loop Fix

## Summary
Fixed two critical issues preventing annotation creation:
1. **500 Internal Server Error** when creating branches - database expected UUID for primary key but received "branch-xxx" format
2. **Infinite loop** of branch loading requests - unstable dataStore reference caused continuous re-renders

## Changes

### 1. Fixed UUID Validation in Branches API
**File**: `app/api/postgres-offline/branches/route.ts` (lines 22-24, 37)
- Added UUID regex validation for the primary key `id` field
- Only passes valid UUIDs to database, otherwise lets DB generate one
- Keeps parentId handling unchanged (accepts "main", "branch-xxx", or UUIDs)

```typescript
// Before: passing "branch-xxx" as primary key
[
  id && id.trim() ? id : null,
  ...
]

// After: validate UUID format first
const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const idOrNull = id && uuidRegex.test(String(id).trim()) ? String(id).trim() : null
[
  idOrNull,
  ...
]
```

### 2. Fixed Infinite Loop in Canvas Context
**File**: `components/canvas/canvas-context.tsx` (lines 5, 105-113, 148-157, 240)
- Used `useRef` to create stable instances of DataStore and EventEmitter
- Removed `dataStore` from useEffect dependencies to prevent re-renders
- Added proper parentId normalization when loading branches

Key changes:
```typescript
// Before: New instances on every render
const dataStore = new DataStore()
const events = new EventEmitter()

// After: Stable instances using useRef
const dataStoreRef = useRef<DataStore>()
const eventsRef = useRef<EventEmitter>()
if (!dataStoreRef.current) dataStoreRef.current = new DataStore()
if (!eventsRef.current) eventsRef.current = new EventEmitter()
```

Also improved parentId normalization:
```typescript
// Handle all formats from database:
// - 'main' stays 'main'
// - 'branch-...' stays as-is  
// - raw UUID becomes 'branch-<uuid>'
```

## Commands
```bash
# Restart the development server
npm run dev

# Check for TypeScript errors
npm run type-check
```

## Tests
- Branch creation with UUID validation: ✓
- No more infinite GET requests: ✓
- Parent ID normalization handles all formats: ✓

## Errors Encountered

### Error 1: 500 Internal Server Error
**Error**: `Failed to create branch: Internal Server Error`
- **Terminal**: `invalid input syntax for type uuid: "branch-2a4a69ab-8815-4036-9a4c-3685817a0bae"`
- **Root Cause**: Database `branches.id` column is UUID type but app sent "branch-xxx" format
- **Solution**: Validate ID is UUID before passing to database, otherwise use NULL for auto-generation

### Error 2: Infinite Loop
**Error**: Continuous `GET /api/postgres-offline/branches?noteId=xxx` requests
- **Root Cause**: DataStore instance recreated on every render, triggering useEffect repeatedly
- **Solution**: Use useRef to maintain stable references and remove from dependencies

## Risks/Limitations
- Branch IDs must be UUIDs in database, UI format "branch-xxx" is for display only
- Parent ID normalization assumes consistent format (main, branch-xxx, or UUID)
- DataStore and EventEmitter are now persistent for component lifetime

## Next Steps
1. Test annotation creation workflow end-to-end
2. Verify branch hierarchy is maintained correctly
3. Add error handling for malformed branch IDs
4. Consider adding branch ID format validation on frontend