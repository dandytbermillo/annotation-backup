name: "Option A - Plain Offline Mode Implementation (PostgreSQL without Yjs)"
version: 3
last_updated: 2025-08-28
description: |
  Implement Option A (offline, single-user, no Yjs) as specified in INITIAL.md, adding plain offline mode alongside existing Yjs implementation for future dual-mode support.
  
  CHANGELOG:
  - v3: Corrected to implement alongside Yjs (not replace), fixed migration references, aligned with updated INITIAL.md
  - v2: Complete rewrite to focus on Option A (no Yjs) per updated INITIAL.md
  - v1: Original PostgreSQL persistence with Yjs (already implemented)

## Purpose
Implement Option A - a plain offline mode without Yjs runtime or CRDT logic, storing editor content as ProseMirror JSON/HTML in PostgreSQL. This implementation runs alongside the existing Yjs-based system, preparing for future dual-mode support where users can choose between offline (Option A) and collaborative (Option B) modes.

## Core Principles
1. **Context is King**: Include all 10 TipTap fixes that must be preserved
2. **Validation Loops**: Test each fix still works in plain mode
3. **Information Dense**: Reference existing adapter patterns 
4. **Progressive Success**: Add plain mode incrementally, validate at each step
5. **Global rules**: Follow CLAUDE.md - Option A focus, Option B compatibility

---

## Goal
Implement Option A as specified in INITIAL.md:
- Add PlainOfflineProvider for non-Yjs state management
- Create PostgresOfflineAdapter implementing PlainCrudAdapter interface
- Add plain TipTap editor without collaboration extensions
- Store editor content as ProseMirror JSON/HTML (not Yjs binary)
- Preserve all 10 TipTap fixes in the plain implementation
- Keep existing Yjs implementation untouched for Option B

## Why
- **User Request**: "we struggled building the yjs collaboration. can we do the offline mode without yjs first?"
- **Simplicity**: Single-user scenarios don't need CRDT complexity
- **Performance**: Remove CRDT overhead for offline use
- **CLAUDE.md**: "Current focus is Option A (offline, single-user, no Yjs)"
- **Future Ready**: Sets foundation for dual-mode support

## What
### Current State (Already Implemented)
- PostgreSQL persistence WITH Yjs ✅
- All PostgreSQL adapters working ✅
- 10 TipTap fixes applied to Yjs mode ✅
- Binary Yjs storage in PostgreSQL ✅
- migrations/004_offline_queue.up.sql exists ✅

### Target State (Option A Addition)
- PostgreSQL persistence WITHOUT Yjs (new)
- PlainOfflineProvider for state management (new)
- TipTap editor plain variant (new)
- JSON/HTML storage in document_saves table
- All 10 fixes working in plain mode
- Existing Yjs mode continues to work

### Success Criteria (from INITIAL.md)
- [ ] Notes, annotations, branches, panels, and document saves (non-Yjs) persist correctly to Postgres
- [ ] Plain mode codepath contains no Yjs imports or Y.Doc usage
- [ ] All 10 TipTap fixes work in plain mode
- [ ] Offline queue works for single-user (use existing migrations/004_offline_queue.*; no duplicates)
- [ ] Electron fallback to local Postgres works when remote is unavailable
- [ ] Integration tests pass for both Web (API routes) and Electron (direct SQL)
- [ ] Renderer communicates with Postgres only via IPC (no direct DB handles/imports in renderer)
- [ ] Every migration includes both `.up.sql` and `.down.sql` with tested forward/backward application

### Out of Scope (per INITIAL.md)
- Yjs collaboration features (awareness, RelativePosition anchors, live CRDT)
- Mode switching UI and provider factory (deferred to Phase 2)
- Removing existing Yjs implementation

## All Needed Context

