import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { WorkspaceStore } from '@/lib/workspace/workspace-store'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'
import { extractFullText } from '@/lib/utils/branch-preview'

const pool = serverPool

const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a'
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))
const isUuid = (s: string): boolean => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)
const normalizePanelId = (noteId: string, panelId: string): string => (isUuid(panelId) ? panelId : uuidv5(`${noteId}:${panelId}`, uuidv5.DNS))
const toVersionNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) ? value : null)

type DirectResult = {
  noteId: string
  panelId: string
  status: 'success' | 'skipped' | 'conflict' | 'error'
  version?: number
  reason?: string
  error?: string
  latestVersion?: number
  baseVersion?: number
  requestedVersion?: number
}

// POST /api/postgres-offline/queue/flush
// Dual-mode:
//  - If body contains operations[] and drain_db !== true: process provided operations (backward compatible)
//  - Else: drain DB offline_queue using reliability semantics (TTL, priority, dependencies, dead-letter)
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any))
  const hasOps = Array.isArray(body?.operations) && body.operations.length > 0
  const drainDb = body?.drain_db === true || !hasOps

  let workspaceId: string
  try {
    workspaceId = await WorkspaceStore.getDefaultWorkspaceId(pool)
  } catch (error) {
    console.error('[queue/flush] Failed to resolve workspace:', error)
    return NextResponse.json({ error: 'Failed to resolve workspace' }, { status: 500 })
  }

  if (!drainDb && hasOps) {
    try {
      const { operations = [] } = body
      const results: DirectResult[] = []
      const errors: any[] = []

      for (const op of operations) {
        try {
          const { noteId, panelId, operation, data } = op
          if (!noteId || !panelId) throw new Error('noteId and panelId are required')

          const noteKey = coerceEntityId(noteId)
          const panelKey = normalizePanelId(noteKey, panelId)

          switch (operation) {
            case 'update':
            case 'create': {
              const contentJson = data?.content ?? {}
              const contentString = JSON.stringify(contentJson)
              const baseVersion = toVersionNumber(data?.baseVersion)
              const version = toVersionNumber(data?.version)

              if (baseVersion === null || version === null) {
                throw new Error('baseVersion and version must be numbers')
              }

              const latest = await pool.query(
                `SELECT content, version
                   FROM document_saves
                  WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
                  ORDER BY version DESC
                  LIMIT 1`,
                [noteKey, panelKey, workspaceId]
              )

              const latestRow = latest.rows[0]
              const latestVersion: number = latestRow?.version ?? 0

              if (
                latestRow &&
                JSON.stringify(latestRow.content) === contentString &&
                version === latestVersion
              ) {
                results.push({ noteId, panelId, status: 'skipped', reason: 'no-change', version: latestVersion })
                break
              }

              if (latestVersion > baseVersion) {
                results.push({
                  noteId,
                  panelId,
                  status: 'conflict',
                  error: `stale document save: baseVersion ${baseVersion} behind latest ${latestVersion}`,
                  latestVersion,
                  baseVersion,
                  requestedVersion: version
                })
                break
              }

              if (version <= latestVersion) {
                results.push({
                  noteId,
                  panelId,
                  status: 'conflict',
                  error: `non-incrementing version ${version} (latest ${latestVersion})`,
                  latestVersion,
                  baseVersion,
                  requestedVersion: version
                })
                break
              }

              if (version !== baseVersion + 1) {
                console.warn(`[queue/flush] Non-sequential version (direct op): base=${baseVersion}, version=${version}`)
              }

              const documentText = extractFullText(contentJson)

              await pool.query(
                `INSERT INTO document_saves (note_id, panel_id, content, document_text, search_tsv, version, workspace_id, created_at)
                 VALUES ($1, $2, $3::jsonb, $4, to_tsvector('english', $4), $5, $6, NOW())`,
                [noteKey, panelKey, contentString, documentText, version, workspaceId]
              )
              results.push({ noteId, panelId, status: 'success', version })
              break
            }
            case 'delete': {
              await pool.query(
                `DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3`,
                [noteKey, panelKey, workspaceId]
              )
              results.push({ noteId, panelId, status: 'success' })
              break
            }
            default:
              errors.push({ ...op, error: `Unknown operation: ${operation}` })
          }
        } catch (error: any) {
          console.error('[Queue Flush] Error processing operation:', error)
          errors.push({ ...op, error: error?.message || String(error) })
        }
      }

      const conflicts = results.filter(r => r.status === 'conflict').length
      const failed = errors.length + results.filter(r => r.status === 'error').length
      const processed = results.filter(r => r.status === 'success').length
      const skipped = results.filter(r => r.status === 'skipped').length
      const status = failed > 0 ? 500 : conflicts > 0 ? 409 : 200

      return NextResponse.json(
        {
          processed,
          skipped,
          conflicts,
          failed,
          results,
          errors
        },
        { status }
      )
    } catch (error) {
      console.error('[POST /api/postgres-offline/queue/flush] Error:', error)
      return NextResponse.json({ error: 'Failed to flush queue' }, { status: 500 })
    }
  }

  // Drain DB queue mode
  const client = await pool.connect()
  let processed = 0
  let failed = 0
  let expired = 0
  const processedIds: string[] = []
  const errors: any[] = []
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, false)', [
      'app.current_workspace_id',
      workspaceId,
    ])

    const expireRes = await client.query(
      `UPDATE offline_queue
       SET status = 'failed', error_message = 'Operation expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()
       RETURNING id`
    )
    expired = expireRes.rowCount || 0

    const pending = await client.query(
      `SELECT id, type, table_name, entity_id, data, idempotency_key, depends_on, retry_count
       FROM offline_queue
       WHERE status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())
         AND NOT EXISTS (
           SELECT 1 FROM unnest(coalesce(depends_on, ARRAY[]::uuid[])) dep_id
           WHERE dep_id::text IN (
             SELECT id::text FROM offline_queue WHERE status IN ('pending', 'failed')
           )
         )
       ORDER BY priority DESC, created_at ASC
       FOR UPDATE SKIP LOCKED`
    )

    for (const row of pending.rows) {
      try {
        await processQueueOperation(client, row, workspaceId)
        await client.query(
          `UPDATE offline_queue SET status = 'processing', updated_at = NOW() WHERE id = $1`,
          [row.id]
        )
        processed++
        processedIds.push(row.id)
      } catch (err: any) {
        failed++
        const errMsg = String(err)
        const retry = await client.query(
          `UPDATE offline_queue
           SET status = 'failed', error_message = $2, retry_count = retry_count + 1, updated_at = NOW()
           WHERE id = $1
           RETURNING retry_count, idempotency_key, type, table_name, entity_id, data`,
          [row.id, errMsg]
        )
        if (retry.rows[0] && retry.rows[0].retry_count >= 5) {
          const d = retry.rows[0]
          await client.query(
            `INSERT INTO offline_dead_letter
             (queue_id, idempotency_key, type, table_name, entity_id, data, error_message, retry_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [row.id, d.idempotency_key, d.type, d.table_name, d.entity_id, d.data, errMsg, d.retry_count]
          )
          await client.query(`DELETE FROM offline_queue WHERE id = $1`, [row.id])
        }
        errors.push({ id: row.id, error: errMsg })
      }
    }

    // Delete successfully processed items
    if (processedIds.length > 0) {
      await client.query(
        `DELETE FROM offline_queue WHERE status = 'processing' AND id = ANY($1::uuid[])`,
        [processedIds]
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    client.release()
    console.error('[queue/flush] Queue flush failed:', error)
    return NextResponse.json({ error: 'Failed to flush queue' }, { status: 500 })
  }

  client.release()
  return NextResponse.json({ processed, failed, expired, errors })
}

function getNoteId(data: any): string | null {
  return data?.noteId || data?.note_id || null
}
function getPanelId(data: any): string | null {
  return data?.panelId || data?.panel_id || null
}

async function processQueueOperation(client: any, row: any, workspaceId: string) {
  const { type, table_name, entity_id, data } = row
  const table = String(table_name)
  const op = String(type)

  // Whitelist and route per table with parameterized SQL only
  switch (table) {
    case 'document_saves': {
      const rawNoteId = getNoteId(data) ?? entity_id
      const rawPanelId = getPanelId(data)
      if (!rawNoteId || !rawPanelId) {
        throw new Error('document_saves requires noteId and panelId in data')
      }

      const noteId = coerceEntityId(rawNoteId)
      const panelId = normalizePanelId(noteId, rawPanelId)

      if (op === 'delete') {
        await client.query(`DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3`, [noteId, panelId, workspaceId])
        return
      }

      const rawContent = data?.content ?? {}
      const contentJson = typeof rawContent === 'string' ? { html: rawContent } : rawContent
      const contentString = JSON.stringify(contentJson)
      const baseVersion = toVersionNumber(data?.baseVersion)
      const version = toVersionNumber(data?.version)

      if (baseVersion === null || version === null) {
        throw new Error('baseVersion and version must be numbers')
      }

      const latest = await client.query(
        `SELECT content, version
           FROM document_saves
          WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
          ORDER BY version DESC
          LIMIT 1`,
        [noteId, panelId, workspaceId]
      )

      const latestRow = latest.rows[0]
      const latestVersion: number = latestRow?.version ?? 0

      if (
        latestRow &&
        JSON.stringify(latestRow.content) === contentString &&
        version === latestVersion
      ) {
        return
      }

      if (latestVersion > baseVersion) {
        throw new Error(`stale document save: baseVersion ${baseVersion} behind latest ${latestVersion}`)
      }

      if (version <= latestVersion) {
        throw new Error(`non-incrementing version ${version} (latest ${latestVersion})`)
      }

      if (version !== baseVersion + 1) {
        console.warn(`[queue/flush] Non-sequential version (queue op): base=${baseVersion}, version=${version}`)
      }

      const documentText = extractFullText(contentJson)

      await client.query(
        `INSERT INTO document_saves (note_id, panel_id, content, document_text, search_tsv, version, workspace_id, created_at)
         VALUES ($1, $2, $3::jsonb, $4, to_tsvector('english', $4), $5, $6, NOW())`,
        [noteId, panelId, contentString, documentText, version, workspaceId]
      )
      return
    }

    case 'branches': {
      if (op === 'delete') {
        await client.query(`DELETE FROM branches WHERE id = $1`, [entity_id])
        return
      }
      await client.query(
        `INSERT INTO branches
         (id, note_id, parent_id, type, original_text, metadata, anchors, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET 
           note_id = EXCLUDED.note_id,
           parent_id = EXCLUDED.parent_id,
           type = EXCLUDED.type,
           original_text = EXCLUDED.original_text,
           metadata = EXCLUDED.metadata,
           anchors = EXCLUDED.anchors,
           updated_at = NOW()`,
        [
          entity_id,
          data?.noteId || data?.note_id,
          data?.parentId || data?.parent_id || null,
          data?.type || null,
          data?.originalText || data?.original_text || null,
          JSON.stringify(data?.metadata || {}),
          data?.anchors ? JSON.stringify(data.anchors) : null
        ]
      )
      return
    }
  }
}
