# Phase 2 UI Integration - Implementation Plan

**Feature Slug**: `extensible-annotation-types`
**Sub-Phase**: `phase2-ui-integration`
**Date**: 2025-10-10
**Status**: Planning
**Effort Estimate**: ~35 minutes implementation + 15 minutes testing

---

## Problem Statement

Phase 2 API implementation is complete and working, but **UI integration is missing**:

- ❌ Custom types created via API are invisible to users
- ❌ TypeSelector doesn't receive dynamic types from registry
- ❌ `useAnnotationTypes` hook exists but is unused
- ❌ Cross-tab synchronization (BroadcastChannel) is not wired up

**Evidence**: See `docs/proposal/extensible-annotation-types/reports/VERIFICATION-CORRECTION-REPORT.md`

---

## Current State Analysis

### What Works ✅

**Backend/API Layer**:
```
POST   /api/annotation-types      → Creates custom type in DB
PUT    /api/annotation-types/:id  → Updates custom type in DB
DELETE /api/annotation-types/:id  → Deletes custom type from DB
```

**Registry**:
- Loads types from database on startup
- Caches types in memory
- Invalidates cache after mutations
- Notifies local subscribers

**Security**:
- Recursive prototype pollution validation (Zod + PostgreSQL)
- System type protection (cannot modify/delete)
- ID validation (lowercase, hyphens only)

### What's Missing ❌

**UI Layer**:
- TypeSelector component never receives custom types
- No component calls `useAnnotationTypes()` hook
- Users see only hardcoded system types (note, explore, promote)

**Cross-Tab Sync**:
- `notifyAnnotationTypeUpdate()` function exists but never called
- Creating type in Tab A doesn't update Tab B
- Only local subscribers notified (not cross-tab)

---

## Goals and Success Criteria

### Primary Goals

1. **Make custom types visible in UI** - TypeSelector shows all types from registry
2. **Enable cross-tab sync** - Changes in one tab appear in other tabs
3. **Complete Phase 2 end-to-end** - Full API → DB → Registry → UI → Cross-Tab flow

### Acceptance Criteria

- [ ] TypeSelector receives `availableTypes` prop from `useAnnotationTypes()` hook
- [ ] Custom types appear in TypeSelector dropdown immediately after creation
- [ ] Creating custom type via API makes it visible in UI within 1 second
- [ ] Cross-tab sync works: creating type in Tab A updates Tab B within 2 seconds
- [ ] `useAnnotationTypes` hook is actively used in production code
- [ ] `notifyAnnotationTypeUpdate()` is called after POST/PUT/DELETE operations
- [ ] All existing functionality continues to work (no regressions)
- [ ] Type-check passes: `npm run type-check`
- [ ] Tests pass: `npm run test`

---

## Implementation Tasks

### Task 1: Wire `useAnnotationTypes` to TypeSelector (15 min)

**File**: `components/canvas/canvas-panel.tsx`

**Current code** (lines 2020-2024):
```typescript
<TypeSelector
  currentType={currentBranch.type as AnnotationType}
  onTypeChange={handleTypeChange}
  disabled={isChangingType}
/>
```

**Changes needed**:

1. **Import hook** (add to imports section):
```typescript
import { useAnnotationTypes } from '@/lib/hooks/use-annotation-types';
```

2. **Call hook** (add near other hooks):
```typescript
// Load available annotation types from registry
const availableTypes = useAnnotationTypes([]);
```

3. **Pass to TypeSelector** (update JSX):
```typescript
<TypeSelector
  currentType={currentBranch.type as AnnotationType}
  onTypeChange={handleTypeChange}
  disabled={isChangingType}
  availableTypes={availableTypes}
/>
```

**Verification**:
```bash
# Check TypeSelector receives prop
grep -A 5 "TypeSelector" components/canvas/canvas-panel.tsx | grep "availableTypes"

# Check hook is imported and used
grep "useAnnotationTypes" components/canvas/canvas-panel.tsx
```

