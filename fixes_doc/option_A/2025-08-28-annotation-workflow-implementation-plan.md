# Annotation Workflow Implementation Plan for Option A (Plain Mode)
**Version:** 2.0
**Last Updated:** 2025-08-29

## Overview
This plan details the implementation of annotation workflow features for Option A (offline mode without Yjs), ensuring full compliance with:
- PRPs/postgres-persistence.md requirements  
- docs/annotation_workflow.md UX specifications
- INITIAL.md PlainCrudAdapter interface
- Existing codebase patterns and migrations

Note on supporting files location
- Reference and example files mentioned in this plan that come from the supporting reference (annotation_feature_implementation.md) are located under the docs/supporting_files directory of this repository.
- Absolute path for clarity on this machine: /Users/dandy/Downloads/annotation_project/annotation-backup/docs/supporting_files
- When the supporting reference uses paths like components/canvas/... or hooks/..., they refer to docs/supporting_files/components/canvas/... and docs/supporting_files/hooks/... respectively (not the app’s root components/ folder).

## Key Compliance Updates (v2.0)

### 1. Database Migrations
- **USE EXISTING**: Migration 005_document_saves already exists with correct schema
- **DO NOT CREATE**: New migrations for document_saves (already done)
- **REUSE**: Migration 004_offline_queue for offline operations

### 2. Adapter Interface (PlainCrudAdapter)
Must implement exact interface from INITIAL.md:65-79:
```typescript
interface PlainCrudAdapter {
  saveDocument(noteId: string, panelId: string, content: ProseMirrorJSON | HtmlString, version: number): Promise<void>
  loadDocument(noteId: string, panelId: string): Promise<{ content: ProseMirrorJSON | HtmlString, version: number } | null>
  enqueueOffline(op: QueueOp): Promise<void>
  // ... other methods
}
```

