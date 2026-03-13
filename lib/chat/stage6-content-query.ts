/**
 * Stage 6 Content Extension: Shared Note Content Query (Slice 6x.3)
 *
 * Workspace-scoped database query for note content retrieval.
 * Used by both:
 *   - app/api/chat/inspect-note-content/route.ts (standalone API route)
 *   - app/api/chat/stage6-loop/route.ts (loop-internal call)
 *
 * Enforces:
 *   - workspace-level access (fail-closed)
 *   - soft-delete filtering
 *   - latest document_saves selection
 */

import type { PoolClient } from 'pg'

// ============================================================================
// Types
// ============================================================================

export interface NoteContentQueryResult {
  success: boolean
  error?: 'item_not_found' | 'workspace_mismatch' | 'item_deleted' | string
  data?: {
    itemId: string
    title: string
    documentText: string | null
    content: unknown
    version: number
    createdAt: string
  }
}

// ============================================================================
// Query
// ============================================================================

/**
 * Fetch note content with workspace-scoped access enforcement.
 *
 * Steps:
 *   1. Look up item by ID + type='note'
 *   2. Fail-closed workspace check
 *   3. Soft-delete check
 *   4. Fetch latest document_saves row (workspace-scoped)
 *
 * Returns raw text + metadata for client-side snippet extraction.
 */
export async function queryNoteContent(
  client: PoolClient,
  workspaceId: string,
  itemId: string,
): Promise<NoteContentQueryResult> {
  // Step 1: Check if the item exists at all (any workspace, any state)
  const itemCheck = await client.query<{
    id: string
    name: string
    workspace_id: string | null
    deleted_at: string | null
  }>(
    `SELECT id, name, workspace_id, deleted_at
     FROM items
     WHERE id = $1 AND type = 'note'
     LIMIT 1`,
    [itemId],
  )

  if (itemCheck.rows.length === 0) {
    return { success: false, error: 'item_not_found' }
  }

  const item = itemCheck.rows[0]

  // Step 2: Fail-closed workspace access check
  if (item.workspace_id && item.workspace_id !== workspaceId) {
    return { success: false, error: 'workspace_mismatch' }
  }

  // Step 3: Check soft-delete
  if (item.deleted_at) {
    return { success: false, error: 'item_deleted' }
  }

  // Step 4: Fetch latest document content (workspace-scoped)
  const docResult = await client.query<{
    document_text: string | null
    content: unknown
    version: number
    created_at: string
  }>(
    `SELECT document_text, content, version, created_at
     FROM document_saves
     WHERE note_id = $1
       AND workspace_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [itemId, workspaceId],
  )

  const doc = docResult.rows[0] ?? null

  return {
    success: true,
    data: {
      itemId: item.id,
      title: item.name || '',
      documentText: doc?.document_text ?? null,
      content: doc?.document_text ? null : (doc?.content ?? null),
      version: doc?.version ?? 0,
      createdAt: doc?.created_at ?? new Date().toISOString(),
    },
  }
}