**Risk**: Low - TypeSelector already accepts `availableTypes` prop (optional)

---

### Task 2: Wire BroadcastChannel to API Endpoints (10 min)

#### 2a. POST Endpoint

**File**: `app/api/annotation-types/route.ts`

**Current code** (lines 105-109):
```typescript
// 5. Invalidate registry cache (AWAITED - blocks until reload complete)
//    CRITICAL: Ensure registry is initialized before accessing it
await ensureAnnotationTypesReady();
const registry = getAnnotationTypeRegistry();
await registry.invalidate();
```

**Changes needed**:

1. **Import broadcast function** (add to imports):
```typescript
import { notifyAnnotationTypeUpdate } from '@/lib/services/annotation-types-client';
```

2. **Call after invalidation** (add after line 109):
```typescript
await ensureAnnotationTypesReady();
const registry = getAnnotationTypeRegistry();
await registry.invalidate();

// Notify other tabs about the new type
notifyAnnotationTypeUpdate();
```

#### 2b. PUT Endpoint

**File**: `app/api/annotation-types/[id]/route.ts`

**Current code** (lines 76-80):
```typescript
// 5. Invalidate cache (awaited)
//    CRITICAL: Ensure registry is initialized before accessing it
await ensureAnnotationTypesReady();
const registry = getAnnotationTypeRegistry();
await registry.invalidate();
```

**Changes needed**:

1. **Import broadcast function** (add to imports):
```typescript
import { notifyAnnotationTypeUpdate } from '@/lib/services/annotation-types-client';
```

2. **Call after invalidation** (add after line 80):
```typescript
await ensureAnnotationTypesReady();
const registry = getAnnotationTypeRegistry();
await registry.invalidate();

// Notify other tabs about the update
notifyAnnotationTypeUpdate();
```

#### 2c. DELETE Endpoint

**File**: `app/api/annotation-types/[id]/route.ts` (same file, DELETE handler)

**Current code** (lines 161-165):
```typescript
// 3. Invalidate cache (awaited)
//    CRITICAL: Ensure registry is initialized before accessing it
await ensureAnnotationTypesReady();
const registry = getAnnotationTypeRegistry();
await registry.invalidate();
```

**Changes needed**:

1. **Import already added in 2b** (same file)

2. **Call after invalidation** (add after line 165):
```typescript
await ensureAnnotationTypesReady();
const registry = getAnnotationTypeRegistry();
await registry.invalidate();

// Notify other tabs about the deletion
notifyAnnotationTypeUpdate();
```

**Verification**:
```bash
# Check POST endpoint calls broadcast
grep -A 2 "registry.invalidate()" app/api/annotation-types/route.ts | grep "notifyAnnotationTypeUpdate"

# Check PUT endpoint calls broadcast
grep -A 2 "registry.invalidate()" app/api/annotation-types/[id]/route.ts | grep "notifyAnnotationTypeUpdate"

# Check DELETE endpoint calls broadcast
grep -A 2 "registry.invalidate()" app/api/annotation-types/[id]/route.ts | grep "notifyAnnotationTypeUpdate"
```

**Risk**: Very Low - `notifyAnnotationTypeUpdate()` is a safe fire-and-forget call

---

### Task 3: Verify TypeSelector Component Accepts Prop (5 min)

**File**: `components/ui/type-selector.tsx` (or wherever TypeSelector is defined)

**Check**:
1. Read TypeSelector component definition
2. Verify `availableTypes?: AnnotationTypeConfig[]` prop exists
3. Verify component uses this prop to render options

**If prop doesn't exist**:
- Add `availableTypes?: AnnotationTypeConfig[]` to props interface
- Update render logic to use `availableTypes` if provided, fallback to hardcoded types

**Verification**:
```bash
# Find TypeSelector definition
grep -r "export.*TypeSelector" components/ --include="*.tsx"

# Check prop interface
grep -A 10 "interface.*TypeSelector" components/ui/type-selector.tsx
```

