import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { WorkspaceStore, FEATURE_WORKSPACE_SCOPING } from '@/lib/workspace/workspace-store'
import { deleteNoteCascade } from '@/lib/server/note-deletion'

// GET /api/postgres-offline/notes/[id] - Get a note by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Use workspace scoping if feature is enabled
    if (FEATURE_WORKSPACE_SCOPING) {
      const result = await WorkspaceStore.withWorkspace(serverPool, async ({ client, workspaceId }) => {
        return client.query(
          `SELECT id, title, metadata, created_at, updated_at
           FROM notes WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
          [id, workspaceId]
        )
      })

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Note not found' },
          { status: 404 }
        )
      }

      return NextResponse.json(result.rows[0])
    }

    // Legacy path without workspace scoping
    const result = await serverPool.query(
      `SELECT id, title, metadata, created_at, updated_at
       FROM notes WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    )
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Note not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(result.rows[0])
  } catch (error) {
    console.error('[GET /api/postgres-offline/notes/[id]] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get note' },
      { status: 500 }
    )
  }
}

// PATCH /api/postgres-offline/notes/[id] - Update a note
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { title, metadata } = body
    
    // Build dynamic update query
    const updates: string[] = []
    const values: any[] = [id]
    let paramIndex = 2
    
    if (title !== undefined) {
      updates.push(`title = $${paramIndex}`)
      values.push(title)
      paramIndex++
    }
    
    if (metadata !== undefined) {
      updates.push(`metadata = $${paramIndex}::jsonb`)
      values.push(JSON.stringify(metadata))
      paramIndex++
    }
    
    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }
    
    updates.push('updated_at = NOW()')

    // Use workspace scoping if feature is enabled
    if (FEATURE_WORKSPACE_SCOPING) {
      const result = await WorkspaceStore.withWorkspace(serverPool, async ({ client, workspaceId }) => {
        // Add workspace_id to the WHERE clause
        values.push(workspaceId)
        return client.query(
          `UPDATE notes 
           SET ${updates.join(', ')}
           WHERE id = $1 AND workspace_id = $${paramIndex} AND deleted_at IS NULL
           RETURNING id, title, metadata, created_at, updated_at`,
          values
        )
      })

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Note not found in this workspace' },
          { status: 404 }
        )
      }

      return NextResponse.json(result.rows[0])
    }

    // Legacy path without workspace scoping
    const result = await serverPool.query(
      `UPDATE notes 
       SET ${updates.join(', ')}
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, title, metadata, created_at, updated_at`,
      values
    )
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Note not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(result.rows[0])
  } catch (error) {
    console.error('[PATCH /api/postgres-offline/notes/[id]] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update note' },
      { status: 500 }
    )
  }
}

// DELETE /api/postgres-offline/notes/[id] - Soft delete note + panels + saves
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  let body: any = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const requestedWorkspaceId =
    (typeof body?.workspaceId === 'string' && body.workspaceId.length > 0 ? body.workspaceId : undefined) ??
    request.headers.get('x-overlay-workspace-id') ??
    undefined
  const hardDelete = body?.hardDelete === true

  try {
    return await WorkspaceStore.withWorkspace(serverPool, async ({ client, workspaceId }) => {
      let activeWorkspaceId = workspaceId
      let resetWorkspaceAtEnd = false

      if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
        const exists = await client.query('SELECT 1 FROM workspaces WHERE id = $1', [requestedWorkspaceId])
        if (exists.rowCount === 0) {
          return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }
        await client.query('SELECT set_config($1, $2, false)', ['app.current_workspace_id', requestedWorkspaceId])
        activeWorkspaceId = requestedWorkspaceId
        resetWorkspaceAtEnd = true
      }

      try {
        const result = await deleteNoteCascade(client, {
          noteId: id,
          workspaceId: activeWorkspaceId,
          hardDelete,
        })

        if (!result.found) {
          return NextResponse.json({ error: 'Note not found' }, { status: 404 })
        }

        return NextResponse.json({
          success: true,
          workspaceId: result.workspaceId,
          hardDelete: result.hardDelete,
          deletedNote: result.deletedNote,
          affectedPanels: result.affectedPanels,
          affectedDocumentSaves: result.affectedDocumentSaves,
          affectedItems: result.affectedItems,
        })
      } finally {
        if (resetWorkspaceAtEnd) {
          await client.query('SELECT set_config($1, $2, false)', ['app.current_workspace_id', workspaceId])
        }
      }
    })
  } catch (error) {
    console.error('[DELETE /api/postgres-offline/notes/[id]] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete note' },
      { status: 500 }
    )
  }
}
