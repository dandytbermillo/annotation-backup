import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { WorkspaceStore } from '@/lib/workspace/workspace-store'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'
import { extractFullText } from '@/lib/utils/branch-preview'

// Ensure Node.js runtime (pg requires Node)
export const runtime = 'nodejs'

// Deterministic mapping for non-UUID IDs (slugs) → UUID
const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a' // keep stable across services
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))

// Check if a string is a valid UUID
const isUuid = (s: string): boolean => {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)
}

// Normalize panelId helper (same as in regular documents route)
const normalizePanelId = (noteId: string, panelId: string): string => {
  if (isUuid(panelId)) return panelId
  return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
}

const toVersionNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
    ? value
    : null
}

type SaveResult = {
  noteId: string
  panelId: string
  version?: number
  skipped?: boolean
  success?: boolean
  status?: 'conflict' | 'error'
  reason?: string
  error?: string
  id?: string
  latestVersion?: number
  baseVersion?: number
  requestedVersion?: number
  cached?: boolean
}

type ProcessedEntry = { timestamp: number; result: SaveResult }
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000 // 24 hours
const IDEMPOTENCY_SWEEP_INTERVAL = 60 * 60 * 1000 // 1 hour

function getProcessedStore(): { map: Map<string, ProcessedEntry>; lastSweep: number } {
  const g = globalThis as any
  if (!g.__batchDocumentsStore) {
    g.__batchDocumentsStore = { map: new Map<string, ProcessedEntry>(), lastSweep: 0 }
  }
  return g.__batchDocumentsStore
}

function cleanupProcessedKeys(): void {
  const store = getProcessedStore()
  const now = Date.now()
  if (now - store.lastSweep < IDEMPOTENCY_SWEEP_INTERVAL) return
  for (const [key, value] of store.map.entries()) {
    if (now - value.timestamp > IDEMPOTENCY_TTL) store.map.delete(key)
  }
  store.lastSweep = now
}

type BatchSummary = { body: { success: boolean; processed: number; skipped: number; conflicts: number; failed: number; results: SaveResult[] }; status: number }

type PendingSave = {
  noteKey: string
  panelKey: string
  responseNoteId: string
  responsePanelId: string
  contentJson: any
  version: number
  baseVersion: number
  idempotencyKey?: string
}