**Risk**: Medium - TypeSelector may need updates to accept and render dynamic types

---

## Testing Plan

### Unit Tests

**Test file**: `tests/hooks/use-annotation-types.test.ts` (if exists, otherwise create)

```typescript
describe('useAnnotationTypes', () => {
  it('loads types from registry', () => {
    const { result } = renderHook(() => useAnnotationTypes([]));
    expect(result.current).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'note' }),
      expect.objectContaining({ id: 'explore' }),
      expect.objectContaining({ id: 'promote' })
    ]));
  });

  it('includes custom types from database', async () => {
    await createCustomType({ id: 'test-type', label: 'Test' });
    const { result } = renderHook(() => useAnnotationTypes([]));
    expect(result.current).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'test-type' })
    ]));
  });
});
```

### Integration Tests

**Test file**: `tests/integration/annotation-types-ui.test.tsx`

```typescript
describe('Annotation Types UI Integration', () => {
  it('TypeSelector receives availableTypes prop', () => {
    render(<CanvasPanel />);
    // Check TypeSelector is rendered with availableTypes
    expect(screen.getByTestId('type-selector')).toBeInTheDocument();
  });

  it('custom types appear in TypeSelector', async () => {
    await fetch('/api/annotation-types', {
      method: 'POST',
      body: JSON.stringify({
        id: 'meeting-notes',
        label: 'Meeting Notes',
        icon: '🗓️',
        color: '#34495e'
      })
    });

    // Wait for UI update
    await waitFor(() => {
      expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
    });
  });
});
```

### Manual Testing (Cross-Tab Sync)

**Setup**:
1. Start dev server: `npm run dev`
2. Open browser to `http://localhost:3000`
3. Open Tab A and Tab B side by side

**Test Steps**:

**Test 1: Create custom type**
1. In Tab A, open browser console
2. Run:
   ```javascript
   fetch('/api/annotation-types', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       id: 'meeting-notes',
       label: 'Meeting Notes',
       icon: '🗓️',
       color: '#34495e',
       gradient: 'linear-gradient(135deg, #34495e 0%, #2c3e50 100%)',
       defaultWidth: 450
     })
   })
   ```
3. **Expected in Tab A**: TypeSelector dropdown shows "🗓️ Meeting Notes" within 1 second
4. **Expected in Tab B**: TypeSelector dropdown shows "🗓️ Meeting Notes" within 2 seconds

**Test 2: Update custom type**
1. In Tab A console:
   ```javascript
   fetch('/api/annotation-types/meeting-notes', {
     method: 'PUT',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       id: 'meeting-notes',
       label: 'Meeting Notes (Updated)',
       icon: '📝',
       color: '#2ecc71',
       gradient: 'linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)',
       defaultWidth: 500
     })
   })
   ```
2. **Expected in Tab A**: Label changes to "Meeting Notes (Updated)", icon changes to 📝
3. **Expected in Tab B**: Same changes appear within 2 seconds

**Test 3: Delete custom type**
1. In Tab A console:
   ```javascript
   fetch('/api/annotation-types/meeting-notes', { method: 'DELETE' })
   ```
2. **Expected in Tab A**: "Meeting Notes" disappears from dropdown
3. **Expected in Tab B**: "Meeting Notes" disappears within 2 seconds

**Success Criteria**:
- All 3 tests pass
- No console errors
- Changes propagate across tabs
- System types (note, explore, promote) remain unchanged

---

## Validation Gates (Must Pass)

Run these commands after implementation:

```bash
# 1. Type check
npm run type-check

# 2. Lint
npm run lint

# 3. Unit tests
npm run test

# 4. Integration tests (if exists)
npm run test:integration

# 5. Verify hook usage
grep -r "useAnnotationTypes" components/ app/ --include="*.tsx"
# Expected: At least one match in components/canvas/canvas-panel.tsx

# 6. Verify broadcast calls
grep "notifyAnnotationTypeUpdate" app/api/annotation-types/route.ts
grep "notifyAnnotationTypeUpdate" app/api/annotation-types/[id]/route.ts
# Expected: At least 3 matches total (POST, PUT, DELETE)

# 7. Manual cross-tab test
# Follow "Manual Testing" section above
```

