"use client"

/**
 * Dashboard Initializer Component
 * Part of Dashboard Implementation - Phase 3.1 Integration
 *
 * Handles:
 * - Cold start workspace selection (dashboard vs last visited)
 * - Keyboard shortcuts (Cmd+Shift+H to go Home)
 * - Initial dashboard loading when feature is enabled
 * - Rendering DashboardView when on dashboard workspace
 * - Navigating between different entry Dashboards
 * - Pinned Entries: Keeping entry dashboards mounted when switching entries
 */

import { useEffect, useRef, useState, useCallback, createContext, useContext } from "react"
import { isHomeDashboardEnabled } from "@/lib/flags/dashboard"
import { isPinnedEntriesFeatureEnabled, getPinnedEntriesMax, getPinnedWorkspacesPerEntryMax } from "@/lib/flags/pinned-entries"
import { debugLog } from "@/lib/utils/debug-logger"
import { setActiveWorkspaceContext } from "@/lib/note-workspaces/state"
import { setActiveEntryContext } from "@/lib/entry/entry-context"
import {
  initializeWithHome,
  pushNavigationEntry,
  updateCurrentWorkspace,
  updateViewMode,
} from "@/lib/navigation/navigation-context"
import {
  initializePinnedEntryManager,
  usePinnedEntriesState,
} from "@/lib/navigation"
import { DashboardView } from "./DashboardView"

// Context for navigation handler
interface DashboardNavigationContextType {
  onNavigate: (entryId: string, workspaceId: string) => void
  showDashboard: () => void
}

const DashboardNavigationContext = createContext<DashboardNavigationContextType | null>(null)

export function useDashboardNavigation() {
  return useContext(DashboardNavigationContext)
}

interface DashboardInfo {
  homeEntryId: string
  homeEntryName?: string
  dashboardWorkspaceId: string
  ideasInboxId: string | null
}

interface CurrentEntryInfo {
  entryId: string
  entryName: string
}

interface DashboardInitializerProps {
  /** Callback when a workspace should be activated */
  onWorkspaceActivate?: (workspaceId: string) => void
  /** Callback when navigating to a workspace from dashboard */
  onNavigateToWorkspace?: (entryId: string, workspaceId: string) => void
  /** Children to render (shown when NOT on dashboard) */
  children?: React.ReactNode
}

