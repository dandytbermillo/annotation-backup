# Extensible Annotation Types - Implementation Plan

**Feature Slug**: `extensible-annotation-types`
**Date Started**: 2025-10-09
**Status**: Planning
**Assignee**: Claude (Senior Software Engineer)

## Overview

Implement database-backed extensible annotation type system to replace hardcoded types, enabling users to create custom annotation types without code changes.

**Source Proposal**: `/docs/proposal/critical_fixes/extensible-annotation-types-proposal-v2.md`

## Current State Analysis

### Existing Implementation (Hardcoded)

**Type Definition**:
- `lib/models/annotation.ts:12` - `type AnnotationType = 'note' | 'explore' | 'promote'`
- `components/canvas/type-selector.tsx:5` - Duplicated type definition

**Configuration**:
- `lib/models/annotation.ts:64-107` - Color/gradient/icon functions (switch statements)
- `components/canvas/type-selector.tsx:13-17` - TYPE_CONFIG object (hardcoded)

**Usage Locations** (32 total occurrences across 6 files):
1. `lib/extensions/annotation-updater.ts` (3 occurrences)
2. `lib/models/annotation.ts` (9 occurrences)
3. `components/canvas/tiptap-editor-plain.tsx` (1 occurrence)
4. `components/canvas/canvas-panel.tsx` (5 occurrences)
5. `components/canvas/canvas-context.tsx` (9 occurrences)
6. `components/canvas/type-selector.tsx` (5 occurrences)

## Safety Requirements (MANDATORY)

### Pre-Implementation Checklist
- [x] Read v3 proposal completely
- [x] Identify all current usage locations
- [x] Create feature workspace structure
- [x] Create todo list with checkpoints
- [ ] Create backup copies before editing any file
- [ ] Verify database connection works
- [ ] Ensure reversible migration scripts

### Validation Gates (Must Pass Before Merge)
1. `npm run lint` - No new errors
2. `npm run type-check` - TypeScript passes
3. `npm run test` - Unit tests pass
4. `npm run test:integration` - Integration tests pass
5. Manual verification: Create/update/list annotation types via UI
6. Manual verification: Existing hardcoded types still work
7. Migration rollback test: Apply down → verify → re-apply up

### Backup Strategy
- Before editing any file, create `.backup` copy
- Before each subsequent edit pass, create `.backup.N` incremental snapshots
- Keep all backups until full verification complete

## Implementation Phases

### Phase 0: Foundation (This Plan)
- [x] Create feature workspace
- [x] Analyze current state
- [ ] Write detailed implementation plan
- [ ] Get approval to proceed

### Phase 1: Database Layer
**Goal**: Database schema and migration scripts

**Files to Create**:
- `migrations/XXX_add_annotation_types_table.up.sql`
- `migrations/XXX_add_annotation_types_table.down.sql`

**Tasks**:
1. Create migration files with SQL schema from proposal
2. Insert seed data for existing types ('note', 'explore', 'promote')
3. Test forward migration (up.sql)
4. Test rollback (down.sql)
5. Re-test forward migration to ensure idempotency

**Validation**:
```bash
# Check migration applied
PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev -c "\d annotation_types"

# Verify seed data
PGPASSWORD=postgres psql -h localhost -U postgres -d annotation_dev -c "SELECT * FROM annotation_types;"
```

**Acceptance Criteria**:
- [ ] Table `annotation_types` exists
- [ ] 3 seed types inserted ('note', 'explore', 'promote')
- [ ] Rollback script removes table cleanly
- [ ] Re-applying migration is idempotent

---

### Phase 2: Server-Side Registry
**Goal**: In-memory registry with DB backing

**Files to Create**:
- `lib/models/annotation-type-registry.ts` (registry class)
- `lib/models/annotation-type-registry.test.ts` (unit tests)

**Implementation Details**:
1. Define `AnnotationTypeConfig` interface
2. Create `AnnotationTypeRegistry` class with:
   - `ensureLoaded()` - Single-flight DB load
   - `getAll()` - Return cached types
   - `getById(id)` - Lookup by ID
   - `subscribe(callback)` - Observable pattern
   - `notify()` - Trigger subscribers
3. Input validation (regex patterns from proposal)
4. Error handling with retry logic

**Validation**:
```bash
npm run test -- annotation-type-registry.test.ts
```

**Acceptance Criteria**:
- [ ] Registry loads types from DB on first call
- [ ] Subsequent calls return cached data
- [ ] Single-flight pattern prevents concurrent DB queries
- [ ] Subscribe/notify works correctly
- [ ] Validation rejects invalid inputs
- [ ] Unit tests achieve >90% coverage

---

### Phase 3: Bootstrap Module
**Goal**: Lazy initialization for serverless compatibility

**Files to Create**:
- `lib/bootstrap/annotation-types.ts`
- `lib/bootstrap/annotation-types.test.ts`

**Implementation Details**:
1. Singleton registry instance (`let registry: AnnotationTypeRegistry | null = null`)
2. `ensureAnnotationTypesReady()` function with lazy init
3. `getAnnotationTypeRegistry()` accessor
4. Retry on failure (clear `ready` promise)

