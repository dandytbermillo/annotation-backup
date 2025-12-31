/**
 * Entry Resolver
 *
 * Resolves entry names to IDs using the items table.
 * Used by the chat navigation feature for bare name resolution.
 *
 * Data Model:
 * - Entries are items in the `items` table (folders or notes in the knowledge base)
 * - Each entry can have workspaces in `note_workspaces`
 * - Navigation goes to the entry's dashboard via chat-navigate-entry event
 */

import { serverPool } from '@/lib/db/pool'
import type {
  EntryMatch,
  EntryResolutionResult,
  ResolutionContext,
} from './resolution-types'

// =============================================================================
// Entry Resolution
// =============================================================================

/**
 * Resolve an entry by name.
 *
 * Searches the items table for entries matching the name.
 *
 * @param entryName - The entry name to search for
 * @param context - Current context (userId for filtering)
 */
export async function resolveEntry(
  entryName: string,
  context: ResolutionContext
): Promise<EntryResolutionResult> {
  try {
    const searchTerm = entryName.trim().toLowerCase()

    // Search items table for entries matching the name
    // Also fetch the Dashboard workspace for navigation (identified by name = 'Dashboard')
    const query = `
      SELECT
        i.id,
        i.name,
        i.path,
        i.type,
        i.parent_id,
        parent.name as parent_name,
        i.is_system,
        nw.id as dashboard_workspace_id
      FROM items i
      LEFT JOIN items parent ON i.parent_id = parent.id
      LEFT JOIN note_workspaces nw ON nw.item_id = i.id
        AND nw.user_id = $1
        AND nw.name = 'Dashboard'
      WHERE i.deleted_at IS NULL
        AND LOWER(i.name) LIKE $2
        AND (i.is_system IS NULL OR i.is_system = FALSE)
        AND (i.user_id IS NULL OR i.user_id = $1)
      ORDER BY
        CASE WHEN LOWER(i.name) = $3 THEN 0 ELSE 1 END,
        i.updated_at DESC NULLS LAST
      LIMIT 10
    `
    const params = [context.userId, `%${searchTerm}%`, searchTerm]

    const result = await serverPool.query(query, params)

    if (result.rows.length === 0) {
      return {
        status: 'not_found',
        message: `No entry found matching "${entryName}".`,
      }
    }

    const matches: EntryMatch[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      type: row.type as 'folder' | 'note',
      parentId: row.parent_id,
      parentName: row.parent_name,
      isSystem: row.is_system || false,
      dashboardWorkspaceId: row.dashboard_workspace_id,
    }))

    // Check for exact match
    const exactMatch = matches.find(
      (m) => m.name.toLowerCase() === searchTerm
    )

    if (exactMatch && matches.length === 1) {
      return {
        status: 'found',
        entry: exactMatch,
      }
    }

    if (exactMatch) {
      return {
        status: 'found',
        entry: exactMatch,
        matches, // Include all for reference
      }
    }

    if (matches.length === 1) {
      return {
        status: 'found',
        entry: matches[0],
      }
    }

    // Multiple matches
    return {
      status: 'multiple',
      matches,
      message: `Multiple entries match "${entryName}". Please select one.`,
    }
  } catch (error) {
    console.error('[entry-resolver] Error:', error)
    return {
      status: 'not_found',
      message: 'Failed to search entries',
    }
  }
}
