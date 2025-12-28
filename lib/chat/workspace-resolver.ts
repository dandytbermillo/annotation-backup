/**
 * Workspace Resolver
 *
 * Resolves workspace names to IDs using existing APIs.
 * Used by the chat navigation feature.
 */

import { serverPool } from '@/lib/db/pool'
import type {
  WorkspaceMatch,
  WorkspaceResolutionResult,
  ResolutionContext,
} from './resolution-types'

// =============================================================================
// Workspace Resolution
// =============================================================================

/**
 * Resolve a workspace by name.
 *
 * @param workspaceName - The workspace name to search for
 * @param context - Current entry/workspace context
 * @param entryName - Optional entry name to scope the search
 */
export async function resolveWorkspace(
  workspaceName: string,
  context: ResolutionContext,
  entryName?: string
): Promise<WorkspaceResolutionResult> {
  try {
    // Normalize the search term
    const searchTerm = workspaceName.trim().toLowerCase()

    // If the name starts with "workspace ", also consider the remainder as an alternate
    // Example: "workspace 5" could be ambiguous with a workspace named "5".
    const altSearchTerm = searchTerm.startsWith('workspace ')
      ? searchTerm.replace(/^workspace\s+/, '').trim()
      : ''

    // Handle special case: "dashboard"
    const isDashboard = searchTerm === 'dashboard' || searchTerm === 'home'

    function buildQuery(term: string): { query: string; params: any[] } {
      let query: string
      let params: any[]

      if (entryName) {
        // Search within a specific entry (by name)
        query = `
          SELECT
            nw.id,
            nw.name,
            nw.item_id as entry_id,
            nw.is_default,
            nw.updated_at,
            i.name as entry_name
          FROM note_workspaces nw
          LEFT JOIN items i ON nw.item_id = i.id
          WHERE nw.user_id = $1
            AND LOWER(i.name) LIKE $2
            AND (LOWER(nw.name) LIKE $3 OR ($4 AND nw.is_default = true))
          ORDER BY
            CASE WHEN LOWER(nw.name) = $5 THEN 0 ELSE 1 END,
            nw.updated_at DESC NULLS LAST
          LIMIT 10
        `
        params = [
          context.userId,
          `%${entryName.toLowerCase()}%`,
          `%${term}%`,
          isDashboard,
          term,
        ]
      } else if (context.currentEntryId) {
        // Search within current entry first
        query = `
          SELECT
            nw.id,
            nw.name,
            nw.item_id as entry_id,
            nw.is_default,
            nw.updated_at,
            i.name as entry_name
          FROM note_workspaces nw
          LEFT JOIN items i ON nw.item_id = i.id
          WHERE nw.user_id = $1
            AND nw.item_id = $2
            AND (LOWER(nw.name) LIKE $3 OR ($4 AND nw.is_default = true))
          ORDER BY
            CASE WHEN LOWER(nw.name) = $5 THEN 0 ELSE 1 END,
            nw.updated_at DESC NULLS LAST
          LIMIT 10
        `
        params = [
          context.userId,
          context.currentEntryId,
          `%${term}%`,
          isDashboard,
          term,
        ]
      } else {
        // Search across all entries
        query = `
          SELECT
            nw.id,
            nw.name,
            nw.item_id as entry_id,
            nw.is_default,
            nw.updated_at,
            i.name as entry_name
          FROM note_workspaces nw
          LEFT JOIN items i ON nw.item_id = i.id
          WHERE nw.user_id = $1
            AND (LOWER(nw.name) LIKE $2 OR ($3 AND nw.is_default = true))
          ORDER BY
            CASE WHEN LOWER(nw.name) = $4 THEN 0 ELSE 1 END,
            nw.updated_at DESC NULLS LAST
          LIMIT 10
        `
        params = [context.userId, `%${term}%`, isDashboard, term]
      }

      return { query, params }
    }

    const primary = buildQuery(searchTerm)
    const primaryResult = await serverPool.query(primary.query, primary.params)

    let matches: WorkspaceMatch[] = primaryResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      entryId: row.entry_id,
      entryName: row.entry_name || 'Unknown',
      isDefault: row.is_default || false,
      updatedAt: row.updated_at,
    }))

    // If "workspace X" could also mean "X", search the alternate term and merge
    if (altSearchTerm) {
      const alt = buildQuery(altSearchTerm)
      const altResult = await serverPool.query(alt.query, alt.params)
      const altMatches: WorkspaceMatch[] = altResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        entryId: row.entry_id,
        entryName: row.entry_name || 'Unknown',
        isDefault: row.is_default || false,
        updatedAt: row.updated_at,
      }))

      const seen = new Set(matches.map((m) => m.id))
      for (const m of altMatches) {
        if (!seen.has(m.id)) {
          matches.push(m)
          seen.add(m.id)
        }
      }
    }

    if (matches.length === 0) {
      return {
        status: 'not_found',
        message: `No workspace found matching "${workspaceName}"`,
      }
    }

    // If exact match (case-insensitive), return it
    const exactMatch = matches.find(
      (m) => m.name.toLowerCase() === searchTerm ||
        (isDashboard && m.isDefault)
    )

    const altExactMatch = altSearchTerm
      ? matches.find((m) => m.name.toLowerCase() === altSearchTerm)
      : undefined

    // If both exact matches exist ("workspace 5" and "5"), request clarification
    if (exactMatch && altExactMatch && exactMatch.id !== altExactMatch.id) {
      return {
        status: 'multiple',
        matches: [exactMatch, altExactMatch],
        message: `Did you mean "${exactMatch.name}" or "${altExactMatch.name}"?`,
      }
    }

    if (exactMatch && matches.length === 1) {
      return {
        status: 'found',
        workspace: exactMatch,
      }
    }

    if (exactMatch) {
      // Exact match exists but there are other partial matches
      // Return the exact match as primary
      return {
        status: 'found',
        workspace: exactMatch,
        matches, // Include all for reference
      }
    }

    if (matches.length === 1) {
      return {
        status: 'found',
        workspace: matches[0],
      }
    }

    // Multiple matches - need user selection
    return {
      status: 'multiple',
      matches,
      message: `Multiple workspaces match "${workspaceName}". Please select one.`,
    }
  } catch (error) {
    console.error('[workspace-resolver] Error:', error)
    return {
      status: 'not_found',
      message: 'Failed to search workspaces',
    }
  }
}

