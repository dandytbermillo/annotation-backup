import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { WorkspaceStore } from '@/lib/workspace/workspace-store'

const pool = serverPool

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
      const results: any[] = []
      const errors: any[] = []

      for (const op of operations) {
        try {
          const { noteId, panelId, operation, data } = op
          if (!noteId || !panelId) throw new Error('noteId and panelId are required')

          switch (operation) {
            case 'update': {
              const contentJson = data?.content ?? {}
              const content = JSON.stringify(contentJson)
              const baseVersion = typeof data?.baseVersion === 'number' ? data.baseVersion : null
              if (baseVersion === null) {
                throw new Error('baseVersion required for queue operation')
              }

              const latest = await pool.query(
                `SELECT content, version
                   FROM document_saves
                  WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
                  ORDER BY version DESC
                  LIMIT 1`,
                [noteId, panelId, workspaceId]
              )

              if (
                latest.rows[0] &&
                JSON.stringify(latest.rows[0].content) === content
              ) {
                results.push({ ...op, status: 'skipped', reason: 'no-change' })
                break
              }

              if (
                latest.rows[0] &&
                baseVersion !== null &&
                latest.rows[0].version > baseVersion
              ) {
                results.push({
                  ...op,
                  status: 'skipped',
                  reason: 'stale_remote_newer',
                })
                break
              }

              const nextVersionRow = await pool.query(
                `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
                   FROM document_saves
                  WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3`,
                [noteId, panelId, workspaceId]
              )
              const nextVersion = nextVersionRow.rows[0].next_version

              await pool.query(
                `INSERT INTO document_saves (note_id, panel_id, content, version, workspace_id, created_at)
                 VALUES ($1, $2, $3::jsonb, $4, $5, NOW())`,
                [noteId, panelId, content, nextVersion, workspaceId]
              )
              results.push({ ...op, status: 'success', version: nextVersion })
              break
            }
            case 'create': {
              const contentJson = data?.content ?? {}
              const content = JSON.stringify(contentJson)
              const baseVersion = typeof data?.baseVersion === 'number' ? data.baseVersion : null
              if (baseVersion === null) {
                throw new Error('baseVersion required for queue operation')
              }

              const latest = await pool.query(
                `SELECT content, version
                   FROM document_saves
                  WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
                  ORDER BY version DESC
                  LIMIT 1`,
                [noteId, panelId, workspaceId]
              )

              if (
                latest.rows[0] &&
                JSON.stringify(latest.rows[0].content) === content
              ) {
                results.push({ ...op, status: 'skipped', reason: 'no-change' })
                break
              }

              if (
                latest.rows[0] &&
                baseVersion !== null &&
                latest.rows[0].version > baseVersion
              ) {
                results.push({
                  ...op,
                  status: 'skipped',
                  reason: 'stale_remote_newer',
                })
                break
              }

              const nextVersionRow = await pool.query(
                `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
                   FROM document_saves
                  WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3`,
                [noteId, panelId, workspaceId]
              )
              const nextVersion = nextVersionRow.rows[0].next_version

              await pool.query(
                `INSERT INTO document_saves (note_id, panel_id, content, version, workspace_id, created_at)
                 VALUES ($1, $2, $3::jsonb, $4, $5, NOW())`,
                [noteId, panelId, content, nextVersion, workspaceId]
              )
              results.push({ ...op, status: 'success', version: nextVersion })
              break
            }
            case 'delete': {
              await pool.query(
                `DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3`,
                [noteId, panelId, workspaceId]
              )
              results.push({ ...op, status: 'success' })
              break
            }
            default:
              errors.push({ ...op, error: `Unknown operation: ${operation}` })
          }
        } catch (error: any) {
          console.error(`[Queue Flush] Error processing operation:`, error)
          errors.push({ ...op, error: error?.message || String(error) })
        }
      }

      return NextResponse.json({
        processed: results.length,
        succeeded: results.length,
        failed: errors.length,
        results,
        errors
      })
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

    if (processedIds.length > 0) {
      await client.query(`DELETE FROM offline_queue WHERE id = ANY($1::uuid[]) AND status = 'processing'`, [processedIds])
    }
    await client.query('COMMIT')
    return NextResponse.json({ success: true, data: { processed, failed, expired }, errors })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('[queue/flush] error:', error)
    return NextResponse.json({ error: 'Failed to drain queue' }, { status: 500 })
  } finally {
    client.release()
  }
}

