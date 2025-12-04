/**
 * Entry Module
 *
 * Exports for the entry/workspace hierarchy system.
 */

// Types
export type {
  Entry,
  EntrySummary,
  EntryWorkspaceSummary,
  CreateEntryOptions,
  CreateEntryResult,
  EntryContextChangeEvent,
} from './entry-types'

// Context state management
export {
  setActiveEntryContext,
  getActiveEntryContext,
  subscribeToActiveEntryContext,
  subscribeToEntryContextChange,
  clearEntryContext,
} from './entry-context'

// Service functions
export {
  fetchWorkspacesForEntry,
  searchWorkspaces,
  createEntry,
  createEntryForWorkspace,
  seedEntryDashboard,
  getEntry,
  resolveEntryFromWorkspace,
  createWorkspaceForEntry,
} from './entry-service'
