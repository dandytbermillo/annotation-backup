"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import dynamic from 'next/dynamic'
// Phase 1: Using notes explorer with API integration and feature flag
import { FloatingToolbar, type OverlayPopup, type OrgItem } from "./floating-toolbar"
import { PopupOverlay } from "@/components/canvas/popup-overlay"
import { CoordinateBridge } from "@/lib/utils/coordinate-bridge"
import { Menu } from "lucide-react"
import { LayerProvider, useLayer } from "@/components/canvas/layer-provider"
import {
  OverlayLayoutAdapter,
  OverlayLayoutConflictError,
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  type OverlayLayoutPayload,
  type OverlayPopupDescriptor,
  isOverlayPersistenceEnabled,
} from "@/lib/adapters/overlay-layout-adapter"

// Helper to derive display name from path when folder.name is empty
function deriveFromPath(path: string | undefined | null): string | null {
  if (!path || typeof path !== 'string') return null
  const trimmed = path.trim()
  if (!trimmed) return null

  // Remove trailing slashes
  const normalized = trimmed.replace(/\/+$/, '')
  if (!normalized) return null

  // Get last segment
  const segments = normalized.split('/')
  const lastSegment = segments[segments.length - 1]
  return lastSegment && lastSegment.trim() ? lastSegment.trim() : null
}

const ModernAnnotationCanvas = dynamic(
  () => import('./annotation-canvas-modern'),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
        <div className="text-white text-2xl font-semibold animate-pulse">Loading canvas...</div>
      </div>
    )
  }
)