export function DashboardInitializer({
  onWorkspaceActivate,
  onNavigateToWorkspace,
  children,
}: DashboardInitializerProps) {
  const [dashboardEnabled] = useState(() => isHomeDashboardEnabled())
  const [pinnedEntriesEnabled] = useState(() => isPinnedEntriesFeatureEnabled())
  const [isLoading, setIsLoading] = useState(true)
  const [dashboardInfo, setDashboardInfo] = useState<DashboardInfo | null>(null)
  const [showDashboard, setShowDashboard] = useState(false)
  // Current dashboard workspace ID - can be different from Home's dashboard when viewing other entries
  const [currentDashboardWorkspaceId, setCurrentDashboardWorkspaceId] = useState<string | null>(null)
  // Current entry info (for breadcrumb display)
  const [currentEntryInfo, setCurrentEntryInfo] = useState<CurrentEntryInfo | null>(null)
  const fetchedRef = useRef(false)
  const pinnedManagerInitRef = useRef(false)

  // Pinned entries state (for keeping entry dashboards mounted when switching)
  const pinnedEntriesState = usePinnedEntriesState()

  // Phase 4: Parse URL params for initial view mode state restoration
  const [initialViewMode, setInitialViewMode] = useState<'dashboard' | 'workspace'>('dashboard')
  const [initialActiveWorkspaceId, setInitialActiveWorkspaceId] = useState<string | undefined>(undefined)

  // Phase 4: Parse URL params on mount
  useEffect(() => {
    if (typeof window === 'undefined') return

    const urlParams = new URLSearchParams(window.location.search)
    const viewParam = urlParams.get('view')
    const wsParam = urlParams.get('ws')

    if (viewParam === 'workspace' && wsParam) {
      void debugLog({
        component: "DashboardInitializer",
        action: "parse_url_params",
        metadata: { view: viewParam, ws: wsParam },
      })
      console.log("[DashboardInitializer] Parsed URL params - restoring workspace mode:", { view: viewParam, ws: wsParam })
      setInitialViewMode('workspace')
      setInitialActiveWorkspaceId(wsParam)
    }
  }, [])

  // Initialize PinnedEntryManager on mount
  useEffect(() => {
    if (pinnedManagerInitRef.current) return
    pinnedManagerInitRef.current = true

    initializePinnedEntryManager({
      enabled: pinnedEntriesEnabled,
      limits: {
        maxPinnedEntries: getPinnedEntriesMax(),
        maxWorkspacesPerEntry: getPinnedWorkspacesPerEntryMax(),
      },
    })

    void debugLog({
      component: "DashboardInitializer",
      action: "pinned_manager_initialized",
      metadata: {
        enabled: pinnedEntriesEnabled,
        maxPinnedEntries: getPinnedEntriesMax(),
        maxWorkspacesPerEntry: getPinnedWorkspacesPerEntryMax(),
      },
    })
  }, [pinnedEntriesEnabled])

  // Debug: log on mount
  useEffect(() => {
    console.log("[DashboardInitializer] Mount - dashboardEnabled:", dashboardEnabled, "pinnedEntriesEnabled:", pinnedEntriesEnabled)
  }, [dashboardEnabled, pinnedEntriesEnabled])

  // Fetch dashboard info
  useEffect(() => {
    if (!dashboardEnabled || fetchedRef.current) {
      setIsLoading(false)
      return
    }

    fetchedRef.current = true

    const fetchDashboardInfo = async () => {
      try {
        console.log("[DashboardInitializer] Fetching dashboard info...")
        const response = await fetch("/api/dashboard/info")

        if (!response.ok) {
          console.log("[DashboardInitializer] Dashboard info not found (404)")
          setIsLoading(false)
          return
        }

        const data = await response.json()
        console.log("[DashboardInitializer] Dashboard info:", data)
        setDashboardInfo(data)
        // Initialize current dashboard to Home's dashboard
        setCurrentDashboardWorkspaceId(data.dashboardWorkspaceId)
        // Initialize current entry to Home
        setCurrentEntryInfo({
          entryId: data.homeEntryId,
          entryName: data.homeEntryName || "Home",
        })

        // Set the active entry context so components can detect internal vs external links
        setActiveEntryContext(data.homeEntryId)

        // Always show dashboard on app start when feature is enabled
        // The "Continue" panel will show the last workspace for quick access
        // This gives users a "home base" to start from each session
        console.log("[DashboardInitializer] Dashboard enabled, showing dashboard on startup")
        setShowDashboard(true)

        // Initialize navigation stack with Home
        initializeWithHome({
          entryId: data.homeEntryId,
          entryName: data.homeEntryName || "Home",
          dashboardWorkspaceId: data.dashboardWorkspaceId,
          workspaceName: "Dashboard",
        })

        void debugLog({
          component: "DashboardInitializer",
          action: "init_complete",
          metadata: {
            dashboardWorkspaceId: data.dashboardWorkspaceId,
            showDashboard: true,
          },
        })
      } catch (err) {
        console.error("[DashboardInitializer] Error:", err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchDashboardInfo()
  }, [dashboardEnabled])

  // Handle navigation from dashboard to a workspace
  const handleDashboardNavigate = useCallback(async (entryId: string, workspaceId: string) => {
    console.log("[DashboardInitializer] Navigating to workspace:", workspaceId, "entryId:", entryId)

    // Check if the target workspace is a Dashboard workspace
    // If so, stay in dashboard mode but switch to that entry's Dashboard
    try {
      const response = await fetch(`/api/note-workspaces/${workspaceId}`)
      if (response.ok) {
        const data = await response.json()
        const workspaceName = data.workspace?.name

        void debugLog({
          component: "DashboardInitializer",
          action: "navigate_workspace_check",
          metadata: { workspaceId, workspaceName, entryId, isDashboard: workspaceName === "Dashboard" },
        })

        if (workspaceName === "Dashboard") {
          // Navigating to Dashboard workspace - ensure dashboard mode is shown
          console.log("[DashboardInitializer] Navigating to Dashboard workspace, showing dashboard mode")
          setCurrentDashboardWorkspaceId(workspaceId)
          setShowDashboard(true)  // Ensure dashboard view is shown (handles coming from Entry Workspace)

          // Update entry context and fetch entry name
          if (entryId) {
            setActiveEntryContext(entryId)
            // Fetch entry info for breadcrumb and navigation
            let entryName = "Entry"
            try {
              const entryResponse = await fetch(`/api/entries/${entryId}`)
              if (entryResponse.ok) {
                const entryData = await entryResponse.json()
                entryName = entryData.entry?.name || "Entry"
                setCurrentEntryInfo({
                  entryId,
                  entryName,
                })
              }
            } catch (err) {
              console.error("[DashboardInitializer] Failed to fetch entry info:", err)
              setCurrentEntryInfo({ entryId, entryName })
            }

            // Push to navigation stack
            pushNavigationEntry({
              entryId,
              entryName,
              dashboardWorkspaceId: workspaceId,
              workspaceName: "Dashboard",
            })
          }

          // Track the visit
          fetch("/api/dashboard/preferences", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lastWorkspaceId: workspaceId }),
          }).catch((err) => {
            console.error("[DashboardInitializer] Failed to track workspace visit:", err)
          })

          // Call optional callbacks but DON'T hide dashboard
          onNavigateToWorkspace?.(entryId, workspaceId)
          return
        }
      }
    } catch (err) {
      console.error("[DashboardInitializer] Error checking workspace:", err)
    }

    // Not a Dashboard workspace - hide dashboard and show regular app
    console.log("[DashboardInitializer] Navigating to regular workspace, hiding dashboard")

    // Get workspace name for navigation tracking
    let regularWorkspaceName = "Workspace"
    try {
      const wsResponse = await fetch(`/api/note-workspaces/${workspaceId}`)
      if (wsResponse.ok) {
        const wsData = await wsResponse.json()
        regularWorkspaceName = wsData.workspace?.name || "Workspace"
      }
    } catch {
      // Ignore error, use default name
    }

    void debugLog({
      component: "DashboardInitializer",
      action: "navigate_to_regular_workspace",
      metadata: {
        workspaceId,
        entryId,
        workspaceName: regularWorkspaceName,
        step: "before_setActiveWorkspaceContext",
      },
    })

    // Set the active workspace context - this triggers the app to load that workspace
    setActiveWorkspaceContext(workspaceId)

    // Update navigation stack with workspace info
    updateCurrentWorkspace(workspaceId, regularWorkspaceName)

    void debugLog({
      component: "DashboardInitializer",
      action: "navigate_to_regular_workspace",
      metadata: {
        workspaceId,
        entryId,
        step: "after_setActiveWorkspaceContext",
      },
    })

    // Update entry context
    if (entryId) {
      setActiveEntryContext(entryId)
    }

    // Track the visit in user preferences
    fetch("/api/dashboard/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastWorkspaceId: workspaceId }),
    }).catch((err) => {
      console.error("[DashboardInitializer] Failed to track workspace visit:", err)
    })

    void debugLog({
      component: "DashboardInitializer",
      action: "navigate_to_regular_workspace",
      metadata: {
        workspaceId,
        entryId,
        step: "before_setShowDashboard_false",
      },
    })

    // Hide dashboard and show the main app
    setShowDashboard(false)

    void debugLog({
      component: "DashboardInitializer",
      action: "navigate_to_regular_workspace",
      metadata: {
        workspaceId,
        entryId,
        step: "after_setShowDashboard_false",
      },
    })

    // Call optional callbacks
    onNavigateToWorkspace?.(entryId, workspaceId)
    onWorkspaceActivate?.(workspaceId)
  }, [onNavigateToWorkspace, onWorkspaceActivate])

  // Show dashboard for current entry (go back to dashboard from workspace)
  const handleShowDashboard = useCallback(() => {
    if (currentEntryInfo && currentDashboardWorkspaceId) {
      // Update navigation to show we're back on dashboard
      updateCurrentWorkspace(currentDashboardWorkspaceId, "Dashboard")
      setShowDashboard(true)

      void debugLog({
        component: "DashboardInitializer",
        action: "show_dashboard",
        metadata: {
          entryId: currentEntryInfo.entryId,
          dashboardWorkspaceId: currentDashboardWorkspaceId,
        },
      })
    }
  }, [currentEntryInfo, currentDashboardWorkspaceId])

  // Phase 4: Handle view mode changes from DashboardView (for navigation tracking and URL updates)
  const handleViewModeChange = useCallback((viewMode: 'dashboard' | 'workspace', activeWorkspaceId?: string) => {
    void debugLog({
      component: "DashboardInitializer",
      action: "view_mode_changed",
      metadata: {
        viewMode,
        activeWorkspaceId,
        entryId: currentEntryInfo?.entryId,
      },
    })
    console.log("[DashboardInitializer] View mode changed:", { viewMode, activeWorkspaceId })

    // Update navigation context
    updateViewMode(viewMode, activeWorkspaceId)

    // Update URL without page reload
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)

      if (viewMode === 'workspace' && activeWorkspaceId) {
        url.searchParams.set('view', 'workspace')
        url.searchParams.set('ws', activeWorkspaceId)
      } else {
        // Dashboard mode - remove view mode params
        url.searchParams.delete('view')
        url.searchParams.delete('ws')
      }

      // Use replaceState to update URL without adding to browser history
      window.history.replaceState({}, '', url.toString())

      void debugLog({
        component: "DashboardInitializer",
        action: "url_updated",
        metadata: {
          newUrl: url.toString(),
          viewMode,
          activeWorkspaceId,
        },
      })
    }
  }, [currentEntryInfo])

  // Navigation context value
  const navigationContextValue = {
    onNavigate: handleDashboardNavigate,
    showDashboard: handleShowDashboard,
  }

  // If dashboard is not enabled, just render children
  if (!dashboardEnabled) {
    console.log("[DashboardInitializer] Dashboard not enabled, rendering children")
    return <>{children}</>
  }

  // Show loading state while initializing
  if (isLoading) {
    return (
      <div
        className="w-screen h-screen flex items-center justify-center"
        style={{ background: '#0a0c10' }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border-2 animate-spin"
            style={{
              borderColor: 'rgba(255,255,255,0.1)',
              borderTopColor: '#6366f1',
            }}
          />
          <span style={{ color: '#8b8fa3', fontSize: 14 }}>Loading dashboard...</span>
        </div>
      </div>
    )
  }

  // If should show dashboard and we have a dashboard workspace ID, render DashboardView
  // Use currentDashboardWorkspaceId which can be updated when navigating to other entries
  if (showDashboard && currentDashboardWorkspaceId) {
    console.log("[DashboardInitializer] Rendering DashboardView with workspaceId:", currentDashboardWorkspaceId)

    // When pinned entries feature is enabled, render pinned entries' DashboardViews
    // alongside the active entry's DashboardView for state preservation
    if (pinnedEntriesEnabled && pinnedEntriesState.enabled) {
      const activeEntryId = currentEntryInfo?.entryId
      const pinnedEntries = pinnedEntriesState.entries
      const isActiveEntryPinned = pinnedEntries.some(e => e.entryId === activeEntryId)

      // FIX: Build unified render list to prevent unmount/remount when pin status changes.
      // By rendering all entries (pinned + active) through a single map with consistent keys,
      // React maintains component identity when pin status changes. This prevents:
      // 1. Dashboard panels from refreshing (no state reset)
      // 2. View mode from resetting to 'dashboard' when user was in workspace view
      type RenderEntry = {
        entryId: string
        entryName: string
        dashboardWorkspaceId: string
        pinnedWorkspaceIds: string[]
        isPinned: boolean
      }

      const entriesToRender: RenderEntry[] = []

      // Add all pinned entries first
      for (const pinnedEntry of pinnedEntries) {
        entriesToRender.push({
          entryId: pinnedEntry.entryId,
          entryName: pinnedEntry.entryName,
          dashboardWorkspaceId: pinnedEntry.dashboardWorkspaceId,
          pinnedWorkspaceIds: pinnedEntry.pinnedWorkspaceIds,
          isPinned: true,
        })
      }

      // Add active entry if not already in the list (unpinned active entry)
      // This ensures the active entry is always rendered through the same map,
      // preventing remount when transitioning between pinned and unpinned states
      if (!isActiveEntryPinned && activeEntryId && currentDashboardWorkspaceId) {
        entriesToRender.push({
          entryId: activeEntryId,
          entryName: currentEntryInfo?.entryName ?? '',
          dashboardWorkspaceId: currentDashboardWorkspaceId,
          pinnedWorkspaceIds: [], // Unpinned entries don't preserve workspace state
          isPinned: false,
        })
      }

      void debugLog({
        component: "DashboardInitializer",
        action: "render_unified_list",
        metadata: {
          activeEntryId,
          pinnedCount: pinnedEntries.length,
          entriesToRenderCount: entriesToRender.length,
          isActiveEntryPinned,
          renderIds: entriesToRender.map(e => e.entryId),
        },
      })

      return (
        <div className="relative w-screen h-screen">
          {/* Unified render list: all entries rendered through single map with consistent keys */}
          {/* This prevents unmount/remount when pin status changes for the active entry */}
          {entriesToRender.map((entry, index) => {
            const isActive = entry.entryId === activeEntryId

            void debugLog({
              component: "DashboardInitializer",
              action: "rendering_entry",
              metadata: {
                index,
                entryId: entry.entryId,
                entryName: entry.entryName,
                dashboardWorkspaceId: entry.dashboardWorkspaceId,
                isActive,
                isPinned: entry.isPinned,
                pinnedWorkspaceIds: entry.pinnedWorkspaceIds,
              },
            })

            return (
              <div
                key={`entry-${entry.entryId}`}
                className="absolute inset-0"
                style={{
                  visibility: isActive ? 'visible' : 'hidden',
                  pointerEvents: isActive ? 'auto' : 'none',
                  zIndex: isActive ? 10 : 0,
                }}
                aria-hidden={!isActive}
              >
                <DashboardView
                  workspaceId={entry.dashboardWorkspaceId}
                  onNavigate={handleDashboardNavigate}
                  entryId={entry.entryId}
                  entryName={entry.entryName}
                  homeEntryId={dashboardInfo?.homeEntryId}
                  className="w-full h-full"
                  onViewModeChange={handleViewModeChange}
                  // Only restore URL view mode for the initially active entry
                  initialViewMode={isActive ? initialViewMode : 'dashboard'}
                  initialActiveWorkspaceId={isActive ? initialActiveWorkspaceId : undefined}
                  // Pass pinned workspace IDs for state preservation filtering
                  pinnedWorkspaceIds={entry.pinnedWorkspaceIds}
                  // Pass entry active state for workspace filtering
                  // When entry is hidden, only pinned workspaces should stay mounted
                  isEntryActive={isActive}
                />
              </div>
            )
          })}
        </div>
      )
    }

    // Standard rendering without pinned entries feature
    return (
      <DashboardView
        key={currentEntryInfo?.entryId}  // Force remount on entry change to reset viewMode state
        workspaceId={currentDashboardWorkspaceId}
        onNavigate={handleDashboardNavigate}
        entryId={currentEntryInfo?.entryId}
        entryName={currentEntryInfo?.entryName}
        homeEntryId={dashboardInfo?.homeEntryId}
        className="w-screen h-screen"
        onViewModeChange={handleViewModeChange}
        initialViewMode={initialViewMode}
        initialActiveWorkspaceId={initialActiveWorkspaceId}
      />
    )
  }

  // Otherwise render children (the regular app) with navigation context
  console.log("[DashboardInitializer] Rendering children (regular app)")
  return (
    <DashboardNavigationContext.Provider value={navigationContextValue}>
      {children}
    </DashboardNavigationContext.Provider>
  )
}

/**
 * Hook to check if dashboard should be shown
 * Simplified version that just checks the feature flag
 */
export function useShouldShowDashboard(): {
  shouldShow: boolean
  dashboardWorkspaceId: string | null
  isLoading: boolean
} {
  const [dashboardEnabled] = useState(() => isHomeDashboardEnabled())
  const [dashboardWorkspaceId, setDashboardWorkspaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!dashboardEnabled) {
      setIsLoading(false)
      return
    }

    fetch("/api/dashboard/info")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setDashboardWorkspaceId(data?.dashboardWorkspaceId ?? null)
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [dashboardEnabled])

  return {
    shouldShow: dashboardEnabled && dashboardWorkspaceId != null,
    dashboardWorkspaceId,
    isLoading,
  }
}
