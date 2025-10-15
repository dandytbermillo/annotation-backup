# Phase 2 Multi-Note Canvas - Implementation Progress

**Date**: 2025-10-14
**Status**: Stage 1 In Progress (reader migration ✅, type-check + automated smoke ⚠️)

---

## Current State Assessment

### ✅ Completed Work to Date:
1. **Composite ID Helpers** - `lib/canvas/composite-id.ts`
   - `makePanelKey(noteId, panelId)` → `"noteId::panelId"`
   - `parsePanelKey(key)` → `{ noteId, panelId }`
   - `ensurePanelKey(noteId, panelId)` → handles both formats

2. **CanvasItem Type Extension** - `types/canvas-items.ts`
   - Added `noteId?: string` field
   - Added `storeKey?: string` field
   - Updated `createPanelItem()` to accept both parameters

3. **ModernAnnotationCanvas Composite Key Usage**
   - Lines 25, 84-90, 249-255, 1282-1288, 1862 use `ensurePanelKey()`
   - Default positions use composite keys
   - Type error at line 791 fixed

4. **StateTransaction Composite Key Support** - `lib/sync/state-transaction.ts`
   - Already accepts string IDs (no changes needed)
   - Documentation clarified that composite keys are expected from callers

5. **Panel Persistence Composite Key Support** - `lib/hooks/use-panel-persistence.ts`
   - Added `storeKey` parameter to `PanelUpdateData` interface
   - Updated `persistPanelUpdate()` to use composite keys for store operations
   - Updated `persistPanelCreate()` to accept `storeKey` parameter
   - Updated `persistPanelDelete()` to accept `storeKey` parameter
   - Transaction calls now use composite keys

6. **Hydration Composite Key Support** - `lib/hooks/use-canvas-hydration.ts`
   - Imported `makePanelKey()` helper
   - Updated `applyPanelLayout()` to generate composite keys
   - Stores now keyed by `noteId::panelId` format
   - Updated `HydrationStatus` interface to include `storeKey`
   - Hydrated panels include composite keys for consumers

7. **Caller Sites Updated** - All persistence hook callers now pass composite keys
   - `canvas-panel.tsx`: `persistPanelUpdate()` now passes `storeKey`
   - `annotation-canvas-modern.tsx`: `persistPanelCreate()` for main & branch panels now passes `storeKey`
   - `useCanvasHydration` + plain/Yjs decorations resolve composite keys for reads
8. **Static Guardrail** — `npm run test:composite-keys` ensures no regression to plain IDs.

### ⚠️ Remaining for Stage 1 Closure:
- Type-check debt triaged in `reports/2025-10-15-typecheck-inventory.md` (needs fix or exclusion plan).
- Automated smoke (drag → persist → reload) pending — manual guide exists but we need recorded run.
- Update verification report with `npm run test:composite-keys` output + manual sign-off.

### ❌ Not Started - Stage 2 (Unified Canvas):
1. Unified canvas rendering (multi-note mount)
2. Multi-note hydration/persistence orchestration
3. Shared camera & navigation affordances
4. Final verification & cleanup after feature implementation

---

## Stage 1 - Composite Identifiers (✅ COMPLETE)

### Goals:
- [x] Create composite ID helpers
- [x] Update CanvasItem type
- [x] Update StateTransaction to use composite keys
- [x] Update usePanelPersistence to use composite keys
- [x] Update useCanvasHydration to use composite keys
- [x] Update all caller sites / reader paths to pass composite keys
- [ ] Test: drag, save, reload for single note (Automated or logged manual)
- [ ] Type-check baseline decision (fix or quarantine)

### Resolved Issues:
1. ✅ Type error at `annotation-canvas-modern.tsx:791` - Added explicit type annotation
2. ✅ StateTransaction - Already accepts string IDs, callers now pass composite keys
3. ✅ Persistence hooks - Now use `storeKey` parameter for store operations
4. ✅ Hydration - Now generates composite keys using `makePanelKey()`
5. ✅ Caller sites - All `persistPanelUpdate()` and `persistPanelCreate()` calls now pass `storeKey`

---

## Next Steps:

1. ✅ ~~Update `StateTransaction` to accept composite keys~~ - DONE
2. ✅ ~~Update `usePanelPersistence` to use `storeKey` parameter~~ - DONE
3. ✅ ~~Update `useCanvasHydration` to generate composite keys~~ - DONE
4. ✅ ~~Fix type error~~ - DONE
5. **NEXT**: Run/record single-note drag/save/reload (manual + automation target)
6. Decide on type-check remediation path (fix vs exclude legacy files)
7. Begin Stage 2 once above checkpoints complete

---

## Notes:
- Backend workspace API is ready (Phase 1 complete)
- `CanvasWorkspaceProvider` exists but not fully utilized
- Type-check has pre-existing errors (not Stage 1 blockers)