All gates must pass before marking complete.

---

## Rollback Plan

If implementation fails or causes regressions:

### Rollback Task 1 (TypeSelector):
```bash
git checkout components/canvas/canvas-panel.tsx
```

### Rollback Task 2 (BroadcastChannel):
```bash
git checkout app/api/annotation-types/route.ts
git checkout app/api/annotation-types/[id]/route.ts
```

### Complete rollback:
```bash
git reset --hard HEAD
```

**No database changes required** - this is UI-only work.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| TypeSelector doesn't accept `availableTypes` prop | Medium | Check component definition first, add prop if needed |
| Hook causes performance issues | Low | Hook already implements memoization and subscription pattern |
| BroadcastChannel not supported in browser | Very Low | Code already has graceful degradation (`if (!('BroadcastChannel' in window))`) |
| Cross-tab sync causes race conditions | Low | Registry already has single-flight pattern via `loadPromise` |
| Breaking existing type selection | Low | Prop is optional, defaults to existing behavior |

**Overall Risk**: Low - All infrastructure exists, just needs wiring

---

## Timeline

| Task | Time | Dependencies |
|------|------|--------------|
| Task 1: Wire useAnnotationTypes | 15 min | None |
| Task 2: Wire BroadcastChannel | 10 min | None |
| Task 3: Verify TypeSelector | 5 min | None |
| Manual Testing | 10 min | Tasks 1-3 complete |
| Validation Gates | 5 min | All tasks complete |
| **Total** | **45 min** | |

---

## Success Metrics

### Before Implementation
- Custom types created via API: **Invisible to users**
- Cross-tab sync: **Broken**
- `useAnnotationTypes` usage: **0 files**
- `notifyAnnotationTypeUpdate` calls: **0**

### After Implementation
- Custom types created via API: **Visible in TypeSelector within 1 second**
- Cross-tab sync: **Working within 2 seconds**
- `useAnnotationTypes` usage: **≥1 file (canvas-panel.tsx)**
- `notifyAnnotationTypeUpdate` calls: **3 (POST/PUT/DELETE)**

---

## Follow-Up Tasks (Out of Scope)

1. **Admin UI** - Build UI for creating/editing types without curl
2. **Type validation UI** - Show validation errors in form
3. **Type preview** - Visual preview of colors/gradients before saving
4. **Bulk import** - Upload multiple types from JSON file
5. **Type categories** - Organize custom types into categories

See: `docs/proposal/extensible-annotation-types/reports/UI-FOR-MANAGING-TYPES-STATUS.md`

---

## References

- **Audit Report**: `docs/proposal/extensible-annotation-types/reports/VERIFICATION-CORRECTION-REPORT.md`
- **Phase 2 Implementation**: `docs/proposal/extensible-annotation-types/reports/2025-10-09-PHASE2-WRITE-OPERATIONS-REPORT.md`
- **Security Fixes**: `docs/proposal/extensible-annotation-types/reports/2025-10-09-SECURITY-FIXES-VERIFICATION.md`
- **Hook Implementation**: `lib/hooks/use-annotation-types.ts`
- **Broadcast Service**: `lib/services/annotation-types-client.ts`
- **Registry**: `lib/models/annotation-type-registry.ts`

---

## Notes

- This is **UI wiring only** - no new features, just connecting existing infrastructure
- All backend code already works perfectly
- Hook and broadcast functions already exist and are tested
- Just need to call them from the right places
- Estimated effort is conservative - could be done in 30 minutes by experienced developer

---

**Status**: Ready for implementation
**Blocked by**: User approval to proceed
**Next Step**: Create feature branch `fix/phase2-ui-integration` and begin Task 1
