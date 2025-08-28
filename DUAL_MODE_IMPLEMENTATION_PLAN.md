# Dual-Mode Implementation Plan

## Executive Summary

This plan outlines how to implement a dual-mode annotation system supporting both:
- **Option A**: Offline mode (single-user, no Yjs, simpler)
- **Option B**: Collaboration mode (multi-user, with Yjs, real-time sync)

Following INITIAL.md and CLAUDE.md, we'll build Option A first while ensuring architecture compatibility for Option B.

## Phase 1: Clean Up Current Implementation (Week 1)

### Current State
- Full Yjs implementation (actually Option B)
- 10 fixes applied for TipTap persistence issues
- Working but complex for single-user scenarios

### Tasks
1. **Document Current Yjs Implementation**
   - Map all Yjs touch points
   - Document existing provider architecture
   - Capture working patterns from fixes

2. **Create Feature Flag System**
   ```typescript
   // lib/config/collaboration-mode.ts
   export type CollaborationMode = 'offline' | 'collaborative'
   
   export function getCollaborationMode(): CollaborationMode {
     return process.env.NEXT_PUBLIC_COLLAB_MODE === 'collaborative' 
       ? 'collaborative' 
       : 'offline'
   }
   ```

3. **Preserve Working Code**
   - Keep all Yjs code in place
   - Add mode checks before Yjs initialization
   - Ensure existing functionality remains intact

## Phase 2: Implement Option A - Offline Mode (Week 2-3)

### 2.1 Provider Abstraction Layer
Create base provider interface that both modes implement:

```typescript
// lib/providers/base-provider.ts
interface BaseProvider {
  // Document operations
  createDocument(noteId: string, panelId: string): void
  saveDocument(noteId: string, panelId: string, content: any): Promise<void>
  loadDocument(noteId: string, panelId: string): Promise<any>
  
  // Branch operations  
  createBranch(branch: BranchInput): Promise<Branch>
  updateBranch(id: string, updates: Partial<Branch>): Promise<Branch>
  getBranch(id: string): Promise<Branch | null>
  
  // Metadata operations
  setMetadata(key: string, value: any): void
  getMetadata(key: string): any
  
  // Lifecycle
  initialize(): Promise<void>
  destroy(): void
}
```

### 2.2 Plain Offline Provider
Implement Option A provider:

```typescript
// lib/providers/plain-offline-provider.ts
class PlainOfflineProvider implements BaseProvider {
  private store: Map<string, any> = new Map()
  private adapter: PostgresOfflineAdapter
  
  async saveDocument(noteId: string, panelId: string, content: any) {
    // Direct save to PostgreSQL
    await this.adapter.saveDocument(panelId, content, version)
    // Update local store
    this.store.set(`${noteId}-${panelId}`, content)
  }
  
  // No Yjs, no CRDT, just simple state management
}
```

### 2.3 PostgreSQL Adapter for Offline Mode
```typescript
// lib/adapters/postgres-offline-adapter.ts
class PostgresOfflineAdapter {
  async saveDocument(panelId: string, content: any, version: number) {
    // Save as structured JSON, not Yjs binary
    await db.document_saves.create({
      panel_id: panelId,
      content: content, // ProseMirror JSON or HTML
      version: version,
      updated_at: new Date()
    })
  }
}
```

### 2.4 TipTap Editor Without Yjs
```typescript
// components/canvas/tiptap-editor-plain.tsx
const PlainTipTapEditor = ({ content, onChange }) => {
  const editor = useEditor({
    extensions: [
      StarterKit, // WITH history this time
      Highlight,
      Underline,
      // NO Collaboration extension
      // NO CollaborationCursor
    ],
    content: content,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON()) // or getHTML()
    }
  })
  
  return <EditorContent editor={editor} />
}
```

### 2.5 Database Schema Updates
```sql
-- Add mode column to documents
ALTER TABLE notes ADD COLUMN mode VARCHAR(20) DEFAULT 'offline' 
  CHECK (mode IN ('offline', 'collaborative'));

-- Ensure document_saves works for both modes
ALTER TABLE document_saves 
  ADD COLUMN content_type VARCHAR(20) DEFAULT 'json'
  CHECK (content_type IN ('json', 'html', 'yjs_update'));
```

## Phase 3: Mode Switching Infrastructure (Week 4)

