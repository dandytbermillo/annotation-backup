import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { FEATURE_WORKSPACE_SCOPING, withWorkspaceClient } from '@/lib/workspace/workspace-store'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { newType } = await request.json()
    const { id: branchId } = await params

    if (!['note', 'explore', 'promote'].includes(newType)) {
      return NextResponse.json(
        { error: 'Invalid type. Must be note, explore, or promote' },
        { status: 400 }
      )
    }

    if (FEATURE_WORKSPACE_SCOPING) {
      return await withWorkspaceClient(serverPool, async (client) => {
        // Get current branch
        const current = await client.query(
          'SELECT type, title, original_text, metadata FROM branches WHERE id = $1',
          [branchId]
        )

        if (current.rows.length === 0) {
          return NextResponse.json({ error: 'Branch not found' }, { status: 404 })
        }

        const branch = current.rows[0]
        const oldType = branch.type

        if (oldType === newType) {
          // No change needed - return current state
          const unchanged = await client.query(
            `SELECT id, note_id as "noteId", parent_id as "parentId",
                    type, title, original_text as "originalText", metadata, anchors,
                    created_at as "createdAt", updated_at as "updatedAt"
             FROM branches WHERE id = $1`,
            [branchId]
          )
          return NextResponse.json(unchanged.rows[0])
        }

        // Update type history (immutable - create new array)
        const metadata = branch.metadata || {}
        const typeHistory = [...(metadata.typeHistory || [])]
        typeHistory.push({
          type: newType,
          changedAt: new Date().toISOString(),
          reason: 'user_change'
        })

        // Update branch - keep existing title (user may have customized it)
        const updated = await client.query(
          `UPDATE branches
           SET type = $1,
               metadata = $2::jsonb,
               updated_at = NOW()
           WHERE id = $3
           RETURNING id, note_id as "noteId", parent_id as "parentId",
                     type, title, original_text as "originalText", metadata, anchors,
                     created_at as "createdAt", updated_at as "updatedAt"`,
          [
            newType,
            JSON.stringify({ ...metadata, annotationType: newType, typeHistory }),
            branchId
          ]
        )

        return NextResponse.json(updated.rows[0])
      })
    }

    // Non-workspace version
    // Get current branch
    const current = await serverPool.query(
      'SELECT type, title, original_text, metadata FROM branches WHERE id = $1',
      [branchId]
    )

    if (current.rows.length === 0) {
      return NextResponse.json({ error: 'Branch not found' }, { status: 404 })
    }

    const branch = current.rows[0]
    const oldType = branch.type

    if (oldType === newType) {
      // No change needed - return current state
      const unchanged = await serverPool.query(
        `SELECT id, note_id as "noteId", parent_id as "parentId",
                type, title, original_text as "originalText", metadata, anchors,
                created_at as "createdAt", updated_at as "updatedAt"
         FROM branches WHERE id = $1`,
        [branchId]
      )
      return NextResponse.json(unchanged.rows[0])
    }

    // Update type history (immutable - create new array)
    const metadata = branch.metadata || {}
    const typeHistory = [...(metadata.typeHistory || [])]
    typeHistory.push({
      type: newType,
      changedAt: new Date().toISOString(),
      reason: 'user_change'
    })

    // Update branch - keep existing title
    const updated = await serverPool.query(
      `UPDATE branches
       SET type = $1,
           metadata = $2::jsonb,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, note_id as "noteId", parent_id as "parentId",
                 type, title, original_text as "originalText", metadata, anchors,
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [
        newType,
        JSON.stringify({ ...metadata, annotationType: newType, typeHistory }),
        branchId
      ]
    )

    return NextResponse.json(updated.rows[0])
  } catch (error) {
    console.error('[PATCH /api/postgres-offline/branches/[id]/change-type] Error:', error)
    return NextResponse.json(
      { error: 'Failed to change branch type', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
