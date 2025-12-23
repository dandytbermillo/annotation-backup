/**
 * Note Resolver
 *
 * Resolves note titles to IDs using the items table for folder context.
 * Used by the chat navigation feature.
 *
 * Data Model Notes:
 * - notes.workspace_id → workspaces.id (overlay/system workspace, NOT user workspace)
 * - note_workspaces is a separate user workspace system with user_id and item_id
 * - items table (type='note') has the same ID as notes and provides folder hierarchy
 * - We use items table for path/entry context since notes.id = items.id
 */

import { serverPool } from '@/lib/db/pool'
import type {
  NoteMatch,
  NoteResolutionResult,
  ResolutionContext,
} from './resolution-types'

// =============================================================================
// Note Resolution
// =============================================================================

/**
 * Resolve a note by title.
 *
 * Uses items table for folder/entry context since notes.id = items.id.
 * For workspace context, looks up note_workspaces that have the note open.
 *
 * @param noteTitle - The note title to search for
 * @param context - Current entry/workspace context
 * @param entryName - Optional entry name to scope the search
 */
export async function resolveNote(
  noteTitle: string,
  context: ResolutionContext,
  entryName?: string
): Promise<NoteResolutionResult> {
  try {
    const searchTerm = noteTitle.trim().toLowerCase()

    // Search notes using items table for folder context
    // items.id = notes.id for type='note'
    let query: string
    let params: any[]

    if (entryName) {
      // Search within a specific entry (by name in path)
      // Find notes whose folder path contains the entry name
      query = `
        SELECT DISTINCT ON (n.id)
          n.id,
          n.title,
          n.id as note_id,
          i.parent_id as entry_id,
          parent_item.name as entry_name,
          parent_item.path as entry_path,
          SUBSTRING(n.content_text, 1, 100) as excerpt
        FROM notes n
        INNER JOIN items i ON n.id = i.id AND i.type = 'note' AND i.deleted_at IS NULL
        LEFT JOIN items parent_item ON i.parent_id = parent_item.id
        WHERE n.deleted_at IS NULL
          AND LOWER(n.title) LIKE $1
          AND (LOWER(parent_item.name) LIKE $2 OR LOWER(i.path) LIKE $2)
        ORDER BY n.id,
          CASE WHEN LOWER(n.title) = $3 THEN 0 ELSE 1 END,
          n.updated_at DESC NULLS LAST
        LIMIT 10
      `
      params = [
        `%${searchTerm}%`,
        `%${entryName.toLowerCase()}%`,
        searchTerm,
      ]
    } else if (context.currentWorkspaceId) {
      // Search notes that are open in the current workspace
      // Check note_workspaces.payload.openNotes for the workspace
      query = `
        SELECT DISTINCT ON (n.id)
          n.id,
          n.title,
          n.id as note_id,
          nw.id as workspace_id,
          nw.name as workspace_name,
          nw.item_id as entry_id,
          entry_item.name as entry_name,
          SUBSTRING(n.content_text, 1, 100) as excerpt
        FROM notes n
        INNER JOIN note_workspaces nw ON nw.id = $1
        LEFT JOIN items entry_item ON nw.item_id = entry_item.id
        WHERE n.deleted_at IS NULL
          AND LOWER(n.title) LIKE $2
          AND (
            nw.payload->'openNotes' @> jsonb_build_array(jsonb_build_object('noteId', n.id::text))
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(nw.payload->'openNotes') AS elem
              WHERE elem->>'noteId' = n.id::text
            )
          )
        ORDER BY n.id,
          CASE WHEN LOWER(n.title) = $3 THEN 0 ELSE 1 END,
          n.updated_at DESC NULLS LAST
        LIMIT 10
      `
      params = [context.currentWorkspaceId, `%${searchTerm}%`, searchTerm]
    } else if (context.currentEntryId) {
      // Search within current entry's folder hierarchy
      query = `
        SELECT DISTINCT ON (n.id)
          n.id,
          n.title,
          n.id as note_id,
          i.parent_id as entry_id,
          parent_item.name as entry_name,
          SUBSTRING(n.content_text, 1, 100) as excerpt
        FROM notes n
        INNER JOIN items i ON n.id = i.id AND i.type = 'note' AND i.deleted_at IS NULL
        LEFT JOIN items parent_item ON i.parent_id = parent_item.id
        WHERE n.deleted_at IS NULL
          AND LOWER(n.title) LIKE $1
          AND (i.parent_id = $2 OR i.path LIKE (SELECT path || '/%' FROM items WHERE id = $2))
        ORDER BY n.id,
          CASE WHEN LOWER(n.title) = $3 THEN 0 ELSE 1 END,
          n.updated_at DESC NULLS LAST
        LIMIT 10
      `
      params = [
        `%${searchTerm}%`,
        context.currentEntryId,
        searchTerm,
      ]
    } else {
      // No context, search across all notes with folder context
      query = `
        SELECT DISTINCT ON (n.id)
          n.id,
          n.title,
          n.id as note_id,
          i.parent_id as entry_id,
          parent_item.name as entry_name,
          SUBSTRING(n.content_text, 1, 100) as excerpt
        FROM notes n
        LEFT JOIN items i ON n.id = i.id AND i.type = 'note' AND i.deleted_at IS NULL
        LEFT JOIN items parent_item ON i.parent_id = parent_item.id
        WHERE n.deleted_at IS NULL
          AND LOWER(n.title) LIKE $1
        ORDER BY n.id,
          CASE WHEN LOWER(n.title) = $2 THEN 0 ELSE 1 END,
          n.updated_at DESC NULLS LAST
        LIMIT 10
      `
      params = [`%${searchTerm}%`, searchTerm]
    }

    const result = await serverPool.query(query, params)

    if (result.rows.length === 0) {
      // No results in current scope - offer to broaden
      const scopeMessage = context.currentWorkspaceId
        ? 'No note found in current workspace. Try searching in the full entry?'
        : 'No note found matching that title.'

      return {
        status: 'not_found',
        message: scopeMessage,
      }
    }

    const matches: NoteMatch[] = result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      noteId: row.note_id,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      entryId: row.entry_id,
      entryName: row.entry_name,
      excerpt: row.excerpt,
    }))

    // Check for exact match
    const exactMatch = matches.find(
      (m) => m.title.toLowerCase() === searchTerm
    )

    if (exactMatch && matches.length === 1) {
      return {
        status: 'found',
        note: exactMatch,
      }
    }

    if (exactMatch) {
      return {
        status: 'found',
        note: exactMatch,
        matches, // Include all for reference
      }
    }

    if (matches.length === 1) {
      return {
        status: 'found',
        note: matches[0],
      }
    }

    // Multiple matches
    return {
      status: 'multiple',
      matches,
      message: `Multiple notes match "${noteTitle}". Please select one.`,
    }
  } catch (error) {
    console.error('[note-resolver] Error:', error)
    return {
      status: 'not_found',
      message: 'Failed to search notes',
    }
  }
}