**Validation**:
```bash
npm run test -- annotation-types.test.ts
```

**Acceptance Criteria**:
- [ ] No DB queries at module load time
- [ ] First call initializes registry
- [ ] Subsequent calls reuse instance
- [ ] Failure allows retry on next call
- [ ] Unit tests verify lazy behavior

---

### Phase 4: API Endpoint
**Goal**: HTTP endpoint for client access

**Files to Create**:
- `app/api/annotation-types/route.ts`
- `app/api/annotation-types/route.test.ts` (integration test)

**Implementation Details**:
1. GET handler:
   - Call `ensureAnnotationTypesReady()`
   - Return `registry.getAll()` as JSON
   - Handle errors with 500 status
2. Error logging
3. Cache headers (consider cache-control)

**Validation**:
```bash
# Start dev server
npm run dev

# Test endpoint
curl http://localhost:3000/api/annotation-types

# Expected output: JSON array of 3 types
```

**Acceptance Criteria**:
- [ ] GET /api/annotation-types returns 200
- [ ] Response is valid JSON array
- [ ] Contains 3 seed types
- [ ] Errors return 500 with message
- [ ] Integration test passes

---

### Phase 5: Client Helper
**Goal**: BroadcastChannel for cross-tab sync

**Files to Create**:
- `lib/services/annotation-types-client.ts`
- `lib/services/annotation-types-client.test.ts`

**Implementation Details**:
1. `subscribeToAnnotationTypeUpdates(callback)` function
2. BroadcastChannel listener
3. Return unsubscribe function
4. Handle browser compatibility (fallback for no BroadcastChannel)

**Validation**:
```bash
npm run test -- annotation-types-client.test.ts
```

**Acceptance Criteria**:
- [ ] Subscribe returns unsubscribe function
- [ ] Callback fires on channel message
- [ ] Unsubscribe stops callbacks
- [ ] Graceful degradation if BroadcastChannel unavailable
- [ ] Unit tests cover all paths

---

### Phase 6: React Hook
**Goal**: Client component hook with SSR support

**Files to Create**:
- `lib/hooks/use-annotation-types.ts`
- `lib/hooks/use-annotation-types.test.tsx` (React Testing Library)

**Implementation Details**:
1. Accept `initial: AnnotationTypeConfig[]` from server
2. useState initialized with `initial`
3. Separate useEffect for:
   - Syncing with `initial` prop changes
   - Subscribing to updates + fetch on mount
4. AbortController for cleanup
5. isMountedRef to prevent state updates after unmount

**Validation**:
```bash
npm run test -- use-annotation-types.test.tsx
```

**Acceptance Criteria**:
- [ ] Hydrates with server-provided initial state
- [ ] Fetches fresh data on mount
- [ ] Subscribes to cross-tab updates
- [ ] Cleans up on unmount (no memory leaks)
- [ ] Handles fetch errors gracefully
- [ ] React tests verify behavior

---

### Phase 7: Update Existing Code
**Goal**: Migrate from hardcoded to dynamic types

**Files to Modify** (create backups first!):
1. `lib/models/annotation.ts`
   - Keep type for backward compat: `export type AnnotationType = string`
   - Mark helper functions as deprecated
   - Add new function: `getAnnotationTypeConfig(id, registry)`

2. `components/canvas/type-selector.tsx`
   - Replace TYPE_CONFIG with data from `useAnnotationTypes()`
   - Accept `availableTypes` prop
   - Keep fallback for hardcoded types during transition

3. `components/canvas/canvas-context.tsx`
   - Fetch annotation types on mount
   - Pass to child components

4. Other files (defer to Phase 8 if complex):
   - `lib/extensions/annotation-updater.ts`
   - `components/canvas/tiptap-editor-plain.tsx`
   - `components/canvas/canvas-panel.tsx`

**Strategy**:
- **Dual-mode support**: Keep old API working while introducing new
- **Gradual migration**: Update one component at a time
- **Feature flag**: Consider adding env var `ENABLE_DYNAMIC_TYPES` for rollout control

**Acceptance Criteria**:
- [ ] TypeSelector uses dynamic types from hook
- [ ] Existing hardcoded types still work (backward compat)
- [ ] No TypeScript errors
- [ ] UI displays all 3 types correctly
- [ ] Type changing still works

---

### Phase 8: Validation & Testing
**Goal**: Comprehensive test coverage

**Tasks**:
1. Write unit tests for all new modules
2. Write integration tests for API + DB
3. Manual UI testing:
   - Load app, verify 3 types appear
   - Change annotation type, verify color updates
   - Open in 2 tabs, change type in one, verify other updates
4. Performance testing:
   - Cold start time (serverless simulation)
   - Memory usage (registry size)
   - Fetch latency

**Validation Commands**:
```bash
npm run lint
npm run type-check
npm run test
npm run test:integration
```

**Acceptance Criteria**:
- [ ] All lint errors resolved
- [ ] TypeScript compiles with no errors
- [ ] Unit test coverage >80%
- [ ] Integration tests pass
- [ ] Manual UI testing passes

