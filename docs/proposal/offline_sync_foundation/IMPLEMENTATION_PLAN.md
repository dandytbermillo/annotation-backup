# Offline Sync Foundation - Implementation Plan
*Updated: 2025-08-30 - Fixed schema, paths, and CLAUDE.md compliance*  
*Version: 2.0 - Corrected based on implementation status review*

## ⚠️ Critical Requirements (CLAUDE.md Compliant)

1. **PostgreSQL-only persistence** - No IndexedDB, no localStorage for persistence
2. **Correct schema from migration 004**: `type`, `table_name`, `entity_id`, `data` (NOT `operation`, `entity_type`, `payload`)
3. **Extend existing IPC**: Use `electron/ipc/postgres-offline-handlers.ts` (NOT create new files)
4. **Platform-specific approach**:
   - **Electron**: PostgreSQL via IPC (durable, zero data loss)
   - **Web**: Memory-only with warnings (not durable, potential loss on reload)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    ELECTRON                             │
├─────────────────────────────────────────────────────────┤
│  Renderer Process          │      Main Process          │
│  ┌──────────────┐         │      ┌──────────────┐      │
│  │ UI Components │ ──IPC──┼─────▶│  IPC Handlers │      │
│  │              │         │      └──────┬───────┘      │
│  │ Sync Status  │         │             │              │
│  └──────────────┘         │      ┌──────▼───────┐      │
│                           │      │ Local Postgres│      │
│                           │      │ offline_queue │      │
│                           │      └──────────────┘      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                      WEB                                │
├─────────────────────────────────────────────────────────┤
│  Browser                   │      Server                │
│  ┌──────────────┐         │      ┌──────────────┐      │
│  │ UI Components │ ──API──┼─────▶│  API Routes   │      │
│  │              │         │      └──────┬───────┘      │
│  │ Memory Queue │         │             │              │
│  └──────────────┘         │      ┌──────▼───────┐      │
│                           │      │Remote Postgres│      │
│                           │      └──────────────┘      │
└─────────────────────────────────────────────────────────┘
```

## Phase 1: Offline Queue Infrastructure (Week 1)

### 1.1 Database Schema (Already Exists - Migration 004)
```sql
-- CORRECT SCHEMA from migrations/004_offline_queue.up.sql
CREATE TABLE IF NOT EXISTS offline_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('create', 'update', 'delete')),
  table_name VARCHAR(50) NOT NULL CHECK (table_name IN ('notes', 'branches', 'panels')),
  entity_id UUID NOT NULL,
  data JSONB NOT NULL,
  retry_count INTEGER DEFAULT 0,
  status offline_operation_status DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  INDEX idx_offline_queue_status (status),
  INDEX idx_offline_queue_created (created_at)
);
```

### 1.2 Electron IPC Handlers
**File**: `electron/ipc/postgres-offline-handlers.ts` (EXTEND EXISTING FILE)
```typescript
// Add to existing handlers in electron/ipc/postgres-offline-handlers.ts

// Queue an operation when offline (correct schema; uses existing channel name)
ipcMain.handle('postgres-offline:enqueueOffline', async (event, op) => {
  // Map any UI-level entity types to actual table names if needed
  const tableNameMap: Record<string, string> = { 
    note: 'notes', 
    branch: 'branches', 
    panel: 'panels', 
    document: 'document_saves' 
  }
  
  // Support both old and new field names for compatibility
  const table_name = tableNameMap[op.entityType] || op.table_name
  const type = op.operation || op.type
  const entity_id = op.entityId || op.entity_id
  const data = op.payload || op.data
  
  const result = await pool.query(
    `INSERT INTO offline_queue (type, table_name, entity_id, data, status)
     VALUES ($1, $2, $3, $4::jsonb, 'pending')
     RETURNING id, created_at`,
    [type, table_name, entity_id, JSON.stringify(data)]
  )
  
  return result.rows[0]
})