function AnnotationAppContent() {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [canvasState, setCanvasState] = useState({
    zoom: 1,
    showConnections: true
  })
  const [showAddComponentMenu, setShowAddComponentMenu] = useState(false)

  // Floating notes widget state
  const [showNotesWidget, setShowNotesWidget] = useState(false)
  const [notesWidgetPosition, setNotesWidgetPosition] = useState({ x: 100, y: 100 })
  const activeEditorRef = useRef<any>(null) // Track the currently active editor
  const [activePanelId, setActivePanelId] = useState<string | null>(null) // Track the currently active panel ID

  // Display settings state (backdrop style preference)
  const [backdropStyle, setBackdropStyle] = useState<string>('none')

  // Overlay popups state - persists independently of toolbar (like selectedNoteId)
  const [overlayPopups, setOverlayPopups] = useState<OverlayPopup[]>([])
  const [draggingPopup, setDraggingPopup] = useState<string | null>(null)
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const draggingPopupRef = useRef<string | null>(null)
  const dragScreenPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const hoverTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const closeTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Persistence state for overlay layout
  const overlayPersistenceEnabled = isOverlayPersistenceEnabled()
  const overlayAdapterRef = useRef<OverlayLayoutAdapter | null>(null)
  const layoutLoadedRef = useRef(false)
  const layoutRevisionRef = useRef<string | null>(null)
  const lastSavedLayoutHashRef = useRef<string | null>(null)
  const pendingLayoutRef = useRef<{ payload: OverlayLayoutPayload; hash: string } | null>(null)
  const saveInFlightRef = useRef(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Debug: Log persistence state on mount
  useEffect(() => {
    console.log('[AnnotationApp] overlayPersistenceEnabled =', overlayPersistenceEnabled)
  }, [overlayPersistenceEnabled])

  // Initialize overlay adapter
  useEffect(() => {
    if (!overlayPersistenceEnabled) return
    overlayAdapterRef.current = new OverlayLayoutAdapter({ workspaceKey: 'default' })
  }, [overlayPersistenceEnabled])

  // Force re-center trigger - increment to force effect to run
  const [centerTrigger, setCenterTrigger] = useState(0)
  
  // Ref to access canvas methods
  const canvasRef = useRef<any>(null)

  // Ref to track last centered note to avoid repeated centering during normal flow
  const lastCenteredRef = useRef<string | null>(null)
  
  // Determine collaboration mode from environment
  const collabMode = process.env.NEXT_PUBLIC_COLLAB_MODE || 'plain'
  const isPlainMode = collabMode === 'plain'
  
  // Multi-layer canvas is always enabled
  const multiLayerEnabled = true
  const layerContext = useLayer()

  // Adapt overlay popups for PopupOverlay component
  // Only show popups when popups layer is active, otherwise pass empty Map
  const adaptedPopups = useMemo(() => {
    console.log('[AnnotationApp] useMemo: Recalculating adaptedPopups, overlayPopups.length:', overlayPopups.length)
    if (!multiLayerEnabled || !layerContext) return null

    // When notes layer is active, return empty Map to hide popups
    // but keep PopupOverlay component mounted to avoid re-initialization
    if (layerContext.activeLayer === 'notes') {
      return new Map()
    }

    const adapted = new Map()
    overlayPopups.forEach((popup) => {
      const adaptedPopup = {
        ...popup,
        folder: popup.folder || {
          id: popup.folderId,
          name: popup.folderName,
          type: 'folder' as const,
          children: popup.children
        },
        canvasPosition: popup.canvasPosition,
        parentId: popup.parentPopupId // Map parentPopupId to parentId for PopupOverlay
      }
      console.log('[AnnotationApp] useMemo: Adapting popup:', popup.folderId, 'folder.name:', adaptedPopup.folder?.name)
      adapted.set(popup.id, adaptedPopup)
    })
    console.log('[AnnotationApp] useMemo: Created adapted Map with', adapted.size, 'entries')
    return adapted
  }, [overlayPopups, multiLayerEnabled, layerContext, layerContext?.activeLayer])

  // Track previous popup count to detect when NEW popups are added
  const prevPopupCountRef = useRef(0)

  // Auto-switch to popups layer ONLY when NEW popups are created
  useEffect(() => {
    if (!multiLayerEnabled || !layerContext) return

    const currentCount = overlayPopups.length
    const previousCount = prevPopupCountRef.current

    // Only auto-switch when a new popup is ADDED (count increases)
    if (currentCount > previousCount && currentCount > 0) {
      if (layerContext.activeLayer !== 'popups') {
        console.log('[AnnotationApp] New popup created, auto-switching to popups layer')
        layerContext.setActiveLayer('popups')
      }
    }

    // Update the ref for next comparison
    prevPopupCountRef.current = currentCount
  }, [overlayPopups.length, multiLayerEnabled, layerContext])

  // Clear pending hover timeouts when switching TO notes layer (prevent new popups)
  // But keep existing popups in state so they can be restored when switching back
  useEffect(() => {
    if (!multiLayerEnabled || !layerContext) return

    // When user switches to notes layer, clear pending timeouts but keep popup state
    if (layerContext.activeLayer === 'notes') {
      console.log('[AnnotationApp] Switched to notes layer, clearing pending hover timeouts')

      // Clear all pending timeouts to prevent new popups from appearing
      hoverTimeoutRef.current.forEach((timeout) => clearTimeout(timeout))
      hoverTimeoutRef.current.clear()
      closeTimeoutRef.current.forEach((timeout) => clearTimeout(timeout))
      closeTimeoutRef.current.clear()
    }
  }, [layerContext?.activeLayer, multiLayerEnabled, layerContext])

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      // Clear all hover timeouts
      hoverTimeoutRef.current.forEach((timeout) => clearTimeout(timeout))
      hoverTimeoutRef.current.clear()

      // Clear all close timeouts
      closeTimeoutRef.current.forEach((timeout) => clearTimeout(timeout))
      closeTimeoutRef.current.clear()
    }
  }, [])

  // Keep draggingPopupRef in sync
  useEffect(() => {
    draggingPopupRef.current = draggingPopup
  }, [draggingPopup])

  // Handle global mouse events for dragging popup
  useEffect(() => {
    if (!draggingPopup) return

    const handleGlobalMouseMove = (e: MouseEvent) => {
      e.preventDefault()

      const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }

      // Calculate new screen position
      const newScreenPosition = {
        x: e.clientX - dragOffsetRef.current.x,
        y: e.clientY - dragOffsetRef.current.y
      }

      // Convert to canvas coordinates
      const newCanvasPosition = CoordinateBridge.screenToCanvas(newScreenPosition, sharedTransform)

      // Update popup position
      setOverlayPopups(prev =>
        prev.map(p =>
          p.id === draggingPopup
            ? { ...p, canvasPosition: newCanvasPosition, position: newScreenPosition, isDragging: true }
            : p
        )
      )

      dragScreenPosRef.current = newScreenPosition
    }

    const handleGlobalMouseUp = () => {
      if (!draggingPopup) return

      // Mark popup as no longer dragging
      setOverlayPopups(prev =>
        prev.map(p =>
          p.id === draggingPopup
            ? { ...p, isDragging: false }
            : p
        )
      )

      setDraggingPopup(null)
      draggingPopupRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    // Use capture phase for better responsiveness
    document.addEventListener('mousemove', handleGlobalMouseMove, true)
    document.addEventListener('mouseup', handleGlobalMouseUp, true)

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove, true)
      document.removeEventListener('mouseup', handleGlobalMouseUp, true)
    }
  }, [draggingPopup, layerContext]) // Stable during drag - only refs used inside

  // Build layout payload from current overlayPopups state
  const buildLayoutPayload = useCallback((): { payload: OverlayLayoutPayload; hash: string } => {
    const descriptors: OverlayPopupDescriptor[] = []
    const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }

    overlayPopups.forEach(popup => {
      const canvasPos = popup.canvasPosition
      if (!canvasPos) return

      const x = Number.isFinite(canvasPos.x) ? canvasPos.x : 0
      const y = Number.isFinite(canvasPos.y) ? canvasPos.y : 0

      // Derive display name with fallbacks to ensure we always persist a usable label
      const displayName = popup.folderName?.trim()
        || popup.folder?.name?.trim()
        || deriveFromPath((popup.folder as any)?.path)
        || 'Untitled Folder'

      const descriptor: OverlayPopupDescriptor = {
        id: popup.id,
        folderId: popup.folderId || null,
        folderName: displayName,
        folderColor: null,  // Don't cache colors - always fetch fresh from DB on restore
        parentId: popup.parentPopupId || null,
        canvasPosition: { x, y },
        level: popup.level || 0,
      }

      console.log('[Save] Saving popup:', displayName, '- color:', popup.folder?.color, '- descriptor:', JSON.stringify(descriptor))
      descriptors.push(descriptor)
    })

    const payload: OverlayLayoutPayload = {
      schemaVersion: OVERLAY_LAYOUT_SCHEMA_VERSION,
      popups: descriptors,
      inspectors: [],
      lastSavedAt: new Date().toISOString(),
    }

    const hash = JSON.stringify({
      schemaVersion: payload.schemaVersion,
      popups: payload.popups,
      inspectors: payload.inspectors,
    })

    return { payload, hash }
  }, [overlayPopups, layerContext?.transforms.popups])

  // Apply layout from database
  const applyOverlayLayout = useCallback((layout: OverlayLayoutPayload) => {
    const sanitizedPopups = Array.isArray(layout.popups) ? layout.popups : []
    const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }

    const coreHash = JSON.stringify({
      schemaVersion: layout.schemaVersion || OVERLAY_LAYOUT_SCHEMA_VERSION,
      popups: sanitizedPopups,
      inspectors: [],
    })

    lastSavedLayoutHashRef.current = coreHash
    layoutLoadedRef.current = true

    if (sanitizedPopups.length === 0) {
      console.log('[Layout Restoration] No saved popups, clearing overlay popups')
      setOverlayPopups([])
      return
    }

    // Convert descriptors back to OverlayPopup objects
    const restoredPopups: OverlayPopup[] = sanitizedPopups.map(descriptor => {
      const screenPosition = CoordinateBridge.canvasToScreen(descriptor.canvasPosition, sharedTransform)

      // Use stored folder name with fallback to ensure we have a displayable label
      const displayName = descriptor.folderName?.trim() || 'Untitled Folder'

      console.log('[Restore] Descriptor for', displayName, ':', {
        folderId: descriptor.folderId,
        folderColor: descriptor.folderColor,
        parentId: descriptor.parentId
      })

      const restoredPopup = {
        id: descriptor.id,
        folderId: descriptor.folderId || '',
        folderName: displayName,
        folder: descriptor.folderId ? {
          id: descriptor.folderId,
          name: displayName,
          type: 'folder' as const,
          level: descriptor.level || 0,
          color: descriptor.folderColor || undefined,
          children: []
        } : null, // Will be loaded when needed
        position: screenPosition,
        canvasPosition: descriptor.canvasPosition,
        children: [],
        isLoading: Boolean(descriptor.folderId),
        isPersistent: true,
        level: descriptor.level || 0,
        parentPopupId: descriptor.parentId || undefined,
      }

      console.log('[Restore] Initial popup.folder.color for', displayName, ':', restoredPopup.folder?.color)

      return restoredPopup
    })

    setOverlayPopups(restoredPopups)

    // Fetch folder data for each popup (needed to get color if not cached)
    restoredPopups.forEach(async (popup) => {
      if (!popup.folderId) return

      try {
        const response = await fetch(`/api/items/${popup.folderId}`)
        if (!response.ok) {
          console.error('[Popup Restore] Failed to fetch folder:', popup.folderId, 'status:', response.status)
          return
        }

        const responseData = await response.json()
        const folderData = responseData.item || responseData

        // Get the cached color from the descriptor
        const cachedColor = popup.folder?.color

        console.log('[Restore] Processing', folderData.name, '- DB color:', folderData.color, ', cached:', cachedColor)

        // Start with folder's own color, fall back to cached
        let effectiveColor = folderData.color || cachedColor

        // Walk up ancestor chain if we have no color at all (neither DB nor cache)
        if (!effectiveColor) {
          const initialParentId = folderData.parentId ?? folderData.parent_id
          console.log('[Restore] No color for', folderData.name, '- walking ancestor chain from:', initialParentId)
          if (initialParentId) {
            try {
              let currentParentId = initialParentId
              let depth = 0
              const maxDepth = 10 // Prevent infinite loops

              while (currentParentId && !effectiveColor && depth < maxDepth) {
                const parentResponse = await fetch(`/api/items/${currentParentId}`)
                if (!parentResponse.ok) break

                const parentData = await parentResponse.json()
                const parent = parentData.item || parentData

                if (parent.color) {
                  effectiveColor = parent.color
                  console.log('[Restore] Inherited color from ancestor:', parent.name, 'color:', effectiveColor, 'depth:', depth + 1)
                  break
                }

                // Move up to next parent
                currentParentId = parent.parentId ?? parent.parent_id
                depth++
              }

              if (!effectiveColor) {
                console.log('[Restore] No color found in ancestor chain after', depth, 'levels')
              }
            } catch (e) {
              console.warn('[Popup Restore] Failed to fetch ancestor color:', e)
            }
          }
        }

        console.log('[Restore] Final effectiveColor for', folderData.name, ':', effectiveColor)

        // Fetch children
        const childrenResponse = await fetch(`/api/items?parentId=${popup.folderId}`)
        if (!childrenResponse.ok) return

        const childrenData = await childrenResponse.json()
        const children = (childrenData.items || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
          color: item.color,
          path: item.path,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          hasChildren: item.type === 'folder',
          level: popup.level + 1,
          children: [],
          parentId: item.parentId,
        }))

        setOverlayPopups(prev => {
          const updated = prev.map(p => {
            if (p.id !== popup.id) return p

            // Derive display name with fallbacks to prevent blank name from wiping cached label
            const displayName = folderData.name?.trim()
              || deriveFromPath(folderData.path)
              || p.folderName?.trim()  // Keep existing cached name if new data has no name
              || 'Untitled Folder'

            return {
              ...p,
              folderName: displayName,
              folder: {
                id: folderData.id,
                name: displayName,
                type: 'folder' as const,
                level: p.level,
                color: effectiveColor,
                path: folderData.path,
                children,
              },
              children,
              isLoading: false,
            }
          })

          return updated
        })
      } catch (error) {
        console.error(`Failed to load folder ${popup.folderId}:`, error)
      }
    })
  }, [layerContext?.transforms.popups])

  // Flush pending save to database
  const flushLayoutSave = useCallback(async () => {
    if (!overlayPersistenceEnabled) return

    const adapter = overlayAdapterRef.current
    if (!adapter) return

    const pending = pendingLayoutRef.current ?? (() => {
      const snapshot = buildLayoutPayload()
      return snapshot.hash === lastSavedLayoutHashRef.current ? null : snapshot
    })()

    if (!pending) return

    if (saveInFlightRef.current) {
      pendingLayoutRef.current = pending
      return
    }

    pendingLayoutRef.current = null
    saveInFlightRef.current = true

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }

    try {
      const envelope = await adapter.saveLayout({
        layout: pending.payload,
        version: pending.payload.schemaVersion,
        revision: layoutRevisionRef.current,
      })

      layoutRevisionRef.current = envelope.revision
      lastSavedLayoutHashRef.current = JSON.stringify({
        schemaVersion: envelope.layout.schemaVersion,
        popups: envelope.layout.popups,
        inspectors: envelope.layout.inspectors,
      })
      console.log('[AnnotationApp] Saved overlay layout to database')
    } catch (error) {
      if (error instanceof OverlayLayoutConflictError) {
        const envelope = error.payload
        layoutRevisionRef.current = envelope.revision
        lastSavedLayoutHashRef.current = JSON.stringify({
          schemaVersion: envelope.layout.schemaVersion,
          popups: envelope.layout.popups,
          inspectors: envelope.layout.inspectors,
        })
        applyOverlayLayout(envelope.layout)
        console.log('[AnnotationApp] Resolved layout conflict from database')
      } else {
        console.error('[AnnotationApp] Failed to save overlay layout:', error)
        pendingLayoutRef.current = pending
      }
    } finally {
      saveInFlightRef.current = false
      if (pendingLayoutRef.current) {
        void flushLayoutSave()
      }
    }
  }, [applyOverlayLayout, buildLayoutPayload, overlayPersistenceEnabled])

  // Schedule save with debounce (or immediate for creation/deletion)
  const scheduleLayoutSave = useCallback((immediate = false) => {
    if (!overlayPersistenceEnabled) return
    if (!overlayAdapterRef.current) return

    const snapshot = buildLayoutPayload()

    if (snapshot.hash === lastSavedLayoutHashRef.current) {
      pendingLayoutRef.current = null
      return
    }

    if (saveInFlightRef.current) {
      pendingLayoutRef.current = snapshot
      return
    }

    pendingLayoutRef.current = snapshot

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    if (immediate) {
      // Immediate save (for creation/deletion - existence changes)
      console.log('[AnnotationApp] Saving immediately (existence change)...')
      void flushLayoutSave()
    } else {
      // Debounced save (for moves, resizes, etc. - property changes)
      saveTimeoutRef.current = setTimeout(() => {
        void flushLayoutSave()
      }, 2500) // 2.5 second debounce
    }
  }, [buildLayoutPayload, flushLayoutSave, overlayPersistenceEnabled])

  // Load layout from database on mount
  useEffect(() => {
    if (!overlayPersistenceEnabled || layoutLoadedRef.current) return

    const adapter = overlayAdapterRef.current
    if (!adapter) return

    let cancelled = false

    void (async () => {
      try {
        console.log('[AnnotationApp] Loading overlay layout from database...')
        const envelope = await adapter.loadLayout()
        if (cancelled) return

        if (!envelope) {
          console.log('[AnnotationApp] No saved layout found')
          layoutLoadedRef.current = true
          return
        }

        console.log('[AnnotationApp] Loaded overlay layout from database:', envelope.layout.popups.length, 'popups')
        layoutRevisionRef.current = envelope.revision
        lastSavedLayoutHashRef.current = JSON.stringify({
          schemaVersion: envelope.layout.schemaVersion,
          popups: envelope.layout.popups,
          inspectors: envelope.layout.inspectors,
        })
        applyOverlayLayout(envelope.layout)
      } catch (error) {
        if (!cancelled) {
          console.error('[AnnotationApp] Failed to load overlay layout:', error)
        }
      } finally {
        if (!cancelled) {
          layoutLoadedRef.current = true
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyOverlayLayout, overlayPersistenceEnabled])

  // Save layout when overlayPopups changes
  // Use a ref to track if we need to save, to avoid infinite loops
  const prevPopupsRef = useRef<OverlayPopup[]>([])

  useEffect(() => {
    console.log('[AnnotationApp] Save effect triggered. overlayPersistenceEnabled =', overlayPersistenceEnabled, 'overlayPopups.length =', overlayPopups.length, 'layoutLoaded =', layoutLoadedRef.current)
    if (!overlayPersistenceEnabled) {
      console.log('[AnnotationApp] Save skipped: persistence disabled')
      return
    }
    if (!layoutLoadedRef.current) {
      console.log('[AnnotationApp] Save skipped: layout not loaded yet')
      prevPopupsRef.current = overlayPopups
      return
    }

    // Check if popups actually changed (not just re-render)
    const changed = JSON.stringify(overlayPopups) !== JSON.stringify(prevPopupsRef.current)
    if (!changed) {
      console.log('[AnnotationApp] Save skipped: no changes detected')
      return
    }

    // Detect if this is a creation or deletion (existence change vs property change)
    const isCreation = overlayPopups.length > prevPopupsRef.current.length
    const isDeletion = overlayPopups.length < prevPopupsRef.current.length
    const isExistenceChange = isCreation || isDeletion

    if (isCreation) {
      console.log('[AnnotationApp] Scheduling save... (IMMEDIATE - creation)')
    } else if (isDeletion) {
      console.log('[AnnotationApp] Scheduling save... (IMMEDIATE - deletion)')
    } else {
      console.log('[AnnotationApp] Scheduling save... (debounced - property change)')
    }

    prevPopupsRef.current = overlayPopups
    scheduleLayoutSave(isExistenceChange) // Immediate save for creation/deletion, debounced for moves/resizes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayPopups, overlayPersistenceEnabled])

  // Handle note selection with force re-center support
  const handleNoteSelect = (noteId: string) => {
    if (noteId === selectedNoteId) {
      // Same note clicked - force re-center by incrementing trigger
      setCenterTrigger(prev => prev + 1)
    } else {
      // Different note - normal selection
      setSelectedNoteId(noteId)
    }
  }
  
  // Center panel when note selection changes or when forced
  useEffect(() => {
    if (!selectedNoteId) return
    
    // Always center when this effect runs (triggered by selectedNoteId change or centerTrigger change)
    lastCenteredRef.current = selectedNoteId
    
    // Use a slight delay to ensure panel has time to mount
    const timeoutId = setTimeout(() => {
      canvasRef.current?.centerOnPanel?.('main')
    }, 50) // Small delay to allow React to render the panel
    return () => clearTimeout(timeoutId)
  }, [selectedNoteId, centerTrigger]) // Also watch centerTrigger

  // Handle right-click to show notes widget
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()

    // Find which panel was right-clicked
    let target = e.target as HTMLElement
    let panelElement: HTMLElement | null = null

    // Traverse up the DOM tree to find the panel element
    while (target && target !== e.currentTarget) {
      if (target.dataset?.panelId) {
        panelElement = target
        break
      }
      target = target.parentElement as HTMLElement
    }

    // If a panel was right-clicked, register it as active
    if (panelElement?.dataset?.panelId) {
      const panelId = panelElement.dataset.panelId
      console.log('[AnnotationApp] Right-click detected on panel:', panelId)
      setActivePanelId(panelId)
    }

    setNotesWidgetPosition({ x: e.clientX, y: e.clientY })
    setShowNotesWidget(true)
  }, [])

  // Handle closing notes widget
  const handleCloseNotesWidget = useCallback(() => {
    setShowNotesWidget(false)
  }, [])

  // Track mouse position for keyboard shortcut
  const mousePositionRef = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Listen for text selection events from editor
  useEffect(() => {
    const handleShowToolbarOnSelection = (e: Event) => {
      const customEvent = e as CustomEvent
      const { x, y, autoOpenFormat } = customEvent.detail

      setNotesWidgetPosition({ x, y })
      setShowNotesWidget(true)

      // Auto-open Format panel if requested
      // This will be handled by FloatingToolbar component
      if (autoOpenFormat) {
        // Store in window for FloatingToolbar to pick up
        ;(window as any).__autoOpenFormatPanel = true
      }
    }

    window.addEventListener('show-floating-toolbar-on-selection', handleShowToolbarOnSelection)
    return () => window.removeEventListener('show-floating-toolbar-on-selection', handleShowToolbarOnSelection)
  }, [])

  // Keyboard shortcut to open floating toolbar (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()

        // Use last known mouse position
        const { x, y } = mousePositionRef.current

        setNotesWidgetPosition({ x, y })
        setShowNotesWidget(true)
      }

      // Escape to close toolbar
      if (e.key === 'Escape' && showNotesWidget) {
        setShowNotesWidget(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showNotesWidget])

  // Handle registering active editor (called by panels when they gain focus)
  const handleRegisterActiveEditor = useCallback((editorRef: any, panelId: string) => {
    console.log('[AnnotationApp] Registering active editor for panel:', panelId)
    activeEditorRef.current = editorRef
    setActivePanelId(panelId)
  }, [])

  // Handle adding component (callback from FloatingToolbar)
  const handleAddComponentFromToolbar = useCallback((type: string, position?: { x: number; y: number }) => {
    // Call the canvas's addComponent method directly
    if (canvasRef.current?.addComponent) {
      canvasRef.current.addComponent(type, position)
    }
  }, [])

  // Handle backdrop style change (callback from FloatingToolbar)
  const handleBackdropStyleChange = useCallback((style: string) => {
    setBackdropStyle(style)
  }, [])

  // Handle folder renamed (callback from FloatingToolbar)
  const handleFolderRenamed = useCallback((folderId: string, newName: string) => {
    console.log('[AnnotationApp] Folder renamed - folderId:', folderId, 'newName:', newName)
    setOverlayPopups(prev => {
      console.log('[AnnotationApp] Current popups:', prev.map(p => ({
        id: p.id,
        folderId: p.folderId,
        folderName: p.folderName,
        'folder.name': p.folder?.name
      })))

      const updated = prev.map(popup => {
        if (popup.folderId === folderId) {
          console.log('[AnnotationApp] ✅ MATCH! Updating popup:', popup.folderName, '→', newName)
          // Update both folderName AND folder.name (title reads from folder.name)
          return {
            ...popup,
            folderName: newName,
            folder: popup.folder ? { ...popup.folder, name: newName } : null
          }
        }
        console.log('[AnnotationApp] ❌ NO MATCH for popup folderId:', popup.folderId, 'vs', folderId)
        return popup
      })

      console.log('[AnnotationApp] Updated popups:', updated.map(p => ({
        id: p.id,
        folderId: p.folderId,
        folderName: p.folderName,
        'folder.name': p.folder?.name
      })))

      return updated
    })
  }, [])

  // Handle creating overlay popup (callback from FloatingToolbar)
  const handleCreateOverlayPopup = useCallback((popup: OverlayPopup, shouldHighlight: boolean = false) => {
    console.log('[handleCreateOverlayPopup] Adding popup:', popup.folderName, 'folderId:', popup.folderId, 'shouldHighlight:', shouldHighlight);
    setOverlayPopups(prev => {
      console.log('[handleCreateOverlayPopup] Current popups:', prev.length, prev.map(p => p.folderName));

      // Check if popup with same ID already exists
      const existingIndex = prev.findIndex(p => p.id === popup.id)
      if (existingIndex >= 0) {
        console.log('[handleCreateOverlayPopup] Popup already exists at index', existingIndex);

        // If shouldHighlight is true, just highlight - don't replace data or position
        if (shouldHighlight) {
          console.log('[handleCreateOverlayPopup] Just highlighting existing popup IN PLACE, not moving');
          console.log('[handleCreateOverlayPopup] Setting isHighlighted to TRUE for popup:', prev[existingIndex].folderName);
          const updated = [...prev]
          // Only update isHighlighted flag, keep existing position and data
          updated[existingIndex] = { ...updated[existingIndex], isHighlighted: true }
          console.log('[handleCreateOverlayPopup] Updated popup isHighlighted:', updated[existingIndex].isHighlighted);
          return updated
        }

        // Otherwise update popup data (e.g., when children are loaded)
        // Preserve position when just updating children
        console.log('[handleCreateOverlayPopup] Updating existing popup data, preserving position');
        const updated = [...prev]
        updated[existingIndex] = {
          ...popup,
          // Preserve existing position - don't move popup when updating children
          position: updated[existingIndex].position,
          canvasPosition: updated[existingIndex].canvasPosition,
          isHighlighted: updated[existingIndex].isHighlighted
        }
        return updated
      }

      // Check if popup with same folder already exists (shouldn't happen with deterministic IDs, but keep as safety)
      const folderExists = prev.some(p => p.folderId === popup.folderId)
      if (folderExists) {
        console.log('[handleCreateOverlayPopup] Popup for this folder already exists (different ID), highlighting it');
        return prev.map(p =>
          p.folderId === popup.folderId
            ? { ...p, isHighlighted: true }
            : p
        )
      }

      // Add new popup
      console.log('[handleCreateOverlayPopup] Adding new popup. New count will be:', prev.length + 1);
      return [...prev, popup]
    })

    // If highlighting, clear the highlight after animation (2 seconds)
    if (shouldHighlight) {
      setTimeout(() => {
        setOverlayPopups(prev =>
          prev.map(p =>
            p.id === popup.id ? { ...p, isHighlighted: false } : p
          )
        )
      }, 2000)
    }
  }, [])

  // Handle closing overlay popup
  const handleCloseOverlayPopup = useCallback((popupId: string) => {
    // Find the popup to get its folderId for timeout cleanup
    const popup = overlayPopups.find(p => p.id === popupId)

    if (popup) {
      // Clean up any pending timeouts for this popup
      const timeoutKey = popup.parentPopupId ? `${popup.parentPopupId}-${popup.folderId}` : popup.folderId

      // Clear hover timeout
      const hoverTimeout = hoverTimeoutRef.current.get(timeoutKey)
      if (hoverTimeout) {
        clearTimeout(hoverTimeout)
        hoverTimeoutRef.current.delete(timeoutKey)
      }

      // Clear close timeout
      const closeTimeout = closeTimeoutRef.current.get(timeoutKey)
      if (closeTimeout) {
        clearTimeout(closeTimeout)
        closeTimeoutRef.current.delete(timeoutKey)
      }
    }

    setOverlayPopups(prev => prev.filter(p => p.id !== popupId))
    // Save will be triggered automatically by the save effect with immediate save
  }, [overlayPopups])

  // Handle folder hover inside popup (creates cascading child popups)
  const handleFolderHover = useCallback(async (folder: OrgItem, event: React.MouseEvent, parentPopupId: string, isPersistent: boolean = false) => {
    console.log('[handleFolderHover]', { folderName: folder.name, folderId: folder.id, parentPopupId, isPersistent })

    // Check if popup already exists for this folder
    const existingPopup = overlayPopups.find(p => p.folderId === folder.id)

    if (existingPopup) {
      console.log('[handleFolderHover] ✅ EXISTING POPUP FOUND:', existingPopup.folderName, 'existing.isPersistent:', existingPopup.isPersistent, 'click.isPersistent:', isPersistent)

      if (isPersistent) {
        const alreadyPersistent = existingPopup.isPersistent

        console.log(alreadyPersistent
          ? '[handleFolderHover] 🌟 Already persistent - HIGHLIGHTING'
          : '[handleFolderHover] ⬆️ Upgrading hover preview to persistent (no highlight)')

        setOverlayPopups(prev =>
          prev.map(p =>
            p.folderId === folder.id
              ? {
                  ...p,
                  isPersistent: true,
                  isHighlighted: alreadyPersistent, // only flash if this popup had been pinned before
                }
              : p
          )
        )

        if (alreadyPersistent) {
          setTimeout(() => {
            setOverlayPopups(prev =>
              prev.map(p =>
                p.folderId === folder.id ? { ...p, isHighlighted: false } : p
              )
            )
          }, 2000)
        }
      }
      return
    }

    console.log('[handleFolderHover] ❌ NO EXISTING POPUP - creating new one with isHighlighted=false')

    // Capture rect position IMMEDIATELY (before any async/timeout)
    const rect = event.currentTarget.getBoundingClientRect()

    // For non-persistent (hover) popups, use a timeout
    const timeoutKey = parentPopupId ? `${parentPopupId}-${folder.id}` : folder.id

    if (!isPersistent) {
      // Clear any existing timeout for this folder
      if (hoverTimeoutRef.current.has(timeoutKey)) {
        clearTimeout(hoverTimeoutRef.current.get(timeoutKey)!)
        hoverTimeoutRef.current.delete(timeoutKey)
      }

      // Set timeout to show hover tooltip after 300ms
      const timeout = setTimeout(() => {
        hoverTimeoutRef.current.delete(timeoutKey)
        // Create temporary hover popup (pass captured rect)
        createPopup(folder, rect, parentPopupId, false)
      }, 300)

      hoverTimeoutRef.current.set(timeoutKey, timeout)
      return
    }

    // For persistent (click) popups, create immediately
    createPopup(folder, rect, parentPopupId, true)

    async function createPopup(folder: OrgItem, rect: DOMRect, parentPopupId: string, isPersistent: boolean) {
      // Check again if popup exists (might have been created during timeout)
      const currentOverlayPopups = overlayPopups
      const exists = currentOverlayPopups.some(p => p.folderId === folder.id)
      if (exists) return
      const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }

      // Inherit color from parent popup (already open) - FAST, no API call needed!
      let inheritedColor = folder.color
      if (!inheritedColor && parentPopupId) {
        const parentPopup = currentOverlayPopups.find(p => p.id === parentPopupId)

        // If parent popup has color in folder object, use it
        if (parentPopup?.folder?.color) {
          inheritedColor = parentPopup.folder.color
          console.log('[createPopup] ⚡ Inherited color from parent popup folder:', parentPopup.folderName, 'color:', inheritedColor)
        }
        // If parent is still loading but we have folder data with color, use that
        else if (parentPopup?.isLoading && folder.color) {
          inheritedColor = folder.color
          console.log('[createPopup] ⚡ Using folder own color (parent still loading):', inheritedColor)
        }
        // Last resort: walk up ancestor chain via API
        else if (!parentPopup?.isLoading) {
          console.log('[createPopup] Parent popup has no color and not loading, checking ancestors via API')
          const initialParentId = folder.parentId ?? (folder as any).parent_id
          if (initialParentId) {
            try {
              let currentParentId = initialParentId
              let depth = 0
              const maxDepth = 10

              while (currentParentId && !inheritedColor && depth < maxDepth) {
                const parentResponse = await fetch(`/api/items/${currentParentId}`)
                if (!parentResponse.ok) break

                const parentData = await parentResponse.json()
                const parent = parentData.item || parentData

                if (parent.color) {
                  inheritedColor = parent.color
                  console.log('[createPopup] Inherited color from ancestor via API:', parent.name, 'color:', inheritedColor, 'depth:', depth + 1)
                  break
                }

                currentParentId = parent.parentId ?? parent.parent_id
                depth++
              }
            } catch (e) {
              console.warn('[createPopup] Failed to fetch ancestor color:', e)
            }
          }
        }
      }

      // Position child popup to the right of parent
      const spaceRight = window.innerWidth - rect.right
      let popupPosition = { x: rect.right + 10, y: rect.top }

      if (spaceRight < 320) {
        popupPosition = { x: rect.left - 320, y: rect.top }
      }

      const popupId = `overlay-popup-${Date.now()}-${folder.id}`
      const canvasPosition = CoordinateBridge.screenToCanvas(popupPosition, sharedTransform)
      const screenPosition = CoordinateBridge.canvasToScreen(canvasPosition, sharedTransform)

      const newPopup: OverlayPopup = {
        id: popupId,
        folderId: folder.id,
        folderName: folder.name,
        folder: {
          id: folder.id,
          name: folder.name,
          type: 'folder' as const,
          level: (currentOverlayPopups.find(p => p.id === parentPopupId)?.level || 0) + 1,
          color: inheritedColor,
          path: (folder as any).path,
          children: []
        },
        position: screenPosition,
        canvasPosition: canvasPosition,
        children: [],
        isLoading: true,
        isPersistent: isPersistent,
        isHighlighted: false, // Never glow on first creation
        level: (currentOverlayPopups.find(p => p.id === parentPopupId)?.level || 0) + 1,
        parentPopupId: parentPopupId || undefined
      }

      console.log('[createPopup] 📦 Creating NEW popup:', folder.name, 'color:', inheritedColor, 'isHighlighted:', newPopup.isHighlighted)
      setOverlayPopups(prev => [...prev, newPopup])

      // Fetch children
      try {
        const response = await fetch(`/api/items?parentId=${folder.id}`)
        if (!response.ok) throw new Error('Failed to fetch folder contents')

        const data = await response.json()
        const children = data.items || []

        const formattedChildren: OrgItem[] = children.map((item: any) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
          color: item.color,
          path: item.path,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          hasChildren: item.type === 'folder',
          level: folder.level + 1,
          children: [],
          parentId: item.parentId
        }))

        setOverlayPopups(prev =>
          prev.map(p =>
            p.id === popupId
              ? {
                  ...p,
                  children: formattedChildren,
                  isLoading: false,
                  folder: {
                    ...p.folder,  // Preserve existing folder object (has inherited color)
                    children: formattedChildren
                  }
                }
              : p
          )
        )
      } catch (error) {
        console.error('Error fetching child popup contents:', error)
        setOverlayPopups(prev => prev.filter(p => p.id !== popupId))
      }
    }
  }, [overlayPopups, layerContext])

  // Cancel close timeout when hovering the popup itself (keeps it alive)
  const handlePopupHover = useCallback((folderId: string, parentPopupId?: string) => {
    console.log('[handlePopupHover] CALLED', { folderId, parentPopupId, hasTimeouts: closeTimeoutRef.current.size })

    // Try multiple possible timeout keys since we might not know the exact parent
    const possibleKeys = [
      folderId, // Simple key (no parent)
      parentPopupId ? `${parentPopupId}-${folderId}` : null, // With known parent
    ].filter(Boolean) as string[]

    // Also try all keys that end with this folderId
    closeTimeoutRef.current.forEach((timeout, key) => {
      if (key.endsWith(folderId) && !possibleKeys.includes(key)) {
        possibleKeys.push(key)
      }
    })

    console.log('[handlePopupHover] Trying timeout keys:', possibleKeys)
    console.log('[handlePopupHover] Available timeouts:', Array.from(closeTimeoutRef.current.keys()))

    let found = false
    for (const key of possibleKeys) {
      const timeout = closeTimeoutRef.current.get(key)
      if (timeout) {
        clearTimeout(timeout)
        closeTimeoutRef.current.delete(key)
        console.log('[handlePopupHover] ✅ Cancelled close timeout for', key)
        found = true
        break
      }
    }

    if (!found) {
      console.log('[handlePopupHover] ❌ No matching timeout found')
    }
  }, [])

  // Handle folder hover leave (for temporary tooltips)
  const handleFolderHoverLeave = useCallback((folderId?: string, parentPopupId?: string) => {
    console.log('[handleFolderHoverLeave]', { folderId, parentPopupId })

    if (!folderId) return

    // Clear hover timeout if user leaves before tooltip appears
    const timeoutKey = parentPopupId ? `${parentPopupId}-${folderId}` : folderId
    if (hoverTimeoutRef.current.has(timeoutKey)) {
      clearTimeout(hoverTimeoutRef.current.get(timeoutKey)!)
      hoverTimeoutRef.current.delete(timeoutKey)
    }

    // Set close timeout and STORE IT so it can be cancelled when hovering the popup
    const closeTimeout = setTimeout(() => {
      closeTimeoutRef.current.delete(timeoutKey)
      // Close temporary (non-persistent) hover popups for this folder
      setOverlayPopups(prev =>
        prev.filter(p => {
          // Keep popup if it's persistent (clicked) or if it's for a different folder
          if (p.isPersistent) return true
          if (p.folderId !== folderId) return true
          // Remove non-persistent hover popup for this folder
          return false
        })
      )
    }, 300) // 300ms delay to allow moving to tooltip (same as organization panel)

    closeTimeoutRef.current.set(timeoutKey, closeTimeout)
  }, [])

  // Handle delete selected items from popup
  const handleDeleteSelected = useCallback(async (popupId: string, selectedIds: Set<string>) => {
    console.log('[handleDeleteSelected]', { popupId, selectedIds: Array.from(selectedIds) })

    try {
      // Delete each selected item via API and track which ones succeed
      const deleteResults = await Promise.all(
        Array.from(selectedIds).map(async (itemId) => {
          try {
            const response = await fetch(`/api/items/${itemId}`, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json'
              }
            })

            if (!response.ok && response.status !== 404) {
              // 404 is ok (already deleted), but other errors should be logged
              console.error(`Failed to delete item ${itemId}:`, response.status)
              return { itemId, success: false }
            }

            console.log(`Successfully deleted item ${itemId}`)
            return { itemId, success: true }
          } catch (error) {
            console.error(`Error deleting item ${itemId}:`, error)
            return { itemId, success: false }
          }
        })
      )

      // Get IDs of items that were actually deleted successfully
      const successfullyDeletedIds = new Set(
        deleteResults.filter(r => r.success).map(r => r.itemId)
      )
      const successCount = successfullyDeletedIds.size

      console.log(`Deleted ${successCount}/${selectedIds.size} items`)

      // Only remove items that were successfully deleted
      if (successCount > 0) {
        console.log('[handleDeleteSelected] Updating popup to remove successfully deleted items...')

        setOverlayPopups(prev =>
          prev.map(p => {
            if (p.id === popupId && p.folder && p.children) {
              // Filter out ONLY successfully deleted items (safety: failed deletes remain visible)
              const updatedChildren = p.children.filter(child => !successfullyDeletedIds.has(child.id))

              return {
                ...p,
                children: updatedChildren,
                folder: {
                  ...p.folder,
                  children: updatedChildren
                }
              }
            }
            return p
          })
        )

        console.log('[handleDeleteSelected] Popup updated - removed', successCount, 'successfully deleted items')
      }

      // Warn user if some deletes failed
      const failedCount = selectedIds.size - successCount
      if (failedCount > 0) {
        console.warn(`[handleDeleteSelected] ${failedCount} item(s) failed to delete - they remain visible`)
        // Could show user notification here
      }
    } catch (error) {
      console.error('[handleDeleteSelected] Error:', error)
    }
  }, [overlayPopups])

  // Handle bulk move of items to target folder (drag-drop)
  const handleFolderCreated = useCallback((popupId: string, newFolder: any) => {
    console.log('[handleFolderCreated]', { popupId, newFolder })

    // Update the popup's children to include the new folder
    setOverlayPopups(prev =>
      prev.map(popup => {
        if (popup.id === popupId && popup.folder) {
          // Add new folder to the beginning of children array (folders typically shown first)
          const updatedChildren = [newFolder, ...popup.children]
          return {
            ...popup,
            children: updatedChildren,
            folder: { ...popup.folder, children: updatedChildren }
          }
        }
        return popup
      })
    )

    console.log('[handleFolderCreated] Popup updated with new folder')
  }, [])

  const handleBulkMove = useCallback(async (
    itemIds: string[],
    targetFolderId: string,
    sourcePopupId: string
  ) => {
    console.log('[handleBulkMove] Moving items:', { itemIds, targetFolderId, sourcePopupId })

    try {
      // Call bulk-move API
      const response = await fetch('/api/items/bulk-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds, targetFolderId })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to move items')
      }

      const data = await response.json()

      // CRITICAL: Track which items actually moved (same pattern as delete)
      const successfullyMovedIds = new Set(
        (data.movedItems || []).map((item: any) => item.id)
      )
      const movedCount = successfullyMovedIds.size

      console.log(`[handleBulkMove] Successfully moved ${movedCount}/${itemIds.length} items`)

      // Only update UI for items that actually moved
      if (movedCount > 0) {
        setOverlayPopups(prev =>
          prev.map(popup => {
            // Update source popup: remove successfully moved items
            if (popup.id === sourcePopupId && popup.folder && popup.children) {
              const updatedChildren = popup.children.filter(
                child => !successfullyMovedIds.has(child.id)
              )
              return {
                ...popup,
                children: updatedChildren,
                folder: { ...popup.folder, children: updatedChildren }
              }
            }

            // Update target popup: add successfully moved items (prevent duplicates)
            if (popup.folderId === targetFolderId && popup.folder) {
              const movedItems = data.movedItems || []

              // Get IDs of existing children to prevent duplicates
              const existingIds = new Set(popup.children.map(child => child.id))

              // Filter out items that already exist in this popup
              const newItems = movedItems.filter((item: any) => !existingIds.has(item.id))

              // Append only new items
              const updatedChildren = [...popup.children, ...newItems]

              return {
                ...popup,
                children: updatedChildren,
                folder: { ...popup.folder, children: updatedChildren }
              }
            }

            return popup
          })
        )

        console.log('[handleBulkMove] Source popup updated - removed', movedCount, 'moved items')
        console.log('[handleBulkMove] Target popup auto-refresh applied if popup is open')
      }

      // Warn if some moves failed
      const failedCount = itemIds.length - movedCount
      if (failedCount > 0) {
        console.warn(`[handleBulkMove] ${failedCount} item(s) failed to move`)
        // Optional: Show user notification
      }

    } catch (error) {
      console.error('[handleBulkMove] Error:', error)
      alert(`Failed to move items: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [])

  // Handle popup drag start
  const handlePopupDragStart = useCallback((popupId: string, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const popup = overlayPopups.find(p => p.id === popupId)
    if (!popup) return

    // Get the shared transform for coordinate conversion
    const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }

    // Calculate offset between mouse position and popup position
    const screenPosition = CoordinateBridge.canvasToScreen(popup.canvasPosition, sharedTransform)
    const offset = {
      x: event.clientX - screenPosition.x,
      y: event.clientY - screenPosition.y
    }

    dragOffsetRef.current = offset
    setDraggingPopup(popupId)
    draggingPopupRef.current = popupId
    dragScreenPosRef.current = { x: screenPosition.x, y: screenPosition.y }

    // Mark popup as dragging
    setOverlayPopups(prev =>
      prev.map(p => p.id === popupId ? { ...p, isDragging: true } : p)
    )

    // Prevent text selection
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }, [overlayPopups, layerContext])

  // Navigation control functions
  const handleZoomIn = () => {
    setCanvasState(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.1, 2) }))
    if (canvasRef.current?.zoomIn) {
      canvasRef.current.zoomIn()
    }
  }

  const handleZoomOut = () => {
    setCanvasState(prev => ({ ...prev, zoom: Math.max(prev.zoom * 0.9, 0.3) }))
    if (canvasRef.current?.zoomOut) {
      canvasRef.current.zoomOut()
    }
  }

  const handleResetView = () => {
    setCanvasState(prev => ({ ...prev, zoom: 1 }))
    if (canvasRef.current?.resetView) {
      canvasRef.current.resetView()
    }
  }

  const handleToggleConnections = () => {
    setCanvasState(prev => ({ ...prev, showConnections: !prev.showConnections }))
    if (canvasRef.current?.toggleConnections) {
      canvasRef.current.toggleConnections()
    }
  }

  // Feature flag for Phase 1 API (can be toggled via environment variable or UI)
  const usePhase1API = process.env.NEXT_PUBLIC_USE_PHASE1_API === 'true' || false
  const isPopupLayerActive = multiLayerEnabled && layerContext?.activeLayer === 'popups'
  
  return (
    <div
      className="flex h-screen w-screen overflow-hidden relative"
      onContextMenu={handleContextMenu}
    >
      {/* Floating Toolbar */}
      {showNotesWidget && (
        <FloatingToolbar
          x={notesWidgetPosition.x}
          y={notesWidgetPosition.y}
          onClose={handleCloseNotesWidget}
          onSelectNote={handleNoteSelect}
          onCreateOverlayPopup={handleCreateOverlayPopup}
          onAddComponent={handleAddComponentFromToolbar}
          editorRef={activeEditorRef}
          activePanelId={activePanelId}
          onBackdropStyleChange={handleBackdropStyleChange}
          onFolderRenamed={handleFolderRenamed}
        />
      )}
      
      {/* Canvas Area - Full width when explorer is closed */}
      <div 
        className="flex-1 relative transition-all duration-300 ease-in-out"
        style={{
          // Disable pointer events when popup layer is active
          pointerEvents: isPopupLayerActive ? 'none' : 'auto',
          // Ensure canvas stays below popups even with z-index escalation
          position: 'relative',
          zIndex: 1,
          isolation: 'isolate',
        }}
      >
        {selectedNoteId ? (
          <ModernAnnotationCanvas
            key={selectedNoteId}
            noteId={selectedNoteId}
            ref={canvasRef}
            isNotesExplorerOpen={false}
            onCanvasStateChange={setCanvasState}
            showAddComponentMenu={showAddComponentMenu}
            onToggleAddComponentMenu={() => setShowAddComponentMenu(!showAddComponentMenu)}
            onRegisterActiveEditor={handleRegisterActiveEditor}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-950">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-600 mb-4">
                Welcome to Annotation Canvas
              </h2>
              <p className="text-gray-500 mb-6">
                Right-click anywhere to open Notes Explorer and create a new note
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Overlay canvas popups - always mounted to avoid re-initialization */}
      {/* Shows empty Map when notes layer is active, popups when popups layer is active */}
      {multiLayerEnabled && adaptedPopups && (
        <PopupOverlay
          popups={adaptedPopups}
          draggingPopup={draggingPopup}
          onClosePopup={handleCloseOverlayPopup}
          onDragStart={handlePopupDragStart}
          onHoverFolder={handleFolderHover}
          onLeaveFolder={handleFolderHoverLeave}
          onPopupHover={handlePopupHover}
          onSelectNote={handleNoteSelect}
          onDeleteSelected={handleDeleteSelected}
          onBulkMove={handleBulkMove}
          onFolderCreated={handleFolderCreated}
          onPopupCardClick={handleCloseNotesWidget}
          sidebarOpen={false}
          backdropStyle={backdropStyle}
        />
      )}
    </div>
  )
}

export function AnnotationApp() {
  // Always provide LayerProvider - it will internally check feature flag
  return (
    <LayerProvider initialPopupCount={0}>
      <AnnotationAppContent />
    </LayerProvider>
  )
} 
