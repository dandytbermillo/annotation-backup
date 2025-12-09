/**
 * Navigation Module
 *
 * Exports for navigation context, pinned entries, and related functionality.
 */

// Navigation context
export {
  type NavigationEntry,
  getNavigationStack,
  getCurrentNavigationEntry,
  pushNavigationEntry,
  updateCurrentWorkspace,
  updateViewMode,
  getCurrentViewMode,
  navigateToStackEntry,
  clearNavigationStack,
  initializeWithHome,
  subscribeToNavigation,
} from './navigation-context'

// Pinned entry types
export {
  type PinnedEntry,
  type PinnedEntriesState,
  type PinnedEntriesChangeEvent,
  type PinEntryOptions,
  type PinWorkspaceOptions,
  type PinOperationResult,
  type PinnedEntryLimits,
  PINNED_ENTRIES_STORAGE_KEY,
  DEFAULT_PINNED_LIMITS,
} from './pinned-entry-types'

// Pinned entry manager
export {
  initializePinnedEntryManager,
  isPinnedEntriesEnabled,
  setPinnedEntriesEnabled,
  getPinnedEntries,
  getPinnedEntriesState,
  isEntryPinned,
  isWorkspacePinned,
  getPinnedEntry,
  getPinnedWorkspaceIds,
  getPinnedEntryLimits,
  pinEntry,
  unpinEntry,
  pinWorkspace,
  unpinWorkspace,
  updateEntryAccessTime,
  updatePinnedEntryLimits,
  clearAllPinnedEntries,
  subscribeToPinnedEntries,
  subscribeToPinnedEntriesChanges,
  handleEntryDeleted,
  handleWorkspaceDeleted,
} from './pinned-entry-manager'

// React hooks for pinned entries
export {
  usePinnedEntriesState,
  useIsEntryPinned,
  useIsWorkspacePinned,
  usePinnedEntry,
  usePinnedWorkspaceIds,
  usePinnedEntriesChanges,
  useEntryPinActions,
  useWorkspacePinActions,
  usePinnedEntries,
  useIsPinnedEntriesEnabled,
} from './use-pinned-entries'

// Toast notifications for pinned entries
export {
  showEntryPinnedToast,
  showEntryUnpinnedToast,
  showWorkspacePinnedToast,
  showWorkspaceUnpinnedToast,
  showAutoUnpinnedEntryToast,
  showAutoUnpinnedWorkspaceToast,
  showPinErrorToast,
  showFeatureDisabledToast,
} from './pinned-entries-toast'
