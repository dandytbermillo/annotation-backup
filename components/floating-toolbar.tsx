"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Eye } from "lucide-react"
import { useLayer } from "@/components/canvas/layer-provider"
import { CoordinateBridge } from "@/lib/utils/coordinate-bridge"
import { getPlainProvider } from "@/lib/provider-switcher"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { BranchesSection } from "@/components/canvas/branches-section"
import { createNote, fetchRecentNotes } from "@/lib/utils/note-creator"
import { buildMultilinePreview } from "@/lib/utils/branch-preview"
import { PreviewPopover } from "@/components/shared/preview-popover"
import {
  PREVIEW_HOVER_DELAY_MS,
  FOLDER_PREVIEW_DELAY_MS,
  TOOLBAR_HOVER_DELAY_MS,
} from "@/lib/constants/ui-timings"
import { debugLog } from "@/lib/utils/debug-logger"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { screenToWorld } from "@/lib/canvas/coordinate-utils"
import {
  CANVAS_SAFE_BOUNDS,
  clampToCanvasBounds,
  computeVisuallyCenteredWorldPosition,
  RAPID_CENTERING_OFFSET,
  RAPID_CENTERING_RESET_MS,
  type RapidSequenceState,
} from "@/lib/canvas/visual-centering"

const toolbarCreationSequence: RapidSequenceState = { count: 0, lastTimestamp: 0 }


// Folder color palette - similar to sticky notes pattern
const FOLDER_COLORS = [
  { name: 'blue', bg: '#3b82f6', border: '#60a5fa', text: '#ffffff', light: 'rgba(59, 130, 246, 0.1)' },
  { name: 'violet', bg: '#8b5cf6', border: '#a78bfa', text: '#ffffff', light: 'rgba(139, 92, 246, 0.1)' },
  { name: 'amber', bg: '#f59e0b', border: '#fbbf24', text: '#ffffff', light: 'rgba(245, 158, 11, 0.1)' },
  { name: 'emerald', bg: '#10b981', border: '#34d399', text: '#ffffff', light: 'rgba(16, 185, 129, 0.1)' },
  { name: 'red', bg: '#ef4444', border: '#f87171', text: '#ffffff', light: 'rgba(239, 68, 68, 0.1)' },
  { name: 'pink', bg: '#ec4899', border: '#f472b6', text: '#ffffff', light: 'rgba(236, 72, 153, 0.1)' },
  { name: 'cyan', bg: '#06b6d4', border: '#22d3ee', text: '#ffffff', light: 'rgba(6, 182, 212, 0.1)' },
  { name: 'gray', bg: '#6b7280', border: '#9ca3af', text: '#ffffff', light: 'rgba(107, 114, 128, 0.1)' },
]

// Helper to get color theme by name (from database color field)
function getFolderColorTheme(colorName: string | undefined | null) {
  if (!colorName) return null
  const color = FOLDER_COLORS.find(c => c.name === colorName.toLowerCase())
  return color || null
}

// Get auto-assigned color for a folder (cycling through palette)
function getAutoFolderColor(index: number): string {
  return FOLDER_COLORS[index % FOLDER_COLORS.length].name
}

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

type PanelKey = "recents" | "org" | "tools" | "layer" | "format" | "resize" | "branches" | "actions" | "add-component" | "display" | null

type FloatingToolbarProps = {
  x: number
  y: number
  onClose: () => void
  onSelectNote?: (noteId: string, options?: { initialPosition?: { x: number; y: number }; source?: 'toolbar-create' | 'toolbar-open' | 'popup' | 'recent' }) => void
  onCreateNote?: () => void
  onCreateOverlayPopup?: (popup: OverlayPopup, shouldHighlight?: boolean) => void
  onAddComponent?: (type: string, position?: { x: number; y: number }) => void
  editorRef?: React.RefObject<any> // Optional editor ref for format commands
  activePanelId?: string | null // Currently active panel ID for branches/actions
  onBackdropStyleChange?: (style: string) => void // Callback when backdrop style changes
  onFolderRenamed?: (folderId: string, newName: string) => void // Callback when folder is renamed - updates open popups
  activePanel?: PanelKey // Controlled active panel state from parent
  onActivePanelChange?: (panel: PanelKey) => void // Callback when active panel changes
  refreshRecentNotes?: number // Increment this counter to trigger recent notes refresh (fixes stale list when toolbar stays open)
  // Canvas context props (provided by CanvasAwareFloatingToolbar wrapper)
  canvasState?: any // CanvasState from useCanvas()
  canvasDispatch?: React.Dispatch<any> // dispatch from useCanvas()
  canvasDataStore?: any // DataStore from useCanvas()
  canvasNoteId?: string // noteId from useCanvas()
}

interface RecentNote {
  id: string
  title: string
  metaLeft: string
  metaRight: string
}

export interface OrgItem {
  id: string
  name: string
  type: "folder" | "note"
  icon?: string
  color?: string
  path?: string
  hasChildren?: boolean
  level: number
  children?: OrgItem[]
  parentId?: string
  createdAt?: string
  updatedAt?: string
}

interface FolderPopup {
  id: string
  folderId: string
  folderName: string
  position: { x: number; y: number }
  children: OrgItem[]
  isLoading: boolean
  parentFolderId?: string // Track parent folder popup (for nested popups)
  folderColor?: string // Color name from database for header styling
}

export interface OverlayPopup {
  id: string
  folderId: string
  folderName: string
  folder: OrgItem | null
  position: { x: number; y: number }
  canvasPosition: { x: number; y: number }
  children: OrgItem[]
  isLoading: boolean
  isPersistent: boolean
  level: number
  parentPopupId?: string
  isHighlighted?: boolean
  closeMode?: 'normal' | 'closing' // NEW: Interactive close mode
  isPinned?: boolean // NEW: Pin to prevent cascade-close
}

const TOOL_CATEGORIES = [
  { id: "layer" as const, label: "Layer" },
  { id: "format" as const, label: "Format" },
  { id: "resize" as const, label: "Resize" },
  { id: "branches" as const, label: "Branches" },
  { id: "actions" as const, label: "Actions" },
]

const LAYER_ACTIONS = [
  { label: "Bring to Front", desc: "Move panel to top" },
  { label: "Send to Back", desc: "Move panel to bottom" },
]

interface FormatAction {
  label: string
  tooltip: string
  className?: string
  command?: string
  value?: any
}

const FORMAT_ACTIONS: FormatAction[] = [
  { label: "B", tooltip: "Bold", className: "font-bold", command: "bold" },
  { label: "I", tooltip: "Italic", className: "italic", command: "italic" },
  { label: "U", tooltip: "Underline", className: "underline", command: "underline" },
  { label: "H2", tooltip: "Heading 2", command: "heading", value: 2 },
  { label: "H3", tooltip: "Heading 3", command: "heading", value: 3 },
  { label: "•", tooltip: "Bullet List", command: "bulletList" },
  { label: "1.", tooltip: "Numbered List", command: "orderedList" },
  { label: '"', tooltip: "Quote", command: "blockquote" },
  { label: "🖍", tooltip: "Highlight", command: "highlight" },
  { label: "▦", tooltip: "Block Based", command: "collapsibleBlock" },
  { label: "✕", tooltip: "Clear Format", command: "removeFormat" },
]

const RESIZE_ACTIONS = [
  { label: "Resize / Restore", desc: "Toggle panel height" },
]

const BRANCH_ACTIONS = [
  { label: "📄 Main Document", desc: "Root branch" },
  { label: "📝 Introduction", desc: "Note branch" },
  { label: "🔍 Research Area", desc: "Explore branch" },
  { label: "⭐ Final Version", desc: "Promote branch" },
]

const ACTION_ITEMS = [
  { label: "📝 Note", desc: "Create note branch", type: "note" as const },
  { label: "🔍 Explore", desc: "Create explore branch", type: "explore" as const },
  { label: "⭐ Promote", desc: "Create promote branch", type: "promote" as const },
]

