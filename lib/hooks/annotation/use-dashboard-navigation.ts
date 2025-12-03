"use client"

/**
 * Dashboard Navigation Hook
 * Part of Dashboard Implementation - Phase 3.1
 *
 * Handles navigation between dashboard and workspaces:
 * - Cold start workspace selection (last visited or Home/Dashboard)
 * - Keyboard shortcuts (Cmd+Shift+H to go Home)
 * - Tracking last visited workspace
 * - Navigation to specific workspaces
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  setActiveWorkspaceContext,
  getActiveWorkspaceContext,
  subscribeToActiveWorkspaceContext,
} from "@/lib/note-workspaces/state"
import { debugLog } from "@/lib/utils/debug-logger"

export interface DashboardInfo {
  homeEntryId: string
  dashboardWorkspaceId: string
  ideasInboxId: string | null
}

export interface LastWorkspaceInfo {
  id: string
  name: string
  entryId: string | null
  entryName: string | null
}

export interface UseDashboardNavigationOptions {
  /** User ID for fetching preferences */
  userId?: string
  /** Whether the hook is enabled */
  enabled?: boolean
  /** Callback when workspace changes */
  onWorkspaceChange?: (workspaceId: string | null) => void
  /** Callback when navigation to Home occurs */
  onNavigateHome?: (dashboardWorkspaceId: string) => void
}

export interface UseDashboardNavigationResult {
  /** Whether initial loading is complete */
  isReady: boolean
  /** Whether currently loading */
  isLoading: boolean
  /** Error if any */
  error: string | null
  /** Dashboard info (home entry, dashboard workspace, ideas inbox) */
  dashboardInfo: DashboardInfo | null
  /** Last visited workspace info */
  lastWorkspace: LastWorkspaceInfo | null
  /** Current active workspace ID */
  currentWorkspaceId: string | null
  /** Whether currently on the dashboard */
  isOnDashboard: boolean
  /** Navigate to Home/Dashboard */
  navigateToHome: () => void
  /** Navigate to a specific workspace */
  navigateToWorkspace: (workspaceId: string) => void
  /** Track a workspace visit (updates last_workspace_id) */
  trackWorkspaceVisit: (workspaceId: string) => void
  /** Refresh dashboard info */
  refresh: () => Promise<void>
}

/**
 * Check if the current focus is in an input element
 * Used to guard keyboard shortcuts
 */
function isInputFocused(): boolean {
  if (typeof document === "undefined") return false

  const activeElement = document.activeElement
  if (!activeElement) return false

  const tagName = activeElement.tagName.toLowerCase()
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true
  }

  // Check for contenteditable elements (like TipTap editors)
  if (activeElement.getAttribute("contenteditable") === "true") {
    return true
  }

  // Check for elements with role="textbox"
  if (activeElement.getAttribute("role") === "textbox") {
    return true
  }

  return false
}

