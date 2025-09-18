import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { WorkspaceStore, FEATURE_WORKSPACE_SCOPING } from '@/lib/workspace/workspace-store'

// POST /api/postgres-offline/notes - Create a new note
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, title = 'Untitled', metadata = {} } = body
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
    const idOrNull = typeof id === 'string' && uuidRegex.test(id.trim()) ? id.trim() : null

    // Use workspace scoping if feature is enabled
    if (FEATURE_WORKSPACE_SCOPING) {
      const result = await WorkspaceStore.withWorkspace(serverPool, async ({ client, workspaceId }) => {
        // Insert with workspace_id
        const insertResult = await client.query(
          `INSERT INTO notes (id, title, metadata, workspace_id, created_at, updated_at)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3::jsonb, $4, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING
           RETURNING id, title, metadata, created_at, updated_at`,
          [idOrNull, title, JSON.stringify(metadata), workspaceId]
        )

        if (insertResult.rows.length === 0 && idOrNull) {
          // Check if note exists in this workspace
          const existing = await client.query(
            `SELECT id, title, metadata, created_at, updated_at
             FROM notes WHERE id = $1 AND workspace_id = $2`,
            [idOrNull, workspaceId]
          )
          if (existing.rows.length > 0) {
            return { data: existing.rows[0], status: 200 }
          }
          // Note might exist in another workspace
          return { 
            error: 'Note ID conflict but existing row not found in this workspace', 
            status: 409 
          }
        }

        return { data: insertResult.rows[0], status: 201 }
      })

      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      return NextResponse.json(result.data, { status: result.status })
    }

    // Legacy path without workspace scoping
    const result = await serverPool.query(
      `INSERT INTO notes (id, title, metadata, created_at, updated_at)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING
       RETURNING id, title, metadata, created_at, updated_at`,
      [idOrNull, title, JSON.stringify(metadata)]
    )
    
    if (result.rows.length === 0 && idOrNull) {
      const existing = await serverPool.query(
        `SELECT id, title, metadata, created_at, updated_at
         FROM notes WHERE id = $1`,
        [idOrNull]
      )
      if (existing.rows.length > 0) {
        return NextResponse.json(existing.rows[0], { status: 200 })
      }
      return NextResponse.json(
        { error: 'Note ID conflict but existing row not found' },
        { status: 409 }
      )
    }
    
    return NextResponse.json(result.rows[0], { status: 201 })
  } catch (error) {
    console.error('[POST /api/postgres-offline/notes] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create note' },
      { status: 500 }
    )
  }
}