// =============================================================================
// Recent Workspace Resolution
// =============================================================================

/**
 * Get the most recent workspace for the current entry.
 * Per plan: "Use the most recent workspace for the current entry."
 */
export async function resolveRecentWorkspace(
  context: ResolutionContext
): Promise<WorkspaceResolutionResult> {
  try {
    // If we have a current entry, scope to that entry only
    // Otherwise fall back to most recent across all entries
    const hasEntryScope = !!context.currentEntryId

    const query = hasEntryScope
      ? `
        SELECT
          nw.id,
          nw.name,
          nw.item_id as entry_id,
          nw.is_default,
          nw.updated_at,
          i.name as entry_name
        FROM note_workspaces nw
        LEFT JOIN items i ON nw.item_id = i.id
        WHERE nw.user_id = $1
          AND nw.item_id = $2
          AND (i.is_system IS NULL OR i.is_system = FALSE)
        ORDER BY nw.updated_at DESC NULLS LAST
        LIMIT 1
      `
      : `
        SELECT
          nw.id,
          nw.name,
          nw.item_id as entry_id,
          nw.is_default,
          nw.updated_at,
          i.name as entry_name
        FROM note_workspaces nw
        LEFT JOIN items i ON nw.item_id = i.id
        WHERE nw.user_id = $1
          AND (i.is_system IS NULL OR i.is_system = FALSE)
        ORDER BY nw.updated_at DESC NULLS LAST
        LIMIT 1
      `

    const params = hasEntryScope
      ? [context.userId, context.currentEntryId]
      : [context.userId]

    const result = await serverPool.query(query, params)

    if (result.rows.length === 0) {
      return {
        status: 'not_found',
        message: 'No recent workspace found',
      }
    }

    const row = result.rows[0]
    return {
      status: 'found',
      workspace: {
        id: row.id,
        name: row.name,
        entryId: row.entry_id,
        entryName: row.entry_name || 'Unknown',
        isDefault: row.is_default || false,
        updatedAt: row.updated_at,
      },
    }
  } catch (error) {
    console.error('[workspace-resolver] Recent error:', error)
    return {
      status: 'not_found',
      message: 'Failed to fetch recent workspace',
    }
  }
}

// =============================================================================
// List Workspaces (Entry Scoped)
// =============================================================================

/**
 * List all workspaces in the current entry, ordered by updatedAt desc.
 */
export async function listWorkspaces(
  context: ResolutionContext
): Promise<WorkspaceResolutionResult> {
  try {
    if (!context.currentEntryId) {
      return {
        status: 'not_found',
        message: 'Please open an entry first to list its workspaces.',
      }
    }

    const query = `
      SELECT
        nw.id,
        nw.name,
        nw.item_id as entry_id,
        nw.is_default,
        nw.updated_at,
        i.name as entry_name,
        (SELECT COUNT(*) FROM panels p WHERE p.workspace_id = nw.id) as note_count
      FROM note_workspaces nw
      LEFT JOIN items i ON nw.item_id = i.id
      WHERE nw.user_id = $1
        AND nw.item_id = $2
      ORDER BY nw.updated_at DESC NULLS LAST
    `

    const result = await serverPool.query(query, [
      context.userId,
      context.currentEntryId,
    ])

    if (result.rows.length === 0) {
      return {
        status: 'not_found',
        message: 'No workspaces found in this entry.',
      }
    }

    const matches: WorkspaceMatch[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      entryId: row.entry_id,
      entryName: row.entry_name || 'Unknown',
      isDefault: row.is_default || false,
      updatedAt: row.updated_at,
      noteCount: parseInt(row.note_count, 10) || 0,
    }))

    return {
      status: 'multiple',
      matches,
      message: `Found ${matches.length} workspace${matches.length === 1 ? '' : 's'}:`,
    }
  } catch (error) {
    console.error('[workspace-resolver] List error:', error)
    return {
      status: 'not_found',
      message: 'Failed to list workspaces',
    }
  }
}

