/**
 * Entry Service
 *
 * Client-side service for entry operations.
 * Handles API calls for creating entries, fetching workspaces by entry, etc.
 */

import type {
  Entry,
  EntrySummary,
  EntryWorkspaceSummary,
  CreateEntryOptions,
  CreateEntryResult,
} from './entry-types'

/**
 * Fetch workspaces for a specific entry
 */
export async function fetchWorkspacesForEntry(
  entryId: string
): Promise<EntryWorkspaceSummary[]> {
  const response = await fetch(
    `/api/entries/${encodeURIComponent(entryId)}/workspaces`,
    { cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch workspaces: ${response.status}`)
  }

  const data = await response.json()
  return data.workspaces || []
}

/**
 * Search workspaces with optional entry filter
 */
export async function searchWorkspaces(options: {
  query?: string
  entryId?: string
  limit?: number
}): Promise<EntryWorkspaceSummary[]> {
  const params = new URLSearchParams()
  if (options.query) params.set('q', options.query)
  if (options.entryId) params.set('entryId', options.entryId)
  if (options.limit) params.set('limit', String(options.limit))

  const response = await fetch(
    `/api/dashboard/workspaces/search?${params.toString()}`,
    { cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Failed to search workspaces: ${response.status}`)
  }

  const data = await response.json()
  return data.workspaces || []
}

/**
 * Create a new entry with optional dashboard seeding
 */
export async function createEntry(
  options: CreateEntryOptions
): Promise<CreateEntryResult> {
  const response = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to create entry: ${response.status}`)
  }

  return response.json()
}

/**
 * Create an entry for a workspace that doesn't have one (legacy workspace migration)
 * This is used when clicking a Quick Link that points to a workspace without an entry
 */
export async function createEntryForWorkspace(
  workspaceId: string,
  workspaceName: string
): Promise<CreateEntryResult> {
  const response = await fetch('/api/entries/create-for-workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, workspaceName }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to create entry for workspace: ${response.status}`)
  }

  return response.json()
}

/**
 * Seed dashboard panels for an entry
 */
export async function seedEntryDashboard(entryId: string): Promise<{
  dashboardWorkspaceId: string
  panelCount: number
}> {
  const response = await fetch(`/api/entries/${encodeURIComponent(entryId)}/seed-dashboard`, {
    method: 'POST',
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to seed dashboard: ${response.status}`)
  }

  return response.json()
}

/**
 * Get entry details by ID
 */
export async function getEntry(entryId: string): Promise<Entry | null> {
  const response = await fetch(`/api/entries/${encodeURIComponent(entryId)}`, {
    cache: 'no-store',
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to get entry: ${response.status}`)
  }

  const data = await response.json()
  return data.entry || null
}

/**
 * Resolve entry from a workspace ID
 * Returns the entry that owns the workspace
 */
export async function resolveEntryFromWorkspace(
  workspaceId: string
): Promise<EntrySummary | null> {
  const response = await fetch(
    `/api/note-workspaces/${encodeURIComponent(workspaceId)}`,
    { cache: 'no-store' }
  )

  if (!response.ok) {
    return null
  }

  const data = await response.json()
  const workspace = data.workspace

  if (!workspace?.itemId) {
    return null
  }

  // Fetch entry details
  const entryResponse = await fetch(
    `/api/entries/${encodeURIComponent(workspace.itemId)}`,
    { cache: 'no-store' }
  )

  if (!entryResponse.ok) {
    return null
  }

  const entryData = await entryResponse.json()
  return entryData.entry
    ? {
        id: entryData.entry.id,
        name: entryData.entry.name,
        isSystem: entryData.entry.isSystem || false,
        workspaceCount: 0, // Could be fetched separately if needed
      }
    : null
}

/**
 * Create a workspace under a specific entry
 */
export async function createWorkspaceForEntry(
  entryId: string,
  name: string
): Promise<{ id: string; name: string }> {
  const response = await fetch('/api/note-workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, itemId: entryId }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to create workspace: ${response.status}`)
  }

  const data = await response.json()
  return {
    id: data.workspace.id,
    name: data.workspace.name,
  }
}
