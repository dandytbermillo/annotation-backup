import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { WorkspaceStore } from '@/lib/workspace/workspace-store'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'

// Deterministic mapping for non-UUID IDs (slugs) → UUID
const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a' // keep stable across services
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))

// Check if a string is a valid UUID
const isUuid = (s: string): boolean => {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)
}

// Normalize panelId: accept human-readable IDs (e.g., "main") by mapping to a
// deterministic UUID per note using UUID v5 in the DNS namespace.
const normalizePanelId = (noteId: string, panelId: string): string => {
  if (isUuid(panelId)) return panelId
  return uuidv5(`${noteId}:${panelId}`, uuidv5.DNS)
}

// GET /api/postgres-offline/documents/[noteId]/[panelId] - Load a document
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string; panelId: string }> }
) {
  try {
    const { noteId, panelId } = await params
    console.log('[GET Document] Raw params:', { noteId, panelId })
    
    // Coerce noteId slug to UUID if needed
    const noteKey = coerceEntityId(noteId)
    
    const normalizedPanelId = normalizePanelId(noteKey, panelId)
    console.log('[GET Document] Coerced noteId:', noteKey, 'Normalized panelId:', normalizedPanelId)
    
    // Get workspace_id to ensure consistent data across browsers
    let workspaceId: string | null = null;
    try {
      workspaceId = await WorkspaceStore.getDefaultWorkspaceId(serverPool);
    } catch (e) {
      console.error('[GET Document] Failed to get workspace ID:', e);
      return NextResponse.json(
        { error: 'Failed to get workspace' },
        { status: 500 }
      );
    }
    
    const result = await serverPool.query(
      `SELECT content, version 
       FROM document_saves 
       WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
       ORDER BY version DESC
       LIMIT 1`,
      [noteKey, normalizedPanelId, workspaceId]
    )
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }
    
    const { content, version } = result.rows[0]
    
    // Check if content is HTML string format
    if (content.html && typeof content.html === 'string') {
      return NextResponse.json({ content: content.html, version })
    }
    
    // Otherwise return as ProseMirror JSON
    return NextResponse.json({ content, version })
  } catch (error) {
    console.error('[GET /api/postgres-offline/documents/[noteId]/[panelId]] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load document' },
      { status: 500 }
    )
  }
}

// POST /api/postgres-offline/documents/[noteId]/[panelId] - Save a document
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string; panelId: string }> }
) {
  try {
    const { noteId, panelId } = await params
    const body = await request.json()
    const { content, version } = body
    
    // Coerce noteId slug to UUID if needed
    const noteKey = coerceEntityId(noteId)
    const normalizedPanelId = normalizePanelId(noteKey, panelId)
    
    // Prepare content - wrap string content in HTML format
    const contentToSave = typeof content === 'string' 
      ? { html: content }
      : content
    
    // Save the document
    const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : undefined

    const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : undefined
    if (baseVersion === undefined) {
      throw new Error('baseVersion required')
    }

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

      if (latestRow && JSON.stringify(latestRow.content) === JSON.stringify(contentToSave) && version === latestVersion) {
        return { skipped: true, row: latestRow }
      }

      const resolvedBase = baseVersion

      if (latestVersion > resolvedBase) {
        throw new Error(`stale document save: baseVersion ${resolvedBase} behind latest ${latestVersion}`)
      }

      if (version <= latestVersion) {
        throw new Error(`non-incrementing version ${version} (latest ${latestVersion})`)
      }

      if (version !== resolvedBase + 1) {
        console.warn(`[POST /api/postgres-offline/documents/[noteId]/[panelId]] Non-sequential version: base=${resolvedBase}, version=${version}`)
      }

      const inserted = await client.query(
        `INSERT INTO document_saves (note_id, panel_id, content, version, workspace_id, created_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
         RETURNING *`,
        [noteKey, normalizedPanelId, JSON.stringify(contentToSave), version || 1, workspaceId]
      )

      return { skipped: false, row: inserted.rows[0] }
    })

    if (result.skipped) {
      return NextResponse.json(result.row)
    }

    return NextResponse.json(result.row)

  } catch (error) {
    console.error('[POST /api/postgres-offline/documents/[noteId]/[panelId]] Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to save document'
    const status = message.startsWith('stale document save') || message.startsWith('non-incrementing version')
      ? 409
      : message.includes('required')
      ? 400
      : 500
    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}