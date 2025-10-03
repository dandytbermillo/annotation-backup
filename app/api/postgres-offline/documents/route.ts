import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { WorkspaceStore } from '@/lib/workspace/workspace-store'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'
import { extractFullText } from '@/lib/utils/branch-preview'

// Deterministic mapping for non-UUID IDs (slugs) → UUID
const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a' // keep stable across services
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))

// Normalize panelId: accept human-readable IDs (e.g., "main") by mapping to a
// deterministic UUID per note using UUID v5 in the DNS namespace.
const normalizePanelId = (noteId: string, panelId: string): string => {
  if (isUuid(panelId)) return panelId
  return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
}

// Check if a string is a valid UUID
const isUuid = (s: string): boolean => {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)
}

// POST /api/postgres-offline/documents - Save a document
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { noteId, panelId, content, version } = body
    
    // Process document save request
    
    if (!noteId || !panelId || content === undefined || version === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: noteId, panelId, content, version' },
        { status: 400 }
      )
    }
    
    // Coerce noteId slug to UUID if needed (same as GET endpoint)
    const noteKey = coerceEntityId(noteId)
    // Coerced noteId to UUID
    
    // Store content as JSONB
    const contentJson = typeof content === 'string' 
      ? { html: content } 
      : content
    
    const normalizedPanelId = normalizePanelId(noteKey, panelId)
    // Normalized panelId

    if (typeof version !== 'number' || Number.isNaN(version)) {
      throw new Error('version must be a number')
    }

    const baseVersionRaw = body.baseVersion
    if (typeof baseVersionRaw !== 'number' || Number.isNaN(baseVersionRaw)) {
      throw new Error('baseVersion must be a number')
    }
    const baseVersion = baseVersionRaw

    const result = await WorkspaceStore.withWorkspace(serverPool, async ({ client, workspaceId }) => {
      const latest = await client.query(
        `SELECT id, content, version
           FROM document_saves
          WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
          ORDER BY version DESC
          LIMIT 1`,
        [noteKey, normalizedPanelId, workspaceId]
      )

      const latestRow = latest.rows[0]
      const latestVersion: number = latestRow?.version ?? 0

      if (latestRow && JSON.stringify(latestRow.content) === JSON.stringify(contentJson) && version === latestVersion) {
        return { skipped: true, id: latestRow.id }
      }

      const resolvedBase = baseVersion

      if (latestVersion > resolvedBase) {
        throw new Error(`stale document save: baseVersion ${resolvedBase} behind latest ${latestVersion}`)
      }

      if (version <= latestVersion) {
        throw new Error(`non-incrementing version ${version} (latest ${latestVersion})`)
      }

      if (version !== resolvedBase + 1) {
        console.warn(`[POST /api/postgres-offline/documents] Non-sequential version: base=${resolvedBase}, version=${version}`)
      }

      const documentText = extractFullText(contentJson)

      const inserted = await client.query(
        `INSERT INTO document_saves
         (note_id, panel_id, content, document_text, search_tsv, version, workspace_id, created_at)
         VALUES ($1, $2, $3::jsonb, $4, to_tsvector('english', $4), $5, $6, NOW())
         RETURNING id`,
        [noteKey, normalizedPanelId, JSON.stringify(contentJson), documentText, version, workspaceId]
      )

      return { skipped: false, id: inserted.rows[0]?.id }
    })
    
    if (result.skipped) {
      return NextResponse.json({ success: true, skipped: true, id: result.id })
    }

    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    console.error('[POST /api/postgres-offline/documents] Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to save document'
    const status = message.startsWith('stale document save') || message.startsWith('non-incrementing version')
      ? 409
      : message.includes('required') || message.includes('must be a number')
      ? 400
      : 500
    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}