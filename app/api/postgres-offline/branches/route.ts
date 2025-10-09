import { NextRequest, NextResponse } from 'next/server'
import { v5 as uuidv5, validate as validateUuid } from 'uuid'

import { serverPool } from '@/lib/db/pool'
import { FEATURE_WORKSPACE_SCOPING, withWorkspaceClient } from '@/lib/workspace/workspace-store'

// Deterministic mapping for non-UUID IDs (slugs) → UUID
const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a' // keep stable across services
const coerceEntityId = (id: string) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE))

// POST /api/postgres-offline/branches - Create a branch
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      id,
      noteId = '',
      parentId = '',
      type = 'note',
      title = '',
      originalText = '',
      metadata = {},
      anchors
    } = body
    
    // Accept only real UUIDs for primary key; otherwise let DB generate one
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
    const idOrNull = id && uuidRegex.test(String(id).trim()) ? String(id).trim() : null
    
    // parentId: TEXT column; keep non-empty values ("main", "branch-...") and coalesce blanks to null
    const parentIdOrNull = parentId && String(parentId).trim() ? String(parentId).trim() : null
    
    // Coerce noteId slug to UUID if needed
    const noteKey = coerceEntityId(noteId)
    
    if (FEATURE_WORKSPACE_SCOPING) {
      return await withWorkspaceClient(serverPool, async (client, workspaceId) => {
        const insertResult = await client.query(
          `INSERT INTO branches
           (id, note_id, parent_id, type, title, original_text, metadata, anchors, workspace_id, created_at, updated_at)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::jsonb, $8::jsonb, $9::uuid, NOW(), NOW())
           RETURNING id, note_id as "noteId", parent_id as "parentId",
                     type, title, original_text as "originalText", metadata, anchors,
                     created_at as "createdAt", updated_at as "updatedAt"`,
          [
            idOrNull,
            noteKey,
            parentIdOrNull,
            type,
            title,
            originalText,
            JSON.stringify(metadata),
            anchors ? JSON.stringify(anchors) : null,
            workspaceId
          ]
        )

        return NextResponse.json(insertResult.rows[0], { status: 201 })
      })
    }

    const result = await serverPool.query(
      `INSERT INTO branches
       (id, note_id, parent_id, type, title, original_text, metadata, anchors, created_at, updated_at)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::jsonb, $8::jsonb, NOW(), NOW())
       RETURNING id, note_id as "noteId", parent_id as "parentId",
                 type, title, original_text as "originalText", metadata, anchors,
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [
        idOrNull,
        noteKey,
        parentIdOrNull,
        type,
        title,
        originalText,
        JSON.stringify(metadata),
        anchors ? JSON.stringify(anchors) : null
      ]
    )

    return NextResponse.json(result.rows[0], { status: 201 })
  } catch (error) {
    console.error('[POST /api/postgres-offline/branches] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create branch', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET /api/postgres-offline/branches?noteId=xxx - List branches
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const noteId = searchParams.get('noteId')
    
    if (!noteId) {
      return NextResponse.json(
        { error: 'noteId query parameter required' },
        { status: 400 }
      )
    }
    
    // Coerce slug to UUID if needed
    const noteKey = coerceEntityId(noteId)
    
    if (FEATURE_WORKSPACE_SCOPING) {
      return await withWorkspaceClient(serverPool, async (client) => {
        const scopedResult = await client.query(
          `SELECT id, note_id as "noteId", parent_id as "parentId",
                  type, title, original_text as "originalText", metadata, anchors,
                  created_at as "createdAt", updated_at as "updatedAt"
           FROM branches
           WHERE note_id = $1
             AND deleted_at IS NULL
           ORDER BY created_at ASC`,
          [noteKey]
        )

        return NextResponse.json(scopedResult.rows)
      })
    }

    const result = await serverPool.query(
      `SELECT id, note_id as "noteId", parent_id as "parentId",
              type, title, original_text as "originalText", metadata, anchors,
              created_at as "createdAt", updated_at as "updatedAt"
       FROM branches
       WHERE note_id = $1
         AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [noteKey]
    )
    
    return NextResponse.json(result.rows)
  } catch (error) {
    console.error('[GET /api/postgres-offline/branches] Error:', error)
    return NextResponse.json(
      { error: 'Failed to list branches' },
      { status: 500 }
    )
  }
}
