# Offline Mode Roadmap (Without Yjs)
*Focus: Making the annotation system powerful for single-user offline use*
*Updated: 2025-08-30 - Removed IndexedDB/localStorage references per CLAUDE.md*

## ✅ Completed
1. **PostgreSQL Migration** - Database persistence
2. **Batch Implementation** - 90% reduction in DB writes
3. **Plain Mode Provider** - Non-Yjs document handling

## 🎯 Next Priority Features

### 1. **Offline Queue with Sync Recovery** (CRITICAL)
**Why:** Essential for true offline-first experience
**Implementation:**
- Queue operations when offline
- Auto-sync when connection restored
- Conflict resolution for offline edits
- Visual indicator of sync status

**Files to create/modify:**
- `lib/sync/offline-queue-manager.ts`
- `lib/sync/sync-coordinator.ts`
- `components/sync-status-indicator.tsx`

### 2. **Full-Text Search** (HIGH IMPACT)
**Why:** Find anything across all annotations instantly
**Implementation:**
- PostgreSQL full-text search indexes
- Search across notes, annotations, panels
- Fuzzy matching and relevance ranking
- Search history and saved searches

**Files to create:**
- `app/api/search/route.ts`
- `lib/search/search-engine.ts`
- `components/search-panel.tsx`

### 3. **Export/Import System** (USER REQUESTED)
**Why:** Data portability and backup
**Implementation:**
- Export to Markdown, JSON, PDF
- Import from various formats
- Batch export of multiple notes
- Preserve annotation relationships

**Files to create:**
- `lib/export/markdown-exporter.ts`
- `lib/export/pdf-exporter.ts`
- `lib/import/import-manager.ts`

### 4. **Version History & Rollback** (DATA SAFETY)
**Why:** Never lose work, compare changes
**Implementation:**
- Automatic versioning (already have versions!)
- Visual diff between versions
- One-click rollback
- Version branching

**Files to create:**
- `components/version-history-panel.tsx`
- `lib/versions/version-comparator.ts`
- `app/api/versions/[noteId]/route.ts`

### 5. **Smart Linking System** (KNOWLEDGE GRAPH)
**Why:** Connect related annotations
**Implementation:**
- Auto-detect references between notes
- Bidirectional links
- Link preview on hover
- Graph visualization of connections

**Files to create:**
- `lib/linking/link-detector.ts`
- `components/link-graph.tsx`
- `lib/linking/reference-manager.ts`

### 6. **Tagging & Categories** (ORGANIZATION)
**Why:** Better organization and filtering
**Implementation:**
- Hierarchical tags
- Auto-tagging based on content
- Tag-based filtering
- Tag analytics

**Database schema:**
```sql
CREATE TABLE tags (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  parent_id UUID REFERENCES tags(id),
  color VARCHAR(7),
  created_at TIMESTAMP
);

CREATE TABLE note_tags (
  note_id UUID REFERENCES notes(id),
  tag_id UUID REFERENCES tags(id),
  PRIMARY KEY (note_id, tag_id)
);
```

### 7. **Advanced Editor Features** (PRODUCTIVITY)
**Why:** Power user features
**Implementation:**
- Keyboard shortcuts system
- Command palette (Cmd+K)
- Split view editing
- Focus mode
- Custom themes

### 8. **Offline Media Management** (RICH CONTENT)
**Why:** Handle images/files offline
**Implementation:**
- Local media storage
- Image optimization
- File attachments
- Media gallery view

## 🚀 Recommended Implementation Order

### Phase 1: Foundation (Weeks 1-2)
1. **Offline Queue** - Critical for reliability
2. **Sync Status Indicator** - User feedback

### Phase 2: Discovery (Weeks 3-4)
3. **Full-Text Search** - Find anything
4. **Tagging System** - Organization

### Phase 3: Safety (Weeks 5-6)
5. **Version History** - Never lose work
6. **Export/Import** - Data portability

### Phase 4: Power Features (Weeks 7-8)
7. **Smart Linking** - Knowledge connections
8. **Advanced Editor** - Productivity boost

## Technical Decisions

### Storage Strategy (CLAUDE.md Compliant)
- **Primary**: PostgreSQL for ALL persistence (no IndexedDB)
- **Electron**: Local PostgreSQL via IPC handlers
- **Web**: Memory-only with explicit warnings about data loss
- **Cache**: In-memory for frequently accessed
- **Media**: File system for images/attachments (Electron only)
- **Search**: PostgreSQL FTS + GIN indexes

### Offline Architecture
```
User Action → Offline Queue → Sync Manager → PostgreSQL
                ↓                   ↓
            Local Cache      Conflict Resolver
```

### Performance Targets
- Search: < 100ms for 10,000 notes
- Sync: < 2s for 100 operations
- Export: < 5s for 1,000 notes
- Version load: < 500ms

## Next Immediate Step

**Start with Offline Queue Manager:**

```typescript
// lib/sync/offline-queue-manager.ts
interface QueuedOperation {
  id: string
  type: 'create' | 'update' | 'delete'
  table_name: 'notes' | 'branches' | 'panels' | 'document_saves'
  entity_id: string
  data: any
  timestamp: number
  retries: number
  status: 'pending' | 'syncing' | 'failed' | 'completed'
}

class OfflineQueueManager {
  private queue: QueuedOperation[] = []
  private isOnline = navigator.onLine
  
  async addToQueue(operation: Omit<QueuedOperation, 'id' | 'timestamp' | 'retries' | 'status'>) {
    // Add to queue with correct schema (type, table_name, entity_id, data)
    // Persist to PostgreSQL via IPC (Electron) or memory-only (Web)
    // Attempt sync if online
  }
  
  async processQueue() {
    // Process pending operations
    // Handle failures with retry
    // Update UI with progress
  }
}
```

## Success Metrics
- Electron: Zero data loss (durable Postgres queue via IPC)
- Web: Clear offline warning; potential loss on reload (memory-only queue)
- Sub-second search across indexed content
- 100% successful sync of queued operations (Electron)
- < 1% conflict rate with early detection
- 90% task completion without internet (Electron)

## Questions to Answer First

1. **Offline Duration**: How long should we support offline mode? Days? Weeks?
2. **Conflict Resolution**: Last-write-wins or merge strategies?
3. **Search Scope**: Just text or include metadata/tags?
4. **Export Formats**: Which formats are most important?
5. **Version Retention**: How many versions to keep?

## Resources Needed
- PostgreSQL FTS documentation
- PostgreSQL for offline queue (Electron via IPC)
- Memory-only queue for Web (with data loss warnings)
- PDF generation library (pdfkit or similar)
- Diff algorithm for version comparison
- Graph visualization library (d3 or cytoscape)
