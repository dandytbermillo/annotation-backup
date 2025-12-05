"use client"

/**
 * Dashboard View Component
 * Part of Dashboard Implementation - Phase 3 Integration
 *
 * Renders the dashboard workspace with its panels.
 * This is shown when the user is on the dashboard workspace.
 */

import React, { useEffect, useState, useCallback, useRef } from "react"
import { DashboardPanelRenderer } from "./DashboardPanelRenderer"
import { DashboardWelcomeTooltip, useDashboardWelcome } from "./DashboardWelcomeTooltip"
import { AddPanelButton } from "./PanelCatalog"
import { WorkspaceToggleMenu } from "@/components/workspace/workspace-toggle-menu"
import { AnnotationAppShell } from "@/components/annotation-app-shell"
import { setActiveWorkspaceContext } from "@/lib/note-workspaces/state"
import type { WorkspacePanel, PanelConfig } from "@/lib/dashboard/panel-registry"
import { cn } from "@/lib/utils"
import { debugLog } from "@/lib/utils/debug-logger"
import { RefreshCw, ChevronRight, Home, LayoutDashboard } from "lucide-react"

interface WorkspaceSummary {
  id: string
  name: string
  isDefault: boolean
  noteCount?: number
  updatedAt?: string | null
}

/** View mode for the unified dashboard/workspace view */
type ViewMode = 'dashboard' | 'workspace'

interface DashboardViewProps {
  workspaceId: string
  onNavigate?: (entryId: string, workspaceId: string) => void
  entryId?: string
  entryName?: string
  homeEntryId?: string
  className?: string
}

