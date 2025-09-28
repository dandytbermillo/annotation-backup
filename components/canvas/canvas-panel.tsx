"use client"

import { useRef, useState, useEffect, useReducer, useCallback, useLayoutEffect } from "react"
import { useCanvas } from "./canvas-context"
import type { Branch } from "@/types/canvas"
import dynamic from 'next/dynamic'
import TiptapEditorPlain, { TiptapEditorPlainHandle } from "./tiptap-editor-plain"
import type { TiptapEditorHandle } from './tiptap-editor-collab'
import type * as Y from 'yjs'
import { EditorToolbar } from "./editor-toolbar"
import { FormatToolbar } from "./format-toolbar"
import { v4 as uuidv4 } from "uuid"
import { createAnnotationBranch } from "@/lib/models/annotation"
import { getPlainProvider } from "@/lib/provider-switcher"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { isPlainModeActive } from "@/lib/collab-mode"
import type { PlainOfflineProvider, ProseMirrorJSON } from "@/lib/providers/plain-offline-provider"
import type { CollapsibleSelectionSnapshot } from "@/lib/extensions/collapsible-block-selection"
import { useLayer } from "@/components/canvas/layer-provider"
import { useAutoScroll } from "./use-auto-scroll"
import { useIsolation, useRegisterWithIsolation } from "@/lib/isolation/context"
import { Z_INDEX } from "@/lib/constants/z-index"
import { useCanvasCamera } from "@/lib/hooks/use-canvas-camera"
import { useLayerManager, useCanvasNode } from "@/lib/hooks/use-layer-manager"
import { Z_INDEX_BANDS } from "@/lib/canvas/canvas-node"
import { buildBranchPreview } from "@/lib/utils/branch-preview"

const TiptapEditorCollab = dynamic(() => import('./tiptap-editor-collab'), { ssr: false })

// Track which panel is currently being dragged globally
let globalDraggingPanelId: string | null = null

const HEADER_BUTTON_HOVER_DELAY_MS = 300

interface CanvasPanelProps {
  panelId: string
  branch: Branch
  position: { x: number; y: number }
  onClose?: () => void
  noteId?: string
}