// Helpers
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
      const noteId = getNoteId(data)
      const panelId = getPanelId(data)
      if (!noteId || !panelId) throw new Error('document_saves requires noteId and panelId in data')
      if (op === 'delete') {
        await client.query(`DELETE FROM document_saves WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3`, [noteId, panelId, workspaceId])
        return
      }

      const contentJson = data?.content ?? {}
      const content = JSON.stringify(contentJson)
      const baseVersion = typeof data?.baseVersion === 'number' ? data.baseVersion : null
      if (baseVersion === null) {
        throw new Error('baseVersion required for queue operation')
      }

      const latest = await client.query(
        `SELECT content, version
           FROM document_saves
          WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3
          ORDER BY version DESC
          LIMIT 1`,
        [noteId, panelId, workspaceId]
      )

      if (
        latest.rows[0] &&
        JSON.stringify(latest.rows[0].content) === content
      ) {
        return
      }

      if (
        latest.rows[0] &&
        baseVersion !== null &&
        latest.rows[0].version > baseVersion
      ) {
        return
      }

      const nextVersionRow = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
           FROM document_saves
          WHERE note_id = $1 AND panel_id = $2 AND workspace_id = $3`,
        [noteId, panelId, workspaceId]
      )
      const nextVersion = nextVersionRow.rows[0].next_version

      const payloadVersion = typeof data?.version === 'number' ? data.version : null
      if (payloadVersion !== null && payloadVersion < nextVersion - 1) {
        throw new Error(`stale queue payload: incoming version ${payloadVersion} behind current ${nextVersion - 1}`)
      }
      await client.query(
        `INSERT INTO document_saves (note_id, panel_id, content, version, workspace_id, created_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, NOW())`,
        [noteId, panelId, content, nextVersion, workspaceId]
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

    case 'notes': {
      if (op === 'delete') {
        await client.query(`DELETE FROM notes WHERE id = $1`, [entity_id])
        return
      }
      await client.query(
        `INSERT INTO notes (id, title, metadata, created_at, updated_at)
         VALUES ($1, COALESCE($2, 'Untitled'), COALESCE($3::jsonb, '{}'::jsonb), NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET 
           title = COALESCE(EXCLUDED.title, notes.title),
           metadata = COALESCE(EXCLUDED.metadata, notes.metadata),
           updated_at = NOW()`,
        [
          entity_id,
          data?.title || null,
          data?.metadata ? JSON.stringify(data.metadata) : null
        ]
      )
      return
    }

    case 'panels': {
      if (op === 'delete') {
        await client.query(`DELETE FROM panels WHERE id = $1`, [entity_id])
        return
      }
      await client.query(
        `INSERT INTO panels (id, note_id, panel_id, position, dimensions, state, last_accessed)
         VALUES ($1, $2, $3, COALESCE($4::jsonb, '{"x":0,"y":0}'::jsonb), COALESCE($5::jsonb, '{"width":400,"height":300}'::jsonb), COALESCE($6, 'active'), NOW())
         ON CONFLICT (id) DO UPDATE SET 
           note_id = EXCLUDED.note_id,
           panel_id = EXCLUDED.panel_id,
           position = COALESCE(EXCLUDED.position, panels.position),
           dimensions = COALESCE(EXCLUDED.dimensions, panels.dimensions),
           state = COALESCE(EXCLUDED.state, panels.state),
           last_accessed = NOW()`,
        [
          entity_id,
          data?.noteId || data?.note_id,
          data?.panelId || data?.panel_id,
          data?.position ? JSON.stringify(data.position) : null,
          data?.dimensions ? JSON.stringify(data.dimensions) : null,
          data?.state || null
        ]
      )
      return
    }

    default:
      throw new Error(`Unsupported table: ${table}`)
  }
}