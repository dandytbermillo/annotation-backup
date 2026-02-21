"use client"

/**
 * Dashboard View Component
 * Part of Dashboard Implementation - Phase 3 Integration
 *
 * Renders the dashboard workspace with its panels.
 * This is shown when the user is on the dashboard workspace.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react"
import { DashboardPanelRenderer } from "./DashboardPanelRenderer"
import { DashboardWidgetRenderer } from "./DashboardWidgetRenderer"
import { FullPanelDrawer } from "./FullPanelDrawer"
import { PanelSizePicker } from "./PanelSizePicker"
import { DashboardWelcomeTooltip, useDashboardWelcome } from "./DashboardWelcomeTooltip"
import { AddPanelButton, PanelCatalog } from "./PanelCatalog"
import { DashboardBreadcrumb } from "./DashboardBreadcrumb"
import { PinEntryButton } from "./PinEntryButton"
import { WorkspaceToggleMenu } from "@/components/workspace/workspace-toggle-menu"
import { DashboardDock } from "./DashboardDock"
import { AnnotationAppShell } from "@/components/annotation-app-shell"
import { setActiveWorkspaceContext, subscribeToWorkspaceListRefresh, requestWorkspaceListRefresh, subscribeToActiveWorkspaceContext } from "@/lib/note-workspaces/state"
import { useChatNavigationContext } from "@/lib/chat"
import { requestDashboardPanelRefresh } from "@/lib/dashboard/category-store"
import type { WorkspacePanel, PanelConfig } from "@/lib/dashboard/panel-registry"
import { snapToGrid, GRID_CELL_SIZE, GRID_GAP, GRID_OFFSET } from "@/lib/dashboard/grid-snap"
import { cn } from "@/lib/utils"
import { debugLog } from "@/lib/utils/debug-logger"
import { pruneStaleWidgetStates, getAllWidgetStates, upsertWidgetState, removeWidgetState } from "@/lib/widgets/widget-state-store"
import { setActiveWidgetId } from "@/lib/widgets/ui-snapshot-registry"
import { RefreshCw, ChevronRight, LayoutDashboard, Loader2 } from "lucide-react"
import { useAutoScroll } from "@/components/canvas/use-auto-scroll"

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
  /** Callback when view mode changes (for navigation tracking and URL updates) */
  onViewModeChange?: (viewMode: 'dashboard' | 'workspace', activeWorkspaceId?: string) => void
  /** Initial view mode from URL params */
  initialViewMode?: 'dashboard' | 'workspace'
  /** Initial active workspace ID from URL params */
  initialActiveWorkspaceId?: string
  /** Pinned workspace IDs - only these workspaces stay mounted when switching away from this entry */
  pinnedWorkspaceIds?: string[]
  /** Whether this entry is currently active/visible (vs hidden behind another entry) */
  isEntryActive?: boolean
}