---

### Phase 9: Documentation & Cleanup
**Goal**: Complete implementation report

**Files to Create**:
- `docs/proposal/extensible-annotation-types/reports/2025-10-09-implementation-report.md`

**Report Contents** (MANDATORY per CLAUDE.md):
1. **Summary**: What was implemented and why
2. **Changes**: Files modified with key diffs
3. **Migrations**: SQL scripts added
4. **Commands**: How to run, validate, reproduce
5. **Tests**: Results and logs location
6. **Errors**: Any issues encountered + fixes
7. **Risks**: Known limitations
8. **Next Steps**: Phase 2 features (POST /api/annotation-types for custom types)

**Cleanup**:
- Remove `.backup*` files after verification
- Update INITIAL.md with success entry
- Close feature branch

---

## Risk Assessment

### High Risk Areas
1. **Database migration** - Could break existing data if not careful
   - **Mitigation**: Test on dev DB first, include rollback script
2. **Type compatibility** - Existing code expects literal types ('note' | 'explore' | 'promote')
   - **Mitigation**: Keep backward compat, use `string` type with validation
3. **Serverless cold starts** - Lazy loading must work correctly
   - **Mitigation**: Thorough testing of bootstrap module
4. **Memory leaks** - React hook cleanup critical
   - **Mitigation**: AbortController, isMountedRef, unsubscribe

### Medium Risk Areas
1. **Cross-tab sync** - BroadcastChannel browser support
   - **Mitigation**: Graceful degradation, consider localStorage fallback
2. **Race conditions** - Concurrent registry loads
   - **Mitigation**: Single-flight pattern
3. **Cache invalidation** - Stale data in registry
   - **Mitigation**: Observable pattern with manual refresh trigger

### Low Risk Areas
1. **API endpoint** - Straightforward GET handler
2. **Validation** - Well-defined regex patterns
3. **Tests** - Standard unit/integration setup

---

## Rollback Plan

If implementation fails or causes critical issues:

### Immediate Rollback (< 5 minutes)
1. Revert all code changes: `git checkout main -- <files>`
2. Roll back database migration: `npm run migrate:down`
3. Restart dev server
4. Verify hardcoded types work

### Partial Rollback (Keep DB, revert code)
1. Keep `annotation_types` table (harmless)
2. Revert code to hardcoded types
3. Delete new files: `rm lib/models/annotation-type-registry.ts` etc.

### Feature Flag Rollback
1. Set `ENABLE_DYNAMIC_TYPES=false` in .env
2. Code falls back to hardcoded behavior
3. Investigate issue without user impact

---

## Success Criteria (FINAL)

Before marking this feature as "DONE":

- [ ] All validation gates pass (lint, type-check, tests)
- [ ] Migration forward + backward tested
- [ ] UI shows 3 types dynamically from DB
- [ ] Type changing works in both main and branch editors
- [ ] Cross-tab sync works (open 2 tabs, change type in one)
- [ ] No TypeScript errors
- [ ] No new console errors
- [ ] Performance acceptable (< 500ms cold start)
- [ ] Implementation report written
- [ ] Code review approved (if applicable)
- [ ] Deployed to staging (if applicable)

---

## Timeline Estimate

**Conservative estimate** (senior engineer, solo):
- Phase 1 (DB): 2 hours
- Phase 2 (Registry): 3 hours
- Phase 3 (Bootstrap): 1 hour
- Phase 4 (API): 1 hour
- Phase 5 (Client): 1 hour
- Phase 6 (Hook): 2 hours
- Phase 7 (Migration): 4 hours (most complex)
- Phase 8 (Testing): 3 hours
- Phase 9 (Docs): 1 hour

**Total**: ~18 hours (2-3 days)

**Aggressive estimate** (if everything goes smoothly): ~12 hours (1.5 days)

---

## Next Steps

1. Review this plan with stakeholders
2. Get approval to proceed
3. Create feature branch: `git checkout -b feat/extensible-annotation-types`
4. Start Phase 1: Database migration

---

## Appendix: Key Decisions

### Decision 1: Keep Backward Compatibility
**Question**: Should we break existing code using literal types?
**Decision**: NO. Use `type AnnotationType = string` with runtime validation.
**Rationale**: Safer migration, no big-bang rewrite needed.

### Decision 2: Use BroadcastChannel (not polling)
**Question**: How to sync across tabs?
**Decision**: BroadcastChannel with graceful degradation.
**Rationale**: More efficient than polling, modern browsers support it.

### Decision 3: Single-Flight Loading
**Question**: How to prevent cache stampedes?
**Decision**: Share single Promise across concurrent calls.
**Rationale**: Prevents duplicate DB queries, simple implementation.

### Decision 4: Defer POST Endpoint to Phase 2
**Question**: Implement full CRUD in Phase 1?
**Decision**: NO. Start with read-only (GET), add write later.
**Rationale**: Reduces scope, validates architecture before adding complexity.

---

**Status**: Plan complete, awaiting approval to implement.