export function CanvasPanel({ panelId, branch, position, onClose, noteId }: CanvasPanelProps) {
  const { dispatch, state, dataStore, noteId: contextNoteId } = useCanvas()
  type UnifiedEditorHandle = TiptapEditorHandle | TiptapEditorPlainHandle
  const editorRef = useRef<UnifiedEditorHandle | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  
  // Layer management integration
  const layerManager = useLayerManager()
  const layerBandInfo = layerManager.getLayerBandInfo(panelId)
  const { node: canvasNode } = useCanvasNode(panelId, 'panel', position)
  
  // State to track render position and prevent snap-back during drag
  const [renderPosition, setRenderPosition] = useState(position)
  
  // Sidebar toggle state - must be declared early before useEffects that use it
  const [isSidebarVisible, setIsSidebarVisible] = useState(false)
  const [isSidebarHovering, setIsSidebarHovering] = useState(false)
  const sidebarTimeoutRef = useRef<NodeJS.Timeout>()
  const sidebarShowTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Annotation actions toggle state
  const [isActionsVisible, setIsActionsVisible] = useState(false)
  const [isActionsHovering, setIsActionsHovering] = useState(false)
  const actionsTimeoutRef = useRef<NodeJS.Timeout>()
  const actionsShowTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Panel hover state for hiding/showing buttons
  const [isPanelHovered, setIsPanelHovered] = useState(false)
  const panelHoverShowTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const panelHoverHideTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const [panelHeight, setPanelHeight] = useState<number>(500)
  const previousPanelHeightRef = useRef<number>(500)
  const [isPanelHeightExpanded, setIsPanelHeightExpanded] = useState(false)
  const cameraZoomRef = useRef<number>(1)

  const headerControlsActive = isPanelHovered || isSidebarVisible || isActionsVisible || isSidebarHovering || isActionsHovering
  
  // Branch preview state
  const [previewBranchId, setPreviewBranchId] = useState<string | null>(null)
  const previewTimeoutRef = useRef<NodeJS.Timeout>()
  const [collapsibleSelection, setCollapsibleSelection] = useState<CollapsibleSelectionSnapshot | null>(null)
  const handleCollapsibleSelectionChange = useCallback((snapshot: CollapsibleSelectionSnapshot) => {
    if (snapshot.mode === 'none') {
      setCollapsibleSelection(null)
      return
    }
    setCollapsibleSelection(snapshot)
  }, [])

  const getViewportFillHeight = useCallback((top: number) => {
    if (typeof window === 'undefined') {
      return previousPanelHeightRef.current
    }
    const viewportHeight = window.innerHeight
    const marginBottom = 8
    const screenAvailable = viewportHeight - Math.max(top, 0) - marginBottom
    const safeZoom = cameraZoomRef.current || 1
    const worldHeight = screenAvailable / safeZoom
    return Math.max(worldHeight, 320)
  }, [])

  const getCurrentPanelTop = useCallback(() => {
    if (panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect()
      return rect.top
    }
    return renderPosition.y
  }, [renderPosition.y])

  // Header action overflow management
  const ACTION_GAP = 8
  const actionsContainerRef = useRef<HTMLDivElement | null>(null)
  const formatActionRef = useRef<HTMLDivElement | null>(null)
  const overflowButtonRef = useRef<HTMLButtonElement | null>(null)
  const actionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const actionWidthsRef = useRef<Record<string, number>>({})
  const [hiddenActionIds, setHiddenActionIds] = useState<string[]>([])
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false)

  const registerActionRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    actionRefs.current[id] = el
  }, [])

  const closeOverflowMenu = useCallback(() => {
    setIsOverflowMenuOpen(false)
  }, [])

  const handleBranchesButtonClick = useCallback((event?: React.MouseEvent<HTMLElement>) => {
    event?.stopPropagation()
    if (sidebarShowTimeoutRef.current) {
      clearTimeout(sidebarShowTimeoutRef.current)
      sidebarShowTimeoutRef.current = null
    }

    if (isSidebarVisible) {
      setIsSidebarVisible(false)
      setIsSidebarHovering(false)
    } else {
      setIsSidebarVisible(true)
      setIsSidebarHovering(true)
    }

    closeOverflowMenu()
  }, [closeOverflowMenu, isSidebarVisible])

  const handleBranchesButtonMouseEnter = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.background = 'rgba(255,255,255,0.3)'
    if (sidebarTimeoutRef.current) {
      clearTimeout(sidebarTimeoutRef.current)
    }
    if (sidebarShowTimeoutRef.current) {
      clearTimeout(sidebarShowTimeoutRef.current)
      sidebarShowTimeoutRef.current = null
    }
    sidebarShowTimeoutRef.current = setTimeout(() => {
      setIsSidebarHovering(true)
      setIsSidebarVisible(true)
      sidebarShowTimeoutRef.current = null
    }, HEADER_BUTTON_HOVER_DELAY_MS)
  }, [])

  const handleBranchesButtonMouseLeave = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.background = 'rgba(255,255,255,0.2)'
    if (sidebarShowTimeoutRef.current) {
      clearTimeout(sidebarShowTimeoutRef.current)
      sidebarShowTimeoutRef.current = null
    }
    sidebarTimeoutRef.current = setTimeout(() => {
      setIsSidebarHovering(false)
      setIsSidebarVisible(false)
    }, HEADER_BUTTON_HOVER_DELAY_MS)
  }, [])

  const positionAnnotationToolbar = useCallback((target: HTMLElement) => {
    const toolbar = document.getElementById("annotation-toolbar")
    if (!toolbar) return

    const rect = target.getBoundingClientRect()
    toolbar.style.position = "fixed"
    toolbar.style.left = `${rect.left + rect.width / 2}px`
    toolbar.style.top = `${rect.bottom + 8}px`
    toolbar.style.opacity = "1"
    toolbar.style.pointerEvents = "auto"
    toolbar.classList.add("visible")
  }, [])

  const hideAnnotationToolbar = useCallback(() => {
    const toolbar = document.getElementById("annotation-toolbar")
    if (!toolbar) return
    toolbar.style.opacity = "0"
    toolbar.style.pointerEvents = "none"
    toolbar.classList.remove("visible")
  }, [])

  const handleActionsButtonClick = useCallback((event?: React.MouseEvent<HTMLElement>) => {
    event?.stopPropagation()

    if (actionsShowTimeoutRef.current) {
      clearTimeout(actionsShowTimeoutRef.current)
      actionsShowTimeoutRef.current = null
    }

    const target = (event?.currentTarget as HTMLElement) ?? overflowButtonRef.current ?? null

    const nextVisible = !isActionsVisible
    setIsActionsVisible(nextVisible)
    setIsActionsHovering(false)

    if (nextVisible && target) {
      positionAnnotationToolbar(target)
    } else if (!nextVisible) {
      hideAnnotationToolbar()
    }

    closeOverflowMenu()
  }, [closeOverflowMenu, hideAnnotationToolbar, isActionsVisible, positionAnnotationToolbar])

  const handleActionsButtonMouseEnter = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.background = "rgba(255,255,255,0.3)"
    if (actionsTimeoutRef.current) {
      clearTimeout(actionsTimeoutRef.current)
    }
    if (actionsShowTimeoutRef.current) {
      clearTimeout(actionsShowTimeoutRef.current)
      actionsShowTimeoutRef.current = null
    }

    const buttonEl = event.currentTarget

    const showToolbar = (target: HTMLButtonElement) => {
      setIsActionsHovering(true)
      positionAnnotationToolbar(target)
    }

    if (isActionsVisible || isActionsHovering) {
      showToolbar(buttonEl)
      return
    }

    actionsShowTimeoutRef.current = setTimeout(() => {
      showToolbar(buttonEl)
      actionsShowTimeoutRef.current = null
    }, HEADER_BUTTON_HOVER_DELAY_MS)
  }, [isActionsHovering, isActionsVisible, positionAnnotationToolbar])

  const handleActionsButtonMouseLeave = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.background = "rgba(255,255,255,0.2)"
    if (actionsShowTimeoutRef.current) {
      clearTimeout(actionsShowTimeoutRef.current)
      actionsShowTimeoutRef.current = null
    }
    actionsTimeoutRef.current = setTimeout(() => {
      setIsActionsHovering(false)
      const toolbar = document.getElementById("annotation-toolbar")
      if (toolbar && !toolbar.matches(':hover')) {
        hideAnnotationToolbar()
      }
    }, HEADER_BUTTON_HOVER_DELAY_MS)
  }, [hideAnnotationToolbar])

  const handleTogglePanelHeight = useCallback(() => {
    if (isPanelHeightExpanded) {
      setPanelHeight(previousPanelHeightRef.current)
      setIsPanelHeightExpanded(false)
      return
    }

    previousPanelHeightRef.current = panelHeight
    const panelTop = getCurrentPanelTop()
    const expandedHeight = getViewportFillHeight(panelTop)
    setPanelHeight(expandedHeight)
    setIsPanelHeightExpanded(true)
  }, [getCurrentPanelTop, getViewportFillHeight, isPanelHeightExpanded, panelHeight])

  const recalcOverflow = useCallback(() => {
    const container = actionsContainerRef.current
    if (!container) {
      return
    }

    const containerWidth = container.getBoundingClientRect().width
    if (!containerWidth) {
      if (hiddenActionIds.length > 0) {
        setHiddenActionIds([])
      }
      return
    }

    const overflowWidth = overflowButtonRef.current?.getBoundingClientRect().width ?? 36
    const measuredFormatWidth = formatActionRef.current?.getBoundingClientRect().width ?? 0
    const storedFormatWidth = actionWidthsRef.current.format ?? 0
    const formatWidth = measuredFormatWidth > 0 ? measuredFormatWidth : storedFormatWidth
    if (measuredFormatWidth > 0) {
      actionWidthsRef.current.format = measuredFormatWidth
    }

    const order = layerManager.isEnabled
      ? ['bringToFront', 'sendToBack', 'resizeToggle', 'branches', 'actions']
      : ['resizeToggle', 'branches', 'actions']

    const widthMap: Record<string, number> = {}
    order.forEach((id) => {
      const element = actionRefs.current[id]
      const measured = element?.getBoundingClientRect().width ?? 0
      const stored = actionWidthsRef.current[id] ?? 0
      const width = measured > 0 ? measured : stored
      if (width > 0) {
        widthMap[id] = width
        if (measured > 0) {
          actionWidthsRef.current[id] = measured
        }
      }
    })

    const availableIds = order.filter((id) => widthMap[id] !== undefined)
    let visibleIds: string[] = []
    let hiddenIds: string[] = []
    let usedWidth = formatWidth
    let visibleCount = formatWidth > 0 ? 1 : 0

    availableIds.forEach((id) => {
      const width = widthMap[id] ?? 0
      if (width === 0) {
        return
      }
      const gapBefore = visibleCount > 0 ? ACTION_GAP : 0
      if (usedWidth + gapBefore + width <= containerWidth) {
        visibleIds.push(id)
        usedWidth += gapBefore + width
        visibleCount += 1
      } else {
        hiddenIds.push(id)
      }
    })

    if (hiddenIds.length > 0) {
      const computeUsage = (ids: string[]) => {
        let width = formatWidth
        let count = formatWidth > 0 ? 1 : 0
        ids.forEach((id) => {
          const w = widthMap[id] ?? 0
          if (w === 0) {
            return
          }
          width += (count > 0 ? ACTION_GAP : 0) + w
          count += 1
        })
        return { width, count }
      }

      let { width: recomputedWidth, count } = computeUsage(visibleIds)
      while (
        visibleIds.length > 0 &&
        recomputedWidth + (count > 0 ? ACTION_GAP : 0) + overflowWidth > containerWidth
      ) {
        const removed = visibleIds.pop()
        if (!removed) {
          break
        }
        hiddenIds.unshift(removed)
        const recalculated = computeUsage(visibleIds)
        recomputedWidth = recalculated.width
        count = recalculated.count
      }
    }

    const arraysEqual = (a: string[], b: string[]) => {
      if (a.length !== b.length) {
        return false
      }
      return a.every((value, index) => value === b[index])
    }

    if (!arraysEqual(hiddenActionIds, hiddenIds)) {
      setHiddenActionIds(hiddenIds)
    }

    if (hiddenIds.length === 0 && isOverflowMenuOpen) {
      setIsOverflowMenuOpen(false)
    }
  }, [ACTION_GAP, hiddenActionIds, isOverflowMenuOpen, layerManager.isEnabled])
  
  // Update render position when position prop changes (but not during drag)
  const dragStateRef = useRef<any>(null) // Will be set to dragState later
  useEffect(() => {
    if (!dragStateRef.current?.isDragging) {
      // Use LayerManager position if available, otherwise fall back to prop
      const nodePosition = canvasNode?.position ?? position
      setRenderPosition(nodePosition)
    }
  }, [position, canvasNode?.position])
  
  // Camera-based panning
  const {
    panCameraBy,
    resetPanAccumulation,
    getPanAccumulation,
    isCameraEnabled,
    getCameraState,
  } = useCanvasCamera()

  cameraZoomRef.current = getCameraState().zoom || 1
  
  // Isolation system integration
  const { isIsolated, level, placeholder } = useIsolation(panelId)
  // Register panel with isolation manager - mark 'main' as 'critical' so it is never auto-isolated
  useRegisterWithIsolation(panelId, panelRef as any, panelId === 'main' ? 'critical' : 'normal', 'panel')
  
  // Multi-layer canvas context
  const multiLayerEnabled = true
  const layerContext = useLayer()
  
  // Use refs to avoid stale closures in event handlers
  const multiLayerEnabledRef = useRef(multiLayerEnabled)
  const layerContextRef = useRef(layerContext)
  
  // Update refs when values change
  useEffect(() => {
    multiLayerEnabledRef.current = multiLayerEnabled
    layerContextRef.current = layerContext
  }, [multiLayerEnabled, layerContext])
  
  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (sidebarTimeoutRef.current) {
        clearTimeout(sidebarTimeoutRef.current)
      }
      if (sidebarShowTimeoutRef.current) {
        clearTimeout(sidebarShowTimeoutRef.current)
        sidebarShowTimeoutRef.current = null
      }
      if (actionsTimeoutRef.current) {
        clearTimeout(actionsTimeoutRef.current)
      }
      if (actionsShowTimeoutRef.current) {
        clearTimeout(actionsShowTimeoutRef.current)
        actionsShowTimeoutRef.current = null
      }
      if (panelHoverShowTimeoutRef.current) {
        clearTimeout(panelHoverShowTimeoutRef.current)
        panelHoverShowTimeoutRef.current = null
      }
      if (panelHoverHideTimeoutRef.current) {
        clearTimeout(panelHoverHideTimeoutRef.current)
        panelHoverHideTimeoutRef.current = null
      }
    }
  }, [])
  
  // Handle clicking outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      
      // Close sidebar if clicking outside of it
      if (isSidebarHovering || isSidebarVisible) {
        const sidebar = document.getElementById(`branches-sidebar-${panelId}`)
        const button = document.getElementById(`branches-button-${panelId}`)
        
        if (sidebar && !sidebar.contains(target) && button && !button.contains(target)) {
          setIsSidebarHovering(false)
          setIsSidebarVisible(false)
          if (sidebarTimeoutRef.current) {
            clearTimeout(sidebarTimeoutRef.current)
          }
        }
      }
      
      // Close actions panel if clicking outside of it
      if (isActionsHovering || isActionsVisible) {
        const actions = document.getElementById(`actions-panel-${panelId}`)
        const button = document.getElementById(`actions-button-${panelId}`)
        
        if (actions && !actions.contains(target) && button && !button.contains(target)) {
          setIsActionsHovering(false)
          setIsActionsVisible(false)
          if (actionsTimeoutRef.current) {
            clearTimeout(actionsTimeoutRef.current)
          }
        }
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isSidebarHovering, isSidebarVisible, isActionsHovering, isActionsVisible, panelId])
  
  useLayoutEffect(() => {
    recalcOverflow()
  }, [recalcOverflow])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const container = actionsContainerRef.current
    if (!container) {
      return
    }
    const observer = new ResizeObserver(() => {
      recalcOverflow()
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
    }
  }, [recalcOverflow])

  useEffect(() => {
    if (!isOverflowMenuOpen) {
      return
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (!actionsContainerRef.current?.contains(target)) {
        setIsOverflowMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOverflowMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOverflowMenuOpen])

  // Determine Option A (plain) vs collaboration mode as early as possible
  const isPlainMode = isPlainModeActive()
  
  // Check if content is empty to auto-enable edit mode
  const isContentEmpty = () => {
    if (!branch.content) return true
    
    // Check for empty string
    if (branch.content === '') return true
    
    // Check for empty HTML content
    if (typeof branch.content === 'string') {
      const stripped = branch.content.replace(/<[^>]*>/g, '').trim()
      if (stripped.length === 0) return true
      
      // Also check for just placeholder paragraphs
      if (stripped === 'Start writing your document here...' || 
          stripped === 'Start typing...' ||
          stripped.match(/^Start writing your (note|explore|promote)\.{0,3}$/)) {
        return true
      }
    }
    
    // Check for empty ProseMirror JSON
    if (typeof branch.content === 'object' && branch.content.content) {
      const jsonStr = JSON.stringify(branch.content)
      // Check if has any actual text content
      if (!jsonStr.includes('"text"')) return true
      
      // Check if only has empty paragraph
      if (branch.content.content.length === 1 && 
          branch.content.content[0].type === 'paragraph' &&
          (!branch.content.content[0].content || branch.content.content[0].content.length === 0)) {
        return true
      }
    }
    
    return false
  }
  
  // Edit mode state - now respects layer state
  const [isEditing, setIsEditing] = useState(true)
  
  // Use LayerManager z-index as single source of truth
  // Default to base z-index if node not yet registered
  const zIndex = canvasNode?.zIndex ?? Z_INDEX.CANVAS_NODE_BASE
  
  // Compute whether the editor should be editable based on layer state
  const isLayerInteractive = !multiLayerEnabled || !layerContext || layerContext.activeLayer === 'notes'
  const isLayerInteractiveRef = useRef(isLayerInteractive)
  useEffect(() => {
    isLayerInteractiveRef.current = isLayerInteractive
    if (!isLayerInteractive && typeof window !== 'undefined') {
      const activeElement = document.activeElement as HTMLElement | null
      if (activeElement?.closest('.ProseMirror')) {
        activeElement.blur()
      }
    }
  }, [isLayerInteractive])

  const actuallyEditable = isEditing
  const [activeFilter, setActiveFilter] = useState<'all' | 'note' | 'explore' | 'promote'>('all')
  const [lastBranchUpdate, setLastBranchUpdate] = useState(Date.now())
  const forceUpdate = useReducer(() => ({}), {})[1]
  const [isContentLoading, setIsContentLoading] = useState(true)
  const [plainProvider, setPlainProvider] = useState<PlainOfflineProvider | null>(null)
  const postLoadEditApplied = useRef(false)
  
  // Use noteId from props or context
  const currentNoteId = noteId || contextNoteId
  
  // Blur editor when switching to popup layer
  // Simplified drag state - no RAF accumulation
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialPosition: { x: 0, y: 0 }
  })
  
  // Link dragStateRef to dragState for the useEffect above
  dragStateRef.current = dragState.current
  
  // Auto-scroll functionality for panel dragging
  const handleAutoScroll = useCallback((deltaX: number, deltaY: number) => {
    if (!dragState.current.isDragging) return
    
    if (isCameraEnabled) {
      // Use camera-based panning (pan opposite to pointer delta)
      panCameraBy({ dxScreen: -deltaX, dyScreen: -deltaY })
      
      // Keep the dragged panel aligned with the pointer in screen space
      dragState.current.initialPosition.x -= deltaX
      dragState.current.initialPosition.y -= deltaY
    } else {
      // Legacy: Move ALL panels to simulate canvas panning
      const allPanels = document.querySelectorAll('[data-panel-id]')
      allPanels.forEach(panel => {
        const panelEl = panel as HTMLElement
        
        if (panelEl.id === `panel-${panelId}` && dragState.current.isDragging) {
          // For the dragging panel, update its initial position
          dragState.current.initialPosition.x += deltaX
          dragState.current.initialPosition.y += deltaY
        } else {
          // For other panels, update their actual position
          const currentLeft = parseInt(panelEl.style.left || '0', 10)
          const currentTop = parseInt(panelEl.style.top || '0', 10)
          panelEl.style.left = (currentLeft + deltaX) + 'px'
          panelEl.style.top = (currentTop + deltaY) + 'px'
        }
      })
    }
  }, [panelId, isCameraEnabled, panCameraBy])
  
  const { checkAutoScroll, stopAutoScroll } = useAutoScroll({
    enabled: true,
    threshold: 80,
    speed: 8,
    onScroll: handleAutoScroll
  })

  // Get appropriate provider based on mode
  const [ydocState, setYdocState] = useState<{ loading: boolean; doc: Y.Doc | null; error: Error | null }>(
    { loading: false, doc: null, error: null }
  )
  const provider = UnifiedProvider.getInstance()
  
  // Load plain provider when in plain mode
  useEffect(() => {
    if (isPlainMode) {
      // Poll for plain provider initialization
      const checkProvider = () => {
        const { getPlainProvider } = require('@/lib/provider-switcher')
        const provider = getPlainProvider()
        if (provider) {
          console.log('[CanvasPanel] Plain provider initialized')
          setPlainProvider(provider)
        } else {
          // Retry after a short delay
          setTimeout(checkProvider, 100)
        }
      }
      checkProvider()
    }
  }, [isPlainMode])
  
  // Lazy-load Y.Doc only in Yjs mode
  useEffect(() => {
    let cancelled = false
    if (!isPlainMode) {
      setYdocState(s => ({ ...s, loading: true, error: null }))
      import('@/lib/lazy-yjs')
        .then(({ loadYjsProvider }) => loadYjsProvider())
        .then((yjsProvider) => {
          if (cancelled) return
          if (yjsProvider?.getEditorYDoc) {
            const doc = yjsProvider.getEditorYDoc(panelId, currentNoteId)
            setYdocState({ loading: false, doc, error: null })
          } else {
            setYdocState({ loading: false, doc: null, error: new Error('getEditorYDoc unavailable') })
          }
        })
        .catch((e: any) => {
          if (cancelled) return
          setYdocState({ loading: false, doc: null, error: e instanceof Error ? e : new Error('Failed to load Yjs') })
        })
    } else {
      setYdocState({ loading: false, doc: null, error: null })
    }
    return () => { cancelled = true }
  }, [isPlainMode, panelId, currentNoteId])
  
  // Set the current note context if provided
  useEffect(() => {
    if (currentNoteId) {
      provider.setCurrentNote(currentNoteId)
    }
  }, [currentNoteId])
  
  // Wait for content to load (Y.Doc for Yjs mode, or skip for plain mode)
  useEffect(() => {
    if (isPlainMode) {
      // Plain mode doesn't need to wait for Y.Doc loading
      setIsContentLoading(false)
      return
    }
    
    // Reset loading state when note/panel changes
    setIsContentLoading(true)
    
    const checkDocLoading = async () => {
      const { docLoadingStates } = await import('@/lib/yjs-utils')
      const cacheKey = currentNoteId ? `${currentNoteId}-${panelId}` : panelId
      
      // Check if doc is loading
      const loadingPromise = docLoadingStates.get(cacheKey)
      if (loadingPromise) {
        // Wait for loading to complete
        await loadingPromise
      }
      
      // Content is loaded, allow rendering
      setIsContentLoading(false)
    }
    
    checkDocLoading()
  }, [currentNoteId, panelId, isPlainMode])
  
  // Ensure panel position is set on mount
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.style.left = position.x + 'px'
      panelRef.current.style.top = position.y + 'px'
    }
  }, [])

  const cameraZoom = state.canvasState?.zoom || 1

  useEffect(() => {
    if (!isPanelHeightExpanded) {
      return
    }
    if (dragStateRef.current?.isDragging) {
      return
    }
    cameraZoomRef.current = cameraZoom
    const panelTop = getCurrentPanelTop()
    setPanelHeight(getViewportFillHeight(panelTop))
  }, [cameraZoom, getCurrentPanelTop, getViewportFillHeight, isPanelHeightExpanded])

  useEffect(() => {
    if (!isPanelHeightExpanded) {
      return
    }
    if (dragStateRef.current?.isDragging) {
      return
    }
    const handleResize = () => {
      const panelTop = getCurrentPanelTop()
      setPanelHeight(getViewportFillHeight(panelTop))
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [cameraZoom, getCurrentPanelTop, getViewportFillHeight, isPanelHeightExpanded])
  
  // Auto-focus editor when panel mounts if content is empty or it's the main panel
  useEffect(() => {
    const isEmpty = isContentEmpty()
    const isMain = panelId === 'main'
    
    // Always auto-focus main panel when it's empty and editable
    if (isEditing && isMain && isEmpty) {
      // Multiple attempts to ensure focus works after note switch
      const focusAttempts = [100, 300, 500, 800]
      focusAttempts.forEach(delay => {
        setTimeout(() => {
          if (editorRef.current && isEditing && isLayerInteractiveRef.current) {
            editorRef.current.focus()
          }
        }, delay)
      })
    } else if (isEditing && isEmpty && editorRef.current) {
      // For non-main panels, single focus attempt
      setTimeout(() => {
        if (editorRef.current && isLayerInteractiveRef.current) {
          editorRef.current.focus()
        }
      }, 300)
    }
  }, [noteId]) // Re-run when noteId changes (when switching notes)

  const isContentEmptyValue = (value: ProseMirrorJSON | string | null) => {
    if (!value) return true
    if (typeof value === 'string') {
      const stripped = value.replace(/<[^>]*>/g, '').trim()
      return stripped.length === 0 || value === '<p></p>'
    }
    if (typeof value === 'object' && Array.isArray((value as any).content)) {
      return (value as any).content.length === 0
    }
    return false
  }

  const handleEditorContentLoaded = useCallback(
    ({ content: loadedContent }: { content: ProseMirrorJSON | string | null; version: number }) => {
      if (!isPlainMode) return

      if (loadedContent !== undefined && loadedContent !== null && !isContentEmptyValue(loadedContent)) {
        const existing = dataStore.get(panelId) || {}
        const previewFallback = existing.preview
          || existing.metadata?.preview
          || ''
        const computedPreview = buildBranchPreview(loadedContent)
        const previewText = (computedPreview || previewFallback || '').replace(/\s+/g, ' ').trim()

        const nextMetadata = {
          ...(existing.metadata || {}),
        }

        if (previewText) {
          nextMetadata.preview = previewText
        } else {
          delete nextMetadata.preview
        }

        dataStore.update(panelId, {
          content: loadedContent,
          preview: previewText,
          hasHydratedContent: true,
          metadata: nextMetadata,
        })
      } else if (loadedContent !== undefined && loadedContent !== null) {
        // Ensure preview clears when empty content is applied
        const existing = dataStore.get(panelId) || {}
        const nextMetadata = {
          ...(existing.metadata || {}),
        }
        delete nextMetadata.preview

        dataStore.update(panelId, {
          content: loadedContent,
          preview: '',
          hasHydratedContent: false,
          metadata: nextMetadata,
        })
      }

      const empty = isContentEmptyValue(loadedContent)

      if (panelId !== 'main') return
      if (postLoadEditApplied.current) return

      postLoadEditApplied.current = true

      if (empty) {
        setIsEditing(true)
        setTimeout(() => {
          if (editorRef.current && isLayerInteractiveRef.current) {
            editorRef.current.focus()
          }
        }, 120)
      }
    },
    [isPlainMode, panelId, branch.originalText, dataStore]
  )
  
  // Update edit mode when branch content changes (Option A only)
  useEffect(() => {
    if (!isPlainMode) return
    
    // Don't trigger auto-edit while content is still loading
    if (isContentLoading) {
      console.log('[CanvasPanel] Skipping auto-edit check - content still loading')
      return
    }
    
    const isEmpty = isContentEmpty()
    
    // If content is empty and we're not in edit mode, switch to edit mode
    if (isEmpty && !isEditing) {
      console.log('[CanvasPanel] Auto-enabling edit mode for empty content')
      setIsEditing(true)
      
      // Also trigger focus
      setTimeout(() => {
        if (editorRef.current && isLayerInteractiveRef.current) {
          editorRef.current.focus()
        }
      }, 100)
    }
  }, [branch.content, panelId, isEditing, isPlainMode, isContentLoading]) // Watch for content changes
  
  // Get fresh branch data from CollaborationProvider
  const branchesMap = provider.getBranchesMap()
  
  // Get current branch data - re-evaluate on each render
  const getBranchData = () => {
    const providerData = branchesMap.get(panelId)
    const storeData = dataStore.get(panelId)
    
    // YJS returns proxy objects, convert to plain object for React
    if (providerData) {
      // Ensure branches array is preserved
      const plainData = JSON.parse(JSON.stringify(providerData))
      // Merge with store data to ensure no branches are lost
      if (storeData && storeData.branches) {
        const mergedBranches = [...new Set([...(plainData.branches || []), ...(storeData.branches || [])])]
        plainData.branches = mergedBranches
      }
      // Ensure branches array exists
      if (!plainData.branches) {
        plainData.branches = []
      }
      return plainData
    }
    
    // If no provider data, use store data or branch prop
    const data = storeData || branch
    // Ensure branches array exists
    if (!data.branches) {
      data.branches = []
    }
    return data
  }
  const currentBranch = getBranchData()
  
  // Generate title for branch panels if not set
  const getPanelTitle = () => {
    if (currentBranch.title) {
      return currentBranch.title
    }
    
    // For branch panels without a title, use the originalText
    if (panelId !== 'main' && currentBranch.originalText) {
      const truncatedText = currentBranch.originalText.length > 30 
        ? currentBranch.originalText.substring(0, 30) + '...' 
        : currentBranch.originalText
      return `"${truncatedText}"`
    }
    
    // Fallback to panelId if no title can be generated
    return panelId
  }

  const panelTitle = getPanelTitle()
  const showPanelTitle = Boolean(panelTitle)

  const handleUpdate = (payload: ProseMirrorJSON | string) => {
    const existing = dataStore.get(panelId) || {}

    const previewFallback = existing.preview
      || existing.metadata?.preview
      || ''
    const isPayloadEmpty = isContentEmptyValue(payload as any)
    const computedPreview = buildBranchPreview(payload)
    const resolvedPreview = computedPreview || (isPayloadEmpty ? '' : previewFallback)
    const previewText = resolvedPreview.replace(/\s+/g, ' ').trim()

    const nextMetadata = {
      ...(currentBranch.metadata || {}),
    }

    if (previewText) {
      nextMetadata.preview = previewText
    } else {
      delete nextMetadata.preview
    }

    const updatedData = {
      ...currentBranch,
      content: payload,
      preview: previewText,
      hasHydratedContent: true,
      metadata: nextMetadata,
    }

    // Update both stores with panel-specific content + preview
    dataStore.update(panelId, updatedData)
    
    // Also update in CollaborationProvider
    const branchData = branchesMap.get(panelId)
    if (branchData) {
      branchData.content = payload
      branchData.preview = previewText
      branchesMap.set(panelId, branchData)
    } else {
      // If not in YJS yet, add the full data
      branchesMap.set(panelId, updatedData)
    }
    
    // Show auto-save indicator
    const autoSave = document.getElementById(`auto-save-${panelId}`)
    if (autoSave) {
      autoSave.style.opacity = '1'
      setTimeout(() => {
        autoSave.style.opacity = '0'
      }, 2000)
    }

    // Force re-render to update branch displays
    dispatch({ type: "BRANCH_UPDATED" })
  }

  const handleSelectionChange = (text: string, range: Range | null) => {
    dispatch({
      type: "SET_SELECTION",
      payload: {
        text,
        range,
        panel: text.length > 0 ? panelId : null,
      },
    })

    // Don't show toolbar on text selection - only show via Actions button
  }

  const handleToggleEditing = () => {
    const newEditableState = !isEditing
    setIsEditing(newEditableState)

    const toggleBtn = document.querySelector(`#toolbar-${panelId} .toolbar-btn.special`) as HTMLButtonElement
    if (toggleBtn) {
      toggleBtn.innerHTML = newEditableState ? '💾 Save' : '📝 Edit'
      toggleBtn.title = newEditableState ? 'Save Changes' : 'Edit Content'
    }
    
    dataStore.update(panelId, { isEditable: newEditableState })
    
    if (newEditableState) {
      editorRef.current?.focus()
    }
  }

  // Listen for insert-annotation events at the panel level
  useEffect(() => {
    const handleInsertAnnotation = (event: Event) => {
      const customEvent = event as CustomEvent
      const { type, annotationId, branchId } = customEvent.detail
      
      // Insert the annotation using the editor's command
      if (editorRef.current) {
        editorRef.current.insertAnnotation(type, annotationId, branchId)
      } else {
        console.warn('Editor ref not available for annotation insertion')
      }
    }

    // Listen for global insert-annotation events
    const handleGlobalInsertAnnotation = (event: Event) => {
      const customEvent = event as CustomEvent
      if (customEvent.detail.panelId === panelId) {
        handleInsertAnnotation(event)
      }
    }

    // Add event listeners
    const panel = panelRef.current
    if (panel) {
      panel.addEventListener('insert-annotation', handleInsertAnnotation)
    }
    window.addEventListener('insert-annotation-global', handleGlobalInsertAnnotation)
    
    return () => {
      if (panel) {
        panel.removeEventListener('insert-annotation', handleInsertAnnotation)
      }
      window.removeEventListener('insert-annotation-global', handleGlobalInsertAnnotation)
    }
  }, [panelId])

  const generateBreadcrumb = () => {
    const breadcrumbs = []
    let currentId = panelId

    while (currentId && dataStore.has(currentId)) {
      const currentBranch = dataStore.get(currentId)
      breadcrumbs.unshift({
        id: currentId,
        title: currentBranch.title,
      })
      currentId = currentBranch.parentId
    }

    if (breadcrumbs.length <= 1) return null

    return breadcrumbs.map((crumb, index) => (
      <span key={crumb.id}>
        {index === breadcrumbs.length - 1 ? (
          <span>{crumb.title}</span>
        ) : (
          <span className="cursor-pointer text-indigo-600 hover:underline">
            {crumb.title}
          </span>
        )}
        {index < breadcrumbs.length - 1 && <span className="mx-1 text-gray-400">›</span>}
      </span>
    ))
  }

  // Panel dragging logic
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }

    const header = panel.querySelector('.panel-header') as HTMLElement
    if (!header) {
      return
    }
    
    // Update header cursor based on layer state
    const updateHeaderCursor = () => {
      if (multiLayerEnabledRef.current && layerContextRef.current?.activeLayer === 'popups') {
        header.style.cursor = 'not-allowed'
      } else {
        header.style.cursor = 'move'
      }
    }
    updateHeaderCursor()
    
    const handleMouseDown = (e: MouseEvent) => {
      // Don't start drag if clicking on any button (close, layer actions, lock/unlock)
      const target = e.target instanceof Element ? e.target : null
      if (target && target.closest('button')) {
        return
      }
      
      // Block drag if popup layer is active - USE REFS for current values
      if (multiLayerEnabledRef.current && layerContextRef.current?.activeLayer === 'popups') {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      
      dragState.current.isDragging = true
      
      // Notify editor to defer heavy operations
      if (editorRef.current && typeof editorRef.current.setPerformanceMode === 'function') {
        editorRef.current.setPerformanceMode(true)
      }
      
      // Get current panel position from style
      const currentLeft = parseInt(panel.style.left || position.x.toString(), 10)
      const currentTop = parseInt(panel.style.top || position.y.toString(), 10)
      
      // Store initial position
      dragState.current.initialPosition = { x: currentLeft, y: currentTop }
      dragState.current.startX = e.clientX
      dragState.current.startY = e.clientY
      
      // Update render position to current position when starting drag
      setRenderPosition({ x: currentLeft, y: currentTop })

      // Prepare panel for dragging
      panel.style.transition = 'none'

      // Bring panel to front while dragging
      // Always use LayerManager for focus/z-index management
      if (layerManager.isEnabled) {
        layerManager.focusNode(panelId) // This brings to front and updates focus time
      }
      globalDraggingPanelId = panelId
      
      // Prevent text selection while dragging
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'move'
      panel.style.cursor = 'move'
      
      e.preventDefault()
      e.stopPropagation()
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.current.isDragging) return
      
      // Check for auto-scroll when near edges
      checkAutoScroll(e.clientX, e.clientY)
      
      // Direct position update - no RAF accumulation
      const deltaX = e.clientX - dragState.current.startX
      const deltaY = e.clientY - dragState.current.startY
      
      const newLeft = dragState.current.initialPosition.x + deltaX
      const newTop = dragState.current.initialPosition.y + deltaY
      
      // Update render position to prevent snap-back during drag
      setRenderPosition({ x: newLeft, y: newTop })
      
      panel.style.left = newLeft + 'px'
      panel.style.top = newTop + 'px'
      
      e.preventDefault()
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragState.current.isDragging) return
      
      // Stop auto-scroll when dragging ends
      stopAutoScroll()
      
      dragState.current.isDragging = false
      globalDraggingPanelId = null
      
      // Re-enable normal editor operations
      if (editorRef.current && typeof editorRef.current.setPerformanceMode === 'function') {
        editorRef.current.setPerformanceMode(false)
      }
      
      // Get final position from current style
      const finalX = parseInt(panel.style.left, 10)
      const finalY = parseInt(panel.style.top, 10)
      
      // Update position in LayerManager if enabled
      // Update position through LayerManager
      if (layerManager.isEnabled) {
        layerManager.updateNode(panelId, { position: { x: finalX, y: finalY } })
      }
      
      // Clean up global dragging state
      if (globalDraggingPanelId === panelId) {
        globalDraggingPanelId = null
      }
      
      // Update render position to final position
      setRenderPosition({ x: finalX, y: finalY })
      
      // Update position in both stores
      dataStore.update(panelId, { position: { x: finalX, y: finalY } })
      const branchData = branchesMap.get(panelId)
      if (branchData) {
        branchData.position = { x: finalX, y: finalY }
        branchesMap.set(panelId, branchData)
      }
      
      // Reset camera pan accumulation if using camera mode
      if (isCameraEnabled) {
        resetPanAccumulation()
      }
      
      // Reset cursor
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      
      e.preventDefault()
    }

    // Add event listeners
    header.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      // Clean up event listeners
      header.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      
      // Stop auto-scroll on cleanup
      stopAutoScroll()
      
      // Reset any lingering styles
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [checkAutoScroll, stopAutoScroll, panelId, isCameraEnabled, resetPanAccumulation]) // Add auto-scroll functions, camera deps, and panelId as dependencies

  // Update cursor when layer state changes
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    
    const header = panel.querySelector('.panel-header') as HTMLElement
    if (!header) return
    
    if (multiLayerEnabledRef.current && layerContextRef.current?.activeLayer === 'popups') {
      header.style.cursor = 'not-allowed'
    } else {
      header.style.cursor = 'move'
    }
  }, [layerContext?.activeLayer]) // Re-run when active layer changes

  const isMainPanel = panelId === 'main'
  const showToolbar = isMainPanel || isEditing

  // Reinforce focus after mount or load when entering edit mode (Option A only)
  useEffect(() => {
    if (!isPlainMode) return
    if (isEditing && !isContentLoading && editorRef.current && isLayerInteractive) {
      const delays = [50, 200, 400]
      delays.forEach((d) => setTimeout(() => {
        // Double-check layer state at time of focus
        if (layerContextRef.current?.activeLayer === 'notes' || !multiLayerEnabledRef.current) {
          editorRef.current?.focus()
        }
      }, d))
    }
  }, [isEditing, isContentLoading, isPlainMode, isLayerInteractive])

  // Filter branches based on active filter
  // In plain mode, get branches from dataStore; otherwise use provider
  const allBranches = isPlainMode 
    ? (dataStore.get(panelId)?.branches || [])
    : (provider.getBranches ? provider.getBranches(panelId) : [])
  const filteredBranches = allBranches.filter((branchId: string) => {
    if (activeFilter === 'all') return true
    
    // Try to get branch from provider first, then dataStore
    const providerChild = branchesMap.get(branchId)
    const storeChild = dataStore.get(branchId)
    const childBranch = providerChild || storeChild
    
    // If we can't find the branch data, include it anyway for 'all' filter
    if (!childBranch) {
      return activeFilter === 'all'
    }
    
    return childBranch.type === activeFilter
  })

  // Force re-render when branches change
  useEffect(() => {
    // In plain mode, listen for dataStore updates
    if (isPlainMode) {
      // Set up listener for dataStore changes
      const handleDataStoreUpdate = (updatedPanelId: string) => {
        // Defer state updates to avoid React warning
        setTimeout(() => {
          // If this panel or its branches were updated, force re-render
          if (updatedPanelId === panelId || dataStore.get(panelId)?.branches?.includes(updatedPanelId)) {
            setLastBranchUpdate(Date.now())
            forceUpdate()
          }
        }, 0)
      }
      
      // Listen for dataStore updates
      dataStore.on('update', handleDataStoreUpdate)
      dataStore.on('set', handleDataStoreUpdate)
      
      return () => {
        dataStore.off('update', handleDataStoreUpdate)
        dataStore.off('set', handleDataStoreUpdate)
      }
    }
    
    // Check if branchesMap has observe method (Yjs Map)
    if (!branchesMap || typeof branchesMap.observe !== 'function') {
      // Plain JavaScript Map, no observation needed
      return
    }
    
    const updateHandler = (event: any) => {
      // Defer state updates to avoid React warning
      setTimeout(() => {
        // Check if this panel's branches were updated
        if (event && event.keysChanged && event.keysChanged.has(panelId)) {
          setLastBranchUpdate(Date.now())
        }
        
        forceUpdate()
      }, 0)
    }
    
    // Listen for changes to the YJS native structure
    const branchesArrayUpdateHandler = () => {
      // Defer state updates to avoid React warning
      setTimeout(() => {
        setLastBranchUpdate(Date.now())
        forceUpdate()
      }, 0)
    }
    
    // Listen for any changes to the branches map (legacy)
    branchesMap.observe(updateHandler)
    
    // Listen for changes to the YJS native branches array
    try {
      const structure = provider.getDocumentStructure && provider.getDocumentStructure()
      if (structure && structure.getBranchesArray) {
        const branchesArray = structure.getBranchesArray(panelId)
        if (branchesArray && typeof branchesArray.observe === 'function') {
          branchesArray.observe(branchesArrayUpdateHandler)
          
          return () => {
            branchesMap.unobserve(updateHandler)
            branchesArray.unobserve(branchesArrayUpdateHandler)
          }
        }
      }
      
      // Fallback to legacy observation only
      return () => {
        branchesMap.unobserve(updateHandler)
      }
    } catch {
      // Fallback to legacy observation only
      return () => {
        branchesMap.unobserve(updateHandler)
      }
    }
  }, [panelId, forceUpdate, branchesMap, provider, isPlainMode])

  // Calculate position for branch panel relative to parent
  const calculateBranchPanelPosition = () => {
    const currentPanel = panelRef.current
    let parentPosition = { x: 2000, y: 1500 } // Default position
    
    if (currentPanel) {
      // Get the actual panel dimensions
      const rect = currentPanel.getBoundingClientRect()
      const panelWidth = rect.width || 800 // Fallback to 800 if width not available
      const gap = 50 // Gap between panels
      
      // Get the transform values from the panel's style
      const style = window.getComputedStyle(currentPanel)
      const transform = style.transform
      
      if (transform && transform !== 'none') {
        // Extract translation values from the transform matrix
        const matrix = new DOMMatrixReadOnly(transform)
        const currentX = matrix.m41
        const currentY = matrix.m42
        
        // Smart positioning logic:
        // 1. Check if there are already panels on either side
        // 2. Prefer right side by default
        // 3. Use left if right side would go too far (beyond viewport or x > 4000)
        // 4. Alternate sides if multiple branches are opened
        
        // Get all existing panels to check for collisions
        const allPanels = document.querySelectorAll('[data-panel-id]')
        let rightOccupied = false
        let leftOccupied = false
        
        allPanels.forEach((panel) => {
          if (panel === currentPanel) return
          
          const panelStyle = window.getComputedStyle(panel)
          const panelTransform = panelStyle.transform
          
          if (panelTransform && panelTransform !== 'none') {
            const panelMatrix = new DOMMatrixReadOnly(panelTransform)
            const panelX = panelMatrix.m41
            
            // Check if a panel is already on the right
            if (panelX > currentX + panelWidth && 
                panelX < currentX + panelWidth + gap + 100) {
              rightOccupied = true
            }
            
            // Check if a panel is already on the left
            if (panelX < currentX - gap && 
                panelX > currentX - panelWidth - gap - 100) {
              leftOccupied = true
            }
          }
        })
        
        // Decide placement based on occupancy and viewport constraints
        let placeOnLeft = false
        
        if (!rightOccupied && !leftOccupied) {
          // Neither side occupied - check viewport constraints
          const viewportWidth = window.innerWidth
          const rightEdgePosition = currentX + panelWidth + gap + panelWidth
          
          // Place on left if right would exceed viewport or go beyond x=4000
          placeOnLeft = rightEdgePosition > viewportWidth || currentX > 2500
        } else if (rightOccupied && !leftOccupied) {
          // Right is occupied, left is free
          placeOnLeft = true
        } else if (!rightOccupied && leftOccupied) {
          // Left is occupied, right is free
          placeOnLeft = false
        } else {
          // Both sides occupied - stack on the right with offset
          placeOnLeft = false
          // Add vertical offset to avoid complete overlap
          parentPosition.y = currentY + 100
        }
        
        // Position the new panel to the left or right of the parent with gap
        parentPosition = {
          x: placeOnLeft 
            ? currentX - panelWidth - gap // Panel width + gap on the left
            : currentX + panelWidth + gap, // Panel width + gap on the right
          y: parentPosition.y || currentY // Use offset Y if set, otherwise same vertical position
        }
      } else {
        // Fallback: try to get position from data stores
        const panelData = isPlainMode 
          ? dataStore.get(panelId) 
          : branchesMap.get(panelId)
        
        if (panelData?.position) {
          // Simple fallback logic when transform not available
          const placeOnLeft = panelData.position.x > 2500
          parentPosition = {
            x: placeOnLeft 
              ? panelData.position.x - panelWidth - gap 
              : panelData.position.x + panelWidth + gap,
            y: panelData.position.y
          }
        }
      }
    }
    
    return parentPosition
  }

  // Handle branch click to open panel
  const handleBranchClick = (branchId: string) => {
    // Check if branch exists before creating panel
    const branchExists = branchesMap.has(branchId) || dataStore.has(branchId)
    if (!branchExists) {
      console.warn(`Branch ${branchId} not found`)
      return
    }
    
    // Get position for the new panel
    const parentPosition = calculateBranchPanelPosition()
    
    // Dispatch event to create panel with parent position
    window.dispatchEvent(new CustomEvent('create-panel', { 
      detail: { 
        panelId: branchId,
        parentPanelId: panelId,
        parentPosition: parentPosition
      },
      bubbles: true 
    }))
  }

  return (
    <div
      ref={panelRef}
      className={`panel ${currentBranch.type}`}
      id={`panel-${panelId}`}
      data-panel-id={panelId}
      onMouseEnter={() => {
        if (panelHoverHideTimeoutRef.current) {
          clearTimeout(panelHoverHideTimeoutRef.current)
          panelHoverHideTimeoutRef.current = null
        }
        if (panelHoverShowTimeoutRef.current) {
          clearTimeout(panelHoverShowTimeoutRef.current)
        }

        if (isPanelHovered) {
          panelHoverShowTimeoutRef.current = null
          return
        }

        panelHoverShowTimeoutRef.current = setTimeout(() => {
          setIsPanelHovered(true)
          panelHoverShowTimeoutRef.current = null
        }, HEADER_BUTTON_HOVER_DELAY_MS)
      }}
      onMouseLeave={() => {
        if (panelHoverShowTimeoutRef.current) {
          clearTimeout(panelHoverShowTimeoutRef.current)
          panelHoverShowTimeoutRef.current = null
        }
        if (panelHoverHideTimeoutRef.current) {
          clearTimeout(panelHoverHideTimeoutRef.current)
        }

        panelHoverHideTimeoutRef.current = setTimeout(() => {
          // Only hide if no popups are visible
          if (!isSidebarVisible && !isActionsVisible && !isSidebarHovering && !isActionsHovering) {
            setIsPanelHovered(false)
          }
          panelHoverHideTimeoutRef.current = null
        }, HEADER_BUTTON_HOVER_DELAY_MS)
      }}
      style={{
        position: 'absolute',
        left: renderPosition.x + 'px',
        top: renderPosition.y + 'px',
        width: '500px',
        height: `${panelHeight}px`,
        maxHeight: isPanelHeightExpanded ? 'none' : '80vh',
        background: isIsolated ? '#fff5f5' : 'white',
        borderRadius: '16px',
        boxShadow: isIsolated 
          ? '0 8px 32px rgba(239, 68, 68, 0.25)' 
          : '0 8px 32px rgba(0,0,0,0.15)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: zIndex,
        border: isIsolated ? '2px solid #ef4444' : 'none',
      }}
    >
      {/* Panel Header */}
      <div 
        className="panel-header"
        style={{
          background: currentBranch.type === 'main' 
            ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
            : currentBranch.type === 'note'
            ? 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)'
            : currentBranch.type === 'explore'
            ? 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)'
            : 'linear-gradient(135deg, #27ae60 0%, #229954 100%)',
          padding: '12px 20px',
          height: '56px',
          minHeight: '56px',
          maxHeight: '56px',
          color: 'white',
          fontWeight: 600,
          fontSize: '16px',
          cursor: 'move',
          userSelect: 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pointerEvents: 'auto',
          borderBottom: isIsolated ? '3px solid #ef4444' : 'none',
          flexShrink: 0,
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          flex: '0 0 auto',
        }}>
          {/* Lock and Close buttons - moved to left side before title */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            opacity: headerControlsActive ? 1 : 0,
            transition: 'opacity 0.2s ease',
            pointerEvents: headerControlsActive ? 'auto' : 'none'
          }}>
            {/* Lock/Unlock button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                const debug = (window as any).__isolationDebug
                if (debug) {
                  if (isIsolated) {
                    debug.restore(panelId)
                  } else {
                    debug.isolate(panelId)
                  }
                }
              }}
              style={{
                background: isIsolated ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.2)',
                border: 'none',
                borderRadius: '50%',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                color: 'white',
                fontSize: '12px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isIsolated ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255,255,255,0.3)'
                e.currentTarget.style.transform = 'scale(1.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isIsolated ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.2)'
                e.currentTarget.style.transform = 'scale(1)'
              }}
              title={isIsolated ? 'Restore panel' : 'Isolate panel'}
            >
              {isIsolated ? '🔓' : '🔒'}
            </button>
            
            {onClose && (
              <button 
                className="panel-close"
                onClick={onClose}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  fontSize: '14px',
                  color: 'white',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
                  e.currentTarget.style.transform = 'scale(1.1)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
                title="Close panel"
              >
                ×
              </button>
            )}

            {/* Drag Handle */}
            <div
              className="drag-indicator"
              title="Drag to move panel"
              style={{
                width: '56px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.6) 1px, transparent 1px)',
                backgroundSize: '6px 6px',
                backgroundPosition: '0 0',
                cursor: 'move',
              }}
            />
          </div>
          
          {/* Panel Title */}
          {showPanelTitle && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '10px',
              opacity: headerControlsActive ? 0 : 1,
              transition: 'opacity 0.2s ease, max-width 0.2s ease',
              overflow: 'hidden',
              flex: headerControlsActive ? '0 0 auto' : 1,
              maxWidth: headerControlsActive ? 0 : '100%',
              width: headerControlsActive ? 0 : 'auto',
              pointerEvents: headerControlsActive ? 'none' : 'auto',
            }}>
              <span style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '300px',
              }}>{panelTitle}</span>
              {isIsolated && currentBranch.type !== 'main' && (
                <span style={{
                  background: '#ef4444',
                  color: 'white',
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                }}>
                  ISOLATED
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* Right side buttons */}
        <div
          ref={actionsContainerRef}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: `${ACTION_GAP}px`,
            opacity: headerControlsActive ? 1 : 0,
            transition: 'opacity 0.2s ease',
            pointerEvents: headerControlsActive ? 'auto' : 'none',
            position: 'relative',
            justifyContent: 'flex-end',
            flex: (currentBranch.type === 'main' || headerControlsActive) ? '1 1 auto' : '0 1 auto',
            marginLeft: 'auto'
          }}
        >
          {layerManager.isEnabled && (
            <>
              <div
                ref={registerActionRef('bringToFront')}
                style={{
                  display: hiddenActionIds.includes('bringToFront') ? 'none' : 'flex',
                }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (layerManager.isEnabled) {
                      layerManager.bringToFront(panelId)
                    }
                  }}
                  disabled={layerBandInfo?.isAtTop}
                  style={{
                    background: 'rgba(255,255,255,0.2)',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: layerBandInfo?.isAtTop ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    color: 'white',
                    fontSize: '12px',
                    opacity: layerBandInfo?.isAtTop ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!layerBandInfo?.isAtTop) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                  }}
                  title="Bring to front"
                >
                  ↑
                </button>
              </div>

              <div
                ref={registerActionRef('sendToBack')}
                style={{
                  display: hiddenActionIds.includes('sendToBack') ? 'none' : 'flex',
                }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (layerManager.isEnabled) {
                      layerManager.sendToBack(panelId)
                    }
                  }}
                  disabled={layerBandInfo?.isAtBottom}
                  style={{
                    background: 'rgba(255,255,255,0.2)',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: layerBandInfo?.isAtBottom ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    color: 'white',
                    fontSize: '12px',
                    opacity: layerBandInfo?.isAtBottom ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!layerBandInfo?.isAtBottom) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                  }}
                  title="Send to back"
                >
                  ↓
                </button>
              </div>
            </>
          )}

          <div
            ref={formatActionRef}
            style={{
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <FormatToolbar
              editorRef={editorRef}
              panelId={panelId}
              hoverDelayMs={HEADER_BUTTON_HOVER_DELAY_MS}
              collapsibleSelection={collapsibleSelection}
            />
          </div>

          <div
            ref={registerActionRef('resizeToggle')}
            style={{
              display: hiddenActionIds.includes('resizeToggle') ? 'none' : 'flex'
            }}
          >
            <button
              onClick={(event) => {
                event.stopPropagation()
                handleTogglePanelHeight()
              }}
              title={isPanelHeightExpanded ? 'Restore panel height' : 'Expand panel height'}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                cursor: 'pointer',
                fontSize: '11px',
                color: 'white',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                height: '24px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14" />
                <path d="M9 8l3-3 3 3" />
                <path d="M9 16l3 3 3-3" />
              </svg>
              <span>{isPanelHeightExpanded ? 'Restore' : 'Resize'}</span>
            </button>
          </div>

          <div
            ref={registerActionRef('branches')}
            style={{
              display: hiddenActionIds.includes('branches') ? 'none' : 'flex'
            }}
          >
            <button
              id={`branches-button-${panelId}`}
              onClick={handleBranchesButtonClick}
              onMouseEnter={handleBranchesButtonMouseEnter}
              onMouseLeave={handleBranchesButtonMouseLeave}
              title={isSidebarVisible ? "Hide branches" : "Show branches"}
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "none",
                borderRadius: "4px",
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: "11px",
                color: "white",
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                height: "24px",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <line x1="14" y1="8" x2="18" y2="8" />
                <line x1="14" y1="12" x2="18" y2="12" />
                <line x1="14" y1="16" x2="18" y2="16" />
              </svg>
              <span>Branches</span>
            </button>
          </div>

          <div
            ref={registerActionRef('actions')}
            style={{
              display: hiddenActionIds.includes('actions') ? 'none' : 'flex'
            }}
          >
            <button
              id={`actions-button-${panelId}`}
              onClick={handleActionsButtonClick}
              onMouseEnter={handleActionsButtonMouseEnter}
              onMouseLeave={handleActionsButtonMouseLeave}
              title="Create annotation"
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "none",
                borderRadius: "4px",
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: "11px",
                color: "white",
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                height: "24px",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Actions</span>
            </button>
          </div>

          <button
            ref={overflowButtonRef}
            onClick={(event) => {
              event.stopPropagation()
              setIsOverflowMenuOpen((prev) => !prev)
            }}
            style={{
              display: hiddenActionIds.length > 0 ? 'flex' : 'none',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 6px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              height: '24px',
            }}
            title="More actions"
          >
            »
          </button>

          {isOverflowMenuOpen && hiddenActionIds.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'rgba(22,22,22,0.95)',
                color: 'white',
                borderRadius: '8px',
                padding: '8px 0',
                boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
                minWidth: '160px',
                zIndex: Z_INDEX.DROPDOWN,
              }}
            >
              {hiddenActionIds.map((actionId) => {
                const isDisabled =
                  (actionId === 'bringToFront' && layerBandInfo?.isAtTop) ||
                  (actionId === 'sendToBack' && layerBandInfo?.isAtBottom)

                return (
                  <button
                    key={actionId}
                    onClick={(event) => {
                      if (isDisabled) {
                        event.preventDefault()
                        event.stopPropagation()
                        return
                      }

                      if (actionId === 'bringToFront') {
                        event.stopPropagation()
                        if (layerManager.isEnabled) {
                          layerManager.bringToFront(panelId)
                        }
                        closeOverflowMenu()
                        return
                      }
                      if (actionId === 'sendToBack') {
                        event.stopPropagation()
                        if (layerManager.isEnabled) {
                          layerManager.sendToBack(panelId)
                        }
                        closeOverflowMenu()
                        return
                      }
                      if (actionId === 'branches') {
                        handleBranchesButtonClick(event)
                        return
                      }
                      if (actionId === 'actions') {
                        handleActionsButtonClick(event)
                        return
                      }
                      if (actionId === 'resizeToggle') {
                        handleTogglePanelHeight()
                        closeOverflowMenu()
                      }
                    }}
                    style={{
                      display: 'flex',
                      width: '100%',
                      padding: '8px 16px',
                      background: 'transparent',
                      border: 'none',
                      color: 'white',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      textAlign: 'left',
                      opacity: isDisabled ? 0.6 : 1,
                    }}
                  >
                    <span>
                      {actionId === 'bringToFront' && 'Bring to Front'}
                      {actionId === 'sendToBack' && 'Send to Back'}
                      {actionId === 'resizeToggle' && (isPanelHeightExpanded ? 'Restore Height' : 'Expand Height')}
                      {actionId === 'branches' && 'Branches'}
                      {actionId === 'actions' && 'Actions'}
                    </span>
                    {(actionId === 'bringToFront' && layerBandInfo?.isAtTop) && (
                      <span style={{ fontSize: '11px', opacity: 0.6 }}>Done</span>
                    )}
                    {(actionId === 'sendToBack' && layerBandInfo?.isAtBottom) && (
                      <span style={{ fontSize: '11px', opacity: 0.6 }}>Done</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        
      </div>

      {/* Check if isolated and show placeholder */}
      {isIsolated ? (
        <div style={{ padding: '20px' }}>
          {placeholder}
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Editor Section */}
          <div style={{
            flex: 1,
            padding: '20px 25px 25px 25px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
          }}>
          {/* Auto Save Indicator */}
          <div
            id={`auto-save-${panelId}`}
            style={{
              position: 'absolute',
              top: '12px',
              right: '15px',
              padding: '4px 8px',
              background: '#28a745',
              color: 'white',
              borderRadius: '12px',
              fontSize: '10px',
              opacity: 0,
              transition: 'opacity 0.3s ease',
              zIndex: 2,
            }}
          >
            Saved
          </div>

          {/* Editor Content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div className="rich-editor-wrapper">
              
              {isContentLoading ? (
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: '#666',
                  fontSize: '14px'
                }}>
                  Loading content...
                </div>
              ) : isPlainMode ? (
                plainProvider ? (
                  <TiptapEditorPlain
                    ref={editorRef as any}
                    // DON'T pass content when using provider to avoid triggering fallback effect
                    isEditable={actuallyEditable}  // Respects layer state
                    noteId={currentNoteId || ''}
                    panelId={panelId}
                    onUpdate={(content) => handleUpdate(typeof content === 'string' ? content : JSON.stringify(content))}
                    onSelectionChange={handleSelectionChange}
                    onCollapsibleSelectionChange={handleCollapsibleSelectionChange}
                    placeholder={`Start writing your ${currentBranch.type || 'note'}...`}
                    provider={plainProvider}
                    onContentLoaded={handleEditorContentLoaded}
                  />
                ) : (
                  <div style={{
                    padding: '40px',
                    textAlign: 'center',
                    color: '#666',
                    fontSize: '14px'
                  }}>
                    Initializing plain mode provider...
                  </div>
                )
              ) : (
                ydocState.loading && !ydocState.doc ? (
                  <div style={{
                    padding: '40px',
                    textAlign: 'center',
                    color: '#666',
                    fontSize: '14px'
                  }}>
                    Loading collaborative editor...
                  </div>
                ) : (
                  <TiptapEditorCollab
                    ref={editorRef}
                    content={''}
                    isEditable={actuallyEditable}  // Respects layer state
                    panelId={panelId}
                    onUpdate={handleUpdate}
                    onSelectionChange={handleSelectionChange}
                    placeholder={`Start writing your ${currentBranch.type || 'note'}...`}
                    ydoc={ydocState.doc as Y.Doc}
                    provider={provider.getProvider() as any}
                  />
                )
              )}
            </div>
          </div>
        </div>

      </div>
      )}
      
      
      {/* Branches Sidebar - Floating Panel */}
      {(isSidebarVisible || isSidebarHovering) && (
        <div 
          id={`branches-sidebar-${panelId}`}
          onMouseEnter={() => {
            // Keep sidebar visible when hovering over it
            if (sidebarTimeoutRef.current) {
              clearTimeout(sidebarTimeoutRef.current)
            }
            if (sidebarShowTimeoutRef.current) {
              clearTimeout(sidebarShowTimeoutRef.current)
              sidebarShowTimeoutRef.current = null
            }
            setIsSidebarHovering(true)
          }}
          onMouseLeave={() => {
            // Hide sidebar after delay when leaving
            if (sidebarShowTimeoutRef.current) {
              clearTimeout(sidebarShowTimeoutRef.current)
              sidebarShowTimeoutRef.current = null
            }
            sidebarTimeoutRef.current = setTimeout(() => {
              setIsSidebarHovering(false)
            }, HEADER_BUTTON_HOVER_DELAY_MS)
          }}
          style={{
          position: 'absolute',
          top: '60px',
          right: '10px',
          width: '300px',
          maxHeight: 'calc(100% - 80px)',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          padding: '20px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          zIndex: zIndex + 10,
        }}>
          <div style={{
            color: 'white',
            fontSize: '16px',
            fontWeight: 600,
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span>📌</span> Branches ({allBranches.length})
          </div>

          {/* Filter buttons */}
          <div style={{
            display: 'flex',
            gap: '6px',
            marginBottom: '16px',
            background: 'rgba(255,255,255,0.1)',
            padding: '4px',
            borderRadius: '8px',
          }}>
            {['all', 'note', 'explore', 'promote'].map(filter => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter as typeof activeFilter)}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: '6px',
                  background: activeFilter === filter ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: activeFilter === filter ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textTransform: 'capitalize',
                }}
                onMouseEnter={(e) => {
                  if (activeFilter !== filter) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeFilter !== filter) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                  }
                }}
              >
                {filter}
              </button>
            ))}
          </div>

          {/* Branch items */}
          <div style={{ flex: 1 }}>
            {filteredBranches.length === 0 ? (
              <div style={{
                color: 'rgba(255,255,255,0.7)',
                textAlign: 'center',
                fontSize: '14px',
                marginTop: '20px',
              }}>
                No {activeFilter !== 'all' ? `${activeFilter} ` : ''}branches yet
              </div>
            ) : (
              filteredBranches.map((branchId: string) => {
                // Try both stores for branch data
                const providerChild = branchesMap.get(branchId)
                const storeChild = dataStore.get(branchId)
                const childBranch = providerChild || storeChild
                
                if (!childBranch) {
                  return null
                }

                return (
                  <div
                    key={branchId}
                    className={`branch-item ${childBranch.type}`}
                    style={{
                      background: 'rgba(255,255,255,0.95)',
                      borderRadius: '12px',
                      padding: '16px',
                      marginBottom: '12px',
                      transition: 'all 0.3s ease',
                      borderLeft: `4px solid ${
                        childBranch.type === 'note' ? '#2196f3' :
                        childBranch.type === 'explore' ? '#ff9800' : '#4caf50'
                      }`,
                      userSelect: 'none',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateX(4px)'
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateX(0)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    {/* Branch content - clickable area */}
                    <div 
                      style={{
                        flex: 1,
                        cursor: 'pointer',
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleBranchClick(branchId)
                      }}
                    >
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#2c3e50',
                        marginBottom: '4px',
                      }}>
                        {childBranch.title}
                      </div>
                      <div style={{
                        fontSize: '12px',
                        color: '#7f8c8d',
                        lineHeight: 1.4,
                      }}>
                        {childBranch.originalText || 'Click to open'}
                      </div>
                    </div>
                    
                    {/* Eye/View button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        // Clear any preview timeout to prevent conflicts
                        if (previewTimeoutRef.current) {
                          clearTimeout(previewTimeoutRef.current)
                        }
                        // Clear preview state since we're opening permanently
                        setPreviewBranchId(null)
                        // Click opens the panel permanently
                        handleBranchClick(branchId)
                      }}
                      onMouseEnter={(e) => {
                        e.stopPropagation()
                        // Clear any existing timeout
                        if (previewTimeoutRef.current) {
                          clearTimeout(previewTimeoutRef.current)
                        }
                        // Only show preview if not already clicked/opened
                        // Check if panel already exists
                        const panelExists = document.querySelector(`[data-panel-id="${branchId}"]`)
                        if (!panelExists) {
                          // Show preview after short delay
                          previewTimeoutRef.current = setTimeout(() => {
                            setPreviewBranchId(branchId)
                            
                            // Get position for the preview panel (reuse same logic)
                            const parentPosition = calculateBranchPanelPosition()
                            
                            // Dispatch event to create temporary preview panel
                            window.dispatchEvent(new CustomEvent('preview-panel', { 
                              detail: { 
                                panelId: branchId,
                                parentPanelId: panelId,
                                parentPosition: parentPosition,
                                isPreview: true
                              },
                              bubbles: true 
                            }))
                          }, 300) // 300ms delay before showing preview
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.stopPropagation()
                        // Clear timeout
                        if (previewTimeoutRef.current) {
                          clearTimeout(previewTimeoutRef.current)
                        }
                        // Only remove preview if it's actually a preview (not a permanent panel)
                        if (previewBranchId === branchId) {
                          setPreviewBranchId(null)
                          // Dispatch event to remove preview panel
                          window.dispatchEvent(new CustomEvent('remove-preview-panel', { 
                            detail: { panelId: branchId },
                            bubbles: true 
                          }))
                        }
                      }}
                      style={{
                        background: 'transparent',
                        border: '1px solid #ddd',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        color: '#7f8c8d',
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
                        e.currentTarget.style.borderColor = '#999'
                        e.currentTarget.style.color = '#2c3e50'
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.borderColor = '#ddd'
                        e.currentTarget.style.color = '#7f8c8d'
                      }}
                      title="Preview branch (hover) / Open (click)"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Connection points */}
      {!isMainPanel && (
        <div className="connection-point input" style={{
          position: 'absolute',
          left: '-8px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '16px',
          height: '16px',
          background: '#667eea',
          borderRadius: '50%',
          border: '3px solid white',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }} />
      )}
      <div className="connection-point output" style={{
        position: 'absolute',
        right: '-8px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '16px',
        height: '16px',
        background: '#667eea',
        borderRadius: '50%',
        border: '3px solid white',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }} />
    </div>
  )
} 
