"use client"

import { useRef, useState, useEffect, useReducer, useCallback } from "react"
import { useCanvas } from "./canvas-context"
import type { Branch } from "@/types/canvas"
import dynamic from 'next/dynamic'
import TiptapEditorPlain, { TiptapEditorPlainHandle } from "./tiptap-editor-plain"
import type { TiptapEditorHandle } from './tiptap-editor-collab'
import type * as Y from 'yjs'
import { EditorToolbar } from "./editor-toolbar"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { isPlainModeActive } from "@/lib/collab-mode"
import type { PlainOfflineProvider } from "@/lib/providers/plain-offline-provider"
import { useLayer } from "@/components/canvas/layer-provider"
import { useFeatureFlag } from "@/lib/offline/feature-flags"
import { useAutoScroll } from "./use-auto-scroll"
import { useIsolation, useRegisterWithIsolation } from "@/lib/isolation/context"
import { Z_INDEX } from "@/lib/constants/z-index"
import { useCanvasCamera } from "@/lib/hooks/use-canvas-camera"
import { useLayerManager, useCanvasNode } from "@/lib/hooks/use-layer-manager"
import { Z_INDEX_BANDS } from "@/lib/canvas/canvas-node"

const TiptapEditorCollab = dynamic(() => import('./tiptap-editor-collab'), { ssr: false })