### Documentation & References
```yaml
# MUST READ - Authoritative specifications
- file: CLAUDE.md
  why: Project conventions and Option A/B definitions
  critical: "Current focus is Option A"
  
- file: INITIAL.md
  why: Complete specification for this implementation
  lines: 62-83 (PlainCrudAdapter interface)
  critical: Use existing migrations/004_offline_queue.up.sql
  
- file: docs/offline-first-implementation.md
  why: Reference architecture for offline mode
  critical: Map-based storage patterns, sync queue design

# Pattern References (as specified in INITIAL.md)
- file: lib/adapters/web-adapter-enhanced.ts
  why: Web adapter patterns to follow
  lines: 18-60 (offline queue implementation)
  
- file: lib/adapters/electron-adapter.ts
  why: Electron adapter patterns to follow
  lines: 42-97 (IPC handling patterns)

# Current Implementation to Preserve
- file: lib/yjs-provider.ts
  why: Contains all 10 fixes logic to port
  critical: Keep this file for Option B
  
- file: components/canvas/tiptap-editor.tsx
  why: Current editor with Yjs collaboration
  lines: 8-9 (imports to avoid in plain mode)

# 10 Critical Fixes to Preserve
- file: fixes_doc/2024-08-27-yjs-duplication-fix.md
- file: fixes_doc/2024-08-27-note-switching-fix.md
- file: fixes_doc/2024-08-27-async-loading-fix.md
- file: fixes_doc/2024-08-27-tiptap-deletion-fix.md
- file: fixes_doc/2024-08-27-ydoc-cross-note-fix.md
- file: fixes_doc/2024-08-27-reload-content-fix.md
- file: fixes_doc/2024-08-27-post-reload-persistence-fix.md
- file: fixes_doc/2024-08-27-multiple-reload-persistence-fix.md
- file: fixes_doc/2024-08-27-persistence-handler-closure-fix.md
- file: fixes_doc/2024-08-27-infinite-load-loop-fix.md

# External Documentation
- url: https://node-postgres.com/features/queries
  why: PostgreSQL query patterns
  section: Parameterized queries
  
- url: https://tiptap.dev/docs/editor/guide/output
  why: TipTap content formats
  section: JSON and HTML output
```

### Current Codebase Structure
```bash
annotation-backup/
├── lib/
│   ├── yjs-provider.ts              # KEEP: For Option B
│   ├── enhanced-yjs-provider.ts     # KEEP: For Option B
│   ├── adapters/
│   │   ├── postgres-adapter.ts      # KEEP: Base class
│   │   ├── electron-postgres-adapter.ts # KEEP: Works already
│   │   └── web-postgres-adapter.ts  # KEEP: Works already
│   └── database/                    # KEEP: Connection management
├── components/
│   └── canvas/
│       └── tiptap-editor.tsx        # KEEP: For Option B
├── migrations/
│   └── 004_offline_queue.up.sql    # USE: Existing migration
└── fixes_doc/                       # REFERENCE: All fixes
```

### Target Codebase Structure (Additions Only)
```bash
annotation-backup/
├── lib/
│   ├── providers/
│   │   └── plain-offline-provider.ts    # NEW: Non-Yjs provider
│   ├── adapters/
│   │   └── postgres-offline-adapter.ts  # NEW: PlainCrudAdapter impl
│   └── utils/
│       └── anchor-utils.ts              # NEW: Text-based anchoring
└── components/
    └── canvas/
        └── tiptap-editor-plain.tsx      # NEW: No collaboration
```

### Environment Requirements
```bash
# Required Tools
- Node.js 20.x or higher
- PostgreSQL 15.x
- npm or pnpm package manager

# Environment Variables
DATABASE_URL=postgres://postgres:postgres@localhost:5432/annotation_dev
NEXT_PUBLIC_COLLAB_MODE=plain  # For Option A
NEXT_PUBLIC_PERSISTENCE_MODE=api  # Web mode

# Electron-specific
DATABASE_URL_REMOTE=postgres://user:pass@remote:5432/annotation
DATABASE_URL_LOCAL=postgres://postgres:postgres@localhost:5432/annotation_dev
PERSISTENCE_MODE=direct
PG_CONN_TIMEOUT_MS=2000

# Development Setup
docker compose up -d postgres  # Start PostgreSQL
npm run db:migrate            # Run existing migrations
npm run dev                   # Start development server
```