export function useDashboardNavigation(
  options: UseDashboardNavigationOptions = {}
): UseDashboardNavigationResult {
  const { enabled = true, onWorkspaceChange, onNavigateHome } = options

  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dashboardInfo, setDashboardInfo] = useState<DashboardInfo | null>(null)
  const [lastWorkspace, setLastWorkspace] = useState<LastWorkspaceInfo | null>(null)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(
    getActiveWorkspaceContext()
  )

  const initializedRef = useRef(false)
  const trackingInFlightRef = useRef(false)

  // Subscribe to workspace context changes
  useEffect(() => {
    const unsubscribe = subscribeToActiveWorkspaceContext((workspaceId) => {
      setCurrentWorkspaceId(workspaceId)
      onWorkspaceChange?.(workspaceId)
    })

    return unsubscribe
  }, [onWorkspaceChange])

  // Fetch dashboard info and preferences
  const fetchDashboardInfo = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Fetch dashboard info (home entry, dashboard workspace)
      const dashboardResponse = await fetch("/api/dashboard/info")
      if (!dashboardResponse.ok) {
        if (dashboardResponse.status === 404) {
          // Dashboard not set up yet - this is OK for first run
          void debugLog({
            component: "DashboardNavigation",
            action: "dashboard_info_not_found",
            metadata: { status: 404 },
          })
          setDashboardInfo(null)
          setIsReady(true)
          return
        }
        throw new Error("Failed to fetch dashboard info")
      }

      const dashboardData = await dashboardResponse.json()
      setDashboardInfo(dashboardData)

      // Fetch user preferences for last workspace
      const prefsResponse = await fetch("/api/dashboard/preferences")
      if (prefsResponse.ok) {
        const prefsData = await prefsResponse.json()
        if (prefsData.lastWorkspace) {
          setLastWorkspace(prefsData.lastWorkspace)
        }
      }

      setIsReady(true)
    } catch (err) {
      console.error("[useDashboardNavigation] Failed to fetch dashboard info:", err)
      setError(err instanceof Error ? err.message : "Failed to load dashboard")
      setIsReady(true) // Still mark as ready so app can proceed
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial fetch and cold start handling
  useEffect(() => {
    if (!enabled || initializedRef.current) return
    initializedRef.current = true

    const initialize = async () => {
      await fetchDashboardInfo()

      // Cold start: determine which workspace to load
      const currentActive = getActiveWorkspaceContext()
      if (currentActive) {
        // Already have an active workspace, don't override
        void debugLog({
          component: "DashboardNavigation",
          action: "cold_start_already_active",
          metadata: { currentActive },
        })
        return
      }

      // Check preferences for last workspace
      try {
        const prefsResponse = await fetch("/api/dashboard/preferences")
        if (prefsResponse.ok) {
          const prefsData = await prefsResponse.json()

          if (prefsData.lastWorkspaceId) {
            // Resume last workspace
            void debugLog({
              component: "DashboardNavigation",
              action: "cold_start_resuming_last",
              metadata: { lastWorkspaceId: prefsData.lastWorkspaceId },
            })
            setActiveWorkspaceContext(prefsData.lastWorkspaceId)
            return
          }
        }

        // Fall back to dashboard workspace
        const dashboardResponse = await fetch("/api/dashboard/info")
        if (dashboardResponse.ok) {
          const dashboardData = await dashboardResponse.json()
          if (dashboardData.dashboardWorkspaceId) {
            void debugLog({
              component: "DashboardNavigation",
              action: "cold_start_loading_dashboard",
              metadata: { dashboardWorkspaceId: dashboardData.dashboardWorkspaceId },
            })
            setActiveWorkspaceContext(dashboardData.dashboardWorkspaceId)
          }
        }
      } catch (err) {
        console.error("[useDashboardNavigation] Cold start initialization failed:", err)
      }
    }

    initialize()
  }, [enabled, fetchDashboardInfo])

  // Navigate to Home/Dashboard
  const navigateToHome = useCallback(() => {
    if (!dashboardInfo?.dashboardWorkspaceId) {
      console.warn("[useDashboardNavigation] Cannot navigate to Home: dashboard not initialized")
      return
    }

    void debugLog({
      component: "DashboardNavigation",
      action: "navigating_to_home",
      metadata: { dashboardWorkspaceId: dashboardInfo.dashboardWorkspaceId },
    })

    setActiveWorkspaceContext(dashboardInfo.dashboardWorkspaceId)
    onNavigateHome?.(dashboardInfo.dashboardWorkspaceId)
  }, [dashboardInfo, onNavigateHome])

  // Navigate to a specific workspace
  const navigateToWorkspace = useCallback((workspaceId: string) => {
    void debugLog({
      component: "DashboardNavigation",
      action: "navigating_to_workspace",
      metadata: { workspaceId },
    })

    setActiveWorkspaceContext(workspaceId)
  }, [])

  // Track a workspace visit (update last_workspace_id)
  const trackWorkspaceVisit = useCallback(async (workspaceId: string) => {
    // Don't track dashboard visits
    if (workspaceId === dashboardInfo?.dashboardWorkspaceId) {
      return
    }

    // Prevent concurrent tracking
    if (trackingInFlightRef.current) return
    trackingInFlightRef.current = true

    try {
      const response = await fetch("/api/dashboard/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastWorkspaceId: workspaceId }),
      })

      if (response.ok) {
        void debugLog({
          component: "DashboardNavigation",
          action: "tracked_workspace_visit",
          metadata: { workspaceId },
        })
      }
    } catch (err) {
      console.error("[useDashboardNavigation] Failed to track workspace visit:", err)
    } finally {
      trackingInFlightRef.current = false
    }
  }, [dashboardInfo])

  // Keyboard shortcut: Cmd+Shift+H to go Home
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+H (Mac) or Ctrl+Shift+H (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "h") {
        // Don't fire in input elements
        if (isInputFocused()) return

        e.preventDefault()
        e.stopPropagation()

        void debugLog({
          component: "DashboardNavigation",
          action: "keyboard_shortcut_home",
          metadata: { key: "Cmd+Shift+H" },
        })

        navigateToHome()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [enabled, navigateToHome])

  // Check if currently on dashboard
  const isOnDashboard = Boolean(
    dashboardInfo?.dashboardWorkspaceId &&
    currentWorkspaceId === dashboardInfo.dashboardWorkspaceId
  )

  return {
    isReady,
    isLoading,
    error,
    dashboardInfo,
    lastWorkspace,
    currentWorkspaceId,
    isOnDashboard,
    navigateToHome,
    navigateToWorkspace,
    trackWorkspaceVisit,
    refresh: fetchDashboardInfo,
  }
}