export function DashboardView({
  workspaceId,
  onNavigate,
  entryId,
  entryName = "Home",
  homeEntryId,
  className,
  onViewModeChange,
  initialViewMode = 'dashboard',
  initialActiveWorkspaceId,
  pinnedWorkspaceIds,
  isEntryActive = true,
}: DashboardViewProps) {
  const [panels, setPanels] = useState<WorkspacePanel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { hasSeenWelcome, markAsSeen } = useDashboardWelcome()
  const showWelcome = !hasSeenWelcome

  // View mode state (Phase 2) - Initialize from URL params if provided
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(initialActiveWorkspaceId ?? null)
  // Phase 3: Lazy mounting - only mount workspace canvas after first visit
  // Initialize to true if starting in workspace mode (from URL)
  const [hasVisitedWorkspace, setHasVisitedWorkspace] = useState(initialViewMode === 'workspace' && !!initialActiveWorkspaceId)

  // Chat Navigation Fix 2: Pending note to open after workspace switches
  // When chat says "open note X in workspace Y", we store the pending note here
  // and pass it to AnnotationAppShell which opens it after mounting
  const [pendingNoteOpen, setPendingNoteOpen] = useState<{ noteId: string; workspaceId: string } | null>(null)

  // Chat Navigation: Pending workspace ID when workspace was just created and list hasn't refreshed yet
  const [pendingWorkspaceSwitch, setPendingWorkspaceSwitch] = useState<string | null>(null)

  // Phase 5: Loading state for mode switching transitions
  const [isModeSwitching, setIsModeSwitching] = useState(false)
  const modeSwitchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Highlighted panel state (for glow effect when clicking Eye icon in Links Overview)
  const [highlightedPanelId, setHighlightedPanelId] = useState<string | null>(null)
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Widget Architecture: Full panel drawer state
  const [drawerPanel, setDrawerPanel] = useState<WorkspacePanel | null>(null)
  const isDrawerOpen = drawerPanel !== null

  // Chat Navigation: Get functions to track view mode and workspace opens
  const { setCurrentLocation, incrementOpenCount, setUiContext, setLastAction, recordExecutedAction } = useChatNavigationContext()

  // Debug: Track mount/unmount and initial state
  useEffect(() => {
    void debugLog({
      component: "DashboardView",
      action: "mounted",
      metadata: {
        entryId,
        entryName,
        workspaceId,
        initialViewMode,
        initialActiveWorkspaceId,
        hasVisitedWorkspace,
      },
    })
    console.log("[DashboardView] Mounted:", { entryId, entryName, viewMode, hasVisitedWorkspace })

    return () => {
      void debugLog({
        component: "DashboardView",
        action: "unmounted",
        metadata: { entryId, entryName },
      })
      console.log("[DashboardView] Unmounted:", { entryId, entryName })
    }
  }, []) // Only run on mount/unmount

  // Phase 5: Debounce rapid mode switching
  const lastModeSwitchRef = useRef<number>(0)
  const MODE_SWITCH_DEBOUNCE_MS = 150

  // Phase 4: Handle initial workspace mode from URL params
  // Set workspace context if starting in workspace mode
  useEffect(() => {
    if (initialViewMode === 'workspace' && initialActiveWorkspaceId) {
      void debugLog({
        component: "DashboardView",
        action: "restore_from_url",
        metadata: {
          initialViewMode,
          initialActiveWorkspaceId,
          entryId,
        },
      })
      console.log("[DashboardView] Restoring workspace mode from URL:", { initialViewMode, initialActiveWorkspaceId })
      setActiveWorkspaceContext(initialActiveWorkspaceId)
    }
  }, []) // Only run on mount

  // Workspaces for dropdown
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [isWorkspacesLoading, setIsWorkspacesLoading] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null)

  const visibleWidgets = useMemo(() => {
    return panels
      .filter((panel) => panel.isVisible && !panel.deletedAt)
      .slice(0, 10)
      .map((panel) => ({
        id: panel.id,
        title: panel.title ?? panel.panelType,
        type: panel.panelType,
      }))
  }, [panels])

  // Chat Navigation: Update location tracking when view mode changes
  useEffect(() => {
    const currentWorkspace = workspaces.find(ws => ws.id === activeWorkspaceId)
    // Only pass workspace ID when in workspace mode
    // When in dashboard mode, workspace ID should be undefined for "already on dashboard" detection
    setCurrentLocation(
      viewMode,
      entryId,
      entryName,
      viewMode === 'workspace' ? (activeWorkspaceId ?? undefined) : undefined,
      viewMode === 'workspace' ? currentWorkspace?.name : undefined
    )
  }, [viewMode, entryId, entryName, activeWorkspaceId, workspaces, setCurrentLocation])

  // Drag state
  const [draggingPanelId, setDraggingPanelId] = useState<string | null>(null)
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const dragStartRef = useRef<{ x: number; y: number; panelX: number; panelY: number } | null>(null)

  useEffect(() => {
    // Debug: Track when this effect runs and what triggered it
    console.log('[DashboardView] uiContext_effect_entered:', {
      isEntryActive,
      viewMode,
      drawerPanelId: drawerPanel?.id ?? null,
      drawerPanelTitle: drawerPanel?.title ?? drawerPanel?.panelType ?? null,
    })
    void debugLog({
      component: 'DashboardView',
      action: 'uiContext_effect_entered',
      metadata: {
        isEntryActive,
        viewMode,
        drawerPanelId: drawerPanel?.id ?? null,
        drawerPanelTitle: drawerPanel?.title ?? drawerPanel?.panelType ?? null,
      },
    })
    if (!isEntryActive) {
      void debugLog({
        component: 'DashboardView',
        action: 'setUiContext_inactive',
        metadata: { isEntryActive, viewMode },
      })
      setUiContext(null)
      return
    }
    if (viewMode === 'dashboard') {
      const openDrawerTitle = drawerPanel?.title ?? drawerPanel?.panelType ?? null
      // Phase 4: Filter out workspace widgetStates when on dashboard
      // This prevents stale workspace data from being sent to the LLM
      // Filter by widgetId (not instanceId prefix) to avoid hiding third-party widgets
      const allWidgetStates = getAllWidgetStates()
      const dashboardWidgetStates = Object.fromEntries(
        Object.entries(allWidgetStates).filter(([, state]) => state.widgetId !== 'workspace')
      )
      void debugLog({
        component: 'DashboardView',
        action: 'setUiContext_dashboard',
        metadata: {
          viewMode,
          drawerPanelId: drawerPanel?.id,
          openDrawerTitle,
          hasDraw: !!drawerPanel,
          allWidgetStatesCount: Object.keys(allWidgetStates).length,
          dashboardWidgetStatesCount: Object.keys(dashboardWidgetStates).length,
          filteredOutWorkspaceStates: Object.entries(allWidgetStates).filter(([, s]) => s.widgetId === 'workspace').map(([k]) => k),
        },
      })
      setUiContext({
        mode: 'dashboard',
        dashboard: {
          entryId,
          entryName,
          visibleWidgets,
          openDrawer: drawerPanel
            ? {
                panelId: drawerPanel.id,
                title: drawerPanel.title ?? drawerPanel.panelType,
                type: drawerPanel.panelType,
              }
            : undefined,
          focusedPanelId: activePanelId,
          widgetStates: dashboardWidgetStates,
        },
      })
      return
    }
    // Phase 3: Workspace mode uiContext is owned exclusively by AnnotationAppShell.
    // DashboardView must not set workspace uiContext to prevent race conditions.
    // AnnotationAppShell has access to openNotes from the dock, which DashboardView lacks.
  }, [
    viewMode,
    entryId,
    entryName,
    visibleWidgets,
    drawerPanel,
    activePanelId,
    setUiContext,
    isEntryActive,
  ])

  // Phase 4: Dashboard state reporting via widgetStates
  // Reports dashboard state for LLM context (same contract as widgets)
  useEffect(() => {
    // Debug: Track when this effect runs
    console.log('[DashboardView] widgetState_effect_entered:', {
      viewMode,
      isEntryActive,
      drawerPanelId: drawerPanel?.id ?? null,
      drawerPanelTitle: drawerPanel?.title ?? drawerPanel?.panelType ?? null,
    })
    void debugLog({
      component: 'DashboardView',
      action: 'widgetState_effect_entered',
      metadata: {
        viewMode,
        isEntryActive,
        drawerPanelId: drawerPanel?.id ?? null,
        drawerPanelTitle: drawerPanel?.title ?? drawerPanel?.panelType ?? null,
      },
    })
    // Only report in dashboard mode when entry is active
    if (viewMode !== 'dashboard' || !isEntryActive) {
      // Clean up when leaving dashboard mode
      removeWidgetState(`dashboard-${entryId}`)
      return
    }

    const openDrawerTitle = drawerPanel?.title ?? drawerPanel?.panelType ?? null
    const widgetCount = visibleWidgets.length
    const summary = openDrawerTitle
      ? `${entryName} dashboard with ${widgetCount} widgets, "${openDrawerTitle}" drawer open`
      : `${entryName} dashboard with ${widgetCount} widgets`

    void debugLog({
      component: 'DashboardView',
      action: 'report_dashboard_widgetState',
      metadata: { entryId, widgetCount, openDrawerTitle, summary },
    })

    upsertWidgetState({
      _version: 1,
      widgetId: 'dashboard',
      instanceId: `dashboard-${entryId}`,
      title: `${entryName} Dashboard`,
      view: openDrawerTitle ? 'drawer' : 'main',
      selection: openDrawerTitle ? { id: drawerPanel?.id ?? '', label: openDrawerTitle } : null,
      summary,
      updatedAt: Date.now(),
      counts: { widgets: widgetCount },
      contextTags: ['entry-dashboard', `entry-${entryId}`],
    })

    return () => {
      removeWidgetState(`dashboard-${entryId}`)
    }
  }, [viewMode, entryId, entryName, visibleWidgets, drawerPanel, isEntryActive])

  // Snap-to-grid placeholder state
  const [snapPlaceholder, setSnapPlaceholder] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dashboardContainerRef = useRef<HTMLDivElement>(null)

  // Dynamic canvas size calculation
  // Canvas MUST be larger than viewport to provide scroll room for auto-scroll
  const canvasDimensions = useMemo(() => {
    const BUFFER = 500 // Extra space beyond panels for scrolling
    const SCROLL_ROOM = 200 // Extra space beyond viewport to enable initial scrolling
    const viewportWidth = window?.innerWidth || 1200
    // Header is now outside the scrollable container, so use full remaining height
    // The scrollable container is flex-1 which is (100vh - header height ~56px)
    const viewportHeight = (window?.innerHeight || 800) - 56

    // Canvas must be larger than viewport + some room for scroll to work
    const MIN_WIDTH = viewportWidth + SCROLL_ROOM
    const MIN_HEIGHT = viewportHeight + SCROLL_ROOM

    if (panels.length === 0) {
      return { width: MIN_WIDTH, height: MIN_HEIGHT }
    }

    // Find the rightmost and bottommost panel edges
    let maxRight = 0
    let maxBottom = 0

    for (const panel of panels) {
      const right = panel.positionX + panel.width
      const bottom = panel.positionY + panel.height
      if (right > maxRight) maxRight = right
      if (bottom > maxBottom) maxBottom = bottom
    }

    // Add buffer for scrollable space, ensuring always larger than viewport
    return {
      width: Math.max(MIN_WIDTH, maxRight + BUFFER),
      height: Math.max(MIN_HEIGHT, maxBottom + BUFFER),
    }
  }, [panels])

  // When dragging, temporarily expand canvas to allow more scroll room
  const [dragExpandBuffer, setDragExpandBuffer] = useState({ x: 0, y: 0 })

  // Auto-scroll handler for dashboard panel dragging
  const handleDashboardAutoScroll = useCallback((deltaX: number, deltaY: number) => {
    if (!dashboardContainerRef.current || !draggingPanelId) return

    const container = dashboardContainerRef.current

    // INVERT the deltas: the hook's direction is for "view follows content"
    // but we need "reveal more canvas in the direction of drag"
    // Near bottom edge: hook gives negative deltaY (scroll up), but we want scroll DOWN
    // Near right edge: hook gives negative deltaX (scroll left), but we want scroll RIGHT
    // Near left edge: hook gives positive deltaX (scroll right), but we want scroll LEFT
    // Near top edge: hook gives positive deltaY (scroll down), but we want scroll UP
    const scrollDeltaX = -deltaX
    const scrollDeltaY = -deltaY

    console.log("[DashboardView] Auto-scroll triggered:", {
      originalDelta: { deltaX, deltaY },
      adjustedDelta: { scrollDeltaX, scrollDeltaY },
      currentScroll: { scrollLeft: container.scrollLeft, scrollTop: container.scrollTop },
      leftEdgeCheck: {
        scrollDeltaXIsNegative: scrollDeltaX < 0,
        scrollLeftIsZero: container.scrollLeft <= 0,
        conditionMet: scrollDeltaX < 0 && container.scrollLeft <= 0
      }
    })

    // Handle horizontal scrolling
    if (scrollDeltaX !== 0) {
      if (scrollDeltaX < 0 && container.scrollLeft < 1) {
        // LEFT EDGE: Already at left, can't scroll left further
        // No expansion needed leftward - just block (same as top edge)
        console.log("[DashboardView] At left edge (scrollLeft=0), can't scroll left further")
      } else {
        // Normal horizontal scroll (right edge only, since left is blocked)
        container.scrollLeft += scrollDeltaX

        // Expand buffer for right edge only
        if (scrollDeltaX > 0) {
          setDragExpandBuffer(prev => ({
            ...prev,
            x: prev.x + Math.abs(scrollDeltaX) * 2,
          }))
        }

        // Update dragging panel position
        if (dragStartRef.current) {
          dragStartRef.current.panelX += scrollDeltaX
          setPanels((prev) =>
            prev.map((p) =>
              p.id === draggingPanelId
                ? { ...p, positionX: Math.max(0, Math.round(p.positionX + scrollDeltaX)) }
                : p
            )
          )
        }
      }
    }

    // Handle vertical scrolling
    if (scrollDeltaY !== 0) {
      if (scrollDeltaY < 0 && container.scrollTop < 1) {
        // TOP EDGE: Already at top, can't scroll up further
        // No expansion needed upward - just block
        console.log("[DashboardView] At top edge (scrollTop=0), can't scroll up further")
      } else {
        // Normal vertical scroll (up or down)
        container.scrollTop += scrollDeltaY

        // Expand buffer for bottom edge only (no top edge expansion)
        if (scrollDeltaY > 0) {
          setDragExpandBuffer(prev => ({
            ...prev,
            y: prev.y + Math.abs(scrollDeltaY) * 2,
          }))
        }

        // Update dragging panel position to follow scroll
        if (dragStartRef.current) {
          dragStartRef.current.panelY += scrollDeltaY
          setPanels((prev) =>
            prev.map((p) =>
              p.id === draggingPanelId
                ? {
                    ...p,
                    // Clamp to >= 0 to prevent negative positions
                    positionY: Math.max(0, Math.round(p.positionY + scrollDeltaY))
                  }
                : p
            )
          )
        }
      }
    }
  }, [draggingPanelId])

  const { checkAutoScroll, stopAutoScroll } = useAutoScroll({
    enabled: !!draggingPanelId,
    threshold: 50,
    speedPxPerSec: 400,
    activationDelay: 300, // Faster activation for dashboard panels
    onScroll: handleDashboardAutoScroll,
    containerRef: dashboardContainerRef,
  })

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

  // Listen for highlight-dashboard-panel events (from Links Overview Eye icon click)
  useEffect(() => {
    const handleHighlightPanel = (e: Event) => {
      const customEvent = e as CustomEvent<{ panelId: string }>
      const panelId = customEvent.detail?.panelId
      if (!panelId) return

      // Find the panel element and scroll it into view
      const panelElement = document.querySelector(`[data-panel-id="${panelId}"]`)
      if (panelElement) {
        panelElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }

      // Set highlighted state for glow effect
      setHighlightedPanelId(panelId)

      // Clear highlight after animation duration
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedPanelId(null)
      }, 2000) // Glow for 2 seconds
    }

    window.addEventListener('highlight-dashboard-panel', handleHighlightPanel)
    return () => {
      window.removeEventListener('highlight-dashboard-panel', handleHighlightPanel)
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  // Listen for refresh-dashboard-panels events (when a hidden panel is made visible)
  useEffect(() => {
    const handleRefreshPanels = () => {
      void debugLog({
        component: "DashboardView",
        action: "refresh_panels_event_received",
        metadata: { workspaceId },
      })
      fetchPanels()
    }

    window.addEventListener('refresh-dashboard-panels', handleRefreshPanels)
    return () => {
      window.removeEventListener('refresh-dashboard-panels', handleRefreshPanels)
    }
  }, [fetchPanels, workspaceId])

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
  const workspacePanelRef = useRef<HTMLDivElement>(null)

  // Panel catalog state (for Add Panel button in dock)
  const [isPanelCatalogOpen, setIsPanelCatalogOpen] = useState(false)

  // Close workspace panel when clicking outside (for dock-triggered panel)
  useEffect(() => {
    if (!workspaceMenuOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Don't close if clicking the dock workspace button
      if (target.closest('[data-workspace-toggle]')) return
      // Don't close if clicking inside the panel
      if (workspacePanelRef.current?.contains(target)) return
      // Don't close if clicking the old menu ref (for header dropdown if present)
      if (workspaceMenuRef.current?.contains(target)) return
      setWorkspaceMenuOpen(false)
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [workspaceMenuOpen])

  // Close panel catalog when clicking outside
  useEffect(() => {
    if (!isPanelCatalogOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Don't close if clicking the dock add panel button
      if (target.closest('[data-add-panel-toggle]')) return
      // Don't close if clicking inside the catalog
      if (target.closest('[data-panel-catalog]')) return
      setIsPanelCatalogOpen(false)
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isPanelCatalogOpen])

  // Handle workspace selection from dropdown (receives just workspaceId)
  // Phase 2: Sets viewMode to 'workspace' instead of navigating away
  // Phase 3: Also sets active workspace context so AnnotationAppShell loads the correct workspace
  // Phase 4: Calls onViewModeChange for navigation tracking and URL updates
  // Phase 5: Adds debouncing for rapid mode switching and loading state
  const handleWorkspaceSelectById = useCallback((
    selectedWorkspaceId: string,
    opts?: { source?: 'chat' | 'direct_ui'; isUserMeaningful?: boolean }
  ) => {
    // Phase 5: Debounce rapid mode switching
    const now = Date.now()
    if (now - lastModeSwitchRef.current < MODE_SWITCH_DEBOUNCE_MS) {
      console.log("[DashboardView] Mode switch debounced")
      return
    }
    lastModeSwitchRef.current = now

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

    // Phase 5: Show loading state briefly during mode switch
    void debugLog({
      component: "DashboardView",
      action: "is_mode_switching_set",
      metadata: { value: true, entryId },
    })
    setIsModeSwitching(true)
    if (modeSwitchTimeoutRef.current) {
      clearTimeout(modeSwitchTimeoutRef.current)
    }
    modeSwitchTimeoutRef.current = setTimeout(() => {
      void debugLog({
        component: "DashboardView",
        action: "is_mode_switching_set",
        metadata: { value: false, entryId, source: "timeout" },
      })
      setIsModeSwitching(false)
    }, 300)

    setActiveWorkspaceId(selectedWorkspaceId)
    setViewMode('workspace')
    // Phase 3: Mark that workspace has been visited for lazy mounting
    setHasVisitedWorkspace(true)
    // Phase 3: Set active workspace context so AnnotationAppShell loads the selected workspace
    // This triggers the subscription in AnnotationAppContent which calls noteWorkspaceState.selectWorkspace()
    setActiveWorkspaceContext(selectedWorkspaceId)
    // Phase 4: Notify parent for navigation tracking and URL updates
    onViewModeChange?.('workspace', selectedWorkspaceId)
    // Chat Navigation: Track workspace open count for session stats
    if (ws) {
      incrementOpenCount(selectedWorkspaceId, ws.name, 'workspace')
      recordExecutedAction({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: selectedWorkspaceId, name: ws.name },
        source: opts?.source || 'direct_ui',
        resolverPath: opts?.source === 'chat' ? 'executeAction' : 'directUI',
        reasonCode: opts?.source === 'chat' ? 'unknown' : 'direct_ui',
        scopeKind: 'workspace',
        scopeInstanceId: selectedWorkspaceId,
        isUserMeaningful: opts?.isUserMeaningful ?? true,
        outcome: 'success',
      })
    }
  }, [entryId, workspaces, onViewModeChange, incrementOpenCount, recordExecutedAction])

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

  // Handle workspace change from canvas dock (when user switches workspaces inside workspace view)
  // This syncs the DashboardView's activeWorkspaceId with the internal workspace change
  const handleWorkspaceChangeFromCanvas = useCallback((workspaceId: string) => {
    void debugLog({
      component: "DashboardView",
      action: "workspace_changed_from_canvas",
      metadata: { workspaceId, previousActiveWorkspaceId: activeWorkspaceId, entryId },
    })
    console.log("[DashboardView] Workspace changed from canvas dock:", workspaceId)

    // Update local state so controlledWorkspaceId stays in sync
    setActiveWorkspaceId(workspaceId)
    // Also update the global context
    setActiveWorkspaceContext(workspaceId)
    // Notify parent for URL updates
    onViewModeChange?.('workspace', workspaceId)
    // Chat Navigation: Track workspace open count for session stats
    const ws = workspaces.find(w => w.id === workspaceId)
    if (ws) {
      incrementOpenCount(workspaceId, ws.name, 'workspace')
      // ActionTrace Phase B: Record open_workspace at commit point (direct_ui only — canvas dock)
      recordExecutedAction({
        actionType: 'open_workspace',
        target: { kind: 'workspace', id: workspaceId, name: ws.name },
        source: 'direct_ui',
        resolverPath: 'directUI',
        reasonCode: 'direct_ui',
        scopeKind: 'workspace',
        scopeInstanceId: workspaceId,
        isUserMeaningful: true,
        outcome: 'success',
      })
    }
  }, [activeWorkspaceId, entryId, onViewModeChange, workspaces, incrementOpenCount, recordExecutedAction])

  // Handle returning to dashboard mode (Phase 2)
  // Phase 4: Calls onViewModeChange for navigation tracking and URL updates
  // Phase 5: Adds debouncing for rapid mode switching and loading state
  const handleReturnToDashboard = useCallback((opts?: { source?: 'chat' | 'direct_ui' }) => {
    // Phase 5: Debounce rapid mode switching
    const now = Date.now()
    if (now - lastModeSwitchRef.current < MODE_SWITCH_DEBOUNCE_MS) {
      console.log("[DashboardView] Mode switch debounced")
      return
    }
    lastModeSwitchRef.current = now

    void debugLog({
      component: "DashboardView",
      action: "return_to_dashboard",
      metadata: {
        previousWorkspaceId: activeWorkspaceId,
        entryId,
      },
    })
    console.log("[DashboardView] Returning to dashboard mode from workspace:", activeWorkspaceId)

    // Phase 5: Show loading state briefly during mode switch
    void debugLog({
      component: "DashboardView",
      action: "is_mode_switching_set",
      metadata: { value: true, entryId },
    })
    setIsModeSwitching(true)
    if (modeSwitchTimeoutRef.current) {
      clearTimeout(modeSwitchTimeoutRef.current)
    }
    modeSwitchTimeoutRef.current = setTimeout(() => {
      void debugLog({
        component: "DashboardView",
        action: "is_mode_switching_set",
        metadata: { value: false, entryId, source: "timeout" },
      })
      setIsModeSwitching(false)
    }, 300)

    setViewMode('dashboard')
    // Note: We keep activeWorkspaceId (local state) so user can quickly return to the same workspace
    // But we clear the module-level activeWorkspaceContext so chat navigation can detect "already on dashboard"
    void debugLog({
      component: 'DashboardView',
      action: 'handleReturnToDashboard_clearing_context',
      metadata: { previousWorkspaceId: activeWorkspaceId, entryId },
    })
    setActiveWorkspaceContext(null)
    // Phase 4: Notify parent for navigation tracking and URL updates
    onViewModeChange?.('dashboard')
    // ActionTrace Phase B: Record go_to_dashboard at commit point
    recordExecutedAction({
      actionType: 'go_to_dashboard',
      target: { kind: 'entry', id: entryId, name: entryName },
      source: opts?.source || 'direct_ui',
      resolverPath: opts?.source === 'chat' ? 'executeAction' : 'directUI',
      reasonCode: opts?.source === 'chat' ? 'unknown' : 'direct_ui',
      scopeKind: 'workspace',
      scopeInstanceId: activeWorkspaceId ?? undefined,
      isUserMeaningful: true,
      outcome: 'success',
    })
  }, [activeWorkspaceId, entryId, entryName, onViewModeChange, recordExecutedAction])

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

    void debugLog({
      component: "DashboardView",
      action: "create_workspace_start",
      metadata: { entryId, currentWorkspacesCount: workspaces.length },
    })

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
      const newWorkspaceId = data.workspace?.id

      void debugLog({
        component: "DashboardView",
        action: "workspace_created",
        metadata: { workspaceId: newWorkspaceId, entryId },
      })

      // Request global workspace list refresh so AnnotationAppShell's noteWorkspaceState gets updated
      void debugLog({
        component: "DashboardView",
        action: "requesting_global_workspace_refresh",
        metadata: { workspaceId: newWorkspaceId },
      })
      requestWorkspaceListRefresh()

      // Refetch workspaces to update the local list
      await refetchWorkspaces()

      void debugLog({
        component: "DashboardView",
        action: "local_workspaces_refetched",
        metadata: { workspaceId: newWorkspaceId, newWorkspacesCount: workspaces.length + 1 },
      })

      // Switch to the newly created workspace
      if (newWorkspaceId) {
        void debugLog({
          component: "DashboardView",
          action: "switching_to_new_workspace",
          metadata: {
            workspaceId: newWorkspaceId,
            entryId,
            step: "before_state_updates",
          },
        })
        setWorkspaceMenuOpen(false)
        setActiveWorkspaceId(newWorkspaceId)
        setViewMode('workspace')
        setHasVisitedWorkspace(true)

        void debugLog({
          component: "DashboardView",
          action: "switching_to_new_workspace",
          metadata: {
            workspaceId: newWorkspaceId,
            entryId,
            step: "before_setActiveWorkspaceContext",
          },
        })
        setActiveWorkspaceContext(newWorkspaceId)

        void debugLog({
          component: "DashboardView",
          action: "switching_to_new_workspace",
          metadata: {
            workspaceId: newWorkspaceId,
            entryId,
            step: "after_setActiveWorkspaceContext",
          },
        })
        onViewModeChange?.('workspace', newWorkspaceId)

        void debugLog({
          component: "DashboardView",
          action: "switching_to_new_workspace",
          metadata: {
            workspaceId: newWorkspaceId,
            entryId,
            step: "complete",
          },
        })
      }
    } catch (err) {
      console.error("[DashboardView] Failed to create workspace:", err)
      void debugLog({
        component: "DashboardView",
        action: "create_workspace_error",
        metadata: { entryId, error: err instanceof Error ? err.message : String(err) },
      })
    }
  }, [entryId, workspaces.length, refetchWorkspaces, onViewModeChange])

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

  // Handle panel close - hides panel instead of deleting it
  // Panel can be re-opened from Links Overview panel's Eye icon
  const handlePanelClose = useCallback(
    async (panelId: string) => {
      try {
        const response = await fetch(`/api/dashboard/panels/${panelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isVisible: false }),
        })

        if (!response.ok) {
          throw new Error("Failed to hide panel")
        }

        // Remove from local state (panel is hidden, not deleted)
        setPanels((prev) => prev.filter((p) => p.id !== panelId))

        // Notify Links Overview panel to refresh so it shows the hidden panel
        requestDashboardPanelRefresh()

        void debugLog({
          component: "DashboardView",
          action: "panel_hidden",
          metadata: { panelId, workspaceId },
        })
      } catch (err) {
        console.error("[DashboardView] Failed to hide panel:", err)
      }
    },
    [workspaceId]
  )

  // Handle panel delete - soft delete (move to trash)
  // Panel can be restored from Links Overview's Trash section within 30 days
  const handlePanelDelete = useCallback(
    async (panelId: string) => {
      try {
        // DELETE without ?permanent=true does soft delete
        const response = await fetch(`/api/dashboard/panels/${panelId}`, {
          method: "DELETE",
        })

        if (!response.ok) {
          throw new Error("Failed to delete panel")
        }

        // Remove from local state (panel is soft deleted)
        setPanels((prev) => prev.filter((p) => p.id !== panelId))

        // Notify Links Overview panel to refresh so it shows in Trash section
        requestDashboardPanelRefresh()

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

  // Widget Architecture: Handle widget double-click to open drawer
  const handleWidgetDoubleClick = useCallback((panel: WorkspacePanel) => {
    setDrawerPanel(panel)
    if (isEntryActive) {
      // Phase 4: Filter out workspace widgetStates when on dashboard (same as main effect)
      // Filter by widgetId (not instanceId prefix) to avoid hiding third-party widgets
      const allWidgetStates = getAllWidgetStates()
      const dashboardWidgetStates = Object.fromEntries(
        Object.entries(allWidgetStates).filter(([, state]) => state.widgetId !== 'workspace')
      )
      setUiContext({
        mode: 'dashboard',
        dashboard: {
          entryId,
          entryName,
          visibleWidgets,
          openDrawer: {
            panelId: panel.id,
            title: panel.title ?? panel.panelType,
            type: panel.panelType,
          },
          focusedPanelId: activePanelId,
          widgetStates: dashboardWidgetStates,
        },
      })
    }
    // ActionTrace Phase B: Record open_panel at commit point (direct_ui only — double-click)
    // MUST fire before setLastAction so the freshness guard ref is set and blocks the redundant legacy write.
    recordExecutedAction({
      actionType: 'open_panel',
      target: { kind: 'panel', id: panel.id, name: panel.title ?? panel.panelType },
      source: 'direct_ui',
      resolverPath: 'directUI',
      reasonCode: 'direct_ui',
      scopeKind: 'dashboard',
      scopeInstanceId: entryId,
      isUserMeaningful: true,
      outcome: 'success',
    })
    setLastAction({
      type: 'open_panel',
      panelTitle: panel.title ?? panel.panelType,
      panelId: panel.id,
      timestamp: Date.now(),
    })
    void debugLog({
      component: "DashboardView",
      action: "drawer_opened",
      metadata: { panelId: panel.id, panelType: panel.panelType },
    })
  }, [activePanelId, entryId, entryName, isEntryActive, setLastAction, setUiContext, visibleWidgets, recordExecutedAction])

  // Widget Architecture: Handle drawer close
  const handleDrawerClose = useCallback(() => {
    setDrawerPanel(null)
    setActiveWidgetId(null)
    void debugLog({
      component: "DashboardView",
      action: "drawer_closed",
      metadata: {},
    })
  }, [])

  // Widget Architecture: Listen for 'open-panel-drawer' events from chat
  useEffect(() => {
    const handleOpenDrawer = (e: CustomEvent<{ panelId: string; source?: 'chat' }>) => {
      console.log('[DashboardView] handleOpenDrawer_called:', {
        requestedPanelId: e.detail.panelId,
        panelsCount: panels.length,
        currentDrawerPanelId: drawerPanel?.id ?? null,
      })
      void debugLog({
        component: "DashboardView",
        action: "handleOpenDrawer_called",
        metadata: {
          requestedPanelId: e.detail.panelId,
          panelsCount: panels.length,
          currentDrawerPanelId: drawerPanel?.id ?? null,
        },
      })
      const panel = panels.find(p => p.id === e.detail.panelId)
      if (panel) {
        console.log('[DashboardView] setDrawerPanel_calling:', { panelId: panel.id, panelType: panel.panelType, panelTitle: panel.title })
        void debugLog({
          component: "DashboardView",
          action: "setDrawerPanel_calling",
          metadata: { panelId: panel.id, panelType: panel.panelType, panelTitle: panel.title },
        })
        setDrawerPanel(panel)
        setActiveWidgetId(panel.id)
        // ActionTrace Phase B: Record open_panel at commit point
        const eventSource = e.detail.source === 'chat' ? 'chat' as const : 'direct_ui' as const
        recordExecutedAction({
          actionType: 'open_panel',
          target: { kind: 'panel', id: panel.id, name: panel.title ?? panel.panelType },
          source: eventSource,
          resolverPath: eventSource === 'chat' ? 'executeAction' : 'directUI',
          reasonCode: eventSource === 'chat' ? 'unknown' : 'direct_ui',
          scopeKind: 'dashboard',
          scopeInstanceId: entryId,
          isUserMeaningful: true,
          outcome: 'success',
        })
        console.log('[DashboardView] drawer_opened_from_chat:', { panelId: panel.id, panelType: panel.panelType })
        void debugLog({
          component: "DashboardView",
          action: "drawer_opened_from_chat",
          metadata: { panelId: panel.id, panelType: panel.panelType },
        })
      } else {
        console.log('[DashboardView] handleOpenDrawer_panel_not_found:', { requestedPanelId: e.detail.panelId, availablePanelIds: panels.map(p => p.id) })
        void debugLog({
          component: "DashboardView",
          action: "handleOpenDrawer_panel_not_found",
          metadata: { requestedPanelId: e.detail.panelId, availablePanelIds: panels.map(p => p.id) },
        })
      }
    }

    window.addEventListener('open-panel-drawer', handleOpenDrawer as EventListener)
    return () => window.removeEventListener('open-panel-drawer', handleOpenDrawer as EventListener)
  }, [panels, recordExecutedAction, entryId])

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

  // Handle panel title change
  const handleTitleChange = useCallback(
    async (panelId: string, newTitle: string) => {
      try {
        const response = await fetch(`/api/dashboard/panels/${panelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        })

        if (!response.ok) {
          throw new Error("Failed to update panel title")
        }

        setPanels((prev) =>
          prev.map((p) =>
            p.id === panelId ? { ...p, title: newTitle } : p
          )
        )

        // Notify Links Overview and other panels that panel data changed
        requestDashboardPanelRefresh()

        void debugLog({
          component: "DashboardView",
          action: "panel_title_updated",
          metadata: { panelId, newTitle, workspaceId },
        })
      } catch (err) {
        console.error("[DashboardView] Failed to update panel title:", err)
      }
    },
    [workspaceId]
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
        // Round to integers - database expects integer type
        await fetch(`/api/dashboard/panels/${panelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positionX: Math.round(x), positionY: Math.round(y) }),
        })
      } catch (err) {
        console.error("[DashboardView] Failed to update panel position:", err)
      }
    },
    []
  )

  // Handle panel size change (from size picker)
  const handleSizeChange = useCallback(
    async (panelId: string, width: number, height: number) => {
      try {
        // Update local state immediately for responsive UI
        setPanels((prev) =>
          prev.map((p) =>
            p.id === panelId ? { ...p, width, height } : p
          )
        )

        // Persist to server
        await fetch(`/api/dashboard/panels/${panelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ width, height }),
        })

        void debugLog({
          component: "DashboardView",
          action: "panel_size_changed",
          metadata: { panelId, width, height },
        })
      } catch (err) {
        console.error("[DashboardView] Failed to update panel size:", err)
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
      const newX = Math.max(0, Math.round(dragStartRef.current.panelX + deltaX))
      const newY = Math.max(0, Math.round(dragStartRef.current.panelY + deltaY))

      // Calculate snap-to-grid placeholder position
      const snappedPos = snapToGrid(newX, newY)
      const draggingPanel = panels.find(p => p.id === draggingPanelId)
      if (draggingPanel) {
        setSnapPlaceholder({
          x: snappedPos.x,
          y: snappedPos.y,
          width: draggingPanel.width,
          height: draggingPanel.height,
        })
      }

      setPanels((prev) =>
        prev.map((p) =>
          p.id === draggingPanelId ? { ...p, positionX: newX, positionY: newY } : p
        )
      )

      // Check for auto-scroll at container edges
      // For TOP edge: use PANEL position, not cursor, since cursor is offset from panel's edge
      if (dashboardContainerRef.current) {
        const rect = dashboardContainerRef.current.getBoundingClientRect()
        const scrollTop = dashboardContainerRef.current.scrollTop
        const distFromRight = rect.right - e.clientX
        const distFromBottom = rect.bottom - e.clientY
        const distFromTop = e.clientY - rect.top

        // Check if PANEL is near the visible top edge
        // Panel's visual Y position relative to scroll = newY - scrollTop
        // If this is small AND there's scroll room above (scrollTop > 0), we're near visible top
        const panelVisualY = newY - scrollTop
        const panelNearVisibleTop = scrollTop > 0 && panelVisualY < 50

        if (distFromRight < 60 || distFromBottom < 60 || panelNearVisibleTop) {
          console.log("[DashboardView] Near edge:", {
            clientX: e.clientX,
            clientY: e.clientY,
            panelPosition: { x: newX, y: newY },
            scrollTop,
            panelVisualY,
            containerRect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
            distFromRight,
            distFromBottom,
            distFromTop,
            panelNearVisibleTop,
          })
        }

        // TOP edge: synthesize cursor position if panel is near visible top
        let syntheticY = e.clientY
        if (panelNearVisibleTop && distFromTop > 50) {
          syntheticY = rect.top + 25 // 25px from top edge
          console.log("[DashboardView] Synthesizing top edge position:", { originalY: e.clientY, syntheticY, scrollTop })
        }

        checkAutoScroll(e.clientX, syntheticY)
      } else {
        checkAutoScroll(e.clientX, e.clientY)
      }
    },
    [draggingPanelId, checkAutoScroll, panels]
  )

  const handleDragEnd = useCallback(() => {
    if (draggingPanelId && dragStartRef.current) {
      const panel = panels.find((p) => p.id === draggingPanelId)
      if (panel) {
        // Snap to grid position
        const snappedPos = snapToGrid(panel.positionX, panel.positionY)

        // Update local state with snapped position
        setPanels((prev) =>
          prev.map((p) =>
            p.id === draggingPanelId
              ? { ...p, positionX: snappedPos.x, positionY: snappedPos.y }
              : p
          )
        )

        // Persist snapped position to server
        handlePositionChange(panel.id, snappedPos.x, snappedPos.y)
      }
    }
    setDraggingPanelId(null)
    dragStartRef.current = null
    stopAutoScroll()
    // Reset drag expand buffer after drag ends
    setDragExpandBuffer({ x: 0, y: 0 })
    // Clear snap placeholder
    setSnapPlaceholder(null)
  }, [draggingPanelId, panels, handlePositionChange, stopAutoScroll])

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

  // Phase 5: Keyboard shortcut (Cmd+Shift+D or Ctrl+Shift+D) to toggle dashboard mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+D (Mac) or Ctrl+Shift+D (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        e.stopPropagation()

        void debugLog({
          component: "DashboardView",
          action: "keyboard_shortcut_toggle",
          metadata: { currentViewMode: viewMode, entryId },
        })

        if (viewMode === 'workspace') {
          handleReturnToDashboard()
        } else if (activeWorkspaceId) {
          // Only switch to workspace if one was previously selected
          handleWorkspaceSelectById(activeWorkspaceId)
        } else if (workspaces.length > 0) {
          // Otherwise switch to the default workspace
          const defaultWs = workspaces.find(ws => ws.isDefault) || workspaces[0]
          handleWorkspaceSelectById(defaultWs.id)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, activeWorkspaceId, workspaces, entryId, handleReturnToDashboard, handleWorkspaceSelectById])

  // Phase 5: Subscribe to workspace list refresh events
  // This handles external workspace creation/deletion/rename
  useEffect(() => {
    const unsubscribe = subscribeToWorkspaceListRefresh(() => {
      void debugLog({
        component: "DashboardView",
        action: "workspace_list_refresh_triggered",
        metadata: { entryId },
      })
      refetchWorkspaces()
    })
    return () => unsubscribe()
  }, [entryId, refetchWorkspaces])

  // Chat Navigation Fix 1: Subscribe to active workspace context changes
  // This handles "open workspace" commands from chat navigation
  useEffect(() => {
    const unsubscribe = subscribeToActiveWorkspaceContext((workspaceId) => {
      if (!workspaceId) return

      // Check if workspace is in our list (belongs to this entry)
      const workspaceExists = workspaces.some(ws => ws.id === workspaceId)

      // If in workspace mode and workspace exists, just update activeWorkspaceId
      // This passes to AnnotationAppShell as controlledWorkspaceId
      if (viewMode === 'workspace') {
        if (workspaceExists) {
          void debugLog({
            component: "DashboardView",
            action: "workspace_context_change_in_workspace_mode",
            metadata: { workspaceId, viewMode, activeWorkspaceId },
          })
          // Update the controlled workspace ID for AnnotationAppShell
          if (activeWorkspaceId !== workspaceId) {
            setActiveWorkspaceId(workspaceId)
          }
        } else {
          // Workspace not in this entry - might need to switch entries
          // Store as pending and refetch to see if it appears
          void debugLog({
            component: "DashboardView",
            action: "workspace_context_change_pending_in_workspace_mode",
            metadata: { workspaceId, viewMode, reason: "workspace_not_in_entry" },
          })
          setPendingWorkspaceSwitch(workspaceId)
          refetchWorkspaces()
        }
        return
      }

      // Dashboard mode handling
      if (!workspaceExists) {
        void debugLog({
          component: "DashboardView",
          action: "workspace_context_change_pending",
          metadata: { workspaceId, viewMode, reason: "workspace_not_in_list_yet", availableWorkspaces: workspaces.map(ws => ws.id) },
        })
        // Workspace not in list yet (probably just created) - store pending and refetch
        setPendingWorkspaceSwitch(workspaceId)
        refetchWorkspaces()
        return
      }

      void debugLog({
        component: "DashboardView",
        action: "workspace_context_change_handling",
        metadata: { workspaceId, viewMode, entryId },
      })

      // Switch to workspace mode (auto-sync — not user-meaningful to avoid polluting semantic answers)
      handleWorkspaceSelectById(workspaceId, { isUserMeaningful: false })
    })
    return () => unsubscribe()
  }, [viewMode, workspaces, entryId, activeWorkspaceId, handleWorkspaceSelectById, refetchWorkspaces])

  // Chat Navigation: Handle pending workspace switch after workspaces list updates
  useEffect(() => {
    if (!pendingWorkspaceSwitch) return

    const workspaceExists = workspaces.some(ws => ws.id === pendingWorkspaceSwitch)
    if (workspaceExists) {
      void debugLog({
        component: "DashboardView",
        action: "pending_workspace_switch_resolved",
        metadata: { workspaceId: pendingWorkspaceSwitch, viewMode, entryId },
      })

      const workspaceId = pendingWorkspaceSwitch
      setPendingWorkspaceSwitch(null)
      handleWorkspaceSelectById(workspaceId)
    }
  }, [workspaces, pendingWorkspaceSwitch, viewMode, entryId, handleWorkspaceSelectById])

  // Chat Navigation Fix 2: Listen for chat-navigate-note events
  // This handles "open note X" commands from chat navigation
  // When AnnotationAppShell is not yet mounted (hasVisitedWorkspace === false),
  // we need to handle the event here and pass pendingNoteOpen to the shell
  useEffect(() => {
    const handleChatNavigateNote = (event: CustomEvent<{ noteId: string; workspaceId?: string; entryId?: string }>) => {
      const { noteId, workspaceId } = event.detail

      void debugLog({
        component: "DashboardView",
        action: "chat_navigate_note_received",
        metadata: { noteId, workspaceId, hasVisitedWorkspace, viewMode, entryId },
      })

      if (!noteId) return

      // Determine which workspace to open
      const targetWorkspaceId = workspaceId || activeWorkspaceId || workspaces.find(ws => ws.isDefault)?.id || workspaces[0]?.id
      if (!targetWorkspaceId) {
        void debugLog({
          component: "DashboardView",
          action: "chat_navigate_note_no_workspace",
          metadata: { noteId, workspaceId, availableWorkspaces: workspaces.length },
        })
        return
      }

      // Store the pending note - AnnotationAppShell will open it after mounting
      setPendingNoteOpen({ noteId, workspaceId: targetWorkspaceId })

      // Switch to workspace mode if not already there
      if (viewMode === 'dashboard') {
        handleWorkspaceSelectById(targetWorkspaceId, { source: 'chat' })
      } else if (activeWorkspaceId !== targetWorkspaceId) {
        // Already in workspace mode but different workspace
        handleWorkspaceSelectById(targetWorkspaceId, { source: 'chat' })
      }
    }

    window.addEventListener('chat-navigate-note', handleChatNavigateNote as EventListener)
    return () => {
      window.removeEventListener('chat-navigate-note', handleChatNavigateNote as EventListener)
    }
  }, [viewMode, activeWorkspaceId, workspaces, hasVisitedWorkspace, entryId, handleWorkspaceSelectById])

  // Chat Navigation Fix 3: Listen for chat-navigate-dashboard events
  // This handles "go to dashboard" / "back" commands from chat navigation
  useEffect(() => {
    const handleChatNavigateDashboard = (event: CustomEvent<{ entryId?: string }>) => {
      void debugLog({
        component: "DashboardView",
        action: "chat_navigate_dashboard_received",
        metadata: { eventEntryId: event.detail?.entryId, currentEntryId: entryId, viewMode },
      })

      // Only handle if we're in workspace mode (otherwise already on dashboard)
      if (viewMode === 'workspace') {
        handleReturnToDashboard({ source: 'chat' })
      }
    }

    window.addEventListener('chat-navigate-dashboard', handleChatNavigateDashboard as EventListener)
    return () => {
      window.removeEventListener('chat-navigate-dashboard', handleChatNavigateDashboard as EventListener)
    }
  }, [viewMode, entryId, handleReturnToDashboard])

  // Chat Navigation Fix 4: Listen for chat-navigate-workspace events
  // This handles "open workspace X" commands even when workspace context is unchanged
  // (setActiveWorkspaceContext early-returns on same value, so subscription won't fire)
  useEffect(() => {
    const handleChatNavigateWorkspace = (event: CustomEvent<{ workspaceId: string; workspaceName?: string }>) => {
      const { workspaceId, workspaceName } = event.detail

      void debugLog({
        component: "DashboardView",
        action: "chat_navigate_workspace_received",
        metadata: { workspaceId, workspaceName, viewMode, activeWorkspaceId },
      })

      if (!workspaceId) return

      // Check if workspace belongs to this entry
      const workspaceExists = workspaces.some(ws => ws.id === workspaceId)
      if (!workspaceExists) {
        void debugLog({
          component: "DashboardView",
          action: "chat_navigate_workspace_not_in_entry",
          metadata: { workspaceId, workspaceName, entryId },
        })
        return
      }

      // Switch to workspace (works even if already the active workspace)
      handleWorkspaceSelectById(workspaceId, { source: 'chat' })
    }

    window.addEventListener('chat-navigate-workspace', handleChatNavigateWorkspace as EventListener)
    return () => {
      window.removeEventListener('chat-navigate-workspace', handleChatNavigateWorkspace as EventListener)
    }
  }, [viewMode, activeWorkspaceId, workspaces, entryId, handleWorkspaceSelectById])

  // Phase 5: Detect workspace deletion while viewing
  // If activeWorkspaceId is no longer in the workspaces list, return to dashboard
  useEffect(() => {
    if (viewMode === 'workspace' && activeWorkspaceId) {
      const workspaceStillExists = workspaces.some(ws => ws.id === activeWorkspaceId)
      if (!workspaceStillExists && workspaces.length > 0) {
        // Workspace was deleted while viewing - return to dashboard
        void debugLog({
          component: "DashboardView",
          action: "workspace_deleted_while_viewing",
          metadata: { deletedWorkspaceId: activeWorkspaceId, entryId },
        })
        console.log("[DashboardView] Workspace deleted while viewing, returning to dashboard:", activeWorkspaceId)
        setViewMode('dashboard')
        setActiveWorkspaceId(null)
        onViewModeChange?.('dashboard')
      }
    }
  }, [workspaces, activeWorkspaceId, viewMode, entryId, onViewModeChange])

  // Phase 5: Cleanup mode switch timeout on unmount
  useEffect(() => {
    return () => {
      if (modeSwitchTimeoutRef.current) {
        clearTimeout(modeSwitchTimeoutRef.current)
      }
    }
  }, [])

  // Widget Chat State: Prune stale widget states every 30 seconds
  // Marks entries older than 60s as stale, removes entries older than 5 minutes
  useEffect(() => {
    const PRUNE_INTERVAL_MS = 30_000 // 30 seconds
    const STALE_TTL_MS = 60_000 // 60 seconds (mark as stale)
    const REMOVE_TTL_MS = 300_000 // 5 minutes (remove entirely)

    const intervalId = setInterval(() => {
      const now = Date.now()
      const result = pruneStaleWidgetStates(now, STALE_TTL_MS, REMOVE_TTL_MS)
      if (result.markedStale > 0 || result.removed > 0) {
        void debugLog({
          component: "DashboardView",
          action: "widget_state_pruned",
          metadata: { markedStale: result.markedStale, removed: result.removed },
        })
      }
    }, PRUNE_INTERVAL_MS)

    return () => clearInterval(intervalId)
  }, [])

  // Safety mechanism: Reset isModeSwitching if it's stuck for too long (1 second max)
  useEffect(() => {
    if (!isModeSwitching) return

    const safetyTimeout = setTimeout(() => {
      console.log("[DashboardView] Safety timeout: resetting isModeSwitching")
      void debugLog({
        component: "DashboardView",
        action: "is_mode_switching_set",
        metadata: { value: false, entryId, source: "safety_timeout" },
      })
      setIsModeSwitching(false)
    }, 1000)

    return () => clearTimeout(safetyTimeout)
  }, [isModeSwitching, entryId])

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
    <>
      {/* Glow animation styles for highlighted panels */}
      <style>{`
        @keyframes panelGlow {
          0%, 100% {
            box-shadow: 0 0 20px 4px rgba(99, 102, 241, 0.6),
                        0 0 40px 8px rgba(139, 92, 246, 0.4),
                        inset 0 0 10px 2px rgba(99, 102, 241, 0.1);
          }
          50% {
            box-shadow: 0 0 30px 8px rgba(99, 102, 241, 0.8),
                        0 0 60px 16px rgba(139, 92, 246, 0.5),
                        inset 0 0 15px 4px rgba(99, 102, 241, 0.15);
          }
        }
        .panel-highlight-glow {
          animation: panelGlow 0.8s ease-in-out infinite;
          border-radius: 12px;
        }
      `}</style>
      <div
        className={cn("relative flex flex-col", className)}
        style={{
          // Fixed dimensions for the entire view
          width: '100vw',
          height: '100vh',
          background: '#0a0c10',
          color: '#f0f0f0',
        }}
      >
      {/* Welcome tooltip */}
      {showWelcome && (
        <DashboardWelcomeTooltip onDismiss={markAsSeen} />
      )}

      {/* Dashboard header - OUTSIDE scrollable container so it doesn't scroll horizontally */}
      <div
        className="flex-shrink-0 z-10 px-4 py-1.5 flex items-center justify-between"
        style={{
          background: 'rgba(15, 17, 23, 0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
          {/* Left side: Breadcrumb */}
          <div className="flex items-center gap-2">
            {/* Breadcrumb - shows full ancestor hierarchy */}
            <div className="flex items-center gap-1.5 text-sm">
              <DashboardBreadcrumb
                workspaceId={workspaceId}
                onHomeClick={handleGoHome}
                onEntryClick={(clickedEntryId, dashboardWorkspaceId) => {
                  // Navigate to clicked entry's dashboard
                  if (onNavigate && dashboardWorkspaceId) {
                    onNavigate(clickedEntryId, dashboardWorkspaceId)
                  }
                }}
                onWorkspaceClick={(wsId) => {
                  // If clicking on Dashboard, return to dashboard mode
                  if (wsId === workspaceId) {
                    handleReturnToDashboard()
                  } else {
                    // Navigate to the clicked workspace
                    setActiveWorkspaceId(wsId)
                    setViewMode('workspace')
                  }
                }}
                showHomeIcon={true}
                showLoading={false}
                hideWorkspaceSegment={true}
              />
            </div>

            {/* Pin Entry Button - allows pinning this entry for state preservation */}
            {entryId && (
              <PinEntryButton
                entryId={entryId}
                dashboardWorkspaceId={workspaceId}
                entryName={entryName}
                size="sm"
              />
            )}
          </div>

          {/* Right side: Reset button only (other controls moved to dock) */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetLayout}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                background: 'transparent',
                color: '#8b8fa3',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reset
            </button>
          </div>
        </div>

      {/* Scrollable container - BELOW the fixed header */}
      <div
        ref={dashboardContainerRef}
        className={`flex-1 relative ${viewMode === 'workspace' ? 'overflow-hidden' : 'overflow-auto'}`}
        style={{
          background: '#0a0c10',
        }}
      >
        {/* Context Indicator - shows current view (Dashboard or Workspace name) */}
        {/* Subtle, centered, fades on hover, doesn't block interactions */}
        <div
          className="absolute top-2 left-0 right-0 flex justify-center pointer-events-none z-10 transition-opacity duration-200 hover:opacity-0"
          style={{ pointerEvents: 'none' }}
        >
          <span
            className="text-xs font-medium transition-opacity duration-200"
            style={{
              color: 'rgba(255, 255, 255, 0.35)',
              pointerEvents: 'auto',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
          >
            {viewMode === 'dashboard'
              ? 'Dashboard'
              : (workspaces.find(ws => ws.id === activeWorkspaceId)?.name || 'Workspace')
            }
          </span>
        </div>
        {/* Canvas surface with grid pattern - dynamically sized based on panel positions */}
        <div
          style={{
            // Dynamic sizing: expands to fit panels + buffer, plus extra when dragging
            minWidth: canvasDimensions.width + dragExpandBuffer.x,
            minHeight: canvasDimensions.height + dragExpandBuffer.y,
            background: `
              radial-gradient(circle at 400px 300px, rgba(99, 102, 241, 0.04) 0%, transparent 50%),
              linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px),
              #0a0c10
            `,
            backgroundSize: '100% 100%, 20px 20px, 20px 20px, 100% 100%',
          }}
        >

        {/*
          Content area - Option C: Layered/Preserved State
          Both dashboard and workspace are rendered, but only one is visible.
          This preserves workspace state when switching back to dashboard.
          Phase 5: Added smooth transitions and loading overlay.
        */}

        {/* Phase 5: Mode switching loading overlay */}
        {/* Note: pointer-events: none prevents this overlay from blocking interactions if it gets stuck */}
        {isModeSwitching && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(10, 12, 16, 0.5)',
              backdropFilter: 'blur(4px)',
              animation: 'fadeIn 150ms ease-out',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Loader2
                size={24}
                style={{
                  color: '#818cf8',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <span style={{ color: '#8b8fa3', fontSize: 13 }}>
                {viewMode === 'workspace' ? 'Loading workspace...' : 'Returning to dashboard...'}
              </span>
            </div>
          </div>
        )}

        {/* Dashboard panels canvas - hidden when in workspace mode */}
        {/* Phase 5: Using opacity + pointer-events for smoother transition */}
        {/* Canvas grows dynamically based on panel positions for unlimited scrolling */}
        <div
          ref={canvasRef}
          className="relative"
          style={{
            // Use calculated dimensions instead of fixed height
            minWidth: canvasDimensions.width + dragExpandBuffer.x,
            minHeight: canvasDimensions.height + dragExpandBuffer.y,
            padding: 24,
            opacity: viewMode === 'dashboard' ? 1 : 0,
            pointerEvents: viewMode === 'dashboard' ? 'auto' : 'none',
            transition: 'opacity 200ms ease-in-out',
            position: viewMode === 'dashboard' ? 'relative' : 'absolute',
            visibility: viewMode === 'dashboard' ? 'visible' : 'hidden',
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
              {/* Grid overlay - shows during drag */}
              {draggingPanelId && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    pointerEvents: 'none',
                    zIndex: 1,
                    backgroundImage: `
                      linear-gradient(to right, rgba(99, 102, 241, 0.1) 1px, transparent 1px),
                      linear-gradient(to bottom, rgba(99, 102, 241, 0.1) 1px, transparent 1px)
                    `,
                    backgroundSize: `${GRID_CELL_SIZE}px ${GRID_CELL_SIZE}px`,
                    backgroundPosition: `${GRID_OFFSET}px ${GRID_OFFSET}px`,
                    opacity: 0.6,
                    transition: 'opacity 150ms ease-out',
                  }}
                />
              )}

              {/* Snap placeholder - shows where panel will snap to */}
              {snapPlaceholder && draggingPanelId && (
                <div
                  style={{
                    position: 'absolute',
                    left: snapPlaceholder.x,
                    top: snapPlaceholder.y,
                    width: snapPlaceholder.width,
                    height: snapPlaceholder.height,
                    borderRadius: 12,
                    border: '2px dashed rgba(99, 102, 241, 0.6)',
                    background: 'rgba(99, 102, 241, 0.08)',
                    pointerEvents: 'none',
                    zIndex: 2,
                    transition: 'all 100ms ease-out',
                    boxShadow: '0 0 20px rgba(99, 102, 241, 0.2)',
                  }}
                />
              )}

              {panels.map((panel) => (
                <div
                  key={panel.id}
                  data-panel-id={panel.id}
                  className={highlightedPanelId === panel.id ? 'panel-highlight-glow' : ''}
                  style={{
                    position: 'absolute',
                    left: panel.positionX,
                    top: panel.positionY,
                    width: panel.width,
                    height: panel.height,
                    zIndex: highlightedPanelId === panel.id ? 9999 : panel.zIndex,
                    cursor: draggingPanelId === panel.id ? 'grabbing' : 'default',
                  }}
                  onClick={() => setActivePanelId(panel.id)}
                >
                  {/* Widget Architecture: Render widget with drag via onMouseDown */}
                  <DashboardWidgetRenderer
                    panel={panel}
                    onDoubleClick={handleWidgetDoubleClick}
                    isActive={activePanelId === panel.id}
                    onMouseDown={(e) => handleDragStart(e, panel)}
                    onConfigChange={(config) => handleConfigChange(panel.id, config)}
                    allPanels={panels}
                    activePanelId={activePanelId}
                    onFocusPanel={setActivePanelId}
                    onClosePanel={handlePanelClose}
                  />
                  {/* Size picker button - positioned at lower-right corner */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 8,
                      right: 8,
                      zIndex: 10,
                    }}
                  >
                    <PanelSizePicker
                      currentWidth={panel.width}
                      currentHeight={panel.height}
                      onSizeChange={(_, width, height) => handleSizeChange(panel.id, width, height)}
                      disabled={draggingPanelId === panel.id}
                    />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/*
          Workspace canvas - Lazy mounted after first visit, hidden when in dashboard mode.
          Uses isHidden prop to suppress portal rendering when hidden (prevents portal bypass).
          hideHomeButton and hideWorkspaceToggle since DashboardView provides those.
          Phase 5: Added smooth transitions.
        */}
        {hasVisitedWorkspace && (
          <div
            style={{
              position: 'absolute',
              top: 0, // Header is now outside the scrollable container
              left: 0,
              right: 0,
              bottom: 0,
              opacity: viewMode === 'workspace' ? 1 : 0,
              pointerEvents: viewMode === 'workspace' ? 'auto' : 'none',
              transition: 'opacity 200ms ease-in-out',
              visibility: viewMode === 'workspace' ? 'visible' : 'hidden',
              // Also use display:none when hidden to completely remove from layout
              // and prevent any potential CSS stacking issues
              display: viewMode === 'workspace' ? 'block' : 'none',
            }}
          >
            {/* DEBUG: trace activeWorkspaceId prop */}
            {void debugLog({
              component: "DashboardView",
              action: "render_annotation_app_shell",
              metadata: { activeWorkspaceId, viewMode },
            })}
            <AnnotationAppShell
              isHidden={viewMode !== 'workspace'}
              hideHomeButton
              hideWorkspaceToggle
              toolbarTopOffset={56}
              controlledWorkspaceId={activeWorkspaceId ?? undefined}
              pinnedWorkspaceIds={pinnedWorkspaceIds}
              isEntryActive={isEntryActive}
              onReturnToDashboard={handleReturnToDashboard}
              onWorkspaceChange={handleWorkspaceChangeFromCanvas}
              pendingNoteOpen={pendingNoteOpen}
              onPendingNoteHandled={() => setPendingNoteOpen(null)}
            />
          </div>
        )}
        </div>
        {/* End of canvas surface */}
      </div>
      {/* End of scrollable container */}

      {/* Dashboard Dock - iOS Control Center style (only shown in dashboard mode) */}
      {viewMode === 'dashboard' && (
        <>
          <DashboardDock
            onWorkspaceClick={() => setWorkspaceMenuOpen(prev => !prev)}
            isWorkspacePanelOpen={workspaceMenuOpen}
            currentWorkspaceName={workspaces.find(ws => ws.isDefault)?.name || "Workspace"}
            workspaceCount={workspaces.length}
            onAddPanelClick={() => setIsPanelCatalogOpen(prev => !prev)}
            addPanelDisabled={isWorkspacesLoading}
            currentEntryId={entryId}
            currentWorkspaceId={activeWorkspaceId ?? undefined}
          />

          {/* Workspace Sidebar - slides in from right when workspace button clicked */}
          {/* Backdrop - subtle dim without blur (panel has its own backdrop-blur) */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.2)',
              zIndex: 99997,
              opacity: workspaceMenuOpen ? 1 : 0,
              pointerEvents: workspaceMenuOpen ? 'auto' : 'none',
              transition: 'opacity 200ms ease-out',
            }}
            onClick={() => setWorkspaceMenuOpen(false)}
          />
          {/* Sidebar Panel */}
          <div
            ref={workspacePanelRef}
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 320,
              borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.4)',
              zIndex: 99998,
              transform: workspaceMenuOpen ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 250ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <WorkspaceToggleMenu
              hideHeader
              sidebarMode
              labelTitle="NOTE WORKSPACE"
              statusLabel={workspaces.find(ws => ws.isDefault)?.name || "Workspace"}
              isOpen={workspaceMenuOpen}
              onToggleMenu={() => setWorkspaceMenuOpen(prev => !prev)}
              onCreateWorkspace={handleCreateWorkspace}
              disableCreate={isWorkspacesLoading}
              isListLoading={isWorkspacesLoading}
              workspaces={workspaces}
              currentWorkspaceId={null}
              deletingWorkspaceId={deletingWorkspaceId}
              onSelectWorkspace={handleWorkspaceSelectById}
              onDeleteWorkspace={handleDeleteWorkspace}
              onRenameWorkspace={handleRenameWorkspace}
              entryId={entryId}
              entryName={entryName}
            />
          </div>

          {/* Panel Catalog - appears above dock when add panel button clicked */}
          {isPanelCatalogOpen && (
            <div
              data-panel-catalog
              style={{
                position: 'fixed',
                bottom: 100,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 99998,
              }}
            >
              <PanelCatalog
                workspaceId={workspaceId}
                onPanelAdded={() => {
                  fetchPanels()
                  setIsPanelCatalogOpen(false)
                }}
                onClose={() => setIsPanelCatalogOpen(false)}
              />
            </div>
          )}

          {/* Widget Architecture: Full Panel Drawer */}
          <FullPanelDrawer
            isOpen={isDrawerOpen}
            onClose={handleDrawerClose}
            panel={drawerPanel}
            onConfigChange={(panelId, config) => handleConfigChange(panelId, config)}
            onTitleChange={(panelId, newTitle) => handleTitleChange(panelId, newTitle)}
            onNavigate={onNavigate}
            onOpenWorkspace={handleWorkspaceSelectById}
            onDelete={(panelId) => handlePanelDelete(panelId)}
          />
        </>
      )}
    </div>
    </>
  )
}