// Optional status endpoint (new): summarize pending/failed for UI polling
ipcMain.handle('postgres-offline:queueStatus', async () => {
  const result = await pool.query(
    `SELECT status, COUNT(*) as count
     FROM offline_queue
     WHERE created_at > NOW() - INTERVAL '24 hours'
     GROUP BY status`
  )
  
  return result.rows
})

// Processing: use existing channel name (flushQueue) implemented in this file
// No new handler is required here; call 'postgres-offline:flushQueue' from the UI when online resumes.
// The existing flushQueue handler (lines 330-397) already processes the queue correctly.
```

### 1.3 Web API Endpoints
**File**: `app/api/offline-queue/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server'

// Web doesn't persist queue - just returns sync status
export async function GET(request: NextRequest) {
  return NextResponse.json({
    isOnline: true,
    message: 'Web mode requires active connection',
    queueSupported: false
  })
}

// Immediate sync attempt for web
export async function POST(request: NextRequest) {
  const operation = await request.json()
  
  // Try immediate execution
  try {
    const result = await executeOperation(operation)
    return NextResponse.json({ 
      success: true, 
      result,
      queued: false 
    })
  } catch (error) {
    // In web mode, we don't queue - just fail
    return NextResponse.json({ 
      success: false,
      error: 'Operation failed - no offline queue in web mode',
      message: 'Please check your connection and retry'
    }, { status: 503 })
  }
}
```

### 1.4 Sync Status Component
**File**: `components/sync-status-indicator.tsx`
```typescript
'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'

interface QueueStatus {
  pending: number
  processing: number
  failed: number
}