// =============================================================================
// Rename Workspace
// =============================================================================

export interface RenameWorkspaceResult {
  success: boolean
  message: string
  workspace?: WorkspaceMatch
}

/**
 * Rename a workspace by ID.
 * @param workspaceId - The workspace ID to rename
 * @param newName - The new name for the workspace
 * @param context - Current context for validation
 */
export async function renameWorkspace(
  workspaceId: string,
  newName: string,
  context: ResolutionContext
): Promise<RenameWorkspaceResult> {
  try {
    if (!newName || !newName.trim()) {
      return {
        success: false,
        message: 'Please provide a new name for the workspace.',
      }
    }

    const trimmedName = newName.trim()

    // Check for duplicate name in same entry
    const checkDuplicateQuery = `
      SELECT id, name FROM note_workspaces
      WHERE user_id = $1
        AND item_id = (SELECT item_id FROM note_workspaces WHERE id = $2)
        AND LOWER(name) = LOWER($3)
        AND id != $2
      LIMIT 1
    `
    const duplicateResult = await serverPool.query(checkDuplicateQuery, [
      context.userId,
      workspaceId,
      trimmedName,
    ])

    if (duplicateResult.rows.length > 0) {
      return {
        success: false,
        message: `A workspace named "${trimmedName}" already exists in this entry.`,
      }
    }

    // Perform the rename
    const updateQuery = `
      UPDATE note_workspaces
      SET name = $1, updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING id, name, item_id as entry_id, is_default, updated_at
    `
    const updateResult = await serverPool.query(updateQuery, [
      trimmedName,
      workspaceId,
      context.userId,
    ])

    if (updateResult.rows.length === 0) {
      return {
        success: false,
        message: 'Workspace not found or you do not have permission to rename it.',
      }
    }

    const row = updateResult.rows[0]

    // Get entry name
    const entryQuery = `SELECT name FROM items WHERE id = $1`
    const entryResult = await serverPool.query(entryQuery, [row.entry_id])
    const entryName = entryResult.rows[0]?.name || 'Unknown'

    return {
      success: true,
      message: `Renamed workspace to "${trimmedName}"`,
      workspace: {
        id: row.id,
        name: row.name,
        entryId: row.entry_id,
        entryName,
        isDefault: row.is_default || false,
        updatedAt: row.updated_at,
      },
    }
  } catch (error) {
    console.error('[workspace-resolver] Rename error:', error)
    return {
      success: false,
      message: 'Failed to rename workspace',
    }
  }
}

// =============================================================================
// Delete Workspace
// =============================================================================

export interface DeleteWorkspaceResult {
  success: boolean
  message: string
  deletedWorkspaceId?: string
  wasCurrentWorkspace?: boolean
}

/**
 * Delete a workspace by ID (permanent deletion).
 * @param workspaceId - The workspace ID to delete
 * @param context - Current context for validation
 */
export async function deleteWorkspace(
  workspaceId: string,
  context: ResolutionContext
): Promise<DeleteWorkspaceResult> {
  try {
    // Check if workspace exists and is not default
    const checkQuery = `
      SELECT id, name, is_default, item_id as entry_id
      FROM note_workspaces
      WHERE id = $1 AND user_id = $2
    `
    const checkResult = await serverPool.query(checkQuery, [
      workspaceId,
      context.userId,
    ])

    if (checkResult.rows.length === 0) {
      return {
        success: false,
        message: 'Workspace not found or you do not have permission to delete it.',
      }
    }

    const workspace = checkResult.rows[0]

    // Block deletion of default workspace
    if (workspace.is_default) {
      return {
        success: false,
        message: 'Cannot delete the default workspace.',
      }
    }

    const wasCurrentWorkspace = context.currentWorkspaceId === workspaceId

    // Delete related panels first (foreign key constraint)
    await serverPool.query('DELETE FROM panels WHERE workspace_id = $1', [workspaceId])

    // Delete the workspace
    await serverPool.query(
      'DELETE FROM note_workspaces WHERE id = $1 AND user_id = $2',
      [workspaceId, context.userId]
    )

    return {
      success: true,
      message: `Deleted workspace "${workspace.name}"`,
      deletedWorkspaceId: workspaceId,
      wasCurrentWorkspace,
    }
  } catch (error) {
    console.error('[workspace-resolver] Delete error:', error)
    return {
      success: false,
      message: 'Failed to delete workspace',
    }
  }
}