async function handleBatchSave(operations: any[], logLabel: string): Promise<BatchSummary> {
  return WorkspaceStore.withWorkspace(serverPool, async ({ client, workspaceId }) => {
    cleanupProcessedKeys()
    const store = getProcessedStore()

    const grouped = new Map<string, PendingSave>()
    const results: SaveResult[] = []

    for (const rawOp of operations) {
      const data = rawOp?.data ?? rawOp
      const idempotencyKey = typeof rawOp?.idempotencyKey === 'string' ? rawOp.idempotencyKey : undefined

      if (idempotencyKey && store.map.has(idempotencyKey)) {
        const cached = store.map.get(idempotencyKey)!
        results.push({ ...cached.result, cached: true })
        continue
      }

      const noteId = typeof data?.noteId === 'string' ? data.noteId : undefined
      const panelId = typeof data?.panelId === 'string' ? data.panelId : undefined
      const content = data?.content
      const version = toVersionNumber(data?.version)
      const baseVersion = toVersionNumber(data?.baseVersion)

      if (!noteId || !panelId || content === undefined) {
        results.push({
          noteId: noteId ?? '',
          panelId: panelId ?? '',
          status: 'error',
          error: 'Missing required fields: noteId, panelId, content'
        })
        continue
      }

      if (version === null) {
        results.push({
          noteId,
          panelId,
          status: 'error',
          error: 'version must be a number'
        })
        continue
      }

      if (baseVersion === null) {
        results.push({
          noteId,
          panelId,
          status: 'error',
          error: 'baseVersion must be a number'
        })
        continue
      }

      const noteKey = coerceEntityId(noteId)
      const panelKey = normalizePanelId(noteKey, panelId)
      const contentJson = typeof content === 'string' ? { html: content } : content

      grouped.set(`${noteKey}:${panelKey}`, {
        noteKey,
        panelKey,
        responseNoteId: noteId,
        responsePanelId: panelId,
        contentJson,
        version,
        baseVersion,
        idempotencyKey
      })
    }

    for (const entry of grouped.values()) {
      // Ensure the parent note row exists so workspace scoping remains consistent
      await client.query(
        `INSERT INTO notes (id, title, metadata, workspace_id, created_at, updated_at)
         VALUES ($1::uuid, 'Untitled', '{}'::jsonb, $2::uuid, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET 
           workspace_id = COALESCE(notes.workspace_id, EXCLUDED.workspace_id),
           updated_at = NOW()`,
        [entry.noteKey, workspaceId]
      )

      const contentString = JSON.stringify(entry.contentJson)
      const latest = await client.query(
        `SELECT id, content, version
           FROM document_saves
          WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
          ORDER BY version DESC
          LIMIT 1`,
        [entry.noteKey, entry.panelKey, workspaceId]
      )

      const latestRow = latest.rows[0]
      const latestVersion: number = latestRow?.version ?? 0

      if (
        latestRow &&
        JSON.stringify(latestRow.content) === contentString &&
        entry.version === latestVersion
      ) {
        results.push({
          noteId: entry.responseNoteId,
          panelId: entry.responsePanelId,
          skipped: true,
          reason: 'no-change',
          version: latestVersion,
          id: latestRow.id
        })
        continue
      }

      if (latestVersion > entry.baseVersion) {
        results.push({
          noteId: entry.responseNoteId,
          panelId: entry.responsePanelId,
          status: 'conflict',
          error: `stale document save: baseVersion ${entry.baseVersion} behind latest ${latestVersion}`,
          latestVersion,
          baseVersion: entry.baseVersion,
          requestedVersion: entry.version
        })
        continue
      }

      if (entry.version <= latestVersion) {
        results.push({
          noteId: entry.responseNoteId,
          panelId: entry.responsePanelId,
          status: 'conflict',
          error: `non-incrementing version ${entry.version} (latest ${latestVersion})`,
          latestVersion,
          baseVersion: entry.baseVersion,
          requestedVersion: entry.version
        })
        continue
      }

      if (entry.version !== entry.baseVersion + 1) {
        console.warn(`[${logLabel}] Non-sequential version: base=${entry.baseVersion}, version=${entry.version}`)
      }

      // Extract plain text from content for search and preview
      const documentText = extractFullText(entry.contentJson)

      const inserted = await client.query(
        `INSERT INTO document_saves
         (note_id, panel_id, content, document_text, search_tsv, version, workspace_id, created_at)
         VALUES ($1, $2, $3::jsonb, $4, to_tsvector('english', $4), $5, $6, NOW())
         RETURNING id`,
        [entry.noteKey, entry.panelKey, contentString, documentText, entry.version, workspaceId]
      )

      const operationResult: SaveResult = {
        noteId: entry.responseNoteId,
        panelId: entry.responsePanelId,
        success: true,
        version: entry.version,
        id: inserted.rows[0]?.id
      }

      results.push(operationResult)

      if (entry.idempotencyKey) {
        store.map.set(entry.idempotencyKey, { timestamp: Date.now(), result: operationResult })
      }
    }

    const conflicts = results.filter(r => r.status === 'conflict').length
    const failed = results.filter(r => r.status === 'error').length
    const processed = results.filter(r => r.success).length
    const skipped = results.filter(r => r.skipped).length
    const hasError = failed > 0
    const hasConflict = conflicts > 0

    const body = {
      success: !hasError && !hasConflict,
      processed,
      skipped,
      conflicts,
      failed,
      results
    }

    const status = hasError ? 500 : hasConflict ? 409 : 200

    return { body, status }
  })
}

export async function POST(request: NextRequest) {
  try {
    const { operations } = await request.json()

    if (!Array.isArray(operations) || operations.length === 0) {
      return NextResponse.json(
        { error: 'Invalid operations array' },
        { status: 400 }
      )
    }

    console.log(`[Batch API - Documents] Processing ${operations.length} create operations`)
    const { body, status } = await handleBatchSave(operations, 'Batch POST /documents')
    return NextResponse.json(body, { status })
  } catch (error) {
    console.error('[Batch API - Documents] Batch POST failed:', error)
    return NextResponse.json(
      {
        error: 'Batch operation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { operations } = await request.json()

    if (!Array.isArray(operations) || operations.length === 0) {
      return NextResponse.json(
        { error: 'Invalid operations array' },
        { status: 400 }
      )
    }

    console.log(`[Batch API - Documents] Processing ${operations.length} update operations`)
    const { body, status } = await handleBatchSave(operations, 'Batch PUT /documents')
    return NextResponse.json(body, { status })
  } catch (error) {
    console.error('[Batch API - Documents] Batch PUT failed:', error)
    return NextResponse.json(
      {
        error: 'Batch operation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { ids } = await request.json()

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: 'Invalid ids array' },
        { status: 400 }
      )
    }

    const summary = await WorkspaceStore.withWorkspace(serverPool, async ({ client, workspaceId }) => {
      let deleted = 0

      for (const rawId of ids) {
        if (typeof rawId !== 'string') continue
        const [rawNoteId, rawPanelId] = rawId.split(':')
        if (!rawNoteId || !rawPanelId) continue

        const noteKey = coerceEntityId(rawNoteId)
        const panelKey = normalizePanelId(noteKey, rawPanelId)

        const res = await client.query(
          `DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3`,
          [noteKey, panelKey, workspaceId]
        )
        deleted += res.rowCount ?? 0
      }

      return deleted
    })

    console.log(`[Batch API - Documents] Successfully deleted ${summary} documents`)
    return NextResponse.json({ success: true, deleted: summary })
  } catch (error) {
    console.error('[Batch API - Documents] Batch delete failed:', error)
    return NextResponse.json(
      {
        error: 'Batch delete failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