export function DashboardView({
  workspaceId,
  onNavigate,
  entryId,
  entryName = "Home",
  homeEntryId,
  className
}: DashboardViewProps) {
  const [panels, setPanels] = useState<WorkspacePanel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { hasSeenWelcome, markAsSeen } = useDashboardWelcome()
  const showWelcome = !hasSeenWelcome

  // View mode state (Phase 2)
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard')
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  // Phase 3: Lazy mounting - only mount workspace canvas after first visit
  const [hasVisitedWorkspace, setHasVisitedWorkspace] = useState(false)

  // Workspaces for dropdown
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [isWorkspacesLoading, setIsWorkspacesLoading] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null)

  // Drag state
  const [draggingPanelId, setDraggingPanelId] = useState<string | null>(null)
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const dragStartRef = useRef<{ x: number; y: number; panelX: number; panelY: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  // Is current entry the Home entry?
  const isHomeEntry = !entryId || entryId === homeEntryId

  // Fetch panels from API
  const fetchPanels = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/dashboard/panels?workspaceId=${workspaceId}`)
      if (!response.ok) {
        throw new Error("Failed to fetch panels")
      }

      const data = await response.json()
      setPanels(Array.isArray(data) ? data : data.panels || [])

      void debugLog({
        component: "DashboardView",
        action: "panels_loaded",
        metadata: { workspaceId, panelCount: (Array.isArray(data) ? data : data.panels || []).length },
      })
    } catch (err) {
      console.error("[DashboardView] Failed to fetch panels:", err)
      setError("Failed to load dashboard panels")
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchPanels()
  }, [fetchPanels])

  // Fetch workspaces for the current entry (excluding Dashboard)
  useEffect(() => {
    if (!entryId) return

    const fetchWorkspaces = async () => {
      try {
        setIsWorkspacesLoading(true)
        const response = await fetch(`/api/entries/${entryId}/workspaces`)
        if (response.ok) {
          const data = await response.json()
          // Filter out Dashboard workspace from dropdown
          const nonDashboardWorkspaces = (data.workspaces || []).filter(
            (ws: WorkspaceSummary & { name: string }) => ws.name !== "Dashboard"
          )
          setWorkspaces(nonDashboardWorkspaces)
        }
      } catch (err) {
        console.error("[DashboardView] Failed to fetch workspaces:", err)
      } finally {
        setIsWorkspacesLoading(false)
      }
    }

    fetchWorkspaces()
  }, [entryId])

  // Ref for outside click handling
  const workspaceMenuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    if (!workspaceMenuOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setWorkspaceMenuOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [workspaceMenuOpen])

  // Handle workspace selection from dropdown (receives just workspaceId)
  // Phase 2: Sets viewMode to 'workspace' instead of navigating away
  // Phase 3: Also sets active workspace context so AnnotationAppShell loads the correct workspace
  const handleWorkspaceSelectById = useCallback((selectedWorkspaceId: string) => {
    const ws = workspaces.find(w => w.id === selectedWorkspaceId)
    void debugLog({
      component: "DashboardView",
      action: "dropdown_workspace_selected",
      metadata: {
        selectedWorkspaceId,
        selectedWorkspaceName: ws?.name,
        selectedIsDefault: ws?.isDefault,
        currentEntryId: entryId,
        viewMode: 'workspace',
        allWorkspacesInDropdown: workspaces.map(w => ({ id: w.id, name: w.name, isDefault: w.isDefault })),
      },
    })
    console.log("[DashboardView] Workspace selected - switching to workspace mode:", { selectedWorkspaceId, ws, entryId })

    setWorkspaceMenuOpen(false)
    setActiveWorkspaceId(selectedWorkspaceId)
    setViewMode('workspace')
    // Phase 3: Mark that workspace has been visited for lazy mounting
    setHasVisitedWorkspace(true)
    // Phase 3: Set active workspace context so AnnotationAppShell loads the selected workspace
    // This triggers the subscription in AnnotationAppContent which calls noteWorkspaceState.selectWorkspace()
    setActiveWorkspaceContext(selectedWorkspaceId)
  }, [entryId, workspaces])

  // Handle navigating to Home
  const handleGoHome = useCallback(() => {
    if (homeEntryId && onNavigate) {
      // Navigate to Home's Dashboard - need to fetch it first
      fetch("/api/dashboard/info")
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.dashboardWorkspaceId) {
            onNavigate(data.homeEntryId, data.dashboardWorkspaceId)
          }
        })
        .catch(err => console.error("[DashboardView] Failed to navigate home:", err))
    }
  }, [homeEntryId, onNavigate])

  // Handle returning to dashboard mode (Phase 2)
  const handleReturnToDashboard = useCallback(() => {
    void debugLog({
      component: "DashboardView",
      action: "return_to_dashboard",
      metadata: {
        previousWorkspaceId: activeWorkspaceId,
        entryId,
      },
    })
    console.log("[DashboardView] Returning to dashboard mode from workspace:", activeWorkspaceId)

    setViewMode('dashboard')
    // Note: We keep activeWorkspaceId so user can quickly return to the same workspace
  }, [activeWorkspaceId, entryId])

  // Refetch workspaces helper
  const refetchWorkspaces = useCallback(async () => {
    if (!entryId) return
    try {
      const response = await fetch(`/api/entries/${entryId}/workspaces`)
      if (response.ok) {
        const data = await response.json()
        const nonDashboardWorkspaces = (data.workspaces || []).filter(
          (ws: WorkspaceSummary & { name: string }) => ws.name !== "Dashboard"
        )
        setWorkspaces(nonDashboardWorkspaces)
      }
    } catch (err) {
      console.error("[DashboardView] Failed to refetch workspaces:", err)
    }
  }, [entryId])

  // Handle create workspace
  const handleCreateWorkspace = useCallback(async () => {
    if (!entryId) return

    try {
      const response = await fetch("/api/note-workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Workspace ${workspaces.length + 1}`,
          itemId: entryId,
          payload: { openNotes: [] },
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to create workspace")
      }

      const data = await response.json()
      void debugLog({
        component: "DashboardView",
        action: "workspace_created",
        metadata: { workspaceId: data.workspace?.id, entryId },
      })

      // Refetch workspaces to update the list
      await refetchWorkspaces()
    } catch (err) {
      console.error("[DashboardView] Failed to create workspace:", err)
    }
  }, [entryId, workspaces.length, refetchWorkspaces])

  // Handle delete workspace
  const handleDeleteWorkspace = useCallback(async (workspaceId: string) => {
    try {
      setDeletingWorkspaceId(workspaceId)

      const response = await fetch(`/api/note-workspaces/${workspaceId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to delete workspace")
      }

      void debugLog({
        component: "DashboardView",
        action: "workspace_deleted",
        metadata: { workspaceId, entryId },
      })

      // Remove from local state
      setWorkspaces(prev => prev.filter(ws => ws.id !== workspaceId))
    } catch (err) {
      console.error("[DashboardView] Failed to delete workspace:", err)
    } finally {
      setDeletingWorkspaceId(null)
    }
  }, [entryId])

  // Handle rename workspace
  const handleRenameWorkspace = useCallback(async (workspaceId: string, newName: string) => {
    try {
      // First, get the workspace to retrieve its current revision
      const getResponse = await fetch(`/api/note-workspaces/${workspaceId}`)
      if (!getResponse.ok) {
        throw new Error("Failed to fetch workspace for rename")
      }
      const { workspace } = await getResponse.json()

      // Now rename with the revision
      const patchResponse = await fetch(`/api/note-workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          revision: workspace.revision,
          payload: workspace.payload || { openNotes: [] },
        }),
      })

      if (!patchResponse.ok) {
        throw new Error("Failed to rename workspace")
      }

      void debugLog({
        component: "DashboardView",
        action: "workspace_renamed",
        metadata: { workspaceId, newName, entryId },
      })

      // Update local state
      setWorkspaces(prev =>
        prev.map(ws => ws.id === workspaceId ? { ...ws, name: newName } : ws)
      )
    } catch (err) {
      console.error("[DashboardView] Failed to rename workspace:", err)
    }
  }, [entryId])

  // Handle panel close
  const handlePanelClose = useCallback(
    async (panelId: string) => {
      try {
        const response = await fetch(`/api/dashboard/panels/${panelId}`, {
          method: "DELETE",
        })

        if (!response.ok) {
          throw new Error("Failed to delete panel")
        }

        setPanels((prev) => prev.filter((p) => p.id !== panelId))

        void debugLog({
          component: "DashboardView",
          action: "panel_deleted",
          metadata: { panelId, workspaceId },
        })
      } catch (err) {
        console.error("[DashboardView] Failed to delete panel:", err)
      }
    },
    [workspaceId]
  )

  // Handle panel config change
  const handleConfigChange = useCallback(
    async (panelId: string, config: Partial<PanelConfig>) => {
      try {
        const response = await fetch(`/api/dashboard/panels/${panelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
        })

        if (!response.ok) {
          throw new Error("Failed to update panel config")
        }

        setPanels((prev) =>
          prev.map((p) =>
            p.id === panelId ? { ...p, config: { ...p.config, ...config } } : p
          )
        )
      } catch (err) {
        console.error("[DashboardView] Failed to update panel config:", err)
      }
    },
    []
  )

  // Handle reset layout
  const handleResetLayout = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard/panels/reset-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      })

      if (!response.ok) {
        throw new Error("Failed to reset layout")
      }

      const data = await response.json()
      setPanels(data.panels || [])

      void debugLog({
        component: "DashboardView",
        action: "layout_reset",
        metadata: { workspaceId, panelCount: (data.panels || []).length },
      })
    } catch (err) {
      console.error("[DashboardView] Failed to reset layout:", err)
    }
  }, [workspaceId])

  // Handle panel position update (persist to server)
  const handlePositionChange = useCallback(
    async (panelId: string, x: number, y: number) => {
      try {
        await fetch(`/api/dashboard/panels/${panelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positionX: x, positionY: y }),
        })
      } catch (err) {
        console.error("[DashboardView] Failed to update panel position:", err)
      }
    },
    []
  )

  // Drag handlers
  const handleDragStart = useCallback(
    (e: React.MouseEvent, panel: WorkspacePanel) => {
      e.preventDefault()
      setDraggingPanelId(panel.id)
      setActivePanelId(panel.id)
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panelX: panel.positionX,
        panelY: panel.positionY,
      }

      // Bring panel to front
      setPanels((prev) => {
        const maxZ = Math.max(...prev.map((p) => p.zIndex), 0)
        return prev.map((p) =>
          p.id === panel.id ? { ...p, zIndex: maxZ + 1 } : p
        )
      })
    },
    []
  )

  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      if (!draggingPanelId || !dragStartRef.current) return

      const deltaX = e.clientX - dragStartRef.current.x
      const deltaY = e.clientY - dragStartRef.current.y
      const newX = Math.max(0, dragStartRef.current.panelX + deltaX)
      const newY = Math.max(0, dragStartRef.current.panelY + deltaY)

      setPanels((prev) =>
        prev.map((p) =>
          p.id === draggingPanelId ? { ...p, positionX: newX, positionY: newY } : p
        )
      )
    },
    [draggingPanelId]
  )

  const handleDragEnd = useCallback(() => {
    if (draggingPanelId && dragStartRef.current) {
      const panel = panels.find((p) => p.id === draggingPanelId)
      if (panel) {
        handlePositionChange(panel.id, panel.positionX, panel.positionY)
      }
    }
    setDraggingPanelId(null)
    dragStartRef.current = null
  }, [draggingPanelId, panels, handlePositionChange])

  // Attach global mouse listeners for dragging
  useEffect(() => {
    if (draggingPanelId) {
      window.addEventListener("mousemove", handleDragMove)
      window.addEventListener("mouseup", handleDragEnd)
      return () => {
        window.removeEventListener("mousemove", handleDragMove)
        window.removeEventListener("mouseup", handleDragEnd)
      }
    }
  }, [draggingPanelId, handleDragMove, handleDragEnd])

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-full w-full"
        style={{ background: '#0a0c10' }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.1)',
            borderTopColor: '#6366f1',
            animation: 'spin 1s linear infinite',
          }}
        />
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full w-full gap-4"
        style={{ background: '#0a0c10' }}
      >
        <p style={{ color: '#ef4444' }}>{error}</p>
        <button
          onClick={fetchPanels}
          className="flex items-center"
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            background: 'transparent',
            color: '#8b8fa3',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn("relative w-full h-full overflow-auto", className)}
      style={{
        background: '#0a0c10',
        color: '#f0f0f0',
      }}
    >
      {/* Canvas surface with grid pattern */}
      <div
        className="min-h-full"
        style={{
          background: `
            radial-gradient(circle at 400px 300px, rgba(99, 102, 241, 0.04) 0%, transparent 50%),
            linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px),
            #0a0c10
          `,
          backgroundSize: '100% 100%, 20px 20px, 20px 20px, 100% 100%',
        }}
      >
        {/* Welcome tooltip */}
        {showWelcome && (
          <DashboardWelcomeTooltip onDismiss={markAsSeen} />
        )}

        {/* Dashboard header */}
        <div
          className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
          style={{
            background: 'rgba(15, 17, 23, 0.95)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {/* Left side: Logo + Breadcrumb */}
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
            >
              A
            </div>
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-sm">
              {/* Home link */}
              <button
                onClick={handleGoHome}
                className="flex items-center gap-1 transition-colors"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: isHomeEntry ? 'default' : 'pointer',
                  color: isHomeEntry ? '#8b8fa3' : '#f0f0f0',
                  padding: '2px 4px',
                  borderRadius: 4,
                }}
                disabled={isHomeEntry}
              >
                <Home size={14} />
                <span>Home</span>
              </button>
              {/* Show entry name if not Home */}
              {!isHomeEntry && (
                <>
                  <ChevronRight size={14} style={{ color: '#5c6070' }} />
                  <span style={{ color: '#f0f0f0', fontWeight: 500 }}>{entryName}</span>
                </>
              )}
              <ChevronRight size={14} style={{ color: '#5c6070' }} />
              {/* Show Dashboard or Workspace name based on viewMode */}
              {viewMode === 'dashboard' ? (
                <span style={{ color: '#8b8fa3' }}>Dashboard</span>
              ) : (
                <>
                  <button
                    onClick={handleReturnToDashboard}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#f0f0f0',
                      padding: '2px 4px',
                      borderRadius: 4,
                    }}
                  >
                    Dashboard
                  </button>
                  <ChevronRight size={14} style={{ color: '#5c6070' }} />
                  <span style={{ color: '#8b8fa3' }}>
                    {workspaces.find(ws => ws.id === activeWorkspaceId)?.name || "Workspace"}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right side: Dashboard button + Workspace dropdown + Add Panel + Reset */}
          <div className="flex items-center gap-2">
            {/* Dashboard button - highlighted when in dashboard mode, clickable when in workspace mode */}
            <button
              onClick={viewMode === 'workspace' ? handleReturnToDashboard : undefined}
              style={{
                padding: '7px 14px',
                borderRadius: '8px',
                background: viewMode === 'dashboard'
                  ? 'rgba(99, 102, 241, 0.15)'
                  : 'transparent',
                color: viewMode === 'dashboard'
                  ? '#818cf8'
                  : '#f0f0f0',
                border: viewMode === 'dashboard'
                  ? '1px solid rgba(99, 102, 241, 0.3)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                cursor: viewMode === 'workspace' ? 'pointer' : 'default',
                fontSize: '13px',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (viewMode === 'workspace') {
                  e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)'
                }
              }}
              onMouseLeave={(e) => {
                if (viewMode === 'workspace') {
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <LayoutDashboard size={14} />
              Dashboard
            </button>

            {/* Workspace dropdown - using WorkspaceToggleMenu */}
            <WorkspaceToggleMenu
              ref={workspaceMenuRef}
              className="pointer-events-auto"
              labelTitle="NOTE WORKSPACE"
              statusLabel={
                viewMode === 'workspace' && activeWorkspaceId
                  ? workspaces.find(ws => ws.id === activeWorkspaceId)?.name || "Workspace"
                  : workspaces.find(ws => ws.isDefault)?.name || "Workspace"
              }
              isOpen={workspaceMenuOpen}
              onToggleMenu={() => setWorkspaceMenuOpen(prev => !prev)}
              onCreateWorkspace={handleCreateWorkspace}
              disableCreate={isWorkspacesLoading}
              isListLoading={isWorkspacesLoading}
              workspaces={workspaces}
              currentWorkspaceId={viewMode === 'workspace' ? activeWorkspaceId : null}
              deletingWorkspaceId={deletingWorkspaceId}
              onSelectWorkspace={handleWorkspaceSelectById}
              onDeleteWorkspace={handleDeleteWorkspace}
              onRenameWorkspace={handleRenameWorkspace}
            />

            <AddPanelButton
              workspaceId={workspaceId}
              onPanelAdded={() => fetchPanels()}
            />
            <button
              onClick={handleResetLayout}
              style={{
                padding: '7px 14px',
                borderRadius: '8px',
                background: 'transparent',
                color: '#8b8fa3',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Reset
            </button>
          </div>
        </div>

        {/*
          Content area - Option C: Layered/Preserved State
          Both dashboard and workspace are rendered, but only one is visible.
          This preserves workspace state when switching back to dashboard.
        */}

        {/* Dashboard panels canvas - hidden when in workspace mode */}
        <div
          ref={canvasRef}
          className="relative"
          style={{
            minHeight: 'calc(100vh - 56px)',
            padding: 24,
            display: viewMode === 'dashboard' ? 'block' : 'none',
          }}
        >
          {panels.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 text-center"
              style={{ color: '#8b8fa3' }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5, marginBottom: 16 }}>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M12 8v8M8 12h8" />
              </svg>
              <p style={{ fontSize: 13, color: '#8b8fa3' }}>No panels yet</p>
              <p style={{ fontSize: 11, color: '#5c6070', marginTop: 4 }}>Add panels to customize your dashboard</p>
              <div className="mt-6">
                <AddPanelButton
                  workspaceId={workspaceId}
                  onPanelAdded={() => fetchPanels()}
                />
              </div>
            </div>
          ) : (
            <>
              {panels.map((panel) => (
                <div
                  key={panel.id}
                  style={{
                    position: 'absolute',
                    left: panel.positionX,
                    top: panel.positionY,
                    width: panel.width,
                    height: panel.height,
                    zIndex: panel.zIndex,
                    cursor: draggingPanelId === panel.id ? 'grabbing' : 'default',
                  }}
                  onClick={() => setActivePanelId(panel.id)}
                >
                  {/* Drag handle - the panel header */}
                  <div
                    onMouseDown={(e) => handleDragStart(e, panel)}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 40,
                      cursor: draggingPanelId === panel.id ? 'grabbing' : 'grab',
                      zIndex: 1,
                    }}
                  />
                  <DashboardPanelRenderer
                    panel={panel}
                    onClose={() => handlePanelClose(panel.id)}
                    onConfigChange={(config) => handleConfigChange(panel.id, config)}
                    onNavigate={onNavigate}
                    isActive={activePanelId === panel.id}
                  />
                </div>
              ))}
            </>
          )}
        </div>

        {/*
          Workspace canvas - Lazy mounted after first visit, hidden when in dashboard mode.
          Uses isHidden prop to suppress portal rendering when hidden (prevents portal bypass).
          hideHomeButton and hideWorkspaceToggle since DashboardView provides those.
        */}
        {hasVisitedWorkspace && (
          <div
            style={{
              position: 'absolute',
              top: 56, // Below the header
              left: 0,
              right: 0,
              bottom: 0,
              display: viewMode === 'workspace' ? 'block' : 'none',
            }}
          >
            <AnnotationAppShell
              isHidden={viewMode !== 'workspace'}
              hideHomeButton
              hideWorkspaceToggle
            />
          </div>
        )}
      </div>
    </div>
  )
}