### 3.1 Provider Factory
```typescript
// lib/providers/provider-factory.ts
export function createProvider(mode: CollaborationMode): BaseProvider {
  switch (mode) {
    case 'offline':
      return new PlainOfflineProvider()
    case 'collaborative':
      return new EnhancedYjsProvider() // Existing Yjs provider
    default:
      throw new Error(`Unknown mode: ${mode}`)
  }
}
```

### 3.2 Mode Context
```typescript
// contexts/collaboration-mode-context.tsx
const CollaborationModeContext = createContext<{
  mode: CollaborationMode
  setMode: (mode: CollaborationMode) => void
  provider: BaseProvider
}>()

export function CollaborationModeProvider({ children }) {
  const [mode, setMode] = useState<CollaborationMode>('offline')
  const provider = useMemo(() => createProvider(mode), [mode])
  
  return (
    <CollaborationModeContext.Provider value={{ mode, setMode, provider }}>
      {children}
    </CollaborationModeContext.Provider>
  )
}
```

### 3.3 Editor Component Switch
```typescript
// components/canvas/canvas-panel.tsx
function CanvasPanel({ noteId, panelId }) {
  const { mode, provider } = useCollaborationMode()
  
  // Load content based on mode
  const content = useContent(provider, noteId, panelId)
  
  return (
    <div className="panel">
      {mode === 'offline' ? (
        <PlainTipTapEditor content={content} onChange={...} />
      ) : (
        <YjsTipTapEditor ydoc={content} /> // Existing editor
      )}
    </div>
  )
}
```

## Phase 4: Data Migration Tools (Week 5)

### 4.1 Mode Conversion
```typescript
// lib/migration/mode-converter.ts
export async function convertToCollaborative(noteId: string) {
  // 1. Load offline document
  const doc = await loadOfflineDocument(noteId)
  
  // 2. Create Y.Doc
  const ydoc = new Y.Doc()
  const yXmlFragment = ydoc.getXmlFragment('prosemirror')
  
  // 3. Convert content
  const node = Node.fromJSON(schema, doc.content)
  prosemirrorToYXmlFragment(node, yXmlFragment)
  
  // 4. Save as Yjs
  const update = Y.encodeStateAsUpdate(ydoc)
  await saveYjsUpdate(noteId, update)
  
  // 5. Update mode flag
  await updateNoteMode(noteId, 'collaborative')
}
```

## Phase 5: UI/UX for Mode Selection (Week 6)

### 5.1 Mode Selector UI
```typescript
// components/mode-selector.tsx
function ModeSelector({ noteId }) {
  const { mode, setMode } = useCollaborationMode()
  
  return (
    <Select value={mode} onValueChange={setMode}>
      <SelectItem value="offline">
        <SingleUserIcon /> Offline Mode
      </SelectItem>
      <SelectItem value="collaborative">
        <MultiUserIcon /> Collaboration Mode
      </SelectItem>
    </Select>
  )
}
```

### 5.2 Feature Availability Indicators
- Show/hide collaboration features based on mode
- Display mode badge in UI
- Warning dialogs when switching modes

## Implementation Order

1. **Start with Phase 1** - Set up feature flags without breaking current functionality
2. **Implement Phase 2** - Build offline mode following INITIAL.md
3. **Add Phase 3** - Create switching infrastructure
4. **Defer Phase 4-5** - Migration tools and UI can come later

## Testing Strategy

### Offline Mode Tests
```bash
# Set environment
NEXT_PUBLIC_COLLAB_MODE=offline npm run dev

# Test checklist
- [ ] Create/edit notes without Yjs
- [ ].Document persistence to PostgreSQL
- [ ] No Yjs-related errors in console
- [ ] Performance improvement measurable
```

### Mode Switching Tests
```bash
# Test both modes
- [ ] Start in offline, create content
- [ ] Switch to collaborative
- [ ] Verify content preserved
- [ ] Collaboration features activate
```

## Success Metrics

1. **Offline Mode**
   - 50% reduction in memory usage
   - Instant load times (no CRDT processing)
   - Zero Yjs proxy errors

2. **Collaborative Mode**
   - Maintains all current functionality
   - Real-time sync when enabled
   - Smooth migration between modes

## Risk Mitigation

1. **Keep existing code intact** during Phase 1-2
2. **Feature flag everything** for gradual rollout
3. **Extensive testing** before removing any Yjs code
4. **Clear migration paths** for existing data

## Next Steps

1. Review this plan
2. Create PRP for Phase 1 using PRP template
3. Begin implementation with feature flags
4. Iterate based on testing results

This approach follows CLAUDE.md's directive to implement Option A while maintaining Yjs compatibility, giving users the choice between simplicity and collaboration.