// Track which panel is currently being dragged globally
let globalDraggingPanelId: string | null = null

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
  const { node: canvasNode } = useCanvasNode(panelId, 'panel', position)
  
  // State to track render position and prevent snap-back during drag
  const [renderPosition, setRenderPosition] = useState(position)
  
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
    isCameraEnabled 
  } = useCanvasCamera()
  
  // Isolation system integration
  const { isIsolated, level, placeholder } = useIsolation(panelId)
  // Register panel with isolation manager - mark 'main' as 'critical' so it is never auto-isolated
  useRegisterWithIsolation(panelId, panelRef as any, panelId === 'main' ? 'critical' : 'normal', 'panel')
  
  // Multi-layer canvas context
  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any)
  const layerContext = useLayer()
  
  // Use refs to avoid stale closures in event handlers
  const multiLayerEnabledRef = useRef(multiLayerEnabled)
  const layerContextRef = useRef(layerContext)
  
  // Update refs when values change
  useEffect(() => {
    multiLayerEnabledRef.current = multiLayerEnabled
    layerContextRef.current = layerContext
  }, [multiLayerEnabled, layerContext])
  
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
  const actuallyEditable = isEditing && isLayerInteractive
  const [activeFilter, setActiveFilter] = useState<'all' | 'note' | 'explore' | 'promote'>('all')
  const [lastBranchUpdate, setLastBranchUpdate] = useState(Date.now())
  const forceUpdate = useReducer(() => ({}), {})[1]
  const [isContentLoading, setIsContentLoading] = useState(true)
  const [plainProvider, setPlainProvider] = useState<PlainOfflineProvider | null>(null)
  const postLoadEditApplied = useRef(false)
  
  // Use noteId from props or context
  const currentNoteId = noteId || contextNoteId
  
  // Blur editor when switching to popup layer
  useEffect(() => {
    if (multiLayerEnabled && layerContext && layerContext.activeLayer === 'popups') {
      // Blur any focused editor to prevent keyboard input
      if (editorRef.current && typeof editorRef.current.setEditable === 'function') {
        editorRef.current.setEditable(false)
        // Also blur the DOM element
        const activeElement = document.activeElement as HTMLElement
        if (activeElement && activeElement.closest('.ProseMirror')) {
          activeElement.blur()
        }
      }
    } else if (multiLayerEnabled && layerContext && layerContext.activeLayer === 'notes') {
      // Re-enable editing when returning to notes layer
      if (editorRef.current && typeof editorRef.current.setEditable === 'function') {
        editorRef.current.setEditable(isEditing)
      }
    }
  }, [layerContext?.activeLayer, multiLayerEnabled, isEditing])
  
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
      // Use camera-based panning
      panCameraBy({ dxScreen: deltaX, dyScreen: deltaY })
      
      // Track accumulated pan for drop coordinate adjustment
      dragState.current.initialPosition.x += deltaX
      dragState.current.initialPosition.y += deltaY
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
          if (editorRef.current && isEditing && isLayerInteractive) {
            editorRef.current.focus()
          }
        }, delay)
      })
    } else if (isEditing && isEmpty && editorRef.current) {
      // For non-main panels, single focus attempt
      setTimeout(() => {
        if (editorRef.current && isLayerInteractive) {
          editorRef.current.focus()
        }
      }, 300)
    }
  }, [noteId]) // Re-run when noteId changes (when switching notes)

  // Option A fallback: once the plain provider is ready, load the actual
  // document for this panel and enforce edit mode if truly empty. This
  // covers async timing where initial state may evaluate before content loads.
  useEffect(() => {
    if (!isPlainMode) return
    if (panelId !== 'main') return
    if (!plainProvider || !currentNoteId) return
    if (postLoadEditApplied.current) return

    postLoadEditApplied.current = true
    ;(async () => {
      try {
        const loaded = await plainProvider.loadDocument(currentNoteId, panelId)
        let isEmpty = false
        if (!loaded) {
          isEmpty = true
        } else if (typeof loaded === 'string') {
          const stripped = loaded.replace(/<[^>]*>/g, '').trim()
          isEmpty = stripped.length === 0 || loaded === '<p></p>'
        } else if (typeof loaded === 'object') {
          // ProseMirror JSON case
          const content = (loaded as any).content
          isEmpty = !content || content.length === 0
        }

        if (isEmpty) {
          setIsEditing(true)
          setTimeout(() => {
            if (editorRef.current) {
              editorRef.current.setEditable(true as any)
              editorRef.current.focus()
            }
          }, 120)
        }
      } catch {
        // Non-fatal; leave current state
      }
    })()
  }, [isPlainMode, panelId, plainProvider, currentNoteId])
  
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
        if (editorRef.current) {
          editorRef.current.setEditable(true)
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

  const handleUpdate = (html: string) => {
    // Update both stores with panel-specific content
    const updatedData = { ...currentBranch, content: html }
    dataStore.update(panelId, updatedData)
    
    // Also update in CollaborationProvider
    const branchData = branchesMap.get(panelId)
    if (branchData) {
      branchData.content = html
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

    const toolbar = document.getElementById("annotation-toolbar")
    if (toolbar && text.length > 0) {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect()
        toolbar.style.left = rect.left + rect.width / 2 + "px"
        toolbar.style.top = rect.top - 80 + "px"
        toolbar.classList.add("visible")
      }
    } else if (toolbar) {
      toolbar.classList.remove("visible")
    }
  }

  const handleToggleEditing = () => {
    const newEditableState = !isEditing
    setIsEditing(newEditableState)
    editorRef.current?.setEditable(newEditableState)
    
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
      // Don't start drag if clicking on close button
      if ((e.target as HTMLElement).closest('.panel-close')) {
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
      layerManager.focusNode(panelId) // This brings to front and updates focus time
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
      layerManager.updateNode(panelId, { position: { x: finalX, y: finalY } })
      
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
        // If this panel or its branches were updated, force re-render
        if (updatedPanelId === panelId || dataStore.get(panelId)?.branches?.includes(updatedPanelId)) {
          setLastBranchUpdate(Date.now())
          forceUpdate()
        }
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
      // Check if this panel's branches were updated
      if (event && event.keysChanged && event.keysChanged.has(panelId)) {
        setLastBranchUpdate(Date.now())
      }
      
      forceUpdate()
    }
    
    // Listen for changes to the YJS native structure
    const branchesArrayUpdateHandler = () => {
      setLastBranchUpdate(Date.now())
      forceUpdate()
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

  // Handle branch click to open panel
  const handleBranchClick = (branchId: string) => {
    // Check if branch exists before creating panel
    const branchExists = branchesMap.has(branchId) || dataStore.has(branchId)
    if (!branchExists) {
      console.warn(`Branch ${branchId} not found`)
      return
    }
    
    // Dispatch event to create panel
    window.dispatchEvent(new CustomEvent('create-panel', { 
      detail: { panelId: branchId },
      bubbles: true 
    }))
  }

  return (
    <div
      ref={panelRef}
      className={`panel ${currentBranch.type}`}
      id={`panel-${panelId}`}
      data-panel-id={panelId}
      style={{
        position: 'absolute',
        left: renderPosition.x + 'px',
        top: renderPosition.y + 'px',
        width: '500px',
        minHeight: '400px',
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
          padding: '20px 25px',
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
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>{currentBranch.title}</span>
          {isIsolated && (
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Layer action buttons - only show when LayerManager is enabled */}
          {layerManager.isEnabled && (
            <>
              {/* Bring to Front button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  layerManager.bringToFront(panelId)
                }}
                disabled={layerManager.getLayerBandInfo(panelId)?.isAtTop}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: layerManager.getLayerBandInfo(panelId)?.isAtTop ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'white',
                  fontSize: '12px',
                  opacity: layerManager.getLayerBandInfo(panelId)?.isAtTop ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!layerManager.getLayerBandInfo(panelId)?.isAtTop) {
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
              
              {/* Send to Back button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  layerManager.sendToBack(panelId)
                }}
                disabled={layerManager.getLayerBandInfo(panelId)?.isAtBottom}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: layerManager.getLayerBandInfo(panelId)?.isAtBottom ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'white',
                  fontSize: '12px',
                  opacity: layerManager.getLayerBandInfo(panelId)?.isAtBottom ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!layerManager.getLayerBandInfo(panelId)?.isAtBottom) {
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
            </>
          )}
          
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
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              color: 'white',
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
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                fontSize: '16px',
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
            flex: 2,
            padding: '20px 25px 25px 25px',
            borderRight: '1px solid #e9ecef',
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

          {/* Editor Header */}
          <div style={{
            marginBottom: '20px',
            paddingBottom: '15px',
            borderBottom: '2px solid #f1f3f4',
          }}>
            <div style={{
              fontSize: '20px',
              fontWeight: 700,
              color: '#2c3e50',
              marginBottom: '8px',
            }}>
              {currentBranch.title}
            </div>
            {generateBreadcrumb() && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                fontSize: '12px',
                color: '#6c757d',
                gap: '5px',
              }}>
                {generateBreadcrumb()}
              </div>
            )}
          </div>

          {/* Editor Content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {currentBranch.originalText && (
              <div style={{
                background: 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)',
                padding: '15px',
                borderLeft: '4px solid #2196f3',
                marginBottom: '20px',
                fontStyle: 'italic',
                borderRadius: '0 8px 8px 0',
                color: '#1565c0',
                fontSize: '14px',
              }}>
                "{currentBranch.originalText}"
              </div>
            )}

            <div className="rich-editor-wrapper">
              {showToolbar && (
                <EditorToolbar
                  panelId={panelId}
                  editorRef={editorRef}
                  isMainPanel={isMainPanel}
                  onToggleEditing={undefined}  // TEMPORARILY DISABLED
                  isEditing={true}  // Always editable
                  isPlainMode={isPlainMode}
                />
              )}
              
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
                    placeholder={`Start writing your ${currentBranch.type || 'note'}...`}
                    provider={plainProvider}
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

        {/* Branches Section */}
        <div style={{
          flex: 1,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '20px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
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
                    onClick={(e) => {
                      e.stopPropagation()
                      handleBranchClick(branchId)
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.95)',
                      borderRadius: '12px',
                      padding: '16px',
                      marginBottom: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      borderLeft: `4px solid ${
                        childBranch.type === 'note' ? '#2196f3' :
                        childBranch.type === 'explore' ? '#ff9800' : '#4caf50'
                      }`,
                      userSelect: 'none',
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
                )
              })
            )}
          </div>
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
