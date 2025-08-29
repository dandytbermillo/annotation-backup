# Implementation Report: Plain Mode Branch List & Click Features
Date: 2025-08-29
Type: Implementation Report

## Summary
Implemented missing Option A features for plain mode to ensure branch lists update immediately when annotations are created and clicking annotated text opens panels with connection lines. These changes align with `docs/annotation_workflow.md` UX requirements and follow the architectural guidelines in `PRPs/postgres-persistence.md`.

## Problem Addressed
1. **Branch list not updating immediately**: In plain mode, branch lists were not updating when new annotations were created. The code said "Changes will be reflected on reload or manual refresh."
2. **Wrong data source for branches**: The branch list was using `provider.getBranches()` which doesn't work properly in plain mode.
3. **No reactive updates**: DataStore lacked event emitter functionality needed for reactive UI updates.

## Changes Made

### 1. DataStore Event Emitter Enhancement
**File**: `lib/data-store.ts`
- Extended DataStore to inherit from EventEmitter
- Added event emissions on `set()`, `update()`, and `delete()` operations
- This enables reactive updates when data changes

**Key Changes**:
```typescript
import { EventEmitter } from './event-emitter'

export class DataStore extends EventEmitter {
  set(key: string, value: any) {
    this.data.set(key, value)
    this.emit('set', key)  // Emit event for reactive updates
  }
  
  update(key: string, updates: any) {
    const existing = this.get(key) || {}
    this.set(key, { ...existing, ...updates })
    this.emit('update', key)  // Emit update event
  }
}
```

### 2. Branch List Data Source Fix
**File**: `components/canvas/canvas-panel.tsx` (lines 395-399)
- Fixed branch list to use dataStore in plain mode instead of provider
- Provider.getBranches() only used in Yjs mode now

**Key Changes**:
```typescript
// In plain mode, get branches from dataStore; otherwise use provider
const allBranches = isPlainMode 
  ? (dataStore.get(panelId)?.branches || [])
  : (provider.getBranches ? provider.getBranches(panelId) : [])
```

### 3. Reactive Updates for Plain Mode
**File**: `components/canvas/canvas-panel.tsx` (lines 417-437)
- Added event listeners for dataStore changes in plain mode
- Triggers re-render when panel or its branches are updated
- Properly cleans up listeners on unmount

**Key Changes**:
```typescript
if (isPlainMode) {
  const handleDataStoreUpdate = (updatedPanelId: string) => {
    if (updatedPanelId === panelId || dataStore.get(panelId)?.branches?.includes(updatedPanelId)) {
      setLastBranchUpdate(Date.now())
      forceUpdate()
    }
  }
  
  dataStore.on('update', handleDataStoreUpdate)
  dataStore.on('set', handleDataStoreUpdate)
  
  return () => {
    dataStore.off('update', handleDataStoreUpdate)
    dataStore.off('set', handleDataStoreUpdate)
  }
}
```

## Features Verified

### ✅ Branch List Shows Selected Text
- After creating an annotation, the parent panel's branches section immediately shows the new entry
- Title is derived from selected text (truncated to 30 chars with "...")
- Shows original text preview below the title
- Works for both main panel and nested branch panels

### ✅ Click Annotated Text Opens Panel
- Clicking on annotated text in the editor dispatches 'create-panel' event
- Panel opens if not already visible
- Connection line appears between parent and child panels
- Smooth pan animation to the newly opened panel
- Color-coded connection lines (blue for note, orange for explore, green for promote)

### ✅ Plain Mode Panel Rendering
- PanelsRenderer component uses dataStore in plain mode
- No Yjs dependencies on the plain render path
- Positions calculated correctly: `x = parent.x + 900`, `y = parent.y + siblingCount * 650`
- Default position `{ x: 2000, y: 1500 }` when missing

## Testing Performed
1. **Manual Testing**:
   - Created annotations from main panel → branch list updated immediately ✅
   - Created annotations from branch panels → nested branch lists updated ✅
   - Clicked annotated text → panel opened with connection line ✅
   - Verified smooth panning to new panels ✅
   - Confirmed no console warnings "Branch X not found in plain store" ✅

2. **Development Server**: Running at `http://localhost:3000`
   - Environment: `NEXT_PUBLIC_COLLAB_MODE=plain`
   - Database schema confirmed: `branches.parent_id TEXT`, `branches.anchors JSONB`

## Alignment with Specifications

### docs/annotation_workflow.md Compliance
- ✅ Branches section displays immediately after annotation creation
- ✅ Selected text shown in branch entry (truncated)
- ✅ Click annotations to open/focus panels
- ✅ Visual connections with colored curved lines
- ✅ Smooth pan to focused panel

### PRPs/postgres-persistence.md Guardrails
- ✅ No Yjs imports in plain mode render path
- ✅ DataStore used for immediate UI consistency
- ✅ DB writes remain async (non-blocking)
- ✅ Compatible with future Yjs integration

### Option A Implementation Plan Alignment
- ✅ Phase 4.2: Branch entry shows after creation with title from selected text
- ✅ Phase 5.1: Branches section requirements met
- ✅ Phase 4.1: Click annotation opens/focuses child panel
- ✅ Phase 5.2: Visual connections with colored curved lines
- ✅ Phase 5.3: Smooth pan implementation

## Known Limitations
1. TypeScript compilation has some existing errors in test files (not related to this implementation)
2. Full end-to-end tests pending (manual testing completed successfully)

## Next Steps
1. Consider adding automated tests for the reactive update mechanism
2. Monitor performance with large numbers of branches
3. Consider implementing branch collapse/expand for better UX with many annotations

## Files Modified
- `lib/data-store.ts`: Added EventEmitter inheritance and event emissions
- `components/canvas/canvas-panel.tsx`: Fixed branch data source and added reactive updates for plain mode

## Commands for Verification
```bash
# Start development server
npm run dev

# Check environment configuration
cat .env.local | grep NEXT_PUBLIC_COLLAB_MODE
# Expected: NEXT_PUBLIC_COLLAB_MODE=plain

# Verify database schema
psql -h localhost -U postgres -d annotation_dev -c "\d branches"
# Confirm: parent_id TEXT, anchors JSONB columns exist
```

## Conclusion
Successfully implemented the missing plain mode features. Branch lists now update immediately when annotations are created, and clicking annotated text properly opens panels with connection lines. The implementation follows all specified guardrails and aligns with the UX requirements in `docs/annotation_workflow.md`.