export function FloatingToolbar({ x, y, onClose, onSelectNote, onCreateNote, onCreateOverlayPopup, onAddComponent, editorRef, activePanelId, onBackdropStyleChange, onFolderRenamed, activePanel: activePanelProp, onActivePanelChange, refreshRecentNotes, canvasState, canvasDispatch, canvasDataStore, canvasNoteId }: FloatingToolbarProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // Use controlled activePanel from parent if provided, otherwise use internal state
  const [internalActivePanel, setInternalActivePanel] = useState<PanelKey>(null)
  const activePanel = activePanelProp !== undefined ? activePanelProp : internalActivePanel
  const setActivePanel = (panel: PanelKey | ((prev: PanelKey) => PanelKey)) => {
    const newPanel = typeof panel === 'function' ? panel(activePanel) : panel
    if (onActivePanelChange) {
      onActivePanelChange(newPanel)
    } else {
      setInternalActivePanel(newPanel)
    }
  }

  const panelHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const buttonHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [isHoveringPanel, setIsHoveringPanel] = useState(false)
  const [isCreatingNote, setIsCreatingNote] = useState(false)

  // Drag state
  const [isDragging, setIsDragging] = useState(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })

  // Debug: Log when activePanelId prop changes
  useEffect(() => {
    console.log('[FloatingToolbar] activePanelId prop changed to:', activePanelId)
  }, [activePanelId])

  // Auto-open Format panel if triggered by text selection
  useEffect(() => {
    const shouldAutoOpen = (window as any).__autoOpenFormatPanel
    if (shouldAutoOpen) {
      setActivePanel('format')
      ;(window as any).__autoOpenFormatPanel = false // Clear flag
    }
  }, [])
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>([])
  const [isLoadingRecent, setIsLoadingRecent] = useState(false)
  const [orgItems, setOrgItems] = useState<OrgItem[]>([])
  const [isLoadingOrg, setIsLoadingOrg] = useState(false)
  const [folderPopups, setFolderPopups] = useState<FolderPopup[]>([]) // Hover tooltips
  const folderPopupsRef = useRef<FolderPopup[]>([]) // Ref to access current state in callbacks
  const popupIdCounter = useRef(0)
  const hoverTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Note preview state
  const [notePreview, setNotePreview] = useState<{
    noteId: string
    content: string
    position: { x: number; y: number }
    sourceFolderId?: string // Track which folder popup triggered this preview
  } | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const previewCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isHoveringPreviewRef = useRef(false)

  // Folder creation state for Organization panel
  const [creatingFolderInOrg, setCreatingFolderInOrg] = useState(false)
  const [newOrgFolderName, setNewOrgFolderName] = useState('')
  const [orgFolderCreationError, setOrgFolderCreationError] = useState<string | null>(null)
  const [orgFolderCreationLoading, setOrgFolderCreationLoading] = useState(false)

  // Edit mode state for Knowledge Base panel
  const [isEditMode, setIsEditMode] = useState(false)

  // Inline rename state for folders in edit mode
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renamingFolderName, setRenamingFolderName] = useState('')
  const [renamingFolderError, setRenamingFolderError] = useState<string | null>(null)
  const [renamingFolderLoading, setRenamingFolderLoading] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Selected folder state for deletion in edit mode
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)

  // Color palette popup state
  const [openPaletteFolderId, setOpenPaletteFolderId] = useState<string | null>(null)
  const [palettePosition, setPalettePosition] = useState<{ x: number; y: number } | null>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const colorButtonRef = useRef<HTMLButtonElement>(null)
  const justSelectedColorRef = useRef(false) // Prevent panel close immediately after color selection

  // Backdrop style preference (persistent)
  const [backdropStyle, setBackdropStyle] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('backdropStyle') || 'none'
    }
    return 'none'
  })

  const computeInitialWorldPosition = useCallback((): { x: number; y: number } | null => {
    if (!canvasState?.canvasState) return null

    const lastInteraction = typeof window !== 'undefined'
      ? (window as any).__canvasLastInteraction ?? null
      : null

    debugLog({
      component: 'FloatingToolbar',
      action: 'new_note_center_anchor_resolved',
      metadata: {
        hasCanvasState: Boolean(canvasState?.canvasState),
        lastInteraction,
        translateX: canvasState.canvasState.translateX,
        translateY: canvasState.canvasState.translateY,
        zoom: canvasState.canvasState.zoom,
      },
    })

    const position = computeVisuallyCenteredWorldPosition(
      {
        translateX: canvasState.canvasState.translateX,
        translateY: canvasState.canvasState.translateY,
        zoom: canvasState.canvasState.zoom,
      },
      toolbarCreationSequence,
      lastInteraction,
    )

    if (position) {
      debugLog({
        component: 'FloatingToolbar',
        action: 'new_note_center_anchor_applied',
        metadata: {
          anchorType: lastInteraction ? 'interaction' : 'viewport_center_seed',
          position,
          sequenceCount: toolbarCreationSequence.count,
        },
      })
      return position
    }

    if (typeof window === 'undefined') return null

    const { translateX = 0, translateY = 0, zoom = 1 } = canvasState.canvasState
    const effectiveZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
    const camera = { x: translateX, y: translateY }
    const fallbackCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const baseWorld = screenToWorld(fallbackCenter, camera, effectiveZoom)
    debugLog({
      component: 'FloatingToolbar',
      action: 'new_note_center_fallback_used',
      metadata: {
        fallbackCenter,
        baseWorld,
      },
    })
    return clampToCanvasBounds(baseWorld)
  }, [canvasState])

  // Save backdrop style to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('backdropStyle', backdropStyle)
    }
    // Notify parent component about backdrop style change
    onBackdropStyleChange?.(backdropStyle)
  }, [backdropStyle, onBackdropStyleChange])

  // Close palette on click outside
  useEffect(() => {
    if (!openPaletteFolderId) return

    const handleClickOutside = (event: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(event.target as Node)) {
        setOpenPaletteFolderId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openPaletteFolderId])

  // Layer context for overlay canvas
  const layerContext = useLayer()
  const multiLayerEnabled = true
  const identityTransform = { x: 0, y: 0, scale: 1 }
  const sharedOverlayTransform = layerContext?.transforms.popups || identityTransform

  // Keep folderPopupsRef in sync with folderPopups state
  useEffect(() => {
    folderPopupsRef.current = folderPopups
  }, [folderPopups])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (buttonHoverTimeoutRef.current) {
        clearTimeout(buttonHoverTimeoutRef.current)
      }
      if (panelHoverTimeoutRef.current) {
        clearTimeout(panelHoverTimeoutRef.current)
      }
    }
  }, [])

  // Debug: Log when activeLayer changes
  useEffect(() => {
    console.log('[FloatingToolbar] Active layer changed to:', layerContext?.activeLayer)
  }, [layerContext?.activeLayer])

  // Toggle between notes and popups layers (like Tab key)
  const toggleLayer = () => {
    console.log('[FloatingToolbar] Toggle layer clicked', {
      hasLayerContext: !!layerContext,
      currentLayer: layerContext?.activeLayer,
      layerContext
    })
    if (!layerContext) {
      console.warn('[FloatingToolbar] No layer context available!')
      return
    }
    const newLayer = layerContext.activeLayer === 'notes' ? 'popups' : 'notes'
    console.log('[FloatingToolbar] Switching to layer:', newLayer)
    layerContext.setActiveLayer(newLayer)
    console.log('[FloatingToolbar] Layer after switch:', layerContext.activeLayer)
  }

  // Auto-switch to note canvas when opening a note (only if currently on popups layer)
  const switchToNoteCanvasIfNeeded = () => {
    if (!layerContext) return

    // Only switch if currently on popups layer
    if (layerContext.activeLayer === 'popups') {
      layerContext.setActiveLayer('notes')
    }
  }

  // Drag handlers for making toolbar draggable
  const handleDragMouseDown = (e: React.MouseEvent) => {
    // Only start drag on left mouse button
    if (e.button !== 0) return

    // Don't start dragging if clicking on a button or interactive element
    const target = e.target as HTMLElement
    if (
      target.tagName === 'BUTTON' ||
      target.closest('button') ||
      target.tagName === 'INPUT' ||
      target.closest('input')
    ) {
      return
    }

    // Clear any pending panel close timeouts to keep panel open during drag
    if (panelHoverTimeoutRef.current) {
      clearTimeout(panelHoverTimeoutRef.current)
      panelHoverTimeoutRef.current = null
    }

    setIsDragging(true)

    // Calculate offset between mouse position and toolbar position
    dragOffsetRef.current = {
      x: e.clientX - position.left,
      y: e.clientY - position.top
    }
  }

  // Handle mouse move and mouse up for dragging
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        left: e.clientX - dragOffsetRef.current.x,
        top: e.clientY - dragOffsetRef.current.y
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  // Execute editor command
  const executeCommand = (command: string, value?: any) => {
    if (!editorRef?.current) {
      console.warn('[FloatingToolbar] No active editor ref - cannot execute command:', command)
      return
    }
    editorRef.current.executeCommand(command, value)
  }

  // Insert annotation (note, explore, promote)
  // This triggers the existing AnnotationToolbar's createAnnotation logic
  const insertAnnotation = (type: 'note' | 'explore' | 'promote') => {
    console.log('[FloatingToolbar] Triggering annotation creation:', type)

    // Dispatch the annotation creation event that the AnnotationToolbar listens for
    // The AnnotationToolbar component has buttons that call createAnnotation(type)
    // We can trigger the same by clicking the corresponding button programmatically
    const toolbar = document.getElementById('annotation-toolbar')
    if (!toolbar) {
      console.warn('[FloatingToolbar] annotation-toolbar not found in DOM')
      return
    }

    // Find and click the appropriate button
    const buttonSelector = `.annotation-btn.${type}`
    const button = toolbar.querySelector(buttonSelector) as HTMLButtonElement

    if (button) {
      console.log('[FloatingToolbar] Clicking annotation button:', type)
      button.click()
    } else {
      console.warn('[FloatingToolbar] Annotation button not found:', buttonSelector)
    }
  }

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) {
      setPosition({ left: x, top: y })
      return
    }

    el.style.left = `${x}px`
    el.style.top = `${y}px`

    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      let left = x + 12
      let top = y + 12

      if (left + rect.width > window.innerWidth - 16) left = window.innerWidth - rect.width - 16
      if (top + rect.height > window.innerHeight - 16) top = window.innerHeight - rect.height - 16
      if (left < 16) left = 16
      if (top < 16) top = 16

      setPosition({ left, top })
    })
  }, [x, y])

  // Fetch recent notes from API
  // Refreshes on mount and when refreshRecentNotes counter changes
  useEffect(() => {
    const loadRecentNotes = async () => {
      console.log('=== [FloatingToolbar] Fetching recent notes ===')
      setIsLoadingRecent(true)
      try {
        const items = await fetchRecentNotes(5)
        console.log('=== [FloatingToolbar] Items count:', items.length)

        // Transform API data to match our UI format
        const formattedNotes: RecentNote[] = items.map((item: any) => {
          // Append 'Z' to force UTC parsing (database returns UTC timestamps without timezone marker)
          const lastAccessed = new Date(item.lastAccessedAt + 'Z')
          const now = Date.now()
          const timeAgo = now - lastAccessed.getTime()
          const minutes = Math.floor(timeAgo / (1000 * 60))
          const hours = Math.floor(minutes / 60)
          const days = Math.floor(hours / 24)

          console.log('[Time Debug]', {
            name: item.name,
            lastAccessedAt: item.lastAccessedAt,
            parsed: lastAccessed.toISOString(),
            timeAgo_ms: timeAgo,
            minutes,
            hours,
            days
          })

          let timeText = ''
          if (days > 0) {
            timeText = `${days}d ago`
          } else if (hours > 0) {
            timeText = `${hours}h ago`
          } else if (minutes > 0) {
            timeText = `${minutes}m ago`
          } else {
            timeText = 'Just now'
          }

          return {
            id: item.id,
            title: item.name,
            metaLeft: timeText,
            metaRight: item.type === 'folder' ? '📁 Folder' : '📄 Note'
          }
        })

        setRecentNotes(formattedNotes)
      } catch (error) {
        console.error('Error fetching recent notes:', error)
        setRecentNotes([])
      } finally {
        setIsLoadingRecent(false)
      }
    }

    loadRecentNotes()
  }, [refreshRecentNotes])

  // Fetch organization tree from API
  useEffect(() => {
    const fetchOrgTree = async () => {
      setIsLoadingOrg(true)
      try {
        const response = await fetch('/api/items?parentId=null')
        if (!response.ok) throw new Error('Failed to fetch organization tree')

        const data = await response.json()
        const items = data.items || []

        // Transform API data to tree structure with icons
        const formattedItems: OrgItem[] = items.map((item: any) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
          color: item.color,
          hasChildren: item.type === 'folder',
          level: 0,
          children: [],
          parentId: item.parentId
        }))

        setOrgItems(formattedItems)

        // Fetch and display children of "Knowledge Base" folder (always show first level)
        const knowledgeBase = formattedItems.find(item =>
          item.name.toLowerCase() === 'knowledge base' && item.type === 'folder'
        )
        if (knowledgeBase) {
          try {
            const childResponse = await fetch(`/api/items?parentId=${knowledgeBase.id}`)
            if (childResponse.ok) {
              const childData = await childResponse.json()
              const children = childData.items || []

              const formattedChildren: OrgItem[] = children.map((item: any) => ({
                id: item.id,
                name: item.name,
                type: item.type,
                icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
                color: item.color,
                path: item.path,
                hasChildren: item.type === 'folder',
                level: 1,
                children: [],
                parentId: item.parentId
              }))

              setOrgItems(prevItems =>
                prevItems.map(item =>
                  item.id === knowledgeBase.id
                    ? { ...item, children: formattedChildren }
                    : item
                )
              )
            }
          } catch (error) {
            console.error('Error fetching Knowledge Base children:', error)
          }
        }
      } catch (error) {
        console.error('Error fetching organization tree:', error)
        setOrgItems([])
      } finally {
        setIsLoadingOrg(false)
      }
    }

    fetchOrgTree()
  }, [])

  // Color selection handler for folders (in edit mode)
  const handleSelectFolderColor = async (folderId: string, newColorName: string, currentColor: string | undefined) => {
    // Set flag to prevent panel from closing
    justSelectedColorRef.current = true

    // Clear any pending panel close timeouts
    if (panelHoverTimeoutRef.current) {
      clearTimeout(panelHoverTimeoutRef.current)
      panelHoverTimeoutRef.current = null
    }

    // Close palette
    setOpenPaletteFolderId(null)
    setPalettePosition(null)

    // Reset flag after a short delay to allow panel to stay open
    setTimeout(() => {
      justSelectedColorRef.current = false
    }, 1500)

    // Optimistic UI update
    setOrgItems(prevItems => {
      const updateItemColor = (items: OrgItem[]): OrgItem[] => {
        return items.map(item => {
          if (item.id === folderId) {
            return { ...item, color: newColorName }
          }
          if (item.children && item.children.length > 0) {
            return { ...item, children: updateItemColor(item.children) }
          }
          return item
        })
      }
      return updateItemColor(prevItems)
    })

    // Update database
    try {
      const response = await fetch(`/api/items/${folderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          color: newColorName,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update folder color')
      }
    } catch (error) {
      console.error('Failed to update folder color:', error)
      // Revert optimistic update on error
      setOrgItems(prevItems => {
        const revertItemColor = (items: OrgItem[]): OrgItem[] => {
          return items.map(item => {
            if (item.id === folderId) {
              return { ...item, color: currentColor }
            }
            if (item.children && item.children.length > 0) {
              return { ...item, children: revertItemColor(item.children) }
            }
            return item
          })
        }
        return revertItemColor(prevItems)
      })
    }
  }

  // Folder creation handlers for Organization panel
  const handleStartCreateFolderInOrg = () => {
    setCreatingFolderInOrg(true)
    setNewOrgFolderName('')
    setOrgFolderCreationError(null)
  }

  const handleCancelCreateFolderInOrg = () => {
    setCreatingFolderInOrg(false)
    setNewOrgFolderName('')
    setOrgFolderCreationError(null)
  }

  const handleCreateFolderInOrg = async () => {
    const trimmedName = newOrgFolderName.trim()

    // Validation
    if (!trimmedName) {
      setOrgFolderCreationError('Folder name cannot be empty')
      return
    }

    if (trimmedName.length > 255) {
      setOrgFolderCreationError('Folder name is too long (max 255 characters)')
      return
    }

    setOrgFolderCreationLoading(true)
    setOrgFolderCreationError(null)

    try {
      // Find Knowledge Base folder ID
      const knowledgeBase = orgItems.find(item => item.name === 'Knowledge Base')

      const response = await fetch('/api/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          type: 'folder',
          name: trimmedName,
          parentId: knowledgeBase?.id || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to create folder: ${response.status}`)
      }

      // Success - clear form
      setNewOrgFolderName('')
      setCreatingFolderInOrg(false)
      setOrgFolderCreationError(null)

      // Refresh the org items to show the new folder
      // Re-fetch the organization tree
      const treeResponse = await fetch('/api/items?parentId=null')
      if (treeResponse.ok) {
        const treeData = await treeResponse.json()
        const items = treeData.items || []

        const formattedItems: OrgItem[] = items.map((item: any) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
          color: item.color,
          hasChildren: item.type === 'folder',
          level: 0,
          children: [],
          parentId: item.parentId
        }))

        setOrgItems(formattedItems)

        // Re-fetch and display children of Knowledge Base
        const knowledgeBase = formattedItems.find(item =>
          item.name.toLowerCase() === 'knowledge base' && item.type === 'folder'
        )
        if (knowledgeBase) {
          const childResponse = await fetch(`/api/items?parentId=${knowledgeBase.id}`)
          if (childResponse.ok) {
            const childData = await childResponse.json()
            const children = childData.items || []

            const formattedChildren: OrgItem[] = children.map((item: any) => ({
              id: item.id,
              name: item.name,
              type: item.type,
              icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
              color: item.color,
              path: item.path,
              hasChildren: item.type === 'folder',
              level: 1,
              children: [],
              parentId: item.parentId
            }))

            setOrgItems(prevItems =>
              prevItems.map(item =>
                item.id === knowledgeBase.id
                  ? { ...item, children: formattedChildren }
                  : item
              )
            )
          }
        }
      }
    } catch (error) {
      console.error('Failed to create folder:', error)
      setOrgFolderCreationError(
        error instanceof Error ? error.message : 'Failed to create folder'
      )
    } finally {
      setOrgFolderCreationLoading(false)
    }
  }

  // === Inline Folder Rename Handlers ===

  // Start renaming a folder (triggered by double-click in edit mode)
  const handleStartRenameFolder = (folder: OrgItem) => {
    setRenamingFolderId(folder.id)
    setRenamingFolderName(folder.name)
    setRenamingFolderError(null)
    // Focus input after React renders it
    setTimeout(() => {
      if (renameInputRef.current) {
        renameInputRef.current.focus()
        renameInputRef.current.select()
      }
    }, 0)
  }

  // Cancel rename without saving
  const handleCancelRenameFolder = () => {
    setRenamingFolderId(null)
    setRenamingFolderName('')
    setRenamingFolderError(null)
  }

  // Save renamed folder
  const handleSaveRenameFolder = async () => {
    if (!renamingFolderId) return

    const trimmedName = renamingFolderName.trim()

    // Validation
    if (!trimmedName) {
      setRenamingFolderError('Folder name cannot be empty')
      return
    }

    // Check if name actually changed
    const currentFolder = findItemById(renamingFolderId, orgItems)
    if (currentFolder && currentFolder.name === trimmedName) {
      // No change, just cancel
      handleCancelRenameFolder()
      return
    }

    // Check for duplicate names in the same parent
    if (currentFolder) {
      const parent = currentFolder.parentId
        ? findItemById(currentFolder.parentId, orgItems)
        : null
      const siblings = parent?.children || orgItems.filter(item => !item.parentId)
      const duplicate = siblings.find(
        item => item.id !== renamingFolderId && item.name.toLowerCase() === trimmedName.toLowerCase()
      )
      if (duplicate) {
        setRenamingFolderError('A folder with this name already exists')
        return
      }
    }

    setRenamingFolderLoading(true)
    setRenamingFolderError(null)

    try {
      // Update folder name via API
      const response = await fetch(`/api/items/${renamingFolderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ name: trimmedName }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to rename folder')
      }

      // Update local state optimistically
      const updateItemName = (items: OrgItem[]): OrgItem[] => {
        return items.map(item => {
          if (item.id === renamingFolderId) {
            return { ...item, name: trimmedName }
          }
          if (item.children) {
            return { ...item, children: updateItemName(item.children) }
          }
          return item
        })
      }

      setOrgItems(updateItemName(orgItems))

      // Notify parent to update any open popups showing this folder
      onFolderRenamed?.(renamingFolderId, trimmedName)

      // Success - clear rename state
      handleCancelRenameFolder()

    } catch (error) {
      console.error('Failed to rename folder:', error)
      setRenamingFolderError(
        error instanceof Error ? error.message : 'Failed to rename folder'
      )
    } finally {
      setRenamingFolderLoading(false)
    }
  }

  // Handle deleting selected folder
  const handleDeleteSelectedFolder = async () => {
    if (!selectedFolderId) return

    const folderToDelete = findItemById(selectedFolderId, orgItems)
    if (!folderToDelete) return

    // Confirm deletion
    const confirmMsg = folderToDelete.children && folderToDelete.children.length > 0
      ? `Delete "${folderToDelete.name}" and all its contents?`
      : `Delete "${folderToDelete.name}"?`

    if (!confirm(confirmMsg)) return

    try {
      const response = await fetch(`/api/items/${selectedFolderId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Failed to delete folder')
      }

      // Remove from orgItems
      const removeItem = (items: OrgItem[]): OrgItem[] => {
        return items
          .filter(item => item.id !== selectedFolderId)
          .map(item => ({
            ...item,
            children: item.children ? removeItem(item.children) : []
          }))
      }

      setOrgItems(removeItem(orgItems))
      setSelectedFolderId(null)

    } catch (error) {
      console.error('Failed to delete folder:', error)
      alert(error instanceof Error ? error.message : 'Failed to delete folder')
    }
  }

  // Helper to find item by id in tree
  const findItemById = (id: string, items: OrgItem[]): OrgItem | null => {
    for (const item of items) {
      if (item.id === id) return item
      if (item.children) {
        const found = findItemById(id, item.children)
        if (found) return found
      }
    }
    return null
  }

  // Flatten tree for rendering (with folders-first sorting)
  // Show only Knowledge Base children (not the Knowledge Base folder itself)
  const flattenTree = (items: OrgItem[]): OrgItem[] => {
    // Sort: folders first, then notes (alphabetically within each group)
    const sortItems = (itemsToSort: OrgItem[]) => {
      return [...itemsToSort].sort((a, b) => {
        // Folders before notes
        if (a.type === 'folder' && b.type !== 'folder') return -1
        if (a.type !== 'folder' && b.type === 'folder') return 1

        // Within same type, sort alphabetically by name
        return a.name.localeCompare(b.name)
      })
    }

    // Find Knowledge Base folder
    const knowledgeBase = items.find(item =>
      item.name === 'Knowledge Base' && item.type === 'folder'
    )

    // Return only its children (sorted)
    if (knowledgeBase && knowledgeBase.children) {
      return sortItems(knowledgeBase.children)
    }

    return []
  }

  // Handle folder eye icon hover to show popup
  const handleEyeHover = async (folder: OrgItem, event: React.MouseEvent, parentFolderId?: string) => {
    event.stopPropagation()
    console.log('[handleEyeHover] Called for folder:', folder.name, folder.id, 'parent:', parentFolderId)

    // Check if popup already exists for this folder
    const existingPopup = folderPopups.find(p => p.folderId === folder.id)
    if (existingPopup) {
      // Already showing, don't create another
      return
    }

    // Get button position
    const rect = event.currentTarget.getBoundingClientRect()

    // Calculate popup position - prefer right side
    const spaceRight = window.innerWidth - rect.right
    let popupPosition = { x: 0, y: 0 }

    if (spaceRight > 320) {
      // Place to the right
      popupPosition.x = rect.right + 10
      popupPosition.y = rect.top
    } else {
      // Place below if not enough space on right
      popupPosition.x = rect.left
      popupPosition.y = rect.bottom + 10
    }

    // Create new popup
    const popupId = `folder-popup-${++popupIdCounter.current}`
    const newPopup: FolderPopup = {
      id: popupId,
      folderId: folder.id,
      folderName: folder.name,
      position: popupPosition,
      children: [],
      isLoading: true,
      parentFolderId,
      folderColor: folder.color // Pass color for header styling
    }

    setFolderPopups(prev => [...prev, newPopup])
    console.log('[handleEyeClick] Created popup:', popupId, 'at position:', popupPosition)

    // Fetch folder children
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
        // Inherit parent's color if child doesn't have one
        color: item.color || (item.type === 'folder' ? folder.color : undefined),
        path: item.path,
        hasChildren: item.type === 'folder',
        level: folder.level + 1,
        children: [],
        parentId: item.parentId
      }))

      // Update popup with children
      setFolderPopups(prev =>
        prev.map(p =>
          p.id === popupId
            ? { ...p, children: formattedChildren, isLoading: false }
            : p
        )
      )
    } catch (error) {
      console.error('Error fetching folder contents:', error)
      // Remove popup on error
      setFolderPopups(prev => prev.filter(p => p.id !== popupId))
    }
  }

  // Handle hover leave to close popup
  const handleEyeHoverLeave = (folderId: string) => {
    console.log('[handleEyeHoverLeave] Leaving folder popup:', folderId)

    // Close popup for this folder after a short delay
    const timeout = setTimeout(() => {
      console.log('[handleEyeHoverLeave] Timeout fired - closing popup:', folderId)
      setFolderPopups(prev => {
        const remaining = prev.filter(p => p.folderId !== folderId)
        console.log('[handleEyeHoverLeave] Remaining popups:', remaining.length)
        // Only reset isHoveringPanel if NO popups remain
        if (remaining.length === 0) {
          console.log('[handleEyeHoverLeave] No popups left - resetting isHoveringPanel')
          setIsHoveringPanel(false)
        }
        return remaining
      })
    }, FOLDER_PREVIEW_DELAY_MS)

    hoverTimeoutRef.current.set(folderId, timeout)

    // Panels now stay open - no auto-close on hover leave
    // Panel only closes via explicit dismiss (click outside or close button)
  }

  // Cancel close timeout when hovering over popup
  const handlePopupHover = (folderId: string) => {
    console.log('[handlePopupHover] Hovering popup:', folderId, 'Total popups:', folderPopupsRef.current.length)

    // Cancel timeout for this popup
    const timeout = hoverTimeoutRef.current.get(folderId)
    if (timeout) {
      console.log('[handlePopupHover] Cancelling close timeout for popup:', folderId)
      clearTimeout(timeout)
      hoverTimeoutRef.current.delete(folderId)
    }

    // ALWAYS cancel panel close timeout to keep Organization panel open
    if (panelHoverTimeoutRef.current) {
      console.log('[handlePopupHover] Cancelling panel close timeout')
      clearTimeout(panelHoverTimeoutRef.current)
      panelHoverTimeoutRef.current = null
    }

    // Set isHoveringPanel to true to prevent panel from closing
    // (popups are considered part of the panel hover state)
    console.log('[handlePopupHover] Setting isHoveringPanel = true')
    setIsHoveringPanel(true)

    // Find this popup and cancel close timeouts for entire parent chain
    const currentPopup = folderPopupsRef.current.find(p => p.folderId === folderId)
    if (currentPopup?.parentFolderId) {
      console.log('[handlePopupHover] Found parent:', currentPopup.parentFolderId)
      // Recursively cancel parent timeouts
      const cancelParentTimeouts = (parentFolderId: string) => {
        console.log('[handlePopupHover] Cancelling timeout for parent:', parentFolderId)
        const parentTimeout = hoverTimeoutRef.current.get(parentFolderId)
        if (parentTimeout) {
          clearTimeout(parentTimeout)
          hoverTimeoutRef.current.delete(parentFolderId)
        }
        // Check if parent also has a parent
        const parentPopup = folderPopupsRef.current.find(p => p.folderId === parentFolderId)
        if (parentPopup?.parentFolderId) {
          cancelParentTimeouts(parentPopup.parentFolderId)
        }
      }
      cancelParentTimeouts(currentPopup.parentFolderId)
    }
  }

  // Handle eye icon click to activate overlay canvas
  const handleEyeClick = async (folder: OrgItem, event: React.MouseEvent) => {
    event.stopPropagation()

    console.log('[handleEyeClick] Clicked folder:', folder.name, 'ID:', folder.id)

    // Close hover tooltips
    setFolderPopups([])

    // If no callback provided, do nothing
    if (!onCreateOverlayPopup) return

    const rect = event.currentTarget.getBoundingClientRect()
    const spaceRight = window.innerWidth - rect.right
    let popupPosition = { x: rect.right + 10, y: rect.top }

    if (spaceRight < 320) {
      popupPosition = { x: rect.left, y: rect.bottom + 10 }
    }

    // Use folder ID as popup ID to prevent duplicates (same folder = same popup)
    const popupId = `overlay-popup-${folder.id}`
    console.log('[handleEyeClick] Generated popup ID:', popupId)

    const canvasPosition = CoordinateBridge.screenToCanvas(popupPosition, sharedOverlayTransform)
    const screenPosition = CoordinateBridge.canvasToScreen(canvasPosition, sharedOverlayTransform)

    // Derive display name with fallbacks to ensure we always have a usable label
    const displayName = folder.name?.trim()
      || deriveFromPath((folder as any).path)
      || 'Untitled Folder'

    // Fetch inherited color by walking up ancestor chain
    let effectiveColor = folder.color
    if (!effectiveColor && folder.parentId) {
      try {
        let currentParentId = folder.parentId
        let depth = 0
        const maxDepth = 10 // Prevent infinite loops

        while (currentParentId && !effectiveColor && depth < maxDepth) {
          const parentResponse = await fetch(`/api/items/${currentParentId}`)
          if (!parentResponse.ok) break

          const parentData = await parentResponse.json()
          const parent = parentData.item || parentData

          if (parent.color) {
            effectiveColor = parent.color
            console.log('[handleEyeClick] Inherited color from ancestor:', parent.name, 'color:', effectiveColor, 'depth:', depth + 1)
            break
          }

          // Move up to next parent
          currentParentId = parent.parentId || parent.parent_id
          depth++
        }

        if (!effectiveColor) {
          console.log('[handleEyeClick] No color found in ancestor chain after', depth, 'levels')
        }
      } catch (e) {
        console.warn('[handleEyeClick] Failed to fetch ancestor color:', e)
      }
    }

    // Create initial popup with loading state
    const newPopup: OverlayPopup = {
      id: popupId,
      folderId: folder.id,
      folderName: displayName,
      folder: {
        id: folder.id,
        name: displayName,
        type: 'folder' as const,
        level: folder.level || 0,
        color: effectiveColor,
        path: (folder as any).path,
        children: []
      },
      position: screenPosition,
      canvasPosition: canvasPosition,
      children: [],
      isLoading: true,
      isPersistent: true,
      level: 0
    }

    console.log('[handleEyeClick] Calling onCreateOverlayPopup with shouldHighlight=true')
    // Call callback to create popup in parent (annotation-app)
    // Always pass shouldHighlight=true to trigger glow if already exists
    onCreateOverlayPopup(newPopup, true)

    // Close toolbar after creating popup (same pattern as selecting a note)
    onClose()

    // Fetch children in background and update via callback
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
        // Inherit parent's color if child doesn't have one
        color: item.color || (item.type === 'folder' ? folder.color : undefined),
        path: item.path,
        hasChildren: item.type === 'folder',
        level: folder.level + 1,
        children: [],
        parentId: item.parentId
      }))

      // Update popup with loaded children (preserve displayName)
      const updatedPopup: OverlayPopup = {
        ...newPopup,
        children: formattedChildren,
        isLoading: false,
        folderName: displayName,
        folder: {
          ...folder,
          name: displayName,
          children: formattedChildren
        }
      }

      // Pass false for shouldHighlight when just updating children data
      onCreateOverlayPopup(updatedPopup, false)
    } catch (error) {
      console.error('Error fetching overlay popup contents:', error)
      // Could add error handling callback here if needed
    }
  }

  // Close all folder popups
  const closeAllPopups = () => {
    setFolderPopups([])
  }

  // Handle button hover
  const handleButtonHover = (panel: PanelKey) => {
    // Clear any existing button hover timeout
    if (buttonHoverTimeoutRef.current) {
      clearTimeout(buttonHoverTimeoutRef.current)
      buttonHoverTimeoutRef.current = null
    }

    // Clear panel hover timeout if exists
    if (panelHoverTimeoutRef.current) {
      clearTimeout(panelHoverTimeoutRef.current)
      panelHoverTimeoutRef.current = null
    }

    // Set timeout to open panel after delay (prevents accidental triggers)
    buttonHoverTimeoutRef.current = setTimeout(() => {
      setActivePanel(panel)
      buttonHoverTimeoutRef.current = null
    }, TOOLBAR_HOVER_DELAY_MS)
  }

  // Handle button hover leave
  const handleButtonHoverLeave = () => {
    // Clear button hover timeout if user moves away before delay completes
    if (buttonHoverTimeoutRef.current) {
      clearTimeout(buttonHoverTimeoutRef.current)
      buttonHoverTimeoutRef.current = null
    }
  }

  // Handle panel hover
  const handlePanelHover = () => {
    if (panelHoverTimeoutRef.current) {
      clearTimeout(panelHoverTimeoutRef.current)
      panelHoverTimeoutRef.current = null
    }
    setIsHoveringPanel(true)
  }

  // Handle panel hover leave
  const handlePanelHoverLeave = () => {
    // Panels now stay open when hovering away - only close via explicit dismiss
    setIsHoveringPanel(false)
  }

  // Handle creating a new note using shared utility (same as notes-explorer)
  const handleCreateNewNote = async () => {
    if (isCreatingNote) return // Prevent double-clicks

    setIsCreatingNote(true)
    try {
      const initialPosition = computeInitialWorldPosition()
      // Use shared note creator utility
      const result = await createNote({ initialPosition: initialPosition ?? undefined })

      if (result.success && result.noteId) {
        // Open the newly created note
        onSelectNote?.(result.noteId, {
          initialPosition: initialPosition ?? undefined,
          source: 'toolbar-create'
        })
        // Close the toolbar
        onClose()
      } else {
        throw new Error(result.error || 'Failed to create note')
      }
    } catch (error) {
      console.error('[FloatingToolbar] Failed to create note:', error)
      alert('Failed to create note. Please try again.')
    } finally {
      setIsCreatingNote(false)
    }
  }

  // Handle note preview hover
  const handleNotePreviewHover = async (noteId: string, event: React.MouseEvent, sourceFolderId?: string) => {
    // Clear existing timeouts
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
    }
    if (previewCloseTimeoutRef.current) {
      clearTimeout(previewCloseTimeoutRef.current)
    }

    // Reset hover state
    isHoveringPreviewRef.current = false

    // Capture position immediately before async operation
    const rect = event.currentTarget.getBoundingClientRect()
    const position = {
      x: rect.right + 10,
      y: rect.top
    }

    // Set timeout to show preview after 500ms
    previewTimeoutRef.current = setTimeout(async () => {
      setIsLoadingPreview(true)
      try {
        const response = await fetch(`/api/items/${noteId}`)
        if (!response.ok) throw new Error('Failed to fetch note')

        const data = await response.json()
        const content = data?.item?.content
        const contentText = data?.item?.contentText

        // Pass full content to PreviewPopover - no hardcoded limit
        // Component will handle truncation (initial 300 chars, expand to show all content)
        // Component's internal safety cap of 5000 chars applies when not using lazy loading
        const previewText = buildMultilinePreview(content, contentText || '', Number.MAX_SAFE_INTEGER)

        setNotePreview({
          noteId,
          content: previewText || 'No content yet',
          position,
          sourceFolderId
        })
      } catch (error) {
        console.error('[FloatingToolbar] Failed to fetch note preview:', error)
      } finally {
        setIsLoadingPreview(false)
      }
    }, 500)
  }

  // Handle note preview hover leave
  const handleNotePreviewHoverLeave = () => {
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current)
    }

    // Delay closing to allow moving mouse to preview tooltip
    previewCloseTimeoutRef.current = setTimeout(() => {
      if (!isHoveringPreviewRef.current) {
        setNotePreview(null)
      }
    }, PREVIEW_HOVER_DELAY_MS)
  }

  // Handle preview tooltip hover
  const handlePreviewTooltipEnter = () => {
    isHoveringPreviewRef.current = true
    if (previewCloseTimeoutRef.current) {
      clearTimeout(previewCloseTimeoutRef.current)
    }
    // Also cancel panel close timeout to keep Organization panel open
    if (panelHoverTimeoutRef.current) {
      clearTimeout(panelHoverTimeoutRef.current)
      panelHoverTimeoutRef.current = null
    }
    // Set isHoveringPanel to true to prevent panel from closing
    setIsHoveringPanel(true)
    // Cancel folder popup close timeout if preview came from a folder popup
    if (notePreview?.sourceFolderId) {
      const timeout = hoverTimeoutRef.current.get(notePreview.sourceFolderId)
      if (timeout) {
        clearTimeout(timeout)
        hoverTimeoutRef.current.delete(notePreview.sourceFolderId)
      }
    }
  }

  // Handle preview tooltip leave
  const handlePreviewTooltipLeave = () => {
    isHoveringPreviewRef.current = false

    // Delay closing to allow moving mouse back to preview
    previewCloseTimeoutRef.current = setTimeout(() => {
      setNotePreview(null)
    }, PREVIEW_HOVER_DELAY_MS)
    // Panels now stay open - no auto-close on hover leave
  }


  useEffect(() => {
    const handleClickAway = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Don't close if clicking inside toolbar/panel or color palette
      if (containerRef.current?.contains(target)) return
      if (paletteRef.current?.contains(target)) return
      // Don't close if clicking inside folder popups or note preview
      if (target.closest('[data-toolbar-resident]')) return
      onClose()
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }

    document.addEventListener("mousedown", handleClickAway)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handleClickAway)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [onClose])

  const renderRecentNotes = () => (
    <div
      className="w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
      style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}
      onMouseEnter={handlePanelHover}
      onMouseLeave={handlePanelHoverLeave}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
        <span>Recent notes</span>
        <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">
          ×
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto p-3 space-y-2">
        {isLoadingRecent ? (
          <div className="text-center py-4 text-white/60 text-sm">Loading...</div>
        ) : recentNotes.length === 0 ? (
          <div className="text-center py-4 text-white/60 text-sm">No recent notes</div>
        ) : (
          recentNotes.map((item) => {
            const isPreviewActive = notePreview?.noteId === item.id
            return (
              <button
                key={item.id}
                className={`group w-full rounded-xl px-3 py-2 text-left text-white/90 transition ${
                  isPreviewActive
                    ? 'bg-blue-500/20 border-blue-400/40'
                    : 'bg-white/5 border-white/10 hover:bg-blue-500/20 hover:border-blue-400/40'
                } border`}
                onDoubleClick={() => {
                  debugLog({
                    component: 'FloatingToolbar',
                    action: 'note_double_click',
                    metadata: {
                      noteId: item.id,
                      noteTitle: item.title,
                      timestamp: Date.now()
                    }
                  })
                  switchToNoteCanvasIfNeeded()
                  onSelectNote?.(item.id)
                  onClose()
                }}
              >
              <div className="text-sm font-medium flex items-center justify-between gap-2">
                <span className="flex-1">{item.title}</span>
                <div
                  onMouseEnter={(e) => handleNotePreviewHover(item.id, e)}
                  onMouseLeave={handleNotePreviewHoverLeave}
                  className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 rounded p-0.5"
                  title="Hover to preview, use 'Open note' button to open"
                >
                  <Eye className="w-3.5 h-3.5 text-blue-400" />
                </div>
              </div>
              <div className="mt-1 flex justify-between text-xs text-white/60">
                <span>{item.metaLeft}</span>
                <span>{item.metaRight}</span>
              </div>
            </button>
            )
          })
        )}
      </div>
    </div>
  )

  const renderOrg = () => {
    const flatItems = flattenTree(orgItems)

    return (
      <div
        className="w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
        style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}
        onMouseEnter={handlePanelHover}
        onMouseLeave={handlePanelHoverLeave}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
          <span>Knowledge Base</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsEditMode(!isEditMode)
                // Clear selection when exiting edit mode
                if (isEditMode) {
                  setSelectedFolderId(null)
                }
              }}
              className="px-2 py-1 text-xs font-medium rounded transition-colors"
              style={{
                backgroundColor: isEditMode ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: isEditMode ? '#60a5fa' : 'rgba(255, 255, 255, 0.6)',
              }}
            >
              {isEditMode ? 'Done' : 'Edit'}
            </button>
            <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">
              ×
            </button>
          </div>
        </div>
        <div className="max-h-64 overflow-x-auto overflow-y-auto p-3 space-y-1">
          {isLoadingOrg ? (
            <div className="text-center py-4 text-white/60 text-sm">Loading...</div>
          ) : flatItems.length === 0 ? (
            <div className="text-center py-4 text-white/60 text-sm">No items</div>
          ) : (
            flatItems.map((item) => {
              const isFolder = item.type === 'folder'
              const colorTheme = isFolder ? getFolderColorTheme(item.color) : null
              const isSelected = selectedFolderId === item.id

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-1"
                >
                  {/* Item container */}
                  <div
                    className="group flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-white/90 transition cursor-pointer"
                    style={
                      isSelected ? {
                        borderLeftWidth: '3px',
                        borderLeftColor: 'rgba(239, 68, 68, 0.8)',
                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                        borderColor: 'rgba(239, 68, 68, 0.4)'
                      } : (notePreview?.noteId === item.id) ? {
                        // Active preview highlight
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        borderColor: 'rgba(96, 165, 250, 0.4)'
                      } : colorTheme ? {
                        borderLeftWidth: '3px',
                        borderLeftColor: colorTheme.bg,
                        backgroundColor: 'rgba(255, 255, 255, 0.05)'
                      } : {}
                    }
                    onMouseEnter={(e) => {
                      if (isSelected || notePreview?.noteId === item.id) {
                        // Keep selected/preview styling on hover
                        return
                      }
                      if (colorTheme) {
                        e.currentTarget.style.backgroundColor = colorTheme.light
                        e.currentTarget.style.borderColor = colorTheme.border
                      } else {
                        e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.2)'
                        e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.4)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (isSelected) {
                        // Restore selected styling
                        e.currentTarget.style.borderLeftWidth = '3px'
                        e.currentTarget.style.borderLeftColor = 'rgba(239, 68, 68, 0.8)'
                        e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)'
                        e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)'
                        return
                      }
                      if (notePreview?.noteId === item.id) {
                        // Restore preview styling
                        e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.2)'
                        e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.4)'
                        return
                      }
                      if (colorTheme) {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
                        e.currentTarget.style.borderLeftColor = colorTheme.bg
                      } else {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
                      }
                    }}
                    onClick={() => {
                      // In edit mode: single click folder to select/deselect for deletion
                      if (isFolder && isEditMode) {
                        setSelectedFolderId(prev => prev === item.id ? null : item.id)
                      }
                    }}
                    onDoubleClick={(e) => {
                      if (isFolder && isEditMode) {
                        // In edit mode: double-click folder to rename
                        e.preventDefault()
                        e.stopPropagation()
                        handleStartRenameFolder(item)
                      } else if (!isFolder) {
                        // Not in edit mode: double-click note to open
                        switchToNoteCanvasIfNeeded()
                        onSelectNote?.(item.id)
                        onClose()
                      }
                    }}
                  >
                    <div className="text-sm font-medium flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span>{item.icon}</span>
                        {/* Show input when renaming this folder, otherwise show name */}
                        {renamingFolderId === item.id ? (
                          <div className="flex-1 min-w-0">
                            <input
                              ref={renameInputRef}
                              type="text"
                              value={renamingFolderName}
                              onChange={(e) => setRenamingFolderName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleSaveRenameFolder()
                                } else if (e.key === 'Escape') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleCancelRenameFolder()
                                }
                              }}
                              onBlur={() => {
                                // Save on blur unless there's an error showing
                                if (!renamingFolderError) {
                                  handleSaveRenameFolder()
                                }
                              }}
                              onClick={(e) => {
                                // Prevent click from bubbling to parent
                                e.stopPropagation()
                              }}
                              onDoubleClick={(e) => {
                                // Prevent double-click from bubbling
                                e.stopPropagation()
                              }}
                              disabled={renamingFolderLoading}
                              className="w-full px-2 py-1 text-sm bg-gray-800 text-white rounded border border-blue-400/60 focus:outline-none focus:border-blue-400 disabled:opacity-50"
                              style={{ minWidth: '100px' }}
                            />
                            {renamingFolderError && (
                              <div className="text-xs text-red-400 mt-1">{renamingFolderError}</div>
                            )}
                          </div>
                        ) : (
                          <span
                            className={isEditMode && isFolder ? 'cursor-text' : ''}
                            title={isEditMode && isFolder ? 'Double-click to rename' : undefined}
                          >
                            {item.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 relative">
                        {/* Color picker button - only in edit mode for folders */}
                        {isEditMode && isFolder && (
                          <div className="relative">
                            <button
                              ref={colorButtonRef}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (openPaletteFolderId === item.id) {
                                  // Close palette
                                  setOpenPaletteFolderId(null)
                                  setPalettePosition(null)
                                } else {
                                  // Clear any pending panel close timeouts when opening palette
                                  if (panelHoverTimeoutRef.current) {
                                    clearTimeout(panelHoverTimeoutRef.current)
                                    panelHoverTimeoutRef.current = null
                                  }

                                  // Open palette and calculate position
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  setPalettePosition({
                                    x: rect.left,
                                    y: rect.bottom + 4
                                  })
                                  setOpenPaletteFolderId(item.id)
                                }
                              }}
                              className="flex items-center gap-1 px-2 py-1 rounded transition-all hover:bg-white/10"
                              title="Click to choose color"
                            >
                              <div
                                className="w-3 h-3 rounded-full border border-white/30"
                                style={{ backgroundColor: colorTheme?.bg || '#6b7280' }}
                              />
                              <span className="text-white/60 text-xs">▼</span>
                            </button>
                          </div>
                        )}
                        {/* Eye icon - always visible, different handlers for folders vs notes */}
                        {isFolder ? (
                          <button
                            onMouseEnter={(e) => handleEyeHover(item, e)}
                            onMouseLeave={() => handleEyeHoverLeave(item.id)}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEyeClick(item, e)
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 rounded p-0.5 cursor-pointer"
                            title="Hover to preview, click to pin"
                          >
                            <Eye className="w-3.5 h-3.5 text-white/40" />
                          </button>
                        ) : (
                          <button
                            onMouseEnter={(e) => handleNotePreviewHover(item.id, e)}
                            onMouseLeave={handleNotePreviewHoverLeave}
                            className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 rounded p-0.5"
                            title="Hover to preview, use 'Open note' button to open"
                          >
                            <Eye className="w-3.5 h-3.5 text-blue-400" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                      {item.type === 'folder' ? 'Folder' : 'Note'}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Add Folder Button */}
        <div className="px-3 pb-3 border-t border-white/10 pt-2">
          {creatingFolderInOrg ? (
            <div>
              <input
                type="text"
                value={newOrgFolderName}
                onChange={(e) => setNewOrgFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCreateFolderInOrg()
                  } else if (e.key === 'Escape') {
                    handleCancelCreateFolderInOrg()
                  }
                }}
                placeholder="New folder name"
                className="w-full px-3 py-2 text-sm bg-gray-800 text-white placeholder-gray-500 rounded-lg border border-white/20 focus:outline-none focus:border-blue-400/60"
                autoFocus
                disabled={orgFolderCreationLoading}
              />
              {orgFolderCreationError && (
                <div className="mt-2 text-xs text-red-400">{orgFolderCreationError}</div>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCreateFolderInOrg()
                  }}
                  disabled={orgFolderCreationLoading}
                  className="flex-1 px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors text-white font-medium"
                >
                  {orgFolderCreationLoading ? 'Creating...' : '✓ Create'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCancelCreateFolderInOrg()
                  }}
                  disabled={orgFolderCreationLoading}
                  className="flex-1 px-3 py-2 text-xs bg-white/10 hover:bg-white/20 disabled:cursor-not-allowed rounded-lg transition-colors text-white/80"
                >
                  ✗ Cancel
                </button>
              </div>
            </div>
          ) : isEditMode ? (
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleStartCreateFolderInOrg()
                }}
                className="flex-1 px-3 py-2 text-left text-sm text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg transition-colors font-medium"
              >
                + New Folder
              </button>
              {selectedFolderId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteSelectedFolder()
                  }}
                  className="px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors font-medium"
                  title="Delete selected folder"
                >
                  🗑️ Delete
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleStartCreateFolderInOrg()
              }}
              className="w-full px-3 py-2 text-left text-sm text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg transition-colors font-medium"
            >
              + New Folder
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderToolCategories = () => (
    <div
      className="flex items-center gap-2 rounded-2xl border border-white/20 bg-gray-900 px-4 py-3 shadow-xl"
      style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}
      onMouseEnter={handlePanelHover}
      onMouseLeave={handlePanelHoverLeave}
    >
      {TOOL_CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white/80 transition hover:bg-blue-500/20 hover:border-blue-400/40"
          onClick={() => setActivePanel(cat.id)}
          onMouseEnter={() => handleButtonHover(cat.id)}
          onMouseLeave={handleButtonHoverLeave}
        >
          {cat.label}
        </button>
      ))}
    </div>
  )

  const renderLayerPanel = () => (
    <div
      className="w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
      style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}
      onMouseEnter={handlePanelHover}
      onMouseLeave={handlePanelHoverLeave}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
        <span>Layer</span>
        <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">×</button>
      </div>
      <div className="p-3 space-y-2">
        {LAYER_ACTIONS.map((item) => (
          <button key={item.label} className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-left text-white/90 transition hover:bg-blue-500/20 hover:border-blue-400/40" onClick={onClose}>
            <div className="text-sm font-medium">{item.label}</div>
            <div className="mt-1 text-xs text-white/60">{item.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )

  const renderFormatPanel = () => (
    <div
      className="rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
      style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)', minWidth: '280px' }}
      onMouseEnter={handlePanelHover}
      onMouseLeave={handlePanelHoverLeave}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
        <span>Format</span>
        <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">×</button>
      </div>
      <div style={{ padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
        {FORMAT_ACTIONS.map((item) => (
          <button
            key={item.label}
            className={`rounded-lg text-sm transition hover:bg-blue-500/30 ${item.className ?? ""}`}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.8)',
              width: '42px',
              height: '42px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              cursor: 'pointer'
            }}
            title={item.tooltip}
            onClick={() => {
              if (item.command) {
                executeCommand(item.command, item.value)
              }
              setActivePanel(null)
              onClose()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )

  const renderResizePanel = () => (
    <div
      className="w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
      style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}
      onMouseEnter={handlePanelHover}
      onMouseLeave={handlePanelHoverLeave}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
        <span>Resize</span>
        <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">×</button>
      </div>
      <div className="p-3 space-y-2">
        {RESIZE_ACTIONS.map((item) => (
          <button key={item.label} className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-left text-white/90 transition hover:bg-blue-500/20 hover:border-blue-400/40" onClick={onClose}>
            <div className="text-sm font-medium">{item.label}</div>
            <div className="mt-1 text-xs text-white/60">{item.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )

  const renderBranchesPanel = () => {
    // Prefer context props (from CanvasAwareFloatingToolbar wrapper)
    // Fall back to window globals for backward compatibility
    const dataStore = canvasDataStore || (typeof window !== 'undefined' ? (window as any).canvasDataStore : null)
    const canvasStateValue = canvasState || (typeof window !== 'undefined' ? (window as any).canvasState : null)
    const canvasDispatchValue = canvasDispatch || (typeof window !== 'undefined' ? (window as any).canvasDispatch : null)
    const lastUpdate = canvasStateValue?.lastUpdate ?? 0

    console.log('[FloatingToolbar] Branches Panel Debug:', {
      activePanelId,
      canvasNoteId,
      hasDataStore: !!dataStore,
      hasCanvasState: !!canvasStateValue
    })

    if (!dataStore) {
      console.log('[FloatingToolbar] No dataStore available')
      return (
        <div style={{
          width: '300px',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '20px',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontSize: '14px' }}>
            No canvas data available
          </div>
        </div>
      )
    }

    // activePanelId now contains the full composite key (e.g., "abc123::main")
    // If it's already a composite key (contains "::"), use it directly
    // Otherwise, construct it from canvasNoteId + activePanelId
    const panelStoreKey = activePanelId && activePanelId.includes('::')
      ? activePanelId  // Already composite, use as-is
      : ensurePanelKey(canvasNoteId || '', activePanelId || 'main')  // Plain ID, build composite

    // Extract plain panel ID from composite key for use in component props
    const { panelId: currentPanelId } = parsePanelKey(panelStoreKey)

    // Get the current branch data
    const currentBranch = dataStore.get(panelStoreKey)

    console.log('[FloatingToolbar] Branches Data:', {
      panelStoreKey,
      currentBranch,
      hasBranches: !!currentBranch?.branches,
      branchesLength: currentBranch?.branches?.length,
      branches: currentBranch?.branches,
      allKeys: Array.from(dataStore.keys ? dataStore.keys() : []),
      allData: Array.from(dataStore.keys ? dataStore.keys() : []).map(k => ({
        key: k,
        hasBranches: !!dataStore.get(k)?.branches,
        branchCount: dataStore.get(k)?.branches?.length || 0
      }))
    })

    if (!currentBranch) {
      console.log('[FloatingToolbar] No branch data found for key:', panelStoreKey)
      return (
        <div style={{
          width: '300px',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '20px',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontSize: '14px' }}>
            No panel selected
          </div>
        </div>
      )
    }

    // Use BranchesSection component with props
    // Use key prop to force re-mount when panel changes OR when canvas state updates
    // Pass state and dispatch to enable real-time updates
    return (
      <div
        style={{ maxWidth: '300px' }}
        onMouseEnter={handlePanelHover}
        onMouseLeave={handlePanelHoverLeave}
      >
        <BranchesSection
          key={`${currentPanelId}-${lastUpdate}`}
          panelId={currentPanelId}
          branch={currentBranch}
          dataStore={dataStore}
          state={canvasStateValue}
          dispatch={canvasDispatchValue}
        />
      </div>
    )
  }

  const renderActionsPanel = () => (
    <div
      className="rounded-2xl border border-white/20 shadow-2xl"
      style={{ backgroundColor: 'rgba(255, 255, 255, 0.98)', padding: '20px', minWidth: '280px' }}
      onMouseEnter={handlePanelHover}
      onMouseLeave={handlePanelHoverLeave}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-gray-800 font-semibold text-lg">Create Branch</span>
        <button
          className="text-gray-500 hover:text-gray-700 text-xl leading-none"
          onClick={() => setActivePanel(null)}
          aria-label="Close panel"
        >
          ×
        </button>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        {/* Note Button */}
        <button
          onClick={() => {
            insertAnnotation('note')
            setActivePanel(null)
            onClose()
          }}
          style={{
            flex: 1,
            background: 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            padding: '20px 16px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 600,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            boxShadow: '0 4px 12px rgba(52, 152, 219, 0.3)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(52, 152, 219, 0.4)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(52, 152, 219, 0.3)'
          }}
        >
          <span style={{ fontSize: '32px' }}>📝</span>
          <span>Note</span>
        </button>

        {/* Explore Button */}
        <button
          onClick={() => {
            insertAnnotation('explore')
            setActivePanel(null)
            onClose()
          }}
          style={{
            flex: 1,
            background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            padding: '20px 16px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 600,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            boxShadow: '0 4px 12px rgba(243, 156, 18, 0.3)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(243, 156, 18, 0.4)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(243, 156, 18, 0.3)'
          }}
        >
          <span style={{ fontSize: '32px' }}>🔍</span>
          <span>Explore</span>
        </button>

        {/* Promote Button */}
        <button
          onClick={() => {
            insertAnnotation('promote')
            setActivePanel(null)
            onClose()
          }}
          style={{
            flex: 1,
            background: 'linear-gradient(135deg, #27ae60 0%, #229954 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            padding: '20px 16px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 600,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            boxShadow: '0 4px 12px rgba(39, 174, 96, 0.3)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(39, 174, 96, 0.4)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(39, 174, 96, 0.3)'
          }}
        >
          <span style={{ fontSize: '32px' }}>⭐</span>
          <span>Promote</span>
        </button>
      </div>
    </div>
  )

  const renderAddComponentPanel = () => {
    const components = [
      { type: 'calculator', label: 'Calculator', icon: '🔢', color: 'from-blue-500 to-blue-600' },
      { type: 'timer', label: 'Timer', icon: '⏱️', color: 'from-green-500 to-green-600' },
      { type: 'sticky-note', label: 'Sticky Note', icon: '📝', color: 'from-yellow-500 to-yellow-600' },
      { type: 'dragtest', label: 'Drag Test', icon: '🖱️', color: 'from-orange-500 to-orange-600' }
    ]

    return (
      <div
        className="w-80 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
        style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}
        onMouseEnter={handlePanelHover}
        onMouseLeave={handlePanelHoverLeave}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
          <span>Add Component</span>
          <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">
            ×
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          {components.map((component) => (
            <button
              key={component.type}
              onClick={() => {
                if (onAddComponent) {
                  onAddComponent(component.type)
                  setActivePanel(null)
                  onClose()
                }
              }}
              className={`bg-gradient-to-br ${component.color} text-white font-semibold rounded-xl p-4 flex flex-col items-center justify-center gap-2 hover:scale-105 active:scale-95 transition-transform`}
              disabled={!onAddComponent}
            >
              <span className="text-3xl">{component.icon}</span>
              <span className="text-sm">{component.label}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const renderDisplaySettingsPanel = () => {
    const backdropOptions = [
      { value: 'none', label: 'None', desc: 'No backdrop overlay' },
      { value: 'subtle', label: 'Subtle', desc: 'Light overlay + slight blur' },
      { value: 'moderate', label: 'Moderate', desc: 'Medium overlay + blur' },
      { value: 'strong', label: 'Strong', desc: 'Dark overlay + heavy blur' },
      { value: 'blur-only', label: 'Blur Only', desc: 'No overlay, blur only' },
      { value: 'vignette', label: 'Vignette', desc: 'Radial fade from center' },
      { value: 'dark', label: 'Dark', desc: 'Dark overlay, no blur' },
      { value: 'light', label: 'Light', desc: 'Light overlay, no blur' },
    ]

    return (
      <div
        className="w-80 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
        style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}
        onMouseEnter={handlePanelHover}
        onMouseLeave={handlePanelHoverLeave}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
          <span>Display Settings</span>
          <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">
            ×
          </button>
        </div>
        <div className="p-4">
          <div className="text-xs text-white/60 font-medium mb-3">Popup Overlay Backdrop</div>
          <div className="space-y-2">
            {backdropOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setBackdropStyle(option.value)}
                className={`w-full px-3 py-2.5 rounded-lg text-left transition-all ${
                  backdropStyle === option.value
                    ? 'bg-blue-500/30 border-2 border-blue-400/60 text-white shadow-md'
                    : 'bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <div className="font-medium text-sm">{option.label}</div>
                <div className="text-xs text-white/60 mt-0.5">{option.desc}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-white/10 text-xs text-white/50">
            Style is saved automatically and persists across sessions.
          </div>
        </div>
      </div>
    )
  }

  const toolbarContent = (
    <div
      ref={containerRef}
      className="absolute z-[9999] group"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(e) => {
        // Prevent default to preserve editor focus and text selection
        e.preventDefault()
      }}
    >
      {/* Main Toolbar - Fixed position */}
      <div
        className="flex items-center gap-3 rounded-full border border-white/20 bg-gray-900 px-4 py-3 shadow-2xl relative select-none"
        style={{
          backgroundColor: 'rgba(17, 24, 39, 0.98)',
          cursor: isDragging ? 'grabbing' : 'grab'
        }}
        onMouseDown={handleDragMouseDown}
      >
        {/* Close Button - Shows on hover */}
        <button
          onClick={onClose}
          className="opacity-0 group-hover:opacity-100 flex h-8 w-8 items-center justify-center rounded-full bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 hover:text-red-300 transition-all duration-200"
          title="Close toolbar (Esc)"
          aria-label="Close toolbar"
        >
          ✕
        </button>

        <button
          onClick={toggleLayer}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 select-none transition-all cursor-pointer hover:scale-110"
          style={{
            backgroundColor: layerContext?.activeLayer === 'popups' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.1)',
            color: layerContext?.activeLayer === 'popups' ? 'rgb(96, 165, 250)' : 'rgba(255, 255, 255, 0.6)'
          }}
          title={`Toggle layer (Tab)\nCurrent: ${layerContext?.activeLayer || 'notes'}`}
        >
          {layerContext?.activeLayer === 'popups' ? '🗂️' : '📄'}
        </button>
        <button
          className="rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:from-blue-400 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleCreateNewNote}
          disabled={isCreatingNote}
        >
          {isCreatingNote ? 'Creating...' : '+ Note'}
        </button>
        <div className="flex items-center gap-2" onMouseLeave={handleButtonHoverLeave}>
          {/* Recents - Dock style */}
          <button
            className={`dock-button flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              activePanel === "recents"
                ? "bg-white/20 border-2 border-white/30 shadow-lg"
                : "bg-white/5 border-2 border-white/20 hover:bg-white/15 hover:border-white/30 hover:shadow-md"
            }`}
            style={{ backdropFilter: 'blur(10px)' }}
            onClick={() => setActivePanel("recents")}
            onMouseEnter={() => handleButtonHover("recents")}
            data-tooltip="Recent Notes"
          >
            <span className="text-xl">🕒</span>
            <span className="text-[10px] text-white/90 font-medium">Recent</span>
          </button>

          {/* Org - Dock style */}
          <button
            className={`dock-button flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              activePanel === "org"
                ? "bg-white/20 border-2 border-white/30 shadow-lg"
                : "bg-white/5 border-2 border-white/20 hover:bg-white/15 hover:border-white/30 hover:shadow-md"
            }`}
            style={{ backdropFilter: 'blur(10px)' }}
            onClick={() => setActivePanel("org")}
            onMouseEnter={() => handleButtonHover("org")}
            data-tooltip="Organization"
          >
            <span className="text-xl">📁</span>
            <span className="text-[10px] text-white/90 font-medium">Org</span>
          </button>

          {/* Tools - Dock style */}
          <button
            className={`dock-button flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              activePanel === "tools"
                ? "bg-white/20 border-2 border-white/30 shadow-lg"
                : "bg-white/5 border-2 border-white/20 hover:bg-white/15 hover:border-white/30 hover:shadow-md"
            }`}
            style={{ backdropFilter: 'blur(10px)' }}
            onClick={() => setActivePanel("tools")}
            onMouseEnter={() => handleButtonHover("tools")}
            data-tooltip="Tools & Actions"
          >
            <span className="text-xl">🛠️</span>
            <span className="text-[10px] text-white/90 font-medium">Tools</span>
          </button>

          {/* Add Component - Dock style */}
          <button
            className={`dock-button flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              activePanel === "add-component"
                ? "bg-white/20 border-2 border-white/30 shadow-lg"
                : "bg-white/5 border-2 border-white/20 hover:bg-white/15 hover:border-white/30 hover:shadow-md"
            }`}
            style={{ backdropFilter: 'blur(10px)' }}
            onClick={() => setActivePanel("add-component")}
            onMouseEnter={() => handleButtonHover("add-component")}
            data-tooltip="Add Component"
          >
            <span className="text-xl">➕</span>
            <span className="text-[10px] text-white/90 font-medium">Component</span>
          </button>

          {/* Display Settings - Dock style */}
          <button
            className={`dock-button flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
              activePanel === "display"
                ? "bg-white/20 border-2 border-white/30 shadow-lg"
                : "bg-white/5 border-2 border-white/20 hover:bg-white/15 hover:border-white/30 hover:shadow-md"
            }`}
            style={{ backdropFilter: 'blur(10px)' }}
            onClick={() => setActivePanel("display")}
            onMouseEnter={() => handleButtonHover("display")}
            data-tooltip="Display Settings"
          >
            <span className="text-xl">🎨</span>
            <span className="text-[10px] text-white/90 font-medium">Display</span>
          </button>
        </div>
      </div>

      {/* Panels - Absolutely positioned below toolbar */}
      <div className="absolute left-1/2 -translate-x-1/2" style={{ top: 'calc(100% + 8px)' }}>
        {activePanel === "recents" && renderRecentNotes()}
        {activePanel === "org" && renderOrg()}
        {(activePanel === "tools" || activePanel === "layer" || activePanel === "format" || activePanel === "resize" || activePanel === "branches" || activePanel === "actions") && renderToolCategories()}
        {activePanel === "layer" && renderLayerPanel()}
        {activePanel === "format" && renderFormatPanel()}
        {activePanel === "resize" && renderResizePanel()}
        {activePanel === "branches" && renderBranchesPanel()}
        {activePanel === "actions" && renderActionsPanel()}
        {activePanel === "add-component" && renderAddComponentPanel()}
        {activePanel === "display" && renderDisplaySettingsPanel()}
      </div>

      {/* Help text - Only show when no panel is active */}
      {!activePanel && (
        <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-gray-800/90 px-3 py-1 text-xs text-white/60 shadow-lg border border-white/10" style={{ top: 'calc(100% + 8px)' }}>
          Press <kbd className="mx-1 px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono text-[10px]">
            {typeof window !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? '⌘K' : 'Ctrl+K'}
          </kbd> to open • <kbd className="mx-1 px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono text-[10px]">Esc</kbd> to close
        </div>
      )}

      {/* Hover tooltip popups - simple fixed divs */}
      {folderPopups.map((popup) => {
        const popupColorTheme = getFolderColorTheme(popup.folderColor)

        return (
          <div
            key={popup.id}
            data-toolbar-resident="true"
            className="fixed w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl"
            style={{
              backgroundColor: 'rgba(17, 24, 39, 0.98)',
              left: `${popup.position.x}px`,
              top: `${popup.position.y}px`,
              zIndex: 10000
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => handlePopupHover(popup.folderId)}
            onMouseLeave={() => handleEyeHoverLeave(popup.folderId)}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b text-sm font-medium"
              style={{
                backgroundColor: 'transparent',
                color: 'rgba(255, 255, 255, 0.8)',
                borderBottomColor: 'rgba(255, 255, 255, 0.1)'
              }}
            >
              <div className="flex items-center gap-2">
                {popupColorTheme && (
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: popupColorTheme.bg }}
                  />
                )}
                <span>{popup.folderName}</span>
              </div>
              <button
                className="hover:opacity-80 transition-opacity"
                style={{ color: 'rgba(255, 255, 255, 0.6)' }}
                onClick={() => setFolderPopups(prev => prev.filter(p => p.id !== popup.id))}
                aria-label="Close popup"
              >
                ×
              </button>
            </div>

          {/* Content */}
          <div className="max-h-64 overflow-y-auto p-3 space-y-1">
            {popup.isLoading ? (
              <div className="text-center py-4 text-white/60 text-sm">Loading...</div>
            ) : popup.children.length === 0 ? (
              <div className="text-center py-4 text-white/60 text-sm">Empty folder</div>
            ) : (
              popup.children.map((child) => (
                <div key={child.id} className="group relative">
                  <button
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-left text-white/90 transition hover:bg-blue-500/20 hover:border-blue-400/40"
                    onDoubleClick={() => {
                      if (child.type === 'note') {
                        switchToNoteCanvasIfNeeded() // Auto-switch to note canvas if on popups layer
                        onSelectNote?.(child.id)
                        onClose()
                        closeAllPopups()
                      }
                    }}
                  >
                    <div className="text-sm font-medium flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span>{child.icon}</span>
                        <span className="truncate">{child.name}</span>
                      </div>
                      {child.type === 'note' ? (
                        <div
                          onMouseEnter={(e) => handleNotePreviewHover(child.id, e, popup.folderId)}
                          onMouseLeave={handleNotePreviewHoverLeave}
                          className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 rounded p-0.5"
                          title="Hover to preview, use 'Open note' button to open"
                        >
                          <Eye className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                      ) : child.type === 'folder' ? (
                        <div
                          onMouseEnter={(e) => handleEyeHover(child, e, popup.folderId)}
                          onMouseLeave={() => handleEyeHoverLeave(child.id)}
                          onClick={(e) => handleEyeClick(child, e)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 rounded p-0.5 cursor-pointer"
                          title="Open folder"
                        >
                          <Eye className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                      {child.type === 'folder' ? 'Folder' : 'Note'}
                    </div>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        )
      })}

      {/* Note preview tooltip - using shared PreviewPopover component */}
      {notePreview && createPortal(
        <PreviewPopover
          content={notePreview.content}
          status={isLoadingPreview ? 'loading' : 'ready'}
          position={notePreview.position}
          noteId={notePreview.noteId}
          onOpenNote={(noteId) => {
            switchToNoteCanvasIfNeeded(); // Auto-switch to note canvas if on popups layer
            onSelectNote?.(noteId);
            setNotePreview(null);
            closeAllPopups(); // Close folder popups
            onClose(); // Close toolbar after opening note
          }}
          onMouseEnter={handlePreviewTooltipEnter}
          onMouseLeave={handlePreviewTooltipLeave}
          zIndex={10000}
        />,
        document.body
      )}

      {/* Color palette popup - rendered via portal to appear on top */}
      {openPaletteFolderId && palettePosition && typeof window !== 'undefined' && createPortal(
        <div
          ref={paletteRef}
          className="fixed p-2 rounded-lg border border-white/20 bg-gray-900 shadow-2xl"
          style={{
            backgroundColor: 'rgba(17, 24, 39, 0.98)',
            left: `${palettePosition.x}px`,
            top: `${palettePosition.y}px`,
            zIndex: 10001
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => {
            // Clear any pending panel close timeout when hovering over palette
            if (panelHoverTimeoutRef.current) {
              clearTimeout(panelHoverTimeoutRef.current)
              panelHoverTimeoutRef.current = null
            }
          }}
        >
          <div className="text-xs text-white/60 mb-2 px-1">Choose color</div>
          <div className="grid grid-cols-4 gap-1.5">
            {FOLDER_COLORS.map((color) => {
              const currentItem = flattenTree(orgItems).find(item => item.id === openPaletteFolderId)
              const isSelected = currentItem?.color === color.name

              return (
                <button
                  key={color.name}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSelectFolderColor(openPaletteFolderId, color.name, currentItem?.color)
                  }}
                  className="group relative w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
                  style={{
                    backgroundColor: color.bg,
                    borderColor: isSelected ? '#ffffff' : 'transparent'
                  }}
                  title={color.name.charAt(0).toUpperCase() + color.name.slice(1)}
                >
                  {/* Selected indicator */}
                  {isSelected && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )

  if (typeof document === 'undefined') {
    return toolbarContent
  }

  return createPortal(toolbarContent, document.body)
}
