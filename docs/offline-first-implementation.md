# Option A: Plain Offline Mode Implementation

## Overview
This document describes the implementation of Option A - a plain offline mode with PostgreSQL persistence, designed for single-user scenarios without YJS CRDTs.

## Key Features

### 1. Direct Property Access
- No YJS proxy complications
- Direct access to properties like `branch.originalText` always works
- Map-based storage via `PlainOfflineProvider`

### 2. PostgreSQL-Only Persistence
- Primary persistence layer using PostgreSQL
- No IndexedDB fallback required
- Schema compatible with future Option B (YJS mode)

### 3. Platform Support
- **Web**: API routes for database access
- **Electron**: IPC handlers with local PostgreSQL failover
- Consistent adapter interface across platforms

### 4. No YJS Runtime
- YJS completely removed from Option A runtime
- Maintains schema compatibility for future migration
- Simpler debugging and data flow

## Architecture Components

### Core Components
1. **PlainOfflineProvider** (`lib/providers/plain-offline-provider.ts`)
   - Map-based storage for branches, notes, panels
   - Implements CRUD operations without YJS
   - Event-driven updates via EventTarget

2. **PlainCrudAdapter Interface** (`lib/providers/plain-offline-provider.ts`)
   - Standardized interface for persistence
   - Platform-agnostic CRUD operations
   - Supports Web, Electron, and test implementations

3. **Platform Adapters**
   - **WebPostgresOfflineAdapter** (`lib/adapters/web-postgres-offline-adapter.ts`)
     - Uses fetch() for API calls
     - No direct database access
   - **ElectronPostgresOfflineAdapter** (`lib/adapters/electron-postgres-offline-adapter.ts`)
     - Uses IPC for main process communication
     - Supports local PostgreSQL failover

4. **TiptapEditorPlain** (`components/canvas/tiptap-editor-plain.tsx`)
   - TipTap without YJS collaboration
   - Direct HTML/JSON persistence
   - Preserves all 10 critical TipTap fixes

### Database Schema
```sql
-- Document saves table (Option A primary storage)
CREATE TABLE document_saves (
  panel_id VARCHAR(255) PRIMARY KEY,
  content TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Core tables (shared between Option A and B)
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE branches (
  id VARCHAR(255) PRIMARY KEY,
  note_id VARCHAR(255),
  parent_id VARCHAR(255),
  type VARCHAR(50),
  original_text TEXT,
  metadata JSONB DEFAULT '{}',
  anchors JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE panels (
  id VARCHAR(255) PRIMARY KEY,
  note_id VARCHAR(255),
  position JSONB,
  dimensions JSONB,
  state VARCHAR(50),
  last_accessed TIMESTAMPTZ DEFAULT NOW()
);
```

## Usage

### Enable Plain Mode (Option A)
```bash
# Via environment variable
NEXT_PUBLIC_COLLAB_MODE=plain npm run dev

# Or in .env.local
NEXT_PUBLIC_COLLAB_MODE=plain
```

### Using the PlainOfflineProvider
```typescript
import { getPlainProvider } from '@/lib/provider-switcher'

function MyComponent() {
  const provider = getPlainProvider()
  
  // Create note
  const note = await provider.createNote({
    title: 'My Note',
    content: 'Initial content'
  })
  
  // Create branch - direct property access works
  const branch = await provider.createBranch({
    noteId: note.id,
    originalText: 'Selected text',
    type: 'note'
  })
  
  // No proxy errors!
  console.log(branch.originalText)
}
```

### Platform-Specific Usage

#### Web Mode
```typescript
// Automatically uses WebPostgresOfflineAdapter
// All database operations go through API routes
const provider = getPlainProvider()
```

#### Electron Mode
```typescript
// Automatically uses ElectronPostgresOfflineAdapter
// Database operations use IPC channels
// Supports local PostgreSQL failover
const provider = getPlainProvider()
```

## Migration Between Modes

### From Option B (YJS) to Option A (Plain)
```bash
# 1. Export YJS data (while in Option B mode)
npm run export:yjs-to-postgres

# 2. Switch to Plain mode
NEXT_PUBLIC_COLLAB_MODE=plain

# 3. Data is now accessible in Option A
```

### From Option A (Plain) to Option B (YJS)
```bash
# Data schema is compatible
# Simply switch modes:
NEXT_PUBLIC_COLLAB_MODE=yjs
```

## Testing

### Validation Gates
```bash
# 1. Lint check
npm run lint

# 2. Type check
npm run type-check

# 3. Unit tests
npm run test

# 4. Start PostgreSQL
docker compose up -d postgres

# 5. Integration tests
npm run test:integration

# 6. E2E tests
npm run test:e2e
```

### Manual Testing Checklist
1. Enable plain mode: `NEXT_PUBLIC_COLLAB_MODE=plain`
2. Create a new note
3. Add branches (note, explore, promote types)
4. Verify direct property access (no proxy errors)
5. Refresh page - verify persistence
6. Test in Electron mode if applicable

## Performance

- Map-based operations: <5ms
- Direct PostgreSQL queries
- No CRDT overhead
- Simplified data flow

## Troubleshooting

### Common Issues

1. **Provider not initialized**
   - Check PlainModeProvider is in app layout
   - Verify NEXT_PUBLIC_COLLAB_MODE=plain
   - Check browser console for initialization logs

2. **API routes 404**
   - Ensure all /api/postgres-offline routes exist
   - Check Next.js is running
   - Verify DATABASE_URL is set

3. **Electron IPC errors**
   - Check preload.js exposes postgres-offline channels
   - Verify IPC handlers are registered
   - Check main process PostgreSQL connection

## API Reference

### PlainOfflineProvider Methods
```typescript
interface PlainOfflineProvider {
  // Notes
  createNote(input: CreateNoteInput): Promise<Note>
  updateNote(id: string, updates: Partial<Note>): Promise<Note>
  deleteNote(id: string): Promise<void>
  listNotes(): Promise<Note[]>
  
  // Branches
  createBranch(input: CreateBranchInput): Promise<Branch>
  updateBranch(id: string, updates: Partial<Branch>): Promise<Branch>
  deleteBranch(id: string): Promise<void>
  listBranches(noteId: string): Promise<Branch[]>
  
  // Documents
  saveDocument(noteId: string, panelId: string, content: ProseMirrorJSON | HtmlString): Promise<void>
  loadDocument(noteId: string, panelId: string): Promise<ProseMirrorJSON | HtmlString | null>
  
  // Queue (Option A uses immediate operations)
  enqueue(op: QueueOp): Promise<void>
  flushQueue(): Promise<void>
}
```

### Platform Adapters
All adapters implement the `PlainCrudAdapter` interface with platform-specific transport:
- WebPostgresOfflineAdapter: Uses fetch()
- ElectronPostgresOfflineAdapter: Uses IPC
- TestAdapter: In-memory for testing