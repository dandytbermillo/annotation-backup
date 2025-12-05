/**
 * Navigation Context
 * Tracks the navigation history through entries for breadcrumb display
 */

import { debugLog } from "@/lib/utils/debug-logger"

export interface NavigationEntry {
  entryId: string
  entryName: string
  dashboardWorkspaceId: string
  /** Current workspace within the entry (if not on dashboard) */
  workspaceId?: string
  workspaceName?: string
  timestamp: number
  /** View mode within the entry (dashboard or embedded workspace) - defaults to 'dashboard' */
  viewMode?: 'dashboard' | 'workspace'
  /** Active workspace ID when viewMode === 'workspace' (for embedded workspace mode) */
  activeWorkspaceId?: string
}

// Navigation stack - bottom of array is most recent (current)
let navigationStack: NavigationEntry[] = []

// Listeners for navigation changes
const navigationListeners = new Set<(stack: NavigationEntry[]) => void>()

/**
 * Get the current navigation stack
 */
export function getNavigationStack(): NavigationEntry[] {
  return [...navigationStack]
}

/**
 * Get the current entry (bottom of stack)
 */
export function getCurrentNavigationEntry(): NavigationEntry | null {
  return navigationStack.length > 0
    ? navigationStack[navigationStack.length - 1]
    : null
}

/**
 * Push a new entry to the navigation stack
 * If the entry already exists in the stack, trim the stack to that point
 */
export function pushNavigationEntry(entry: Omit<NavigationEntry, 'timestamp'>) {
  // Check if this entry already exists in the stack
  const existingIndex = navigationStack.findIndex(e => e.entryId === entry.entryId)

  if (existingIndex !== -1) {
    // Entry exists - trim stack to that point and update it
    navigationStack = navigationStack.slice(0, existingIndex)
  }

  // Push the new entry
  const newEntry: NavigationEntry = {
    ...entry,
    timestamp: Date.now(),
  }
  navigationStack.push(newEntry)

  void debugLog({
    component: "NavigationContext",
    action: "push_entry",
    metadata: {
      entryId: entry.entryId,
      entryName: entry.entryName,
      stackLength: navigationStack.length,
      trimmedFrom: existingIndex !== -1 ? existingIndex : null,
    },
  })

  notifyListeners()
}

/**
 * Update the current entry's workspace (when switching workspaces within an entry)
 */
export function updateCurrentWorkspace(workspaceId: string, workspaceName: string) {
  if (navigationStack.length === 0) return

  const current = navigationStack[navigationStack.length - 1]
  current.workspaceId = workspaceId
  current.workspaceName = workspaceName
  current.timestamp = Date.now()

  void debugLog({
    component: "NavigationContext",
    action: "update_workspace",
    metadata: {
      entryId: current.entryId,
      workspaceId,
      workspaceName,
    },
  })

  notifyListeners()
}

/**
 * Update the current entry's view mode (dashboard ↔ embedded workspace)
 * Used for Phase 3 layered dashboard/workspace switching
 */
export function updateViewMode(
  viewMode: 'dashboard' | 'workspace',
  activeWorkspaceId?: string
) {
  if (navigationStack.length === 0) return

  const current = navigationStack[navigationStack.length - 1]
  current.viewMode = viewMode
  current.activeWorkspaceId = viewMode === 'workspace' ? activeWorkspaceId : undefined
  current.timestamp = Date.now()

  void debugLog({
    component: "NavigationContext",
    action: "update_view_mode",
    metadata: {
      entryId: current.entryId,
      viewMode,
      activeWorkspaceId,
    },
  })

  notifyListeners()
}

/**
 * Get the current view mode for the active entry
 * Returns null if no navigation entry exists
 */
export function getCurrentViewMode(): {
  viewMode: 'dashboard' | 'workspace'
  activeWorkspaceId?: string
} | null {
  const current = getCurrentNavigationEntry()
  if (!current) return null

  return {
    viewMode: current.viewMode ?? 'dashboard',
    activeWorkspaceId: current.activeWorkspaceId,
  }
}

/**
 * Navigate to an entry in the stack (by index)
 * This trims the stack to that point
 */
export function navigateToStackEntry(index: number): NavigationEntry | null {
  if (index < 0 || index >= navigationStack.length) return null

  const targetEntry = navigationStack[index]

  // Trim stack to this point (inclusive)
  navigationStack = navigationStack.slice(0, index + 1)

  void debugLog({
    component: "NavigationContext",
    action: "navigate_to_stack_entry",
    metadata: {
      index,
      entryId: targetEntry.entryId,
      newStackLength: navigationStack.length,
    },
  })

  notifyListeners()
  return targetEntry
}

/**
 * Clear the navigation stack
 */
export function clearNavigationStack() {
  navigationStack = []
  notifyListeners()
}

/**
 * Initialize the stack with Home entry
 */
export function initializeWithHome(homeEntry: Omit<NavigationEntry, 'timestamp'>) {
  if (navigationStack.length === 0) {
    navigationStack = [{
      ...homeEntry,
      timestamp: Date.now(),
    }]

    void debugLog({
      component: "NavigationContext",
      action: "initialize_with_home",
      metadata: {
        entryId: homeEntry.entryId,
        entryName: homeEntry.entryName,
      },
    })

    notifyListeners()
  }
}

/**
 * Subscribe to navigation changes
 */
export function subscribeToNavigation(listener: (stack: NavigationEntry[]) => void) {
  navigationListeners.add(listener)
  return () => {
    navigationListeners.delete(listener)
  }
}

function notifyListeners() {
  const stack = getNavigationStack()
  navigationListeners.forEach(listener => {
    try {
      listener(stack)
    } catch {
      // Ignore listener errors
    }
  })
}