export function SyncStatusIndicator() {
  const [isOnline, setIsOnline] = useState(true)
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [isElectron, setIsElectron] = useState(false)
  
  useEffect(() => {
    // Detect platform
    setIsElectron(typeof window !== 'undefined' && !!(window as any).electron)
    
    // Monitor online status
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    setIsOnline(navigator.onLine)
    
    // Poll queue status (Electron only)
    if (isElectron) {
      const interval = setInterval(async () => {
        const status = await (window as any).electron.ipcRenderer.invoke('postgres-offline:queueStatus')
        const formatted = status.reduce((acc: any, row: any) => {
          acc[row.status] = parseInt(row.count)
          return acc
        }, {})
        setQueueStatus(formatted)
      }, 5000)
      
      return () => clearInterval(interval)
    }
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [isElectron])
  
  // Process queue when back online (Electron)
  useEffect(() => {
    if (isOnline && isElectron && queueStatus?.pending) {
      (window as any).electron.ipcRenderer.invoke('postgres-offline:flushQueue')
    }
  }, [isOnline, isElectron, queueStatus])
  
  if (!isElectron && isOnline) {
    return (
      <Badge variant="outline" className="bg-green-50">
        <div className="w-2 h-2 bg-green-500 rounded-full mr-2" />
        Online
      </Badge>
    )
  }
  
  if (!isElectron && !isOnline) {
    return (
      <Badge variant="destructive">
        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mr-2" />
        Offline - Changes may be lost
      </Badge>
    )
  }
  
  // Electron with queue
  const totalPending = queueStatus?.pending || 0
  const hasFailed = (queueStatus?.failed || 0) > 0
  
  return (
    <div className="flex items-center gap-2">
      <Badge 
        variant={isOnline ? "outline" : "secondary"}
        className={isOnline ? "bg-green-50" : "bg-yellow-50"}
      >
        <div className={`w-2 h-2 rounded-full mr-2 ${
          isOnline ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'
        }`} />
        {isOnline ? 'Online' : 'Offline'}
      </Badge>
      
      {totalPending > 0 && (
        <Badge variant="secondary">
          {totalPending} pending
        </Badge>
      )}
      
      {hasFailed && (
        <Badge variant="destructive">
          {queueStatus?.failed} failed
        </Badge>
      )}
    </div>
  )
}
```

## Queue Engine Upgrades (Reliability & Control)

### 1) Operation Envelope (Conflict-Aware)
Fields added to each queued op (and IPC/API payloads):
- **idempotency_key**: string (UUIDv4 recommended). Unique per logical operation; prevents duplicate processing on retries.
- **origin_device_id**: string. Useful for multi-device reconciliation/telemetry.
- **schema_version**: integer (default 1). Enables forward-compatible evolution of payload shape.
- **base_version**: integer | null. Last known server version for the target entity.
- **base_hash**: text | null. Hash of last known server content for fast drift detection.
- **created_at**: timestamp. Operation creation time on client.

Envelope example (renderer → IPC):
```json
{
  "idempotency_key": "9c9f5c42-3bde-4a1d-9b70-58b4dbe3bd2b",
  "origin_device_id": "macbook-pro-dandy",
  "schema_version": 1,
  "type": "update",
  "table_name": "document_saves",
  "entity_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "base_version": 7,
  "base_hash": "sha256:3f0d…",
  "data": { "content": {/* ProseMirror JSON */}, "noteId":"…", "panelId":"…" },
  "created_at": "2025-08-30T06:55:00Z"
}
```

Server-side conflict check (pseudocode):
```sql
-- Fail fast if base_version or base_hash mismatches server
-- (Application enforces; DB may optionally re-check with constraints in advanced setups)
```

### 2) Queue Table Enhancements
Columns to add to offline_queue:
- **idempotency_key** TEXT UNIQUE NOT NULL
- **origin_device_id** TEXT
- **schema_version** INTEGER DEFAULT 1 NOT NULL
- **priority** SMALLINT DEFAULT 0 NOT NULL (higher value = higher priority)
- **expires_at** TIMESTAMPTZ (TTL for stale ops)
- **group_id** UUID (group related ops for ordering)
- **depends_on** UUID[] (ensure processing order: create → update)

Indexes:
- Unique: (idempotency_key)
- Processing helpers: (status, priority DESC, created_at ASC), (table_name, entity_id, status)

### 3) Coalescing & Batching
- **Coalescing** (pre-flush): For multiple updates to same (table_name, entity_id), keep the last write or merge patches.
- **Batching**: Flush in small batches per table to preserve local ordering and reduce roundtrips; wrap per-batch in a transaction.

### 4) Backoff, Dead-Letter, TTL
- Exponential backoff with jitter; cap retries (e.g., 5).
- On exceeding retries, move to offline_dead_letter (see SQL below).
- Drop or demote ops past expires_at to avoid queue bloat.

### 5) Web Mode Export Package (No Durable Storage)
Provide "Export Offline Package":
- JSON file with queued operations and metadata (idempotency_key, device, timestamps).
- "Import Package" endpoint to enqueue on reconnect in a trusted context (Electron or server).

## Conflict Policy (No Yjs)
- **Early detection**:
  - base_version mismatch → conflict flag.
  - base_hash mismatch → likely conflict; faster than deep diff.
- **Merge strategy** (ProseMirror JSON aware):
  - Different blocks → auto-merge.
  - Same block: attempt text-range merge; formatting-only changes auto-merge.
  - Hard conflicts → UI dialog (keep local, keep remote, block-wise merge).
- Last-write-wins only with explicit user confirmation for unresolved conflicts.

## Observability & Ops
- **Metrics** (SQL View or API):
  - pending_count, failed_count, avg_retry_count, p50/p95 processing time.
- **Dead-letter triage UI**:
  - Inspect error_message, requeue/discard with reason.
- **Cleanup**:
  - Purge processed items older than N days; apply backpressure warnings when queue grows.

## Testing
- **Chaos tests**: Simulate network loss mid-flush; random server failures.
- **Property-based tests**: Validate coalescing rules & dependency ordering.
- **Migration guardrails**: Dry-run analyzers to ensure FTS additions don't lock tables long.

## Implementation Steps (Addenda)
1. Extend IPC to accept envelope fields (idempotency_key, base_version, base_hash, etc.).
2. Add coalescing pass before flush (Electron only).
3. Implement exponential backoff + dead-letter move.
4. Add metrics endpoint/view; wire to dev/admin UI.
5. Provide "Export Offline Package"/"Import Package" flows for Web mode contingencies.

## Phase 2: Full-Text Search (Week 2)

### 2.1 Database Migrations
**File**: `migrations/010_add_document_saves_search_vector.up.sql`
```sql
-- Add search vector to document_saves (notes/panels already covered in migration 003)
ALTER TABLE document_saves
ADD COLUMN IF NOT EXISTS search_vector tsvector
GENERATED ALWAYS AS (
  to_tsvector('english', COALESCE(content::text, ''))
) STORED;

CREATE INDEX IF NOT EXISTS idx_documents_search ON document_saves USING GIN(search_vector);
```

### 2.2 Search API
**File**: `app/api/search/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  const type = searchParams.get('type') || 'all'
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = parseInt(searchParams.get('offset') || '0')
  
  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 })
  }
  
  const tsquery = `plainto_tsquery('english', $1)`
  const results: any = {}
  
  // Search notes
  if (type === 'all' || type === 'notes') {
    const notesResult = await pool.query(
      `SELECT 
        id, title, content,
        ts_rank(search_vector, ${tsquery}) as rank,
        ts_headline('english', content::text, ${tsquery}, 
          'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=10') as excerpt
       FROM notes
       WHERE search_vector @@ ${tsquery}
       ORDER BY rank DESC
       LIMIT $2 OFFSET $3`,
      [query, limit, offset]
    )
    results.notes = notesResult.rows
  }
  
  // Search annotations
  if (type === 'all' || type === 'annotations') {
    const annotationsResult = await pool.query(
      `SELECT 
        a.id, a.note_id, a.type, a.content,
        n.title as note_title,
        ts_rank(a.search_vector, ${tsquery}) as rank,
        ts_headline('english', a.content::text, ${tsquery},
          'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=10') as excerpt
       FROM annotations a
       JOIN notes n ON a.note_id = n.id
       WHERE a.search_vector @@ ${tsquery}
       ORDER BY rank DESC
       LIMIT $2 OFFSET $3`,
      [query, limit, offset]
    )
    results.annotations = annotationsResult.rows
  }
  
  // Search suggestions (for autocomplete)
  const suggestions = await pool.query(
    `SELECT DISTINCT
       ts_stat('SELECT search_vector FROM notes')::text as term
     WHERE term ILIKE $1 || '%'
     LIMIT 5`,
    [query]
  )
  
  return NextResponse.json({
    query,
    results,
    suggestions: suggestions.rows,
    total: (results.notes?.length || 0) + (results.annotations?.length || 0)
  })
}
```

### 2.3 Search Component
**File**: `components/search-panel.tsx`
```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { debounce } from 'lodash'