### Critical Patterns from 10 Fixes
```typescript
// Fix #1: Content Duplication Prevention
// Pattern: Check empty content before initialization
const isEmpty = !content || content === '<p></p>' || content.trim() === ''

// Fix #2 & #5: Composite Key Caching
// Pattern: Always use noteId-panelId composite keys
const cacheKey = noteId ? `${noteId}-${panelId}` : panelId

// Fix #3: Async Loading States
// Pattern: Track loading with state and promises
const [isContentLoading, setIsContentLoading] = useState(true)
const loadingStates = new Map<string, Promise<void>>()

// Fix #4: No Deletion on Unmount
// Pattern: Never clear cache on component unmount

// Fix #6: Fragment Field Detection
// Pattern: Store editor field preference in metadata
const metadata = { fieldType: 'prosemirror' | 'default' }

// Fix #7-9: State Management
// Pattern: Use object state to avoid closures
const persistenceState = { initialized: false, version: 0 }

// Fix #10: Prevent Infinite Loops
// Pattern: Memoize and guard against duplicate operations
const content = useMemo(() => provider.getContent(id), [id])
```

## Implementation Blueprint

### Data Models and Types
```typescript
// lib/providers/plain-offline-provider.ts
import { PlainCrudAdapter } from '@/lib/adapters/postgres-offline-adapter'

export class PlainOfflineProvider {
  private documents = new Map<string, any>()
  private branches = new Map<string, Branch>()
  private adapter: PlainCrudAdapter
  private loadingStates = new Map<string, Promise<void>>()
  private persistenceState = {
    initialized: false,
    lastSave: Date.now(),
    pendingOps: 0
  }
  
  constructor(adapter: PlainCrudAdapter) {
    this.adapter = adapter
  }
  
  // Fix #2: Composite key pattern
  private getCacheKey(noteId: string, panelId: string): string {
    return noteId ? `${noteId}-${panelId}` : panelId
  }
  
  // Fix #3: Async loading with state tracking
  async loadDocument(noteId: string, panelId: string): Promise<any> {
    const cacheKey = this.getCacheKey(noteId, panelId)
    
    // Fix #10: Prevent duplicate loads
    if (this.loadingStates.has(cacheKey)) {
      return await this.loadingStates.get(cacheKey)
    }
    
    const loadPromise = this.adapter.loadDocument(panelId)
      .then(result => {
        if (result) {
          this.documents.set(cacheKey, result.content)
          return result.content
        }
        return null
      })
    
    this.loadingStates.set(cacheKey, loadPromise)
    
    try {
      return await loadPromise
    } finally {
      this.loadingStates.delete(cacheKey)
    }
  }
  
  // Fix #4: No deletion on unmount
  destroy() {
    // Do NOT clear documents cache
    this.persistenceState.initialized = false
  }
}

// lib/adapters/postgres-offline-adapter.ts
export class PostgresOfflineAdapter implements PlainCrudAdapter {
  private pool: Pool
  
  // Adapter method used by PlainOfflineProvider
  async saveDocument(
    noteId: string,
    panelId: string,
    content: ProseMirrorJSON | HtmlString,
    version: number
  ): Promise<void> {
    // Use parameterized query (pattern from postgres-adapter.ts)
    await this.pool.query(
      `INSERT INTO document_saves (note_id, panel_id, content, version, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (note_id, panel_id, version)
       DO UPDATE SET content = EXCLUDED.content`,
      [noteId, panelId, JSON.stringify(content), version]
    )
  }
  
  async enqueueOffline(op: QueueOp): Promise<void> {
    // Use existing offline_queue table from migration 004
    await this.pool.query(
      `INSERT INTO offline_queue (operation, entity_type, entity_id, payload, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [op.operation, op.entityType, op.entityId, JSON.stringify(op.payload)]
    )
  }
}
```

### Task Breakdown

```yaml
Task 1: Create PlainOfflineProvider
CREATE lib/providers/plain-offline-provider.ts:
  - IMPLEMENT state management without Y.Doc
  - USE Map for document/branch storage
  - PATTERN from: lib/yjs-provider.ts (logic only, no Yjs imports)
  - PRESERVE all 10 fixes:
    * getCacheKey for composite keys (Fix #2, #5)
    * Loading state tracking (Fix #3, #10)
    * No cleanup on destroy (Fix #4)
    * Metadata handling (Fix #6)
    * Object-based state (Fix #7-9)
  - ADD comprehensive JSDoc comments
  - VALIDATE: No Yjs imports in file

Task 2: Implement PostgresOfflineAdapter  
CREATE lib/adapters/postgres-offline-adapter.ts:
  - IMPLEMENT PlainCrudAdapter interface from INITIAL.md
  - EXTEND PostgresAdapter base class for connection reuse
  - PATTERN from: lib/adapters/postgres-adapter.ts
  - STORE content as JSON, not binary
  - USE existing offline_queue table (migration 004)
  - ADD proper error handling
  - VALIDATE: Follows web-adapter-enhanced.ts patterns

Task 3: Create Plain TipTap Editor
CREATE components/canvas/tiptap-editor-plain.tsx:
  - COPY from tiptap-editor.tsx as starting point
  - REMOVE these imports:
    * @tiptap/extension-collaboration
    * @tiptap/extension-collaboration-cursor
  - ENABLE History extension (disabled in Yjs mode)
  - PRESERVE Fix #1: Empty content handling
  - PRESERVE Fix #6: Field type detection
  - BIND onChange to save via provider
  - PATTERN from: Standard TipTap examples
  - VALIDATE: No Yjs references

Task 4: Create Anchor Utilities
CREATE lib/utils/anchor-utils.ts:
  - IMPLEMENT text-based anchoring (no Y.RelativePosition)
  - STORE: { start: number, end: number, context: string }
  - HANDLE position updates on text changes
  - PATTERN from: Simple text editor anchoring
  - ADD unit tests for position tracking
  - VALIDATE: Works with plain text offsets

Task 5: Update Canvas Panel (Minimal Changes)
MODIFY components/canvas/canvas-panel.tsx:
  - ADD temporary feature flag check
  - IF plain mode: use PlainOfflineProvider
  - ELSE: use existing YjsProvider (default)
  - PRESERVE all existing functionality
  - PRESERVE Fix #3: Loading state UI
  - PRESERVE Fix #10: Memoization patterns
  - MINIMAL changes to avoid breaking Option B

Task 6: Add document_saves migration (reversible)
CREATE migrations/005_document_saves.up.sql:
  - CREATE TABLE document_saves (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      panel_id UUID,
      content JSONB NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (note_id, panel_id, version)
    )
  - ADD indexes as needed (e.g., (note_id, panel_id, version DESC))
  - NOTE: Do not duplicate offline_queue migration; use existing 004

CREATE migrations/005_document_saves.down.sql:
  - DROP TABLE IF EXISTS document_saves

Task 6: Integration Wiring
MODIFY lib/provider-switcher.ts:
  - READ mode from env (`NEXT_PUBLIC_COLLAB_MODE=plain|yjs`) and localStorage override
  - IF plain: instantiate PlainOfflineProvider; ELSE: keep existing Yjs provider
  - REQUIRE reload to switch modes (no live hot-swap)
  - PRESERVE existing functionality for Yjs mode

Task 7: Add Electron IPC Support
MODIFY electron/main.js (if needed):
  - ADD IPC handlers for plain mode operations
  - PATTERN from: lib/adapters/electron-adapter.ts
  - REUSE existing PostgreSQL connection logic
  - ENSURE no direct DB access from renderer

Task 8: Create Plain Mode Tests
CREATE __tests__/plain-mode/:
  - TEST all 10 fixes work without Yjs
  - TEST PlainCrudAdapter interface compliance
  - TEST offline queue functionality
  - TEST performance vs Yjs mode
  - PATTERN from: Existing test structure
  - VALIDATE: 100% of fixes preserved

Task 9: Integration Testing
CREATE test-plain-mode.sh:
  - START app in plain mode
  - RUN through all 10 fix scenarios
  - VERIFY PostgreSQL storage format
  - CHECK no Yjs artifacts in DB
  - MEASURE performance improvements

Task 10: Documentation Updates
UPDATE README.md:
  - ADD Option A usage instructions
  - NOTE this is temporary until Phase 2
  - DOCUMENT environment variables
  - KEEP existing Option B docs
```

### Preserving the 10 Fixes - Implementation Details

```typescript
// Fix #1: Y.js Content Duplication Fix
// In tiptap-editor-plain.tsx
const PlainTipTapEditor = ({ content, onChange, noteId, panelId }) => {
  const editor = useEditor({
    extensions: [
      StarterKit, // WITH history this time
      Highlight,
      Underline,
      // NO Collaboration extension
    ],
    content: content || '',
    onCreate: ({ editor }) => {
      // Fix #1: Prevent duplicate "Start writing..."
      if (!content || content === '<p></p>' || content.trim() === '') {
        editor.commands.clearContent()
      }
    },
    onUpdate: ({ editor }) => {
      // Save to provider
      onChange(editor.getJSON())
    }
  })
  
  return <EditorContent editor={editor} />
}

// Fix #2, #3, #5, #10: Provider Implementation
// In plain-offline-provider.ts
class PlainOfflineProvider {
  // Fix #2 & #5: Composite keys
  private documents = new Map<string, any>()
  
  // Fix #3: Async loading
  private loadingStates = new Map<string, Promise<void>>()
  
  // Fix #7-9: Object state (not closures)
  private persistenceState = {
    initialized: false,
    updateCount: 0,
    lastSave: Date.now()
  }
  
  // Fix #10: Prevent infinite loops
  async loadDocument(noteId: string, panelId: string): Promise<any> {
    const cacheKey = this.getCacheKey(noteId, panelId)
    
    if (this.loadingStates.has(cacheKey)) {
      return await this.loadingStates.get(cacheKey)
    }
    
    // Load implementation...
  }
  
  // Fix #4: No deletion
  destroy() {
    // Do NOT clear documents
    this.persistenceState.initialized = false
  }
  
  // Fix #6: Metadata handling
  private getFieldType(metadata: any): string {
    return metadata?.useDefaultField ? 'default' : 'prosemirror'
  }
}
```

## Validation Loop

### Level 1: Syntax & Type Checking
```bash
# After each file creation
npm run lint          # No errors
npm run type-check    # TypeScript passes

# Check for Yjs imports in plain mode files
grep -r "from 'yjs'" lib/providers/plain-offline-provider.ts  # Should return nothing
grep -r "from 'yjs'" lib/adapters/postgres-offline-adapter.ts # Should return nothing
```

### Level 2: Fix Preservation Tests
```typescript
// __tests__/plain-mode/fix-preservation.test.ts
import { PlainOfflineProvider } from '@/lib/providers/plain-offline-provider'

describe('10 TipTap Fixes in Plain Mode', () => {
  let provider: PlainOfflineProvider
  
  beforeEach(() => {
    provider = new PlainOfflineProvider(mockAdapter)
  })
  
  test('Fix #1: No content duplication', () => {
    const editor = createPlainEditor('')
    expect(editor.getHTML()).not.toContain('Start writing')
  })
  
  test('Fix #2: Note switching with composite keys', async () => {
    await provider.saveDocument('note1', 'panel1', { type: 'doc', content: [] })
    await provider.saveDocument('note2', 'panel1', { type: 'doc', content: [] })
    
    const doc1 = await provider.loadDocument('note1', 'panel1')
    const doc2 = await provider.loadDocument('note2', 'panel1')
    expect(doc1).not.toEqual(doc2)
  })
  
  // ... test all 10 fixes
})

# Run tests
npm test __tests__/plain-mode/
```

### Level 3: Integration Testing
```bash
# Set environment for plain mode
export NEXT_PUBLIC_COLLAB_MODE=plain

# Start services
docker compose up -d postgres
npm run db:migrate

# Run app
npm run dev

# Manual test checklist:
- [ ] Create new note - no errors
- [ ] Add content - saves to PostgreSQL
- [ ] Check DB: SELECT * FROM document_saves; -- JSON content, not binary
- [ ] Reload page - content persists
- [ ] Switch notes - correct content loads
- [ ] No console errors about Yjs
- [ ] Performance feels snappier
```

### Level 4: Electron Testing
```bash
# Electron-specific tests
export COLLAB_MODE=plain
npm run electron:dev

# Verify:
- [ ] IPC handlers work for plain mode
- [ ] Local PostgreSQL fallback works
- [ ] Offline queue processes correctly
```

## Progressive Implementation Strategy

### Phase 1: Core Implementation (Current Phase)
- Implement PlainOfflineProvider
- Create PostgresOfflineAdapter
- Add plain TipTap editor
- Basic integration
- **Validation**: Plain mode works end-to-end
- **Rollback**: Simply don't use COLLAB_MODE=plain

### Phase 2: Mode Switching (Future - Out of Scope)
- Provider factory with proper switching
- UI for mode selection
- Data migration between modes
- Full dual-mode support
- **Note**: Explicitly out of scope per INITIAL.md

### Phase 3: Production Hardening (Future)
- Performance optimization
- Advanced offline sync strategies
- Conflict resolution for offline edits
- Monitoring and analytics

---

## Anti-Patterns to Avoid
- ❌ Don't import Yjs in any plain mode file
- ❌ Don't break existing Yjs functionality
- ❌ Don't implement mode switching UI (Phase 2)
- ❌ Don't modify existing PostgreSQL adapters
- ❌ Don't duplicate the offline_queue migration (use existing 004); do add reversible migrations for new tables like document_saves
- ❌ Don't skip any of the 10 fixes
- ❌ Don't over-engineer - keep it simple

## Risk Assessment
- **Technical Debt**: [2/9] - Adding alongside, not replacing
- **Integration Complexity**: [5/9] - New provider pattern
- **Regression Risk**: [3/9] - Isolated plain mode
- **Performance Impact**: [1/9] - Should improve
- **Security Risk**: [2/9] - Reusing secure patterns

### Mitigation Strategies
- Extensive fix preservation tests
- Keep changes isolated to new files
- Reuse existing patterns
- Gradual rollout with env variable
- Comprehensive documentation

---

## Implementation Guardrails
- Start with PlainOfflineProvider core
- Validate after each component
- Use existing patterns from referenced files
- Test with: `NEXT_PUBLIC_COLLAB_MODE=plain npm run dev`
- Check for regressions: existing tests should still pass
- Security: Use parameterized queries only

## Expected Challenges and Mitigations
- **Challenge**: Preserving all 10 fixes without Yjs
  - **Mitigation**: Port logic carefully, test each fix
  - **Fallback**: Can reference Yjs implementation
  
- **Challenge**: Anchor management without Y.RelativePosition
  - **Mitigation**: Simple offset-based anchoring
  - **Fallback**: Store extra context for robustness

- **Challenge**: Ensuring no Yjs leakage
  - **Mitigation**: Strict import checking in CI
  - **Fallback**: Automated linting rules

## Success Metrics
- All 10 fixes working in plain mode ✓
- Zero Yjs imports in plain files ✓
- 40%+ memory usage reduction ✓
- Sub-10ms save operations ✓
- All existing tests still pass ✓

---

## Confidence Score and Readiness Assessment

### Confidence Score: 8.5/10

**Strengths:**
- Clear requirements in updated INITIAL.md
- Existing patterns to follow (adapters)
- All 10 fixes well documented
- PostgreSQL infrastructure ready
- Migrations already exist

**Minor Concerns:**
- Anchor utilities need design work
- Integration points need careful handling

### Readiness Indicators
- **Green Light (8.5/10)**: Ready for implementation
- All context provided
- Clear implementation path
- Patterns well established

### Next Steps
1. Create PlainOfflineProvider first
2. Implement PostgresOfflineAdapter
3. Test core functionality
4. Add plain TipTap editor
5. Validate all 10 fixes preserved

Implementation can proceed with high confidence. The approach of adding Option A alongside Option B (rather than replacing) reduces risk significantly. Focus on preserving the 10 fixes while keeping the implementation simple and isolated from the existing Yjs code.
