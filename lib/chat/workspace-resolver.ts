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