interface SearchResult {
  notes?: Array<{
    id: string
    title: string
    excerpt: string
    rank: number
  }>
  annotations?: Array<{
    id: string
    note_id: string
    note_title: string
    excerpt: string
    rank: number
  }>
}

export function SearchPanel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  
  const performSearch = useCallback(
    debounce(async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults(null)
        return
      }
      
      setLoading(true)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`)
        const data = await response.json()
        setResults(data.results)
        setSuggestions(data.suggestions?.map((s: any) => s.term) || [])
      } catch (error) {
        console.error('Search failed:', error)
      } finally {
        setLoading(false)
      }
    }, 300),
    []
  )
  
  useEffect(() => {
    performSearch(query)
  }, [query, performSearch])
  
  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
        <Input
          type="text"
          placeholder="Search notes and annotations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 pr-10"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 transform -translate-y-1/2"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>
      
      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="mt-2 flex gap-2">
          {suggestions.map((suggestion) => (
            <Badge
              key={suggestion}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => setQuery(suggestion)}
            >
              {suggestion}
            </Badge>
          ))}
        </div>
      )}
      
      {/* Results */}
      {loading && (
        <div className="mt-4 text-center text-gray-500">Searching...</div>
      )}
      
      {results && (
        <div className="mt-4 space-y-4">
          {/* Notes Results */}
          {results.notes && results.notes.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Notes</h3>
              {results.notes.map((note) => (
                <Card key={note.id} className="p-3 mb-2 cursor-pointer hover:bg-gray-50">
                  <h4 className="font-medium">{note.title}</h4>
                  <div 
                    className="text-sm text-gray-600 mt-1"
                    dangerouslySetInnerHTML={{ __html: note.excerpt }}
                  />
                  <Badge variant="outline" className="mt-2 text-xs">
                    Relevance: {(note.rank * 100).toFixed(0)}%
                  </Badge>
                </Card>
              ))}
            </div>
          )}
          
          {/* Annotations Results */}
          {results.annotations && results.annotations.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">Annotations</h3>
              {results.annotations.map((annotation) => (
                <Card key={annotation.id} className="p-3 mb-2 cursor-pointer hover:bg-gray-50">
                  <div className="text-xs text-gray-500 mb-1">
                    From: {annotation.note_title}
                  </div>
                  <div 
                    className="text-sm text-gray-600"
                    dangerouslySetInnerHTML={{ __html: annotation.excerpt }}
                  />
                  <Badge variant="outline" className="mt-2 text-xs">
                    Relevance: {(annotation.rank * 100).toFixed(0)}%
                  </Badge>
                </Card>
              ))}
            </div>
          )}
          
          {/* No results */}
          {(!results.notes || results.notes.length === 0) && 
           (!results.annotations || results.annotations.length === 0) && (
            <div className="text-center text-gray-500 mt-8">
              No results found for "{query}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

## Phase 3: Version History UI (Week 3)

### 3.1 Version API
**File**: `app/api/versions/[noteId]/[panelId]/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

export async function GET(
  request: NextRequest,
  { params }: { params: { noteId: string; panelId: string } }
) {
  const { noteId, panelId } = params
  
  // Get all versions
  const versions = await pool.query(
    `SELECT id, version, content, created_at
     FROM document_saves
     WHERE note_id = $1 AND panel_id = $2
     ORDER BY version DESC
     LIMIT 50`,
    [noteId, panelId]
  )
  
  return NextResponse.json({
    noteId,
    panelId,
    versions: versions.rows,
    total: versions.rowCount
  })
}

// Restore a specific version
export async function POST(
  request: NextRequest,
  { params }: { params: { noteId: string; panelId: string } }
) {
  const { noteId, panelId } = params
  const { version } = await request.json()
  
  // Get the version to restore
  const versionData = await pool.query(
    `SELECT content FROM document_saves
     WHERE note_id = $1 AND panel_id = $2 AND version = $3`,
    [noteId, panelId, version]
  )
  
  if (versionData.rows.length === 0) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  }
  
  // Create new version with restored content
  const nextVersion = await pool.query(
    `SELECT COALESCE(MAX(version), 0) + 1 as next_version
     FROM document_saves
     WHERE note_id = $1 AND panel_id = $2`,
    [noteId, panelId]
  )
  
  const result = await pool.query(
    `INSERT INTO document_saves (note_id, panel_id, content, version, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [noteId, panelId, versionData.rows[0].content, nextVersion.rows[0].next_version]
  )
  
  return NextResponse.json({
    success: true,
    restoredFrom: version,
    newVersion: result.rows[0].version
  })
}
```

### 3.2 Version History Component
**File**: `components/version-history-panel.tsx`
```typescript
'use client'

import { useState, useEffect } from 'react'
import { Clock, RotateCcw, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'
import { DiffViewer } from './diff-viewer'

interface Version {
  id: string
  version: number
  content: any
  created_at: string
}

interface VersionHistoryProps {
  noteId: string
  panelId: string
  onRestore?: (version: number) => void
}

export function VersionHistoryPanel({ noteId, panelId, onRestore }: VersionHistoryProps) {
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVersions, setSelectedVersions] = useState<[number, number] | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  
  useEffect(() => {
    fetchVersions()
  }, [noteId, panelId])
  
  const fetchVersions = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/versions/${noteId}/${panelId}`)
      const data = await response.json()
      setVersions(data.versions)
    } catch (error) {
      console.error('Failed to fetch versions:', error)
    } finally {
      setLoading(false)
    }
  }
  
  const handleRestore = async (version: number) => {
    if (!confirm(`Restore version ${version}? This will create a new version.`)) {
      return
    }
    
    try {
      const response = await fetch(`/api/versions/${noteId}/${panelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version })
      })
      
      if (response.ok) {
        await fetchVersions()
        onRestore?.(version)
      }
    } catch (error) {
      console.error('Failed to restore version:', error)
    }
  }
  
  const handleCompare = (v1: number, v2: number) => {
    setSelectedVersions([v1, v2])
    setShowDiff(true)
  }
  
  if (loading) {
    return <div className="p-4 text-center">Loading version history...</div>
  }
  
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Version History
        </h2>
        <Badge variant="outline">
          {versions.length} versions
        </Badge>
      </div>
      
      {/* Diff Viewer */}
      {showDiff && selectedVersions && (
        <Card className="mb-4 p-4">
          <DiffViewer
            oldContent={versions.find(v => v.version === selectedVersions[0])?.content}
            newContent={versions.find(v => v.version === selectedVersions[1])?.content}
            onClose={() => setShowDiff(false)}
          />
        </Card>
      )}
      
      {/* Version List */}
      <div className="space-y-2">
        {versions.map((version, index) => (
          <Card key={version.id} className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant={index === 0 ? "default" : "secondary"}>
                    v{version.version}
                  </Badge>
                  {index === 0 && <Badge variant="outline">Current</Badge>}
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
                </div>
              </div>
              
              <div className="flex gap-2">
                {index > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCompare(version.version, versions[0].version)}
                    >
                      Compare
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRestore(version.version)}
                    >
                      <RotateCcw className="w-4 h-4 mr-1" />
                      Restore
                    </Button>
                  </>
                )}
              </div>
            </div>
            
            {/* Content Preview */}
            <details className="mt-2">
              <summary className="text-sm text-gray-600 cursor-pointer">
                Preview content
              </summary>
              <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-auto max-h-32">
                {JSON.stringify(version.content, null, 2)}
              </pre>
            </details>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

## Phase 4: Conflict Detection (Week 4)

### 4.1 Conflict Detection Middleware
**File**: `lib/sync/conflict-detector.ts`
```typescript
export interface ConflictInfo {
  type: 'version_mismatch' | 'concurrent_edit' | 'deleted_remotely'
  localVersion: number
  remoteVersion: number
  localContent: any
  remoteContent: any
  suggestion: 'use_local' | 'use_remote' | 'merge'
}

export class ConflictDetector {
  async detectConflict(
    noteId: string,
    panelId: string,
    localVersion: number,
    localContent: any
  ): Promise<ConflictInfo | null> {
    // Fetch current remote version
    const response = await fetch(`/api/versions/${noteId}/${panelId}/latest`)
    const remote = await response.json()
    
    if (!remote) {
      return {
        type: 'deleted_remotely',
        localVersion,
        remoteVersion: 0,
        localContent,
        remoteContent: null,
        suggestion: 'use_local'
      }
    }
    
    if (remote.version > localVersion) {
      // Analyze conflict severity
      const severity = this.analyzeConflict(localContent, remote.content)
      
      return {
        type: 'concurrent_edit',
        localVersion,
        remoteVersion: remote.version,
        localContent,
        remoteContent: remote.content,
        suggestion: severity === 'minor' ? 'merge' : 'use_remote'
      }
    }
    
    return null // No conflict
  }
  
  private analyzeConflict(local: any, remote: any): 'minor' | 'major' {
    // Simple heuristic: if different paragraphs edited, it's minor
    // If same paragraph edited, it's major
    // This is simplified - real implementation would be more sophisticated
    
    const localText = JSON.stringify(local)
    const remoteText = JSON.stringify(remote)
    
    const similarity = this.calculateSimilarity(localText, remoteText)
    return similarity > 0.8 ? 'minor' : 'major'
  }
  
  private calculateSimilarity(s1: string, s2: string): number {
    // Simplified similarity calculation
    const longer = s1.length > s2.length ? s1 : s2
    const shorter = s1.length > s2.length ? s2 : s1
    
    if (longer.length === 0) return 1.0
    
    const distance = this.levenshteinDistance(longer, shorter)
    return (longer.length - distance) / longer.length
  }
  
  private levenshteinDistance(s1: string, s2: string): number {
    // Standard Levenshtein distance implementation
    const costs = []
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j
        } else if (j > 0) {
          let newValue = costs[j - 1]
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
          }
          costs[j - 1] = lastValue
          lastValue = newValue
        }
      }
      if (i > 0) costs[s2.length] = lastValue
    }
    return costs[s2.length]
  }
}
```

### 4.2 Conflict Resolution UI
**File**: `components/conflict-resolution-dialog.tsx`
```typescript
'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiffViewer } from './diff-viewer'
import { ConflictInfo } from '@/lib/sync/conflict-detector'