### 3. The 10 TipTap Fixes Preservation
Must follow patterns from PRPs/postgres-persistence.md:188-216:
- Composite cache keys: `noteId-panelId` (Fix #2, #5)
- Loading states map + persistence state object (Fix #3, #7-9)
- NO cache deletion on unmount (Fix #4)
- Empty content guards (Fix #1)
- Memoization to prevent loops (Fix #10)

## Phase 1: Core Infrastructure (Priority: High)

### 1.1 Plain Mode Provider Infrastructure
**Files to create/modify:**
- `lib/providers/plain-offline-provider.ts` (new)
- `lib/adapters/postgres-offline-adapter.ts` (new) 
- `lib/adapters/electron-ipc-adapter.ts` (new)
- `lib/provider-switcher.ts` (new)

**Implementation details:**
```typescript
// PlainOfflineProvider - manages document state without Yjs
export class PlainOfflineProvider extends EventEmitter {
  // Fix #2 & #5: Composite key caching
  private documents = new Map<string, any>(); // key: noteId-panelId
  
  // Fix #3: Async loading states
  private loadingStates = new Map<string, Promise<void>>();
  
  // Fix #7-9: Object state to avoid closures
  private persistenceState = {
    initialized: false,
    updateCount: 0,
    lastSave: Date.now(),
    pendingOps: 0
  };
  
  // Fix #4: NO cache deletion on destroy
  destroy(): void {
    // Do NOT clear documents cache
    this.persistenceState.initialized = false;
    this.removeAllListeners();
  }
}
```

### 1.2 Database Schema (Use Existing)
**Existing migration files:**
- `migrations/004_offline_queue.up.sql` (REUSE for offline operations)
- `migrations/005_document_saves.up.sql` (ALREADY EXISTS with correct schema)

## Phase 2: Text-Based Anchoring System (Priority: High)

### 2.1 Plain Text Anchoring
**Files to modify:**
- `lib/models/annotation.ts` - add PlainAnchor interface
- `lib/utils/text-anchoring.ts` (new)

**Implementation approach:**
```typescript
interface PlainAnchor {
  type: 'text-range';
  start: number;  // character offset
  end: number;    // character offset
  context: {      // for resilience
    prefix: string;
    suffix: string;
    text: string;
  };
}

// Replace Y.RelativePosition with text offsets
function createPlainAnchor(selection: TextSelection): PlainAnchor {
  return {
    type: 'text-range',
    start: selection.from,
    end: selection.to,
    context: extractContext(doc, selection)
  };
}
```

## Phase 3: TipTap Editor Plain Mode (Priority: High)

### 3.1 Plain TipTap Editor Component
**Files to create:**
- `components/canvas/tiptap-editor-plain.tsx` (new)
- `lib/tiptap/plain-extensions.ts` (new)

**Key differences from Yjs version:**
- No Collaboration extension
- No YJS undo/redo
- Use standard ProseMirror history
- Custom annotation marks without Yjs binding
- All 10 fixes preserved

**Implementation with fixes:**
```typescript
export function TipTapEditorPlain({ noteId, panelId, provider, onAnnotationCreate }: Props) {
  const [isContentLoading, setIsContentLoading] = useState(true);
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ x: 0, y: 0 });
  
  // Fix #10: Memoize operations to prevent loops
  const saveContent = useCallback(
    debounce(async (content: any) => {
      await provider.saveDocument(noteId, panelId, content);
    }, 1000),
    [noteId, panelId, provider]
  );
  
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: true, // Use ProseMirror history (not Yjs)
      }),
      PlainAnnotationMark, // Custom mark for annotations
      // Include all fixed extensions from original editor
    ],
    
    onCreate: async ({ editor }) => {
      // Fix #1: Handle empty content
      const doc = await provider.loadDocument(noteId, panelId);
      if (!doc || doc.content === '<p></p>' || !doc.content?.length) {
        editor.commands.clearContent();
      } else {
        editor.commands.setContent(doc);
      }
      setIsContentLoading(false);
    },
    
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      const hasSelection = from !== to;
      
      if (hasSelection) {
        const coords = editor.view.coordsAtPos(from);
        setToolbarPosition({ x: coords.left, y: coords.top - 50 });
        setShowToolbar(true);
      } else {
        setShowToolbar(false);
      }
    }
  });
  
  return (
    <div className="relative h-full">
      <EditorContent editor={editor} className="h-full overflow-auto p-4" />
      
      {showToolbar && (
        <SelectionToolbar
          position={toolbarPosition}
          onSelectType={handleAnnotationCreate}
          showThreeButtons // Ensure 3 colored buttons per UX spec
        />
      )}
    </div>
  );
}
```

## Phase 4: Annotation Creation UI (Priority: High)

### 4.1 Selection Toolbar
**Files to modify:**
- `components/canvas/selection-toolbar.tsx` (use existing)
- `components/canvas/panel-view.tsx` (modify for plain mode)

**Implementation:**
- Three colored buttons (Note/Explore/Promote) near cursor
- Click annotation to open/focus child panel
- Ensure visual styling matches annotation types

### 4.3 Inline Annotation Hover Previews (UX Requirement)
**Files to modify:**
- `lib/tiptap/plain-annotation-mark.ts` - add hover preview support
- `components/canvas/annotation-tooltip.tsx` (new)

**Implementation:**
```typescript
// Add hover preview functionality to annotation marks
export const AnnotationTooltip = ({ annotationId, noteId }: Props) => {
  const [preview, setPreview] = useState<string>('');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  useEffect(() => {
    // Load preview content from associated panel
    loadPreviewContent(annotationId, noteId).then(setPreview);
  }, [annotationId, noteId]);
  
  return (
    <div 
      className="annotation-tooltip"
      style={{ left: position.x, top: position.y - 40 }}
    >
      <div className="preview-content">{preview || 'Loading...'}</div>
    </div>
  );
};
```

### 4.2 Annotation Creation Logic
**Files to create:**
- `lib/canvas/annotation-manager.ts` (new)
- `lib/canvas/plain-canvas-state.ts` (new)

**Complete UX implementation:**
```typescript
export class AnnotationManager {
  async createAnnotation(
    type: 'note' | 'explore' | 'promote',
    selection: { from: number; to: number; text: string },
    parentNoteId: string,
    parentPanelId: string,
    editorDoc: any
  ): Promise<void> {
    // 1. Create text anchor
    const anchor = createPlainAnchor(editorDoc, selection.from, selection.to);
    
    // 2. Store annotation in DB using PlainCrudAdapter
    const annotation = await this.provider.adapter.createBranch({
      note_id: parentNoteId,
      type,
      anchors: [anchor],
      version: 1
    });
    
    // 3. Create new panel to the right (UX requirement)
    const parentPanel = this.panelManager.getPanel(parentPanelId);
    const newPanel = await this.panelManager.createPanel({
      noteId: parentNoteId,
      position: {
        x: parentPanel.position.x + 420, // To the right
        y: parentPanel.position.y
      },
      dimensions: { width: 400, height: 300 },
      metadata: {
        annotationType: type,
        annotationId: annotation.id,
        parentPanelId
      }
    });
    
    // 4. Initialize with quoted reference (UX requirement)
    const quotedContent = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: selection.text }]
          }]
        },
        { type: 'paragraph' } // Editable area below
      ]
    };
    await this.provider.saveDocument(parentNoteId, newPanel.id, quotedContent);
    
    // 5. Add branch entry with all UX features
    await this.addBranchEntry(parentNoteId, parentPanelId, {
      id: newPanel.id,
      annotationId: annotation.id,
      type,
      title: selection.text.slice(0, 50) + '...',
      preview: 'Start expanding on this annotation...', // Default preview
      icon: this.getAnnotationIcon(type),
      clickable: true // Must open/focus panel when clicked
    });
    
    // 6. Create visual connection (UX requirement)
    this.connectionManager.addConnection({
      from: parentPanelId,
      to: newPanel.id,
      type,
      color: this.getAnnotationColor(type),
      curved: true, // Curved lines per UX spec
      updateOnDrag: true // Lines reflow when panels move
    });
    
    // 7. Enable panel features (UX requirements)
    await this.enablePanelFeatures(newPanel.id, {
      draggable: true, // Explicit draggable requirement
      breadcrumb: this.getBreadcrumb(parentPanelId, type),
      branchesSection: true // Own branches section
    });
    
    // 8. Smooth pan to new panel (UX requirement)
    await this.canvasState.smoothPanTo(newPanel.position);
  }
}
```

## Phase 5: Panel & Canvas Features (Priority: Medium)

### 5.1 Auto-Panel Creation
**Files to modify:**
- `lib/canvas/panel-manager.ts` (adapt existing)
- `lib/canvas/panel-positions.ts` (adapt existing)

**Features to implement:**
- Position new panel to the right of parent
- Include quoted reference at top
- Set up editable content area
- Draggable panels (explicit requirement)
- Breadcrumb trail showing path
- Branches section within each panel

### 5.2 Visual Connections
**Files to modify:**
- `components/canvas/connection-lines.tsx` (use existing)
- Ensure color matching for annotation types
- Update connections dynamically when panels are dragged

### 5.3 Smooth Pan Feature (NEW - not in current implementation)
**Files to create:**
- `lib/canvas/pan-animations.ts` (new)

```typescript
function smoothPanToPanel(panelId: string): void {
  const targetPanel = getPanel(panelId);
  const currentViewport = getViewport();
  
  // Calculate pan distance
  const delta = calculatePanDelta(currentViewport, targetPanel);
  
  // Animate using Framer Motion
  animateViewport({
    x: currentViewport.x + delta.x,
    y: currentViewport.y + delta.y,
    duration: 0.5,
    ease: 'easeInOut'
  });
}
```

### 5.4 Navigation & Organization Features
**Files to create:**
- `components/canvas/annotation-navigation.tsx` (new)

**Features:**
- Filter buttons (all/note/explore/promote)
- Hover previews with branch content
- Breadcrumb trails
- Click annotations to open/focus panels
- Support for nested annotations

## Phase 6: Platform-Specific Implementation

### 6.1 Provider Switcher
**File:** `lib/provider-switcher.ts`

```typescript
export function createProvider(config: ProviderConfig): Provider {
  // Read mode from env with localStorage override
  const mode = localStorage.getItem('collab_mode') || 
    process.env.NEXT_PUBLIC_COLLAB_MODE || 
    'yjs'; // Default to existing Yjs mode
  
  if (mode === 'plain') {
    // Option A: Plain mode
    const adapter = createPlainAdapter(config);
    return new PlainOfflineProvider(adapter);
  } else {
    // Option B: Yjs mode (preserve existing)
    return new YjsProvider(config);
  }
}
```

### 6.2 Electron IPC Compliance
**File:** `lib/adapters/electron-ipc-adapter.ts`

```typescript
// This runs in renderer - NO pg imports!
export class ElectronIPCAdapter implements PlainCrudAdapter {
  async saveDocument(noteId: string, panelId: string, content: any, version: number): Promise<void> {
    return window.electron.invoke('postgres-offline:saveDocument', {
      noteId,
      panelId,
      content,
      version
    });
  }
  
  // All other methods delegate to IPC...
}
```

**Use existing:** `electron/ipc/postgres-offline-handlers.ts`

### 6.3 Electron PostgreSQL Failover (PRP Requirement)
**Files to create/modify:**
- `electron/database/failover-manager.ts` (new)
- `electron/main.js` - add failover logic
- `electron/ipc/postgres-offline-handlers.ts` - integrate failover

**Implementation:**
```typescript
// electron/database/failover-manager.ts
export class DatabaseFailoverManager {
  private remotePool?: Pool;
  private localPool?: Pool;
  private isUsingLocal = false;
  
  async initialize(): Promise<void> {
    // Try remote first with timeout
    try {
      this.remotePool = new Pool({
        connectionString: process.env.DATABASE_URL_REMOTE,
        connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT_MS || '2000')
      });
      
      // Test connection
      await this.remotePool.query('SELECT 1');
      console.log('Connected to remote PostgreSQL');
    } catch (error) {
      console.warn('Remote PostgreSQL unavailable, failing over to local:', error.message);
      this.isUsingLocal = true;
      
      // Fallback to local
      this.localPool = new Pool({
        connectionString: process.env.DATABASE_URL_LOCAL
      });
      
      await this.localPool.query('SELECT 1');
      console.log('Connected to local PostgreSQL');
    }
  }
  
  getActivePool(): Pool {
    if (this.isUsingLocal && this.localPool) {
      return this.localPool;
    }
    return this.remotePool!;
  }
  
  async checkAndReconnect(): Promise<void> {
    if (!this.isUsingLocal) return;
    
    // Periodically try to reconnect to remote
    try {
      const testPool = new Pool({
        connectionString: process.env.DATABASE_URL_REMOTE,
        connectionTimeoutMillis: 1000
      });
      
      await testPool.query('SELECT 1');
      await testPool.end();
      
      // Switch back to remote
      this.remotePool = new Pool({
        connectionString: process.env.DATABASE_URL_REMOTE
      });
      this.isUsingLocal = false;
      
      console.log('Reconnected to remote PostgreSQL');
      
      // TODO: Trigger oplog sync to catch up with remote
    } catch {
      // Still unavailable, continue with local
    }
  }
}
```

**Testing Requirements:**
- Test with DATABASE_URL_REMOTE pointing to invalid host
- Verify automatic failover to DATABASE_URL_LOCAL
- Test reconnection when remote becomes available
- Measure failover time is under 3 seconds

## Phase 7: Testing & Validation (Priority: High)

### 7.1 Integration Tests
**Test files to create:**
- `__tests__/plain-mode/annotation-workflow.test.ts`
- `__tests__/plain-mode/ten-fixes-preservation.test.ts`

**Test coverage:**
- All 10 TipTap fixes work without Yjs (explicit tests for each)
- Annotation creation/deletion
- Panel management
- Text anchoring resilience
- PlainCrudAdapter compliance
- Offline queue integration
- UX workflow end-to-end

### 7.2 CI/CD Configuration
**Files to modify:**
- `.github/workflows/ci.yml` - add plain mode tests
- `scripts/test-plain-mode.sh` (already exists)

**Validation checks:**
```yaml
- name: Check for Yjs imports in plain mode
  run: |
    ! grep -r "from 'yjs'" lib/providers/plain-*.ts
    ! grep -r "from 'y-prosemirror'" components/canvas/*plain*.tsx
    
- name: Validate IPC boundaries
  run: |
    ! grep -r "from 'pg'" lib/adapters/electron-ipc-adapter.ts
    ! grep -r "from 'pg'" components/
```

## Implementation Order & Dependencies (Revised)

1. **Week 1: Core Infrastructure**
   - PlainOfflineProvider with all fixes preserved
   - PostgresOfflineAdapter implementing PlainCrudAdapter
   - Integration with existing offline_queue
   - Provider switcher with env/localStorage support

2. **Week 1-2: Editor & Anchoring**
   - Plain TipTap editor with all fixes
   - Text-based anchoring system
   - Annotation mark with click behavior

3. **Week 2: Full UX Implementation**
   - All annotation workflow features
   - Draggable panels, breadcrumbs, hover previews
   - Filter buttons and navigation
   - Smooth pan animation

4. **Week 2-3: Platform & Testing**
   - Electron IPC compliance
   - Web API routes
   - Comprehensive test suite
   - CI/CD validation

## Risk Mitigation

1. **Preserving Option B**: All plain mode files use separate namespaces
2. **TipTap Fixes**: Each fix tested independently in plain mode
3. **Data Migration**: Use existing migrations (004, 005)
4. **Performance**: Benchmark plain mode vs Yjs mode
5. **IPC Boundaries**: CI enforces no pg imports in renderer

## Success Criteria (Updated)

- [ ] All features from annotation_workflow.md implemented
- [ ] PlainCrudAdapter interface fully implemented
- [ ] All 10 TipTap fixes preserved and tested
- [ ] Offline queue integration working
- [ ] No Yjs imports in plain mode files
- [ ] IPC boundaries enforced (no pg in renderer)
- [ ] Uses existing migrations (004, 005)
- [ ] Composite keys (noteId-panelId) throughout
- [ ] All tests pass in CI
- [ ] Inline annotation hover previews working
- [ ] Electron PostgreSQL failover (remote→local) implemented and tested

## References

- PRPs/postgres-persistence.md - Architecture blueprint
- docs/annotation_workflow.md - Feature requirements
- docs/supporting_files/annotation_feature_implementation.md - Implementation reference
- CLAUDE.md - Project conventions and constraints
- INITIAL.md:65-79 - PlainCrudAdapter interface specification

## Compliance Checklist

Before implementation:
- [ ] Review existing migrations (004, 005) - do not duplicate
- [ ] Implement exact PlainCrudAdapter interface from INITIAL.md
- [ ] Preserve all 10 fixes with specific patterns from PRP
- [ ] Include all UX features from annotation_workflow.md
- [ ] Set up IPC boundaries for Electron
- [ ] Configure CI to validate no Yjs imports
