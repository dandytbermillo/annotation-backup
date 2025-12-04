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
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { isHomeDashboardEnabled } from "@/lib/flags/dashboard"
import { debugLog } from "@/lib/utils/debug-logger"
import { setActiveWorkspaceContext } from "@/lib/note-workspaces/state"
import { DashboardView } from "./DashboardView"

interface DashboardInfo {
  homeEntryId: string
  dashboardWorkspaceId: string
  ideasInboxId: string | null
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
  const [isLoading, setIsLoading] = useState(true)
  const [dashboardInfo, setDashboardInfo] = useState<DashboardInfo | null>(null)
  const [showDashboard, setShowDashboard] = useState(false)
  const fetchedRef = useRef(false)

  // Debug: log on mount
  useEffect(() => {
    console.log("[DashboardInitializer] Mount - dashboardEnabled:", dashboardEnabled)
  }, [dashboardEnabled])

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

        // Always show dashboard on app start when feature is enabled
        // The "Continue" panel will show the last workspace for quick access
        // This gives users a "home base" to start from each session
        console.log("[DashboardInitializer] Dashboard enabled, showing dashboard on startup")
        setShowDashboard(true)

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
  const handleDashboardNavigate = useCallback((entryId: string, workspaceId: string) => {
    console.log("[DashboardInitializer] Navigating to workspace:", workspaceId)

    // Set the active workspace context - this triggers the app to load that workspace
    setActiveWorkspaceContext(workspaceId)

    // Track the visit in user preferences
    fetch("/api/dashboard/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastWorkspaceId: workspaceId }),
    }).catch((err) => {
      console.error("[DashboardInitializer] Failed to track workspace visit:", err)
    })

    // Hide dashboard and show the main app
    setShowDashboard(false)

    // Call optional callbacks
    onNavigateToWorkspace?.(entryId, workspaceId)
    onWorkspaceActivate?.(workspaceId)
  }, [onNavigateToWorkspace, onWorkspaceActivate])

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

  // If should show dashboard and we have info, render DashboardView
  if (showDashboard && dashboardInfo?.dashboardWorkspaceId) {
    console.log("[DashboardInitializer] Rendering DashboardView")
    return (
      <DashboardView
        workspaceId={dashboardInfo.dashboardWorkspaceId}
        onNavigate={handleDashboardNavigate}
        className="w-screen h-screen"
      />
    )
  }

  // Otherwise render children (the regular app)
  console.log("[DashboardInitializer] Rendering children (regular app)")
  return <>{children}</>
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