interface ConflictResolutionProps {
  conflict: ConflictInfo
  onResolve: (resolution: 'local' | 'remote' | 'merge') => void
  onCancel: () => void
}

export function ConflictResolutionDialog({ 
  conflict, 
  onResolve, 
  onCancel 
}: ConflictResolutionProps) {
  const [selectedResolution, setSelectedResolution] = useState<'local' | 'remote' | 'merge' | null>(
    conflict.suggestion === 'use_local' ? 'local' : 
    conflict.suggestion === 'use_remote' ? 'remote' : 
    'merge'
  )
  
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="w-5 h-5" />
            Conflict Detected
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 rounded">
            <p className="text-sm">
              {conflict.type === 'concurrent_edit' && 
                `Another user edited this document. Your version: ${conflict.localVersion}, Current version: ${conflict.remoteVersion}`}
              {conflict.type === 'deleted_remotely' &&
                'This document was deleted remotely but you have local changes.'}
              {conflict.type === 'version_mismatch' &&
                'Your local version is out of sync with the server.'}
            </p>
          </div>
          
          {/* Show diff */}
          <div className="border rounded p-4">
            <h3 className="font-semibold mb-2">Changes Comparison</h3>
            <DiffViewer
              oldContent={conflict.remoteContent}
              newContent={conflict.localContent}
              labels={['Server Version', 'Your Version']}
            />
          </div>
          
          {/* Resolution options */}
          <div className="space-y-2">
            <h3 className="font-semibold">Choose Resolution:</h3>
            
            <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="resolution"
                value="local"
                checked={selectedResolution === 'local'}
                onChange={() => setSelectedResolution('local')}
              />
              <div>
                <div className="font-medium">Keep Your Version</div>
                <div className="text-sm text-gray-600">
                  Overwrite the server version with your changes
                </div>
              </div>
            </label>
            
            <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="resolution"
                value="remote"
                checked={selectedResolution === 'remote'}
                onChange={() => setSelectedResolution('remote')}
              />
              <div>
                <div className="font-medium">Use Server Version</div>
                <div className="text-sm text-gray-600">
                  Discard your changes and use the server version
                </div>
              </div>
            </label>
            
            {conflict.suggestion === 'merge' && (
              <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="resolution"
                  value="merge"
                  checked={selectedResolution === 'merge'}
                  onChange={() => setSelectedResolution('merge')}
                />
                <div>
                  <div className="font-medium">Merge Both</div>
                  <div className="text-sm text-gray-600">
                    Attempt to combine both versions (recommended)
                  </div>
                </div>
              </label>
            )}
          </div>
          
          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button 
              onClick={() => selectedResolution && onResolve(selectedResolution)}
              disabled={!selectedResolution}
            >
              Apply Resolution
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

## Testing Strategy

### Unit Tests
```typescript
// __tests__/offline-queue.test.ts
describe('Offline Queue', () => {
  it('should queue operations when offline', async () => {
    // Mock offline state
    Object.defineProperty(navigator, 'onLine', { value: false })
    
    const operation = {
      type: 'update',
      table_name: 'document_saves',
      entity_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      data: { content: 'test', noteId: 'note-id', panelId: 'panel-id' }
    }
    
    const result = await queueManager.add(operation)
    expect(result.status).toBe('pending')
  })
  
  it('should process queue when online', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true })
    
    const processed = await queueManager.processQueue()
    expect(processed.completed).toBeGreaterThan(0)
  })
})
```

### Integration Tests
```bash
# scripts/test-offline-sync.sh
#!/bin/bash

echo "Testing Offline Sync Foundation"

# 1. Test queue persistence (Electron)
echo "Testing offline queue..."
curl -X POST http://localhost:3000/api/test-queue \
  -H "Content-Type: application/json" \
  -d '{"action":"create","data":{"test":true}}'

# 2. Test search
echo "Testing full-text search..."
curl "http://localhost:3000/api/search?q=batch"

# 3. Test version history
echo "Testing version history..."
curl "http://localhost:3000/api/versions/test-note/test-panel"

# 4. Test conflict detection
echo "Testing conflict detection..."
curl -X POST http://localhost:3000/api/test-conflict \
  -H "Content-Type: application/json" \
  -d '{"localVersion":1,"remoteVersion":2}'
```

## Performance Targets

| Feature | Target | Measurement |
|---------|--------|-------------|
| Queue Processing | < 100ms per operation | Time from dequeue to completion |
| Search Response | < 200ms for 10k documents | API response time |
| Version Load | < 500ms for 50 versions | Component render time |
| Conflict Detection | < 100ms | Analysis completion time |

## Success Criteria

1. **Offline Queue**
   - ✅ Electron: Zero data loss (durable Postgres queue via IPC)
   - ✅ Web: Clear offline warning; operations fail fast when offline (no client persistence)
   - ✅ Automatic sync on reconnection (Electron) and visual queue status indicator

2. **Full-Text Search**
   - ✅ Sub-second search across all content
   - ✅ Relevance ranking
   - ✅ Search suggestions

3. **Version History**
   - ✅ All versions accessible
   - ✅ Visual diff between versions
   - ✅ One-click restore

4. **Conflict Detection**
   - ✅ Conflicts detected before data loss
   - ✅ Clear resolution options
   - ✅ Merge capability for minor conflicts

## Deployment Checklist

- [ ] Run migration 009 for search vectors
- [ ] Update Electron main process with IPC handlers
- [ ] Add sync status to main UI header
- [ ] Configure PostgreSQL FTS language settings
- [ ] Test offline behavior in both Electron and Web
- [ ] Document conflict resolution workflow for users
- [ ] Add monitoring for queue size and sync failures

## Next Steps After This Foundation

1. **Enhanced Conflict Resolution**: Implement field-level merging
2. **Compression**: Compress queue payloads for better performance
3. **Selective Sync**: Allow users to choose what to sync
4. **Sync Analytics**: Dashboard showing sync patterns and issues
5. **Export/Import**: Build on version history for full export
