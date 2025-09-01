# Action Plan - Addressing Alignment Gaps

**Date**: 2025-09-01  
**Priority**: High  
**Timeline**: 1-2 weeks

## Critical Misalignments to Address

### 1. Architectural Deviation: Service Worker vs PlainOfflineProvider

**Current State**: Implemented Service Worker-based offline foundation  
**Expected State**: PlainOfflineProvider with PostgresOfflineAdapter per PRP

**Resolution Options**:

#### Option A: Retrofit PlainOfflineProvider (Recommended)
```typescript
// Create PlainOfflineProvider as wrapper around Service Worker
class PlainOfflineProvider {
  constructor(private adapter: PostgresOfflineAdapter) {
    // Initialize Service Worker
    this.initServiceWorker();
  }
  
  // Implement PlainCrudAdapter interface
  async createNote(note: Note) {
    // Use Service Worker queue for offline
    // Direct to adapter when online
  }
}
```

#### Option B: Document Architectural Decision
Create `docs/proposal/unified_offline_foundation/ADR-001-service-worker-architecture.md` explaining:
- Why Service Worker approach was chosen
- How it fulfills Option A requirements
- Compatibility with future PlainOfflineProvider

### 2. Missing TipTap Plain Editor

**Gap**: No plain TipTap editor implementation  
**Impact**: Core editing functionality missing

**Action Items**:
1. Create `components/canvas/tiptap-editor-plain.tsx`
2. Remove collaboration extensions
3. Store as ProseMirror JSON in document_saves
4. Verify all 10 fixes work:
   - Fix 1: Proper unmounting
   - Fix 2: Focus management
   - Fix 3: Content synchronization
   - Fix 4: Undo/redo stack
   - Fix 5: Selection preservation
   - Fix 6: Keyboard shortcuts
   - Fix 7: Paste handling
   - Fix 8: Image uploads
   - Fix 9: Link editing
   - Fix 10: Table support

### 3. Missing Test Infrastructure

**Create these files**:

#### `/scripts/test-plain-mode.sh`
```bash
#!/bin/bash
# Test plain mode (Option A) without Yjs

echo "Testing Plain Mode (Option A)..."

# 1. Check feature flags
echo "Checking feature flags..."
curl -s http://localhost:3000/api/telemetry | jq .

# 2. Test offline queue
echo "Testing offline queue..."
curl -X POST http://localhost:3000/api/postgres-offline/notes \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Note", "content": "Test"}'

# 3. Verify Service Worker
echo "Checking Service Worker..."
curl -I http://localhost:3000/api/health

# 4. Run integration tests
echo "Running integration tests..."
npm run test:integration

echo "Plain mode tests complete!"
```

#### Integration Tests
Create `test/integration/offline-queue.test.ts`:
```typescript
describe('Offline Queue', () => {
  it('should queue operations when offline', async () => {
    // Test implementation
  });
  
  it('should replay operations when online', async () => {
    // Test implementation
  });
});
```

### 4. Electron Support Implementation

**Required Files**:

#### `lib/offline/electron-ipc-bridge.ts` (partial exists, needs completion)
```typescript
export class ElectronIPCBridge {
  async queryPostgres(query: string, params: any[]) {
    if (window.electron) {
      return window.electron.db.query(query, params);
    }
    throw new Error('Not in Electron context');
  }
  
  async checkLocalPostgres() {
    return window.electron?.db.checkLocal();
  }
}
```

#### `electron/preload.js` additions
```javascript
contextBridge.exposeInMainWorld('electron', {
  db: {
    query: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
    checkLocal: () => ipcRenderer.invoke('db:checkLocal'),
  }
});
```

## Implementation Priority

### Week 1 (Immediate)
1. **Day 1-2**: Create test infrastructure
   - Add lint checks to CI
   - Create test-plain-mode.sh
   - Write integration tests

2. **Day 3-4**: Document architectural decisions
   - Create ADR for Service Worker approach
   - Update PRP with approved deviations

3. **Day 5**: Quick wins
   - Fix missing exports
   - Add validation scripts
   - Update documentation

### Week 2 (Follow-up)
1. **Day 1-3**: TipTap plain editor
   - Create plain variant
   - Verify 10 fixes
   - Integration testing

2. **Day 4-5**: Electron support
   - Complete IPC bridge
   - Test local Postgres fallback
   - Desktop UI integration

## Validation Checklist

After implementing fixes, verify:

- [ ] `npm run lint` passes with no errors
- [ ] `npm run type-check` passes
- [ ] `npm run test` passes
- [ ] `npm run test:integration` passes (new)
- [ ] `./scripts/test-plain-mode.sh` passes (new)
- [ ] PlainOfflineProvider exists (wrapper or full implementation)
- [ ] TipTap plain editor works with 10 fixes verified
- [ ] Electron IPC bridge functional
- [ ] All documentation updated

## Success Metrics

- **Alignment Score**: Increase from 85% to 95%+
- **Test Coverage**: Add integration tests with >80% coverage
- **Documentation**: All architectural decisions documented
- **Electron Support**: Desktop app functional with offline mode

## Risk Mitigation

1. **Risk**: Breaking existing functionality
   - **Mitigation**: Feature flag all new changes
   - **Rollback**: Disable flags if issues arise

2. **Risk**: Scope creep
   - **Mitigation**: Focus only on alignment gaps
   - **Defer**: Additional features to Phase 3+

3. **Risk**: Conflicting with Option B (Yjs)
   - **Mitigation**: Keep changes isolated in plain mode
   - **Test**: Verify Yjs mode still works

## Next Steps

1. Review this action plan with team
2. Get approval for architectural decisions
3. Create tickets for each action item
4. Begin implementation in priority order
5. Daily validation against checklist

## Notes

- Service Worker approach is valid for Option A
- Focus on documenting WHY over changing WHAT
- Prioritize testing and validation
- Keep changes behind feature flags