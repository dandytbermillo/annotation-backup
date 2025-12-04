/**
 * Entry Types
 *
 * Types for the entry/workspace hierarchy system.
 * An "entry" is a container (project/folder) that owns workspaces.
 */

/**
 * Represents an entry (container) that owns workspaces
 */
export type Entry = {
  id: string
  name: string
  path: string
  parentId: string | null
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Summary of an entry for display purposes
 */
export type EntrySummary = {
  id: string
  name: string
  isSystem: boolean
  workspaceCount: number
}

/**
 * Workspace summary with entry association
 */
export type EntryWorkspaceSummary = {
  id: string
  name: string
  entryId: string
  entryName: string
  isDefault: boolean
  updatedAt: string
  noteCount: number
}

/**
 * Options for creating an entry
 */
export type CreateEntryOptions = {
  name: string
  parentId?: string
  seedDashboard?: boolean
}

/**
 * Result of entry creation
 */
export type CreateEntryResult = {
  entry: Entry
  dashboardWorkspaceId?: string
  defaultWorkspaceId?: string
}

/**
 * Entry context change event
 */
export type EntryContextChangeEvent = {
  previousEntryId: string | null
  currentEntryId: string | null
  timestamp: number
}
