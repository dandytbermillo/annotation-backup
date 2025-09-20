import { NextRequest, NextResponse } from 'next/server'
import type { PoolClient } from 'pg'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'

// Ensure Node.js runtime (pg requires Node)
export const runtime = 'nodejs'

import { serverPool } from '@/lib/db/pool'
import { FEATURE_WORKSPACE_SCOPING, withWorkspaceClient } from '@/lib/workspace/workspace-store'

// Deterministic mapping for non-UUID IDs (slugs) → UUID
const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a' // keep stable across services
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))

// Idempotency tracking (in production, use Redis or database)
type ProcessedEntry = { timestamp: number; result: any }
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000 // 24 hours
const IDEMPOTENCY_SWEEP_INTERVAL = 60 * 60 * 1000 // 1 hour

function getProcessedStore(): { map: Map<string, ProcessedEntry>; lastSweep: number } {
  const g = globalThis as any
  if (!g.__batchBranchesStore) {
    g.__batchBranchesStore = { map: new Map<string, ProcessedEntry>(), lastSweep: 0 }
  }
  return g.__batchBranchesStore
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

async function executeWithClient(
  handler: (client: PoolClient, workspaceId?: string) => Promise<NextResponse>
): Promise<NextResponse> {
  if (FEATURE_WORKSPACE_SCOPING) {
    return withWorkspaceClient(serverPool, async (client, workspaceId) => handler(client, workspaceId))
  }

  const client = await serverPool.connect()
  try {
    return await handler(client)
  } finally {
    client.release()
  }
}

export async function POST(request: NextRequest) {
  cleanupProcessedKeys()
  const store = getProcessedStore()
  const payload = await request.json()
  const operations = payload?.operations

  if (!Array.isArray(operations) || operations.length === 0) {
    return NextResponse.json(
      { error: 'Invalid operations array' },
      { status: 400 }
    )
  }

  console.log(`[Batch API - Branches] Processing ${operations.length} create operations`)

  return executeWithClient(async (client, workspaceId) => {
    const results: Array<Record<string, any>> = []

    await client.query('BEGIN')

    try {
      for (const op of operations) {
        if (op.idempotencyKey && store.map.has(op.idempotencyKey)) {
          const cached = store.map.get(op.idempotencyKey)
          results.push({ ...cached?.result, cached: true })
          continue
        }

        try {
          const { id, noteId, parentId, type, originalText, metadata, anchors, createdAt, updatedAt } = op

          if (!id || !noteId) {
            results.push({
              error: 'Missing required fields (id, noteId)',
              operation: op
            })
            continue
          }

          const noteKey = coerceEntityId(noteId)
          const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
          const branchId = (id && uuidRegex.test(String(id).trim()))
            ? String(id).trim()
            : uuidv5(`branch:${id || Date.now()}`, ID_NAMESPACE)

          if (workspaceId) {
            await client.query(
              `INSERT INTO notes (id, title, metadata, workspace_id, created_at, updated_at)
               VALUES ($1::uuid, 'Untitled', '{}'::jsonb, $2::uuid, NOW(), NOW())
               ON CONFLICT (id) DO NOTHING`,
              [noteKey, workspaceId]
            )
          } else {
            await client.query(
              `INSERT INTO notes (id, title, metadata, created_at, updated_at)
               VALUES ($1::uuid, 'Untitled', '{}'::jsonb, NOW(), NOW())
               ON CONFLICT (id) DO NOTHING`,
              [noteKey]
            )
          }

          const parentValue = parentId || null
          const branchType = type || 'note'
          const originalTextValue = originalText || ''
          const metadataJson = JSON.stringify(metadata || {})
          const anchorsJson = anchors ? JSON.stringify(anchors) : null
          const createdAtValue = createdAt || new Date()
          const updatedAtValue = updatedAt || new Date()

          const branchResult = workspaceId
            ? await client.query(
                `INSERT INTO branches 
                 (id, note_id, parent_id, type, original_text, metadata, anchors, workspace_id, created_at, updated_at)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::jsonb, $8::uuid, $9, $10)
                 ON CONFLICT (id) DO UPDATE SET
                   parent_id = EXCLUDED.parent_id,
                   type = EXCLUDED.type,
                   original_text = EXCLUDED.original_text,
                   metadata = EXCLUDED.metadata,
                   anchors = EXCLUDED.anchors,
                   workspace_id = EXCLUDED.workspace_id,
                   updated_at = NOW()
                 RETURNING id`,
                [
                  branchId,
                  noteKey,
                  parentValue,
                  branchType,
                  originalTextValue,
                  metadataJson,
                  anchorsJson,
                  workspaceId,
                  createdAtValue,
                  updatedAtValue
                ]
              )
            : await client.query(
                `INSERT INTO branches 
                 (id, note_id, parent_id, type, original_text, metadata, anchors, created_at, updated_at)
                 VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
                 ON CONFLICT (id) DO UPDATE SET
                   parent_id = EXCLUDED.parent_id,
                   type = EXCLUDED.type,
                   original_text = EXCLUDED.original_text,
                   metadata = EXCLUDED.metadata,
                   anchors = EXCLUDED.anchors,
                   updated_at = NOW()
                 RETURNING id`,
                [
                  branchId,
                  noteKey,
                  parentValue,
                  branchType,
                  originalTextValue,
                  metadataJson,
                  anchorsJson,
                  createdAtValue,
                  updatedAtValue
                ]
              )

          const operationResult = {
            success: true,
            id: branchResult.rows[0]?.id
          }

          results.push(operationResult)

          if (op.idempotencyKey) {
            store.map.set(op.idempotencyKey, {
              timestamp: Date.now(),
              result: operationResult
            })
          }
        } catch (error) {
          console.error('[Batch API - Branches] Operation failed:', error)
          results.push({
            error: 'Operation failed',
            message: error instanceof Error ? error.message : 'Unknown error',
            operation: op
          })
        }
      }

      await client.query('COMMIT')

      console.log('[Batch API - Branches] Successfully processed batch')

      return NextResponse.json({
        success: true,
        results,
        processed: results.filter(r => r.success).length,
        failed: results.filter(r => r.error).length
      })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('[Batch API - Branches] Batch operation failed:', error)
      return NextResponse.json(
        {
          error: 'Batch operation failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      )
    }
  })
}

export async function PUT(request: NextRequest) {
  cleanupProcessedKeys()
  const store = getProcessedStore()
  const payload = await request.json()
  const operations = payload?.operations

  if (!Array.isArray(operations) || operations.length === 0) {
    return NextResponse.json(
      { error: 'Invalid operations array' },
      { status: 400 }
    )
  }

  console.log(`[Batch API - Branches] Processing ${operations.length} update operations`)

  return executeWithClient(async (client) => {
    const results: Array<Record<string, any>> = []

    await client.query('BEGIN')

    try {
      for (const op of operations) {
        if (op.idempotencyKey && store.map.has(op.idempotencyKey)) {
          const cached = store.map.get(op.idempotencyKey)
          results.push({ ...cached?.result, cached: true })
          continue
        }

        try {
          const data = op.data || op
          const entityId = op.id || data.id

          if (!entityId) {
            results.push({
              error: 'Missing branch ID',
              operation: op
            })
            continue
          }

          const updateFields: string[] = []
          const values: any[] = []
          let valueIndex = 2

          if (data.parentId !== undefined) {
            updateFields.push(`parent_id = $${valueIndex++}`)
            values.push(data.parentId)
          }

          if (data.type !== undefined) {
            updateFields.push(`type = $${valueIndex++}`)
            values.push(data.type)
          }

          if (data.originalText !== undefined) {
            updateFields.push(`original_text = $${valueIndex++}`)
            values.push(data.originalText)
          }

          if (data.metadata !== undefined) {
            updateFields.push(`metadata = $${valueIndex++}::jsonb`)
            values.push(data.metadata === null ? null : JSON.stringify(data.metadata))
          }
          
          if (data.anchors !== undefined) {
            updateFields.push(`anchors = $${valueIndex++}::jsonb`)
            values.push(data.anchors === null ? null : JSON.stringify(data.anchors))
          }

          updateFields.push('updated_at = NOW()')

          if (updateFields.length === 1) {
            results.push({
              success: true,
              id: entityId,
              skipped: true,
              reason: 'No fields to update'
            })
            continue
          }

          const result = await client.query(
            `UPDATE branches 
             SET ${updateFields.join(', ')}
             WHERE id = $1
             RETURNING id`,
            [entityId, ...values]
          )

          if (result.rows.length === 0) {
            results.push({
              error: 'Branch not found',
              id: entityId
            })
          } else {
            const operationResult = {
              success: true,
              id: result.rows[0].id
            }

            results.push(operationResult)

            if (op.idempotencyKey) {
              store.map.set(op.idempotencyKey, {
                timestamp: Date.now(),
                result: operationResult
              })
            }
          }
        } catch (error) {
          console.error('[Batch API - Branches] Operation failed:', error)
          results.push({
            error: 'Operation failed',
            message: error instanceof Error ? error.message : 'Unknown error',
            operation: op
          })
        }
      }

      await client.query('COMMIT')

      console.log('[Batch API - Branches] Successfully processed batch')

      return NextResponse.json({
        success: true,
        results,
        processed: results.filter(r => r.success).length,
        failed: results.filter(r => r.error).length
      })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('[Batch API - Branches] Batch operation failed:', error)
      return NextResponse.json(
        {
          error: 'Batch operation failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      )
    }
  })
}

export async function DELETE(request: NextRequest) {
  const payload = await request.json()
  const ids = payload?.ids

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json(
      { error: 'Invalid ids array' },
      { status: 400 }
    )
  }

  console.log(`[Batch API - Branches] Processing ${ids.length} delete operations`)

  return executeWithClient(async (client) => {
    await client.query('BEGIN')

    try {
      const result = await client.query(
        'DELETE FROM branches WHERE id = ANY($1::text[]) RETURNING id',
        [ids]
      )

      await client.query('COMMIT')

      console.log(`[Batch API - Branches] Successfully deleted ${result.rows.length} branches`)

      return NextResponse.json({
        success: true,
        deleted: result.rows.length,
        ids: result.rows.map(r => r.id)
      })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('[Batch API - Branches] Batch delete failed:', error)
      return NextResponse.json(
        {
          error: 'Batch delete failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      )
    }
  })
}
