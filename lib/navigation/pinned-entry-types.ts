/**
 * Pinned Entry Types
 * Part of State Preservation Feature - Phase 1
 *
 * Types and interfaces for the pinned entries feature that allows
 * users to keep entry dashboards and workspaces mounted when switching
 * between entries.
 */

/**
 * Represents a pinned entry with its pinned workspaces
 */
export interface PinnedEntry {
  /** The entry ID */
  entryId: string
  /** The dashboard workspace ID for this entry */
  dashboardWorkspaceId: string
  /** Display name of the entry */
  entryName: string
  /** Entry icon (emoji or null) */
  entryIcon?: string | null
  /**
   * Workspace IDs to keep mounted within this entry.
   * Always includes dashboardWorkspaceId when entry is pinned.
   * User can add additional workspaces to persist.
   */
  pinnedWorkspaceIds: string[]
  /** Timestamp when the entry was pinned */
  pinnedAt: number
  /** Last time this pinned entry was accessed */
  lastAccessedAt: number
}

/**
 * Configuration for pinned entry limits
 */
export interface PinnedEntryLimits {
  /** Maximum number of entries that can be pinned (default: 3) */
  maxPinnedEntries: number
  /** Maximum workspaces per pinned entry (default: 2) */
  maxWorkspacesPerEntry: number
}

/**
 * State of all pinned entries
 */
export interface PinnedEntriesState {
  /** List of pinned entries */
  entries: PinnedEntry[]
  /** Current limits configuration */
  limits: PinnedEntryLimits
  /** Feature enabled flag */
  enabled: boolean
}

/**
 * Event fired when pinned entries change
 */
export interface PinnedEntriesChangeEvent {
  /** Type of change */
  type: 'pin_entry' | 'unpin_entry' | 'pin_workspace' | 'unpin_workspace' | 'limit_exceeded' | 'restore'
  /** Entry ID affected */
  entryId: string
  /** Workspace ID affected (for workspace-level changes) */
  workspaceId?: string
  /** Previous state */
  previousState: PinnedEntry[]
  /** New state */
  newState: PinnedEntry[]
  /** Timestamp of change */
  timestamp: number
}

/**
 * Options for pinning an entry
 */
export interface PinEntryOptions {
  entryId: string
  dashboardWorkspaceId: string
  entryName: string
  entryIcon?: string | null
  /** Initial workspaces to pin (defaults to just dashboard) */
  initialWorkspaceIds?: string[]
}

/**
 * Options for pinning a workspace within an entry
 */
export interface PinWorkspaceOptions {
  entryId: string
  workspaceId: string
}

/**
 * Result of a pin/unpin operation
 */
export interface PinOperationResult {
  success: boolean
  /** Error message if operation failed */
  error?: string
  /** Entry that was auto-unpinned if limit was exceeded */
  autoUnpinnedEntry?: PinnedEntry
  /** Workspace that was auto-unpinned if limit was exceeded */
  autoUnpinnedWorkspace?: { entryId: string; workspaceId: string }
}

/**
 * localStorage key for persisting pinned entries
 */
export const PINNED_ENTRIES_STORAGE_KEY = 'annotation_pinned_entries'

/**
 * Default limits for pinned entries
 */
export const DEFAULT_PINNED_LIMITS: PinnedEntryLimits = {
  maxPinnedEntries: 3,
  maxWorkspacesPerEntry: 2,
}
