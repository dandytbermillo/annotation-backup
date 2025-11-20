import type { PoolClient } from 'pg'

export type DeleteNoteCascadeOptions = {
  noteId: string
  workspaceId: string
  hardDelete?: boolean
}

export type DeleteNoteCascadeResult = {
  found: boolean
  workspaceId: string
  deletedNote: boolean
  affectedPanels: number
  affectedDocumentSaves: number
  affectedItems: number
  hardDelete: boolean
}

/**
 * Canonical note deletion: marks items/notes/panels as deleted (or hard-deletes)
 * and removes related document_saves. Expects the caller to have set the
 * workspace context (app.current_workspace_id) already.
 */
export async function deleteNoteCascade(
  client: PoolClient,
  { noteId, workspaceId, hardDelete = false }: DeleteNoteCascadeOptions
): Promise<DeleteNoteCascadeResult> {
  // Ensure the note exists in this workspace (or unscoped)
  const noteRow = await client.query<{ workspace_id: string | null }>(
    `SELECT workspace_id FROM notes WHERE id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)`,
    [noteId, workspaceId]
  )

  if (noteRow.rowCount === 0) {
    return {
      found: false,
      workspaceId,
      deletedNote: false,
      affectedPanels: 0,
      affectedDocumentSaves: 0,
      affectedItems: 0,
      hardDelete,
    }
  }

  const effectiveWorkspaceId = noteRow.rows[0].workspace_id ?? workspaceId

  // If the note was unscoped, attach it to the active workspace for consistency
  if (!noteRow.rows[0].workspace_id) {
    await client.query(
      `UPDATE notes SET workspace_id = $1, updated_at = NOW() WHERE id = $2`,
      [effectiveWorkspaceId, noteId]
    )
  }

  await client.query('BEGIN')
  try {
    let affectedDocumentSaves = 0
    try {
      const docRes = await client.query(
        `DELETE FROM document_saves WHERE note_id = $1 AND workspace_id = $2`,
        [noteId, effectiveWorkspaceId]
      )
      affectedDocumentSaves = docRes.rowCount
    } catch (err: any) {
      // Fallback if workspace_id is missing in this environment
      if (typeof err?.message === 'string' && err.message.includes('workspace_id')) {
        const docRes = await client.query(
          `DELETE FROM document_saves WHERE note_id = $1`,
          [noteId]
        )
        affectedDocumentSaves = docRes.rowCount
      } else {
        throw err
      }
    }

    const panelQuery = hardDelete
      ? `DELETE FROM panels WHERE note_id = $1 AND workspace_id = $2 RETURNING id`
      : `UPDATE panels
           SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
         WHERE note_id = $1 AND workspace_id = $2
         RETURNING id`
    const panelResult = await client.query(panelQuery, [noteId, effectiveWorkspaceId])

    const noteQuery = hardDelete
      ? `DELETE FROM notes WHERE id = $1 AND workspace_id = $2 RETURNING id`
      : `UPDATE notes
           SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2
         RETURNING id`
    const noteResult = await client.query(noteQuery, [noteId, effectiveWorkspaceId])

    const itemQuery = hardDelete
      ? `DELETE FROM items WHERE id = $1 AND workspace_id = $2 RETURNING id`
      : `UPDATE items
           SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
         WHERE id = $1 AND workspace_id = $2
         RETURNING id`
    const itemResult = await client.query(itemQuery, [noteId, effectiveWorkspaceId])

    await client.query('COMMIT')

    return {
      found: true,
      workspaceId: effectiveWorkspaceId,
      deletedNote: noteResult.rowCount > 0,
      affectedPanels: panelResult.rowCount,
      affectedDocumentSaves,
      affectedItems: itemResult.rowCount,
      hardDelete,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
