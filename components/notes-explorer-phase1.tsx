"use client"

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { createPortal } from 'react-dom'
import { 
  Trash2, Plus, FileText, Search, X, ChevronRight, ChevronDown, Clock,
  FolderOpen, Folder, Database, WifiOff, Eye
} from "lucide-react"
import { PopupOverlay } from "@/components/canvas/popup-overlay"
import { useLayer } from "@/components/canvas/layer-provider"
import { LayerControls, layerControlsStyles } from "@/components/canvas/layer-controls"
import { useLayerKeyboardShortcuts } from "@/lib/hooks/use-layer-keyboard-shortcuts"
import { useFeatureFlag } from "@/lib/offline/feature-flags"
import { PopupStateAdapter } from "@/lib/adapters/popup-state-adapter"
import { CoordinateBridge } from "@/lib/utils/coordinate-bridge"

interface Note {
  id: string
  title: string
  createdAt: Date
  lastModified: Date
}

interface RecentNote {
  id: string
  lastAccessed: number
}

interface TreeNode {
  id: string
  name: string
  title?: string
  type: "folder" | "note" | "main" | "explore" | "promote"
  parentId?: string
  children?: TreeNode[]
  content?: string
  path?: string
  icon?: string
  color?: string
  hasChildren?: boolean
  lastAccessedAt?: string
}

interface ItemFromAPI {
  id: string
  name: string
  type: "folder" | "note"
  parentId?: string
  path: string
  icon?: string
  color?: string
  lastAccessedAt?: string
  metadata?: any
}

interface NotesExplorerProps {
  onNoteSelect: (noteId: string) => void
  isOpen: boolean
  onClose: () => void
  // Navigation controls props - disabled for now
  // zoom?: number
  // onZoomIn?: () => void
  // onZoomOut?: () => void
  // onResetView?: () => void
  // onToggleConnections?: () => void
  // showConnections?: boolean
  // Feature flags
  enableTreeView?: boolean
  usePhase1API?: boolean // New flag for Phase 1
}

// Custom hook for localStorage with SSR safety
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(initialValue)

  useEffect(() => {
    if (typeof window === 'undefined') return
    
    try {
      const item = window.localStorage.getItem(key)
      if (item && item !== 'undefined' && item !== 'null') {
        setStoredValue(JSON.parse(item))
      }
    } catch (error) {
      console.error(`Error loading ${key} from localStorage:`, error)
      window.localStorage.removeItem(key)
    }
  }, [key])

  const setValue = useCallback((value: T) => {
    try {
      setStoredValue(value)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(value))
      }
    } catch (error) {
      console.error(`Error saving ${key} to localStorage:`, error)
    }
  }, [key])

  return [storedValue, setValue]
}

// Inner component that uses layer hooks
function NotesExplorerContent({
  onNoteSelect,
  isOpen,
  onClose,
  enableTreeView = true,
  usePhase1API = false,
  multiLayerEnabled = false
}: NotesExplorerProps & { multiLayerEnabled: boolean }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  
  // Multi-layer canvas hooks
  const layerContext = multiLayerEnabled ? useLayer() : null
  const shortcuts = multiLayerEnabled ? useLayerKeyboardShortcuts({
    toggleLayer: () => layerContext?.setActiveLayer(
      layerContext.activeLayer === 'notes' ? 'popups' : 'notes'
    ),
    switchToNotes: () => layerContext?.setActiveLayer('notes'),
    switchToPopups: () => layerContext?.setActiveLayer('popups'),
    toggleSidebar: () => layerContext?.toggleSidebar(),
    resetView: () => layerContext?.resetView(),
  }) : null
  
  // Multi-select state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
  
  // Drag and drop state
  const [draggedItems, setDraggedItems] = useState<Set<string>>(new Set())
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [browseModalOpen, setBrowseModalOpen] = useState(false)
  const [browseFolder, setBrowseFolder] = useState<TreeNode | null>(null)
  const [selectedBrowseItem, setSelectedBrowseItem] = useState<string | null>(null)
  const [isBrowseLoading, setIsBrowseLoading] = useState(false)
  const [browseColumns, setBrowseColumns] = useState<TreeNode[]>([]) // Multi-column view
  const [columnWidths, setColumnWidths] = useState<number[]>([]) // Track column widths
  const [resizingColumn, setResizingColumn] = useState<number | null>(null)
  // Canvas container target for mounting scoped overlays (prevents covering the sidebar)
  const [canvasContainer, setCanvasContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCanvasContainer(document.getElementById('canvas-container'))
    }
  }, [])
  
  // Cascading popover state - now supports multiple popups with dragging
  const [hoverPopovers, setHoverPopovers] = useState<Map<string, {
    id: string
    folder: TreeNode | null
    position: { x: number, y: number } // Screen position (for legacy mode)
    canvasPosition?: { x: number, y: number } // Canvas position (for multi-layer mode) - stored once, not recalculated
    isLoading: boolean
    parentId?: string // To track relationships for connection lines
    level: number // Depth level for positioning
    isDragging?: boolean // Track if popup is being dragged
    height?: number // Actual height of the popup
  }>>(new Map())
  const hoverTimeoutRef = React.useRef<Map<string, NodeJS.Timeout>>(new Map())
  const popoverIdCounter = React.useRef(0)
  
  // Dragging state for popups
  const [draggingPopup, setDraggingPopup] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState<{ x: number, y: number }>({ x: 0, y: 0 })
  // RAF-driven drag refs (avoid per-move React updates)
  const draggingElRef = useRef<HTMLElement | null>(null)
  const dragStartPosRef = useRef<{ left: number; top: number }>({ left: 0, top: 0 })
  const dragDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const dragRafRef = useRef<number | null>(null)
  const rafDragEnabledRef = useRef<boolean>(false)
  
  // Convert popup state for multi-layer canvas
  const adaptedPopups = useMemo(() => {
    if (!multiLayerEnabled || !layerContext) return null
    
    const adapted = new Map()
    
    hoverPopovers.forEach((popup, id) => {
      adapted.set(id, {
        ...popup,
        // Use stored canvas position if available, don't recalculate!
        // This prevents position/transform cancellation
        canvasPosition: popup.canvasPosition || popup.position // Fallback to screen position if canvas not set
      })
    })
    return adapted
  }, [hoverPopovers, multiLayerEnabled, layerContext])
  
  // Hybrid sync: Auto-switch layers based on popup count changes
  const prevPopupCountRef = useRef(hoverPopovers.size)
  
  useEffect(() => {
    if (!multiLayerEnabled || !layerContext) return
    
    const currentPopupCount = hoverPopovers.size
    const prevPopupCount = prevPopupCountRef.current
    
    // Only auto-switch when popup count actually changes
    if (prevPopupCount !== currentPopupCount) {
      prevPopupCountRef.current = currentPopupCount
      
      if (currentPopupCount > 0) {
        // Any popups open - switch to popup layer
        layerContext.setActiveLayer('popups')
      } else {
        // No popups - switch back to notes
        layerContext.setActiveLayer('notes')
      }
    }
  }, [hoverPopovers.size, multiLayerEnabled, layerContext])
  
  // DISABLED: Space/Alt drag handler was preventing space bar in text editors
  // and interfering with direct popup overlay panning
  // The popup overlay now handles its own panning with plain click+drag
  /*
  useEffect(() => {
    if (!multiLayerEnabled || !layerContext) return
    // Removed Space/Alt drag handling - was causing:
    // 1. Space bar not working in text editors
    // 2. Interference with popup overlay's native pan handling
    // 3. Confusion with plain click+drag expectation
  }, [multiLayerEnabled, layerContext])
  */
  
  // Phase 0: Recent Notes tracking (localStorage)
  const [recentNotes, setRecentNotes] = useLocalStorage<RecentNote[]>('recent-notes', [])
  
  // Phase 0/1: Tree view state
  const [expandedNodes, setExpandedNodes] = useLocalStorage<Record<string, boolean>>('tree-expanded', {})
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  
  // Phase 1: API-based state
  const [apiTreeData, setApiTreeData] = useState<TreeNode[]>([])
  const [apiRecentNotes, setApiRecentNotes] = useState<ItemFromAPI[]>([])
  const [isLoadingAPI, setIsLoadingAPI] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  
  // Phase 2: Create note dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newNoteName, setNewNoteName] = useState("")
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [availableFolders, setAvailableFolders] = useState<Array<{
    id: string
    name: string
    path: string
    parentId?: string
    depth?: number
  }>>([])
  const [lastUsedFolderId, setLastUsedFolderId] = useLocalStorage<string | null>('last-folder', null)
  
  // Phase 3: Folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [customFolderInput, setCustomFolderInput] = useState("")
  const [showCustomFolder, setShowCustomFolder] = useState(false)
  
  // Update popup heights after render
  useEffect(() => {
    // Check and update actual heights of all popups
    hoverPopovers.forEach((popover, id) => {
      const popupElement = document.getElementById(`popup-${id}`)
      if (popupElement && !popover.isDragging) {
        const actualHeight = popupElement.offsetHeight
        if (actualHeight && actualHeight !== popover.height) {
          setHoverPopovers(prev => {
            const newMap = new Map(prev)
            const existing = newMap.get(id)
            if (existing && existing.height !== actualHeight) {
              newMap.set(id, { 
                ...existing, 
                height: actualHeight,
                canvasPosition: existing.canvasPosition // Preserve canvas position
              })
            }
            return newMap
          })
        }
      }
    })
  }, [hoverPopovers.size]) // Only re-run when number of popovers changes
  
  // Handle global mouse events for dragging
  useEffect(() => {
    if (!draggingPopup || rafDragEnabledRef.current) return
    
    let lastPosition = { x: 0, y: 0 }
    const popup = hoverPopovers.get(draggingPopup)
    if (popup) {
      lastPosition = popup.position
    }
    
    const handleGlobalMouseMove = (e: MouseEvent) => {
      e.preventDefault()
      
      // Allow dragging with minimal constraints - just keep header visible
      const minVisible = 50 // Minimum pixels that must remain visible
      const newPosition = {
        x: Math.max(-250, Math.min(window.innerWidth - minVisible, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - minVisible, e.clientY - dragOffset.y))
      }
      
      // Calculate delta for layer transform update
      const delta = {
        x: newPosition.x - lastPosition.x,
        y: newPosition.y - lastPosition.y
      }
      
      // Update popup position
      setHoverPopovers(prev => {
        const newMap = new Map(prev)
        const popup = newMap.get(draggingPopup)
        if (popup) {
          // Update canvas position for multi-layer mode
          let updatedCanvasPosition = popup.canvasPosition
          if (multiLayerEnabled && layerContext && popup.canvasPosition) {
            // Update canvas position directly by delta (no transform recalculation)
            updatedCanvasPosition = {
              x: popup.canvasPosition.x + delta.x,
              y: popup.canvasPosition.y + delta.y
            }
          }
          
          newMap.set(draggingPopup, {
            ...popup,
            position: newPosition,
            canvasPosition: updatedCanvasPosition,
            isDragging: true
          })
        }
        return newMap
      })
      
      // Update layer transform if in multi-layer mode
      if (multiLayerEnabled && layerContext && layerContext.activeLayer === 'popups') {
        // When dragging a popup while the popup layer is active,
        // we could optionally pan the entire layer. For now, we'll
        // just let individual popups move.
        // Uncomment below to pan the entire layer:
        // layerContext.updateTransform('popups', delta)
      }
      
      lastPosition = newPosition
    }
    
    const handleGlobalMouseUp = (e: MouseEvent) => {
      e.preventDefault()
      
      setHoverPopovers(prev => {
        const newMap = new Map(prev)
        const popup = newMap.get(draggingPopup)
        if (popup) {
          newMap.set(draggingPopup, { 
            ...popup, 
            isDragging: false,
            canvasPosition: popup.canvasPosition // Preserve canvas position
          })
        }
        return newMap
      })
      
      setDraggingPopup(null)
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
  }, [draggingPopup, dragOffset, multiLayerEnabled, layerContext, hoverPopovers])

  // RAF-driven popup drag: applies transform directly to the dragged element
  useEffect(() => {
    if (!draggingPopup || !rafDragEnabledRef.current) return

    const el = draggingElRef.current
    if (!el) return

    const applyTransform = () => {
      dragRafRef.current = null
      const { dx, dy } = dragDeltaRef.current
      el.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`
    }

    const schedule = () => {
      if (dragRafRef.current == null) {
        dragRafRef.current = requestAnimationFrame(applyTransform)
      }
    }

    const handleMove = (e: MouseEvent) => {
      e.preventDefault()
      const minVisible = 50
      const targetLeft = Math.max(
        -250,
        Math.min(window.innerWidth - minVisible, e.clientX - dragOffset.x)
      )
      const targetTop = Math.max(
        0,
        Math.min(window.innerHeight - minVisible, e.clientY - dragOffset.y)
      )

      const { left, top } = dragStartPosRef.current
      dragDeltaRef.current = { dx: targetLeft - left, dy: targetTop - top }
      schedule()
    }

    const handleUp = (e: MouseEvent) => {
      e.preventDefault()
      const { left, top } = dragStartPosRef.current
      const { dx, dy } = dragDeltaRef.current
      const finalPos = { x: left + dx, y: top + dy }

      // Commit once to React state
      setHoverPopovers(prev => {
        const newMap = new Map(prev)
        const popup = newMap.get(draggingPopup)
        if (popup) {
          let updatedCanvasPosition = popup.canvasPosition
          if (multiLayerEnabled && layerContext && popup.canvasPosition) {
            updatedCanvasPosition = { x: popup.canvasPosition.x + dx, y: popup.canvasPosition.y + dy }
          }
          newMap.set(draggingPopup, {
            ...popup,
            position: finalPos,
            canvasPosition: updatedCanvasPosition,
            isDragging: false,
          })
        }
        return newMap
      })

      // Reset styles
      if (el) {
        el.style.transition = ''
        el.style.willChange = 'auto'
        el.style.zIndex = ''
        el.style.transform = ''
        el.removeAttribute('data-dragging')
      }

      // Cleanup
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = null
      }
      draggingElRef.current = null
      dragDeltaRef.current = { dx: 0, dy: 0 }
      rafDragEnabledRef.current = false
      setDraggingPopup(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMove, true)
    document.addEventListener('mouseup', handleUp, true)

    return () => {
      document.removeEventListener('mousemove', handleMove, true)
      document.removeEventListener('mouseup', handleUp, true)
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = null
      }
      rafDragEnabledRef.current = false
    }
  }, [draggingPopup, dragOffset, multiLayerEnabled, layerContext, setHoverPopovers])
  
  // Track note access
  const trackNoteAccess = useCallback(async (noteId: string) => {
    if (usePhase1API) {
      // Phase 1: Track in database
      try {
        await fetch('/api/items/recent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: noteId })
        })
      } catch (error) {
        console.error('Failed to track item access:', error)
      }
    } else {
      // Phase 0: Track in localStorage
      const now = Date.now()
      setRecentNotes(prev => {
        const filtered = prev.filter(n => n.id !== noteId)
        const updated = [{ id: noteId, lastAccessed: now }, ...filtered].slice(0, 10)
        return updated
      })
    }
  }, [setRecentNotes, usePhase1API])

  // Fetch tree data from API (Phase 1) - Only fetch root level initially
  const fetchTreeFromAPI = useCallback(async () => {
    if (!usePhase1API) return
    
    setIsLoadingAPI(true)
    setApiError(null)
    
    try {
      // Fetch only root items - children will be loaded on demand
      const response = await fetch('/api/items?parentId=null')
      if (!response.ok) throw new Error('Failed to fetch tree')
      
      const data = await response.json()
      
      // Build tree structure WITHOUT recursively fetching all children
      const buildInitialTree = (items: ItemFromAPI[]): TreeNode[] => {
        return items.map(item => ({
          id: item.id,
          name: item.name,
          type: item.type,
          parentId: item.parentId,
          path: item.path,
          icon: item.icon,
          color: item.color,
          children: [], // Empty initially, loaded on expand
          hasChildren: item.type === 'folder' // Folders may have children
        }))
      }
      
      const tree = buildInitialTree(data.items)
      setApiTreeData(tree)
    } catch (error) {
      console.error('Error fetching tree from API:', error)
      setApiError('Failed to load tree structure')
    } finally {
      setIsLoadingAPI(false)
    }
  }, [usePhase1API])

  // Fetch recent notes from API (Phase 1)
  const fetchRecentFromAPI = useCallback(async () => {
    if (!usePhase1API) return
    
    try {
      const response = await fetch('/api/items/recent?limit=5')
      if (!response.ok) throw new Error('Failed to fetch recent items')
      
      const data = await response.json()
      setApiRecentNotes(data.items || [])
    } catch (error) {
      console.error('Error fetching recent items:', error)
    }
  }, [usePhase1API])

  // Build tree from branch data stored in localStorage (Phase 0)
  const buildTreeFromBranches = useCallback((noteId: string): TreeNode[] => {
    try {
      const noteData = localStorage.getItem(`note-data-${noteId}`)
      if (!noteData) return []
      
      const branches = JSON.parse(noteData)
      const nodes: Map<string, TreeNode> = new Map()
      
      Object.entries(branches).forEach(([id, branch]: [string, any]) => {
        nodes.set(id, {
          id,
          name: branch.title || id,
          title: branch.title,
          type: branch.type || 'note',
          parentId: branch.parentId,
          children: [],
          content: branch.content
        })
      })
      
      const roots: TreeNode[] = []
      nodes.forEach(node => {
        if (node.parentId && nodes.has(node.parentId)) {
          const parent = nodes.get(node.parentId)!
          if (!parent.children) parent.children = []
          parent.children.push(node)
        } else if (!node.parentId || node.type === 'main') {
          roots.push(node)
        }
      })
      
      return roots
    } catch (error) {
      console.error('Error building tree:', error)
      return []
    }
  }, [])

  // Load initial data
  useEffect(() => {
    // Load notes from localStorage (both phases use this for now)
    const savedNotes = localStorage.getItem('annotation-notes')
    if (savedNotes) {
      const parsed = JSON.parse(savedNotes)
      setNotes(parsed.map((note: any) => ({
        ...note,
        createdAt: new Date(note.createdAt),
        lastModified: new Date(note.lastModified)
      })))
    }
    
    // Load Phase 1 data if enabled
    if (usePhase1API) {
      fetchTreeFromAPI()
      fetchRecentFromAPI()
    }
    
    // Clean up deleted notes from recents (Phase 0)
    if (!usePhase1API) {
      setRecentNotes(prev => {
        const noteIds = new Set(notes.map(n => n.id))
        return prev.filter(r => noteIds.has(r.id))
      })
    }
  }, [usePhase1API]) // Removed callbacks from dependencies to prevent infinite loops

  // Update tree when selected note changes
  useEffect(() => {
    if (selectedNoteId && enableTreeView) {
      if (usePhase1API) {
        // Phase 1: Tree already loaded from API
        // Could refresh specific branch here if needed
      } else {
        // Phase 0: Build from localStorage
        const tree = buildTreeFromBranches(selectedNoteId)
        setTreeData(tree)
      }
    }
  }, [selectedNoteId, enableTreeView, usePhase1API, buildTreeFromBranches])

  // Phase 3.1: Fetch ALL folders including nested ones for selection
  const fetchAvailableFolders = useCallback(async () => {
    if (!usePhase1API) return
    
    try {
      const response = await fetch('/api/items?type=folder')
      if (!response.ok) return
      
      const data = await response.json()
      // Sort folders by path to ensure proper hierarchy display
      const folders = data.items
        .map((item: ItemFromAPI) => ({
          id: item.id,
          name: item.name,
          path: item.path,
          parentId: item.parentId,
          // Calculate depth for indentation
          depth: item.path.split('/').length - 2
        }))
        .sort((a: any, b: any) => a.path.localeCompare(b.path))
      
      setAvailableFolders(folders)
    } catch (error) {
      console.error('Failed to fetch folders:', error)
    }
  }, [usePhase1API])

  // Load folders when dialog opens
  useEffect(() => {
    if (showCreateDialog && usePhase1API) {
      fetchAvailableFolders()
      // Set default folder after a short delay to allow folders to load
      if (lastUsedFolderId) {
        setSelectedFolderId(lastUsedFolderId)
      } else {
        // Will set default in a separate effect after folders load
        setSelectedFolderId(null)
      }
    }
  }, [showCreateDialog, usePhase1API, fetchAvailableFolders, lastUsedFolderId]) // Fixed deps - removed availableFolders to prevent loop
  
  // Set default folder once folders are loaded
  useEffect(() => {
    if (showCreateDialog && availableFolders.length > 0 && !selectedFolderId && !lastUsedFolderId) {
      const uncategorized = availableFolders.find(f => f.name === 'Uncategorized')
      if (uncategorized) {
        setSelectedFolderId(uncategorized.id)
      }
    }
  }, [availableFolders, showCreateDialog, selectedFolderId, lastUsedFolderId])

  // Phase 3: Create new folder
  const createNewFolder = async (folderName: string, parentId?: string) => {
    try {
      const parentFolderId = parentId || availableFolders.find(f => f.name === 'Knowledge Base')?.id || null
      
      const response = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'folder',
          name: folderName,
          parentId: parentFolderId,
          metadata: {}
        })
      })
      
      if (!response.ok) throw new Error('Failed to create folder')
      
      const data = await response.json()
      const newFolder = {
        id: data.item.id,
        name: data.item.name,
        path: data.item.path
      }
      
      // Update available folders
      setAvailableFolders([...availableFolders, newFolder])
      
      // Select the new folder
      setSelectedFolderId(newFolder.id)
      
      // Refresh tree
      await fetchTreeFromAPI()
      
      return newFolder
    } catch (error) {
      console.error('Failed to create folder:', error)
      alert('Failed to create folder. Please try again.')
      return null
    }
  }

  const createNewNote = async () => {
    try {
      if (usePhase1API) {
        // Phase 3: Handle custom folder creation first
        let finalFolderId = selectedFolderId
        
        // If user typed a custom path, create the folder(s) first
        if (showCustomFolder && customFolderInput.trim()) {
          const pathParts = customFolderInput.trim().split('/').filter(p => p)
          let parentId = availableFolders.find(f => f.name === 'Knowledge Base')?.id || null
          
          // Create each folder in the path if it doesn't exist
          for (const folderName of pathParts) {
            const existingFolder = availableFolders.find(f => 
              f.parentId === parentId && f.name === folderName
            )
            
            if (existingFolder) {
              parentId = existingFolder.id
            } else {
              const newFolder = await createNewFolder(folderName, parentId)
              if (newFolder) {
                parentId = newFolder.id
              } else {
                throw new Error('Failed to create folder path')
              }
            }
          }
          
          finalFolderId = parentId
        }
        
        // Phase 2: Create with folder selection
        const noteName = newNoteName.trim() || `New Note ${notes.length + 1}`
        const folderId = finalFolderId || availableFolders.find(f => f.name === 'Uncategorized')?.id || null
        
        const response = await fetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'note',
            name: noteName,
            parentId: folderId, // User-selected folder
            metadata: {}
          })
        })
        
        if (!response.ok) throw new Error('Failed to create note')
        
        const data = await response.json()
        const newNote: Note = {
          id: data.item.id,
          title: data.item.name,
          createdAt: new Date(data.item.createdAt),
          lastModified: new Date(data.item.updatedAt)
        }
        
        setNotes([...notes, newNote])
        await fetchTreeFromAPI() // Refresh tree
        await fetchRecentFromAPI() // Refresh recent notes
        
        // Phase 2: Remember the folder for next time
        if (folderId) {
          setLastUsedFolderId(folderId)
        }
        
        // Reset dialog state
        setShowCreateDialog(false)
        setNewNoteName("")
        setIsCreatingFolder(false)
        setNewFolderName("")
        setShowCustomFolder(false)
        setCustomFolderInput("")
        
        // Open the new note
        onNoteSelect(data.item.id)
      } else {
        // Phase 0: Create via notes API
        const response = await fetch('/api/postgres-offline/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `New Note ${notes.length + 1}`,
            metadata: {}
          })
        })
        
        if (!response.ok) throw new Error('Failed to create note')
        
        const createdNote = await response.json()
        const newNote: Note = {
          id: createdNote.id,
          title: createdNote.title,
          createdAt: new Date(createdNote.created_at),
          lastModified: new Date(createdNote.updated_at)
        }
        
        setNotes([...notes, newNote])
        localStorage.setItem('annotation-notes', JSON.stringify([...notes, newNote]))
      }
    } catch (error) {
      console.error('Failed to create note:', error)
      alert('Failed to create note. Please try again.')
    }
  }

  const deleteNote = async (noteId: string) => {
    if (confirm('Are you sure you want to delete this note?')) {
      try {
        console.log('Deleting note with ID:', noteId)
        
        if (usePhase1API) {
          // Phase 1: Delete via API
          const response = await fetch(`/api/items/${noteId}`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json'
            }
          })
          
          if (!response.ok) {
            const errorText = await response.text()
            console.error('Delete API error:', response.status, errorText)
            
            // If it's a 404, the note might already be deleted
            if (response.status === 404) {
              console.log('Note not found, removing from local state')
            } else {
              throw new Error(`Failed to delete note: ${response.status}`)
            }
          }
          
          await fetchTreeFromAPI() // Refresh tree
          await fetchRecentFromAPI() // Refresh recent notes
          
          // Also refresh the main notes list
          const notesResponse = await fetch('/api/postgres-offline/notes')
          if (notesResponse.ok) {
            const notesData = await notesResponse.json()
            setNotes(notesData.map((note: any) => ({
              id: note.id,
              title: note.title,
              createdAt: new Date(note.created_at),
              lastModified: new Date(note.updated_at)
            })))
          }
        }
        
        // Update local state (both phases)
        const updatedNotes = notes.filter(note => note.id !== noteId)
        setNotes(updatedNotes)
        localStorage.setItem('annotation-notes', JSON.stringify(updatedNotes))
        
        if (selectedNoteId === noteId) {
          setSelectedNoteId(null)
        }
        
        localStorage.removeItem(`note-data-${noteId}`)
        setRecentNotes(prev => prev.filter(r => r.id !== noteId))
      } catch (error) {
        console.error('Failed to delete note:', error)
        alert('Failed to delete note. Please try again.')
      }
    }
  }

  // Helper function to get all selectable items in visual order
  // Returns items with context about where they appear
  const getAllSelectableItemsWithContext = (): Array<{id: string, section: 'recent' | 'tree', parentId?: string}> => {
    const items: Array<{id: string, section: 'recent' | 'tree', parentId?: string}> = []
    
    // Add recent notes
    if (recentNotesWithData.length > 0) {
      recentNotesWithData.forEach(note => {
        items.push({ id: note.id, section: 'recent' })
      })
    }
    
    // Then traverse the tree and collect only visible notes
    const traverse = (nodeList: TreeNode[], parentId?: string) => {
      for (const node of nodeList) {
        if (node.type === 'note') {
          items.push({ id: node.id, section: 'tree', parentId })
        }
        // Always traverse children if the folder is expanded
        if (node.children && expandedNodes[node.id]) {
          traverse(node.children, node.id)
        }
      }
    }
    traverse(apiTreeData)
    
    return items
  }
  
  // Helper to check if two items are in the same section
  const areItemsInSameSection = (id1: string, id2: string): boolean => {
    // Check if both are in recent notes
    const inRecent1 = recentNotesWithData.some(note => note.id === id1)
    const inRecent2 = recentNotesWithData.some(note => note.id === id2)
    
    // If one is in recent and other is not, they're in different sections
    if (inRecent1 !== inRecent2) return false
    
    // If both in recent, they're in same section
    if (inRecent1 && inRecent2) return true
    
    // Otherwise both are in tree, check if they're under the same parent folder
    const findParent = (nodeId: string, nodes: TreeNode[] = apiTreeData): string | null => {
      for (const node of nodes) {
        if (node.children?.some(child => child.id === nodeId)) {
          return node.id
        }
        if (node.children) {
          const parent = findParent(nodeId, node.children)
          if (parent) return parent
        }
      }
      return null
    }
    
    const parent1 = findParent(id1)
    const parent2 = findParent(id2)
    
    return parent1 === parent2
  }

  // Handle hover popover with support for cascading
  const handleFolderHover = async (folder: TreeNode, event: React.MouseEvent, parentPopoverId?: string) => {
    // Get position for popover FIRST (before any async calls)
    const rect = event.currentTarget.getBoundingClientRect()
    
    // Smart positioning - check available space
    const spaceRight = window.innerWidth - rect.right
    const spaceBelow = window.innerHeight - rect.bottom
    
    let position = { x: 0, y: 0 }
    
    if (spaceRight > 320) {
      // Enough space to the right
      position.x = rect.right + 10
      position.y = rect.top
    } else if (spaceBelow > 200) {
      // Not enough space right, place below
      position.x = rect.left
      position.y = rect.bottom + 10
    } else {
      // Place to the left if no space right or below
      position.x = rect.left - 310
      position.y = rect.top
    }
    
    // Clear any existing timeout for this folder
    const timeoutKey = parentPopoverId ? `${parentPopoverId}-${folder.id}` : folder.id
    if (hoverTimeoutRef.current.has(timeoutKey)) {
      clearTimeout(hoverTimeoutRef.current.get(timeoutKey)!)
    }
    
    // Log to database (non-blocking, don't await)
    fetch('/api/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component: 'notes-explorer',
        action: 'hover_triggered',
        metadata: { folderName: folder.name, folderId: folder.id, position }
      })
    })
    
    // Show popover after 500ms delay
    const timeout = setTimeout(async () => {
      // Log loading state (non-blocking)
      fetch('/api/debug-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component: 'notes-explorer',
          action: 'popover_loading',
          metadata: { folderName: folder.name, state: 'loading' }
        })
      })
      
      // Generate unique ID for this popup
      const popoverId = `popup-${++popoverIdCounter.current}`
      
      // Calculate level based on parent
      const level = parentPopoverId 
        ? (hoverPopovers.get(parentPopoverId)?.level || 0) + 1 
        : 0
      
      // Adjust position for cascading effect - allow both right and down positioning
      let adjustedPosition = {
        x: position.x,
        y: position.y
      }
      
      // Smart positioning: if too far right, cascade downward instead
      if (position.x > window.innerWidth - 400) {
        // Position below instead of to the right
        adjustedPosition.x = position.x - 300
        adjustedPosition.y = position.y + 100
      } else {
        // Normal cascading to the right
        adjustedPosition.x = position.x + (level * 20)
        adjustedPosition.y = position.y + (level * 10)
      }
      
      // Add new popover to the map
      setHoverPopovers(prev => {
        const newMap = new Map(prev)
        
        // Calculate canvas position once when creating popup (for multi-layer mode)
        let canvasPosition = undefined
        if (multiLayerEnabled && layerContext) {
          const popupTransform = layerContext.transforms.popups || { x: 0, y: 0, scale: 1 }
          canvasPosition = CoordinateBridge.screenToCanvas(adjustedPosition, popupTransform)
        }
        
        newMap.set(popoverId, {
          id: popoverId,
          folder: null,
          position: adjustedPosition,
          canvasPosition, // Store canvas position once, don't recalculate on render
          isLoading: true,
          parentId: parentPopoverId,
          level
        })
        return newMap
      })
      
      // Load folder contents if needed
      if (folder.type === 'folder' && (!folder.children || folder.children.length === 0)) {
        try {
          const response = await fetch(`/api/items/${folder.id}/children`)
          if (response.ok) {
            const data = await response.json()
            const updatedFolder = {
              ...folder,
              children: data.children?.map((child: ItemFromAPI) => ({
                id: child.id,
                name: child.name,
                type: child.type,
                parentId: child.parentId,
                path: child.path,
                icon: child.icon,
                color: child.color,
                children: [],
                hasChildren: child.type === 'folder'
              })) || []
            }
            setHoverPopovers(prev => {
              const newMap = new Map(prev)
              const popup = newMap.get(popoverId)
              if (popup) {
                // Calculate height based on loaded content
                const itemCount = updatedFolder.children?.length || 0
                const height = 45 + Math.min(itemCount * 36, 320) + 30 + 20
                
                newMap.set(popoverId, {
                  ...popup,
                  folder: updatedFolder,
                  isLoading: false,
                  height,
                  canvasPosition: popup.canvasPosition // Preserve canvas position
                })
              }
              return newMap
            })
            
            // Log success (non-blocking)
            fetch('/api/debug-log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                component: 'notes-explorer',
                action: 'popover_loaded',
                metadata: { folderName: folder.name, childrenCount: updatedFolder.children.length }
              })
            })
          }
        } catch (error) {
          // Log error (non-blocking)
          fetch('/api/debug-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              component: 'notes-explorer',
              action: 'popover_error',
              metadata: { folderName: folder.name, error: error.message }
            })
          })
          setHoverPopovers(prev => {
            const newMap = new Map(prev)
            const popup = newMap.get(popoverId)
            if (popup) {
              // Empty folder - minimal height
              const height = 45 + 60 + 30 + 20 // Header + empty message + footer + padding
              
              newMap.set(popoverId, {
                ...popup,
                folder: { ...folder, children: [] },
                isLoading: false,
                height,
                canvasPosition: popup.canvasPosition // Preserve canvas position
              })
            }
            return newMap
          })
        }
      } else {
        setHoverPopovers(prev => {
          const newMap = new Map(prev)
          const popup = newMap.get(popoverId)
          if (popup) {
            // Calculate height based on existing children
            const itemCount = folder.children?.length || 0
            const height = 45 + Math.min(itemCount * 36, 320) + 30 + 20
            
            newMap.set(popoverId, {
              ...popup,
              folder,
              isLoading: false,
              height,
              canvasPosition: popup.canvasPosition // Preserve canvas position
            })
          }
          return newMap
        })
        
        // Log shown (non-blocking)
        fetch('/api/debug-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: 'notes-explorer',
            action: 'popover_shown',
            metadata: { folderName: folder.name, childrenCount: folder.children?.length || 0 }
          })
        })
      }
    }, 500) // 500ms delay before showing
    
    // Store timeout reference
    hoverTimeoutRef.current.set(timeoutKey, timeout)
  }
  
  const handleFolderHoverLeave = (folderId?: string, parentPopoverId?: string) => {
    // Clear timeout if hovering out before popover shows
    const timeoutKey = parentPopoverId ? `${parentPopoverId}-${folderId}` : folderId || ''
    if (hoverTimeoutRef.current.has(timeoutKey)) {
      clearTimeout(hoverTimeoutRef.current.get(timeoutKey)!)
      hoverTimeoutRef.current.delete(timeoutKey)
    }
    
    // Don't automatically hide popovers - they stay visible until explicitly closed
    // This allows cascading effect where multiple popovers remain visible
  }
  
  // Close all popovers
  const closeAllPopovers = () => {
    // Clear all timeouts
    hoverTimeoutRef.current.forEach(timeout => clearTimeout(timeout))
    hoverTimeoutRef.current.clear()
    
    // Clear all popovers
    setHoverPopovers(new Map())
    setDraggingPopup(null)
  }
  
  // Close specific popover and its children
  const closePopover = (popoverId: string) => {
    setHoverPopovers(prev => {
      const newMap = new Map(prev)
      
      // Find and remove this popover and all its children
      const toRemove = [popoverId]
      const findChildren = (parentId: string) => {
        prev.forEach((popup, id) => {
          if (popup.parentId === parentId) {
            toRemove.push(id)
            findChildren(id) // Recursively find children
          }
        })
      }
      findChildren(popoverId)
      
      toRemove.forEach(id => newMap.delete(id))
      return newMap
    })
    
    // Clear dragging state if this popup was being dragged
    if (draggingPopup === popoverId) {
      setDraggingPopup(null)
    }
  }
  
  // Handle popup drag start
  const handlePopupDragStart = (popupId: string, e: React.MouseEvent) => {
    e.preventDefault() // Prevent text selection during drag
    e.stopPropagation() // Prevent event bubbling
    
    const popup = hoverPopovers.get(popupId)
    if (!popup) return
    
    // Get the exact position of the header element
    const rect = e.currentTarget.getBoundingClientRect()
    
    // Calculate offset from mouse to popup position
    const offset = {
      x: e.clientX - popup.position.x,
      y: e.clientY - popup.position.y
    }
    
    setDragOffset(offset)
    setDraggingPopup(popupId)
    
    // Avoid setState at t=0 for smoother start; flag element instead
    const elFlag = document.getElementById(`popup-${popupId}`) as HTMLElement | null
    if (elFlag) elFlag.setAttribute('data-dragging', 'true')
    
    // Add cursor style to body during drag
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'

    // Enable RAF-driven drag and prepare element styles
    rafDragEnabledRef.current = true
    const el = document.getElementById(`popup-${popupId}`) as HTMLElement | null
    if (el) {
      draggingElRef.current = el
      const startLeft = parseFloat(el.style.left || '0')
      const startTop = parseFloat(el.style.top || '0')
      dragStartPosRef.current = { left: startLeft, top: startTop }
      dragDeltaRef.current = { dx: 0, dy: 0 }
      el.style.willChange = 'transform'
      el.style.transition = 'none'
      el.style.zIndex = '10000'
      el.style.transform = 'translateZ(0)'
    }
  }
  
  // Handle popup drag (now handled by global mouse events)
  const handlePopupDrag = (e: React.MouseEvent) => {
    // This is now handled by the global mouse move in useEffect
    // Keeping this function for compatibility but it doesn't need to do anything
    if (draggingPopup) {
      e.preventDefault()
    }
  }
  
  // Handle popup drag end
  const handlePopupDragEnd = () => {
    if (!draggingPopup) return
    
    // Remove dragging state
    setHoverPopovers(prev => {
      const newMap = new Map(prev)
      const popup = newMap.get(draggingPopup)
      if (popup) {
        newMap.set(draggingPopup, { 
          ...popup, 
          isDragging: false,
          canvasPosition: popup.canvasPosition // Preserve canvas position
        })
      }
      return newMap
    })
    
    setDraggingPopup(null)
    
    // Reset cursor
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  const handleBrowseFolder = async (folder: TreeNode, event: React.MouseEvent) => {
    event.stopPropagation()
    setBrowseModalOpen(true)
    setIsBrowseLoading(true)
    
    // Load folder contents directly if not already loaded
    if (folder.type === 'folder' && (!folder.children || folder.children.length === 0)) {
      try {
        const response = await fetch(`/api/items/${folder.id}/children`)
        if (response.ok) {
          const data = await response.json()
          if (data.children && data.children.length > 0) {
            // Create an updated folder with the loaded children
            const updatedFolder = {
              ...folder,
              children: data.children.map((child: ItemFromAPI) => ({
                id: child.id,
                name: child.name,
                type: child.type,
                parentId: child.parentId,
                path: child.path,
                icon: child.icon,
                color: child.color,
                children: [],
                hasChildren: child.type === 'folder'
              }))
            }
            setBrowseFolder(updatedFolder)
            setBrowseColumns([updatedFolder]) // Initialize with first column
            setColumnWidths([280]) // Default width
            
            // Also update the main tree for consistency
            await loadNodeChildren(folder.id)
          } else {
            // Folder is empty
            setBrowseFolder({ ...folder, children: [] })
            setBrowseColumns([{ ...folder, children: [] }])
            setColumnWidths([280])
          }
        } else {
          setBrowseFolder(folder)
          setBrowseColumns([folder])
          setColumnWidths([280])
        }
      } catch (error) {
        console.error('Error loading folder contents:', error)
        setBrowseFolder(folder)
        setBrowseColumns([folder])
        setColumnWidths([280])
      }
    } else {
      setBrowseFolder(folder)
      setBrowseColumns([folder])
      setColumnWidths([280])
    }
    
    setIsBrowseLoading(false)
  }

  const closeBrowseModal = () => {
    setBrowseModalOpen(false)
    setBrowseFolder(null)
    setSelectedBrowseItem(null)
    setBrowseColumns([])
    setColumnWidths([])
  }

  const handleColumnResize = (columnIndex: number, newWidth: number) => {
    const newWidths = [...columnWidths]
    newWidths[columnIndex] = Math.max(200, Math.min(500, newWidth)) // Min 200px, Max 500px
    setColumnWidths(newWidths)
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (resizingColumn !== null && columnWidths[resizingColumn] !== undefined) {
      const startX = columnWidths.slice(0, resizingColumn).reduce((sum, w) => sum + w, 320) // 320 is sidebar offset
      const newWidth = e.clientX - startX
      handleColumnResize(resizingColumn, newWidth)
    }
  }

  const handleMouseUp = () => {
    setResizingColumn(null)
  }

  // Add mouse event listeners when resizing
  React.useEffect(() => {
    if (resizingColumn !== null) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = 'auto'
      }
    }
  }, [resizingColumn, columnWidths])

  const handleBrowseSubfolder = async (folder: TreeNode, columnIndex: number) => {
    // Remove columns after the current one and add new column
    const newColumns = browseColumns.slice(0, columnIndex + 1)
    
    setIsBrowseLoading(true)
    setSelectedBrowseItem(folder.id)
    
    // Load folder contents directly
    if (folder.type === 'folder' && (!folder.children || folder.children.length === 0)) {
      try {
        const response = await fetch(`/api/items/${folder.id}/children`)
        if (response.ok) {
          const data = await response.json()
          if (data.children && data.children.length > 0) {
            const updatedFolder = {
              ...folder,
              children: data.children.map((child: ItemFromAPI) => ({
                id: child.id,
                name: child.name,
                type: child.type,
                parentId: child.parentId,
                path: child.path,
                icon: child.icon,
                color: child.color,
                children: [],
                hasChildren: child.type === 'folder'
              }))
            }
            setBrowseColumns([...newColumns, updatedFolder])
            setColumnWidths([...columnWidths.slice(0, columnIndex + 1), 280])
          } else {
            setBrowseColumns([...newColumns, { ...folder, children: [] }])
            setColumnWidths([...columnWidths.slice(0, columnIndex + 1), 280])
          }
        }
      } catch (error) {
        console.error('Error loading folder contents:', error)
      }
    } else if (folder.children) {
      setBrowseColumns([...newColumns, folder])
      setColumnWidths([...columnWidths.slice(0, columnIndex + 1), 280])
    }
    
    setIsBrowseLoading(false)
  }

  const handleBrowseFolderNavigation = async (folder: TreeNode) => {
    setIsBrowseLoading(true)
    setSelectedBrowseItem(null)
    
    // Load folder contents directly
    if (folder.type === 'folder' && (!folder.children || folder.children.length === 0)) {
      try {
        const response = await fetch(`/api/items/${folder.id}/children`)
        if (response.ok) {
          const data = await response.json()
          if (data.children && data.children.length > 0) {
            const updatedFolder = {
              ...folder,
              children: data.children.map((child: ItemFromAPI) => ({
                id: child.id,
                name: child.name,
                type: child.type,
                parentId: child.parentId,
                path: child.path,
                icon: child.icon,
                color: child.color,
                children: [],
                hasChildren: child.type === 'folder'
              }))
            }
            setBrowseFolder(updatedFolder)
          } else {
            setBrowseFolder({ ...folder, children: [] })
          }
        } else {
          setBrowseFolder(folder)
        }
      } catch (error) {
        console.error('Error loading folder contents:', error)
        setBrowseFolder(folder)
      }
    } else {
      setBrowseFolder(folder)
    }
    
    setIsBrowseLoading(false)
  }

  const handleNoteSelect = (noteId: string, event?: React.MouseEvent, openNote: boolean = false) => {
    const isMultiSelect = event && (event.metaKey || event.ctrlKey)
    const isShiftSelect = event && event.shiftKey
    const isDoubleClick = event && event.detail === 2
    
    if (isMultiSelect) {
      // Ctrl/Cmd+click: Toggle selection
      const newSelection = new Set(selectedItems)
      if (newSelection.has(noteId)) {
        newSelection.delete(noteId)
      } else {
        newSelection.add(noteId)
      }
      setSelectedItems(newSelection)
      setLastSelectedId(noteId)
      
      // Set as selected but don't open the note
      if (newSelection.size === 1) {
        setSelectedNoteId(noteId)
        // Don't call onNoteSelect here - only select, don't open
      }
    } else if (isShiftSelect && lastSelectedId) {
      // Shift+click: Select range only within the same logical group
      const allItemsWithContext = getAllSelectableItemsWithContext()
      
      // Find the exact context of clicked items (where they appear in the UI)
      let startItem = null
      let endItem = null
      let startIndex = -1
      let endIndex = -1
      
      // Find items in tree section first (prefer tree over recent for duplicates)
      for (let i = 0; i < allItemsWithContext.length; i++) {
        const item = allItemsWithContext[i]
        if (item.id === lastSelectedId && item.section === 'tree') {
          startItem = item
          startIndex = i
        }
        if (item.id === noteId && item.section === 'tree') {
          endItem = item
          endIndex = i
        }
      }
      
      // If not found in tree, look in recent
      if (startIndex === -1) {
        for (let i = 0; i < allItemsWithContext.length; i++) {
          const item = allItemsWithContext[i]
          if (item.id === lastSelectedId && item.section === 'recent') {
            startItem = item
            startIndex = i
            break
          }
        }
      }
      
      if (endIndex === -1) {
        for (let i = 0; i < allItemsWithContext.length; i++) {
          const item = allItemsWithContext[i]
          if (item.id === noteId && item.section === 'recent') {
            endItem = item
            endIndex = i
            break
          }
        }
      }
      
      if (startIndex !== -1 && endIndex !== -1 && startItem && endItem) {
        // Check if both items are in the same section and parent
        if (startItem.section !== endItem.section || startItem.parentId !== endItem.parentId) {
          // Different sections or parents - just select the clicked item
          setSelectedItems(new Set([noteId]))
          setSelectedNoteId(noteId)
          setLastSelectedId(noteId)
          // Don't open - just select
          return
        }
        
        // Select range within the same section/parent
        const minIndex = Math.min(startIndex, endIndex)
        const maxIndex = Math.max(startIndex, endIndex)
        const rangeItems = allItemsWithContext.slice(minIndex, maxIndex + 1)
        
        // Filter to only include items from the same section and parent
        const filteredRange = rangeItems
          .filter(item => 
            item.section === startItem.section && 
            item.parentId === startItem.parentId
          )
          .map(item => item.id)
        
        // Create new selection with only the range items
        const newSelection = new Set(filteredRange)
        setSelectedItems(newSelection)
        
        // Set the clicked item as primary selected but don't open
        setSelectedNoteId(noteId)
        // Don't track access or open - just select
      } else {
        // Fallback to single selection if range can't be determined
        setSelectedItems(new Set([noteId]))
        setSelectedNoteId(noteId)
        setLastSelectedId(noteId)
        // Don't open - just select
      }
    } else {
      // Regular click: Single select (clear multi-selection)
      setSelectedItems(new Set([noteId]))
      setSelectedNoteId(noteId)
      setLastSelectedId(noteId)
      
      // Only open the note on double-click or when explicitly requested
      if (isDoubleClick || openNote) {
        trackNoteAccess(noteId)
        onNoteSelect(noteId)
        // Clear selection when opening a note to hide the action bar
        setSelectedItems(new Set())
      }
    }
  }

  // Load children for a node on demand (Phase 1)
  const loadNodeChildren = async (nodeId: string) => {
    if (!usePhase1API) return
    
    try {
      const response = await fetch(`/api/items/${nodeId}/children`)
      if (!response.ok) return
      
      const data = await response.json()
      if (!data.children || data.children.length === 0) return
      
      // Update the tree with loaded children
      const updateTreeWithChildren = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map(node => {
          if (node.id === nodeId) {
            return {
              ...node,
              children: data.children.map((child: ItemFromAPI) => ({
                id: child.id,
                name: child.name,
                type: child.type,
                parentId: child.parentId,
                path: child.path,
                icon: child.icon,
                color: child.color,
                children: [],
                hasChildren: child.type === 'folder'
              }))
            }
          } else if (node.children && node.children.length > 0) {
            return {
              ...node,
              children: updateTreeWithChildren(node.children)
            }
          }
          return node
        })
      }
      
      setApiTreeData(prev => updateTreeWithChildren(prev))
    } catch (error) {
      console.error('Error loading children:', error)
    }
  }

  const toggleTreeNode = async (nodeId: string) => {
    const isExpanding = !expandedNodes[nodeId]
    
    // Load children on first expand (Phase 1)
    if (isExpanding && usePhase1API) {
      // Find the node to check if it has unloaded children
      const findNode = (nodes: TreeNode[]): TreeNode | null => {
        for (const node of nodes) {
          if (node.id === nodeId) return node
          if (node.children) {
            const found = findNode(node.children)
            if (found) return found
          }
        }
        return null
      }
      
      const node = findNode(apiTreeData)
      if (node && node.type === 'folder' && node.children?.length === 0) {
        await loadNodeChildren(nodeId)
      }
    }
    
    setExpandedNodes((prev: Record<string, boolean>) => ({
      ...prev,
      [nodeId]: isExpanding
    }))
  }

  // Get recent notes with full data
  const recentNotesWithData = useMemo(() => {
    if (usePhase1API) {
      // Phase 1: Use API data
      return apiRecentNotes.map(item => ({
        id: item.id,
        title: item.name,
        lastAccessed: new Date(item.lastAccessedAt || '').getTime()
      }))
    } else {
      // Phase 0: Use localStorage
      const noteMap = new Map(notes.map(n => [n.id, n]))
      return recentNotes
        .filter(r => noteMap.has(r.id))
        .map(r => ({
          ...noteMap.get(r.id)!,
          lastAccessed: r.lastAccessed
        }))
        .slice(0, 5)
    }
  }, [recentNotes, notes, apiRecentNotes, usePhase1API])

  const filteredNotes = notes.filter(note =>
    note.title.toLowerCase().includes(searchTerm.toLowerCase())
  )
  
  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, nodeId: string) => {
    // If the dragged item is selected, drag all selected items
    const itemsToDrag = selectedItems.has(nodeId) ? selectedItems : new Set([nodeId])
    setDraggedItems(itemsToDrag)
    
    // Set drag data
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', Array.from(itemsToDrag).join(','))
    
    // Add a custom drag image showing count if multiple items
    if (itemsToDrag.size > 1) {
      const dragPreview = document.createElement('div')
      dragPreview.className = 'bg-indigo-600 text-white px-2 py-1 rounded'
      dragPreview.textContent = `${itemsToDrag.size} items`
      dragPreview.style.position = 'absolute'
      dragPreview.style.top = '-1000px'
      document.body.appendChild(dragPreview)
      e.dataTransfer.setDragImage(dragPreview, 0, 0)
      setTimeout(() => document.body.removeChild(dragPreview), 0)
    }
  }
  
  const handleDragEnd = () => {
    setDraggedItems(new Set())
    setDropTargetId(null)
  }
  
  const handleDragOver = (e: React.DragEvent, nodeId: string, isFolder: boolean) => {
    if (!isFolder) return
    
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetId(nodeId)
  }
  
  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if we're leaving the drop zone entirely
    const related = e.relatedTarget as HTMLElement
    if (!related || !related.closest('[data-drop-zone]')) {
      setDropTargetId(null)
    }
  }
  
  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.stopPropagation()
    
    const itemIds = Array.from(draggedItems)
    if (itemIds.length === 0) return
    
    // Don't allow dropping on itself
    if (itemIds.includes(targetId)) {
      setDropTargetId(null)
      return
    }
    
    try {
      const response = await fetch('/api/items/bulk-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds,
          targetFolderId: targetId
        })
      })
      
      if (!response.ok) throw new Error('Failed to move items')
      
      // Auto-expand the target folder to show the moved items
      setExpandedNodes(prev => ({
        ...prev,
        [targetId]: true
      }))
      
      // Load the target folder's children to show the moved items
      await loadNodeChildren(targetId)
      
      // Also reload the source parent folders to remove moved items
      const sourceParentIds = new Set<string>()
      for (const itemId of itemIds) {
        // Find the parent of each moved item
        const findParent = (nodes: TreeNode[]): string | null => {
          for (const node of nodes) {
            if (node.children?.some(child => child.id === itemId)) {
              return node.id
            }
            if (node.children) {
              const parent = findParent(node.children)
              if (parent) return parent
            }
          }
          return null
        }
        const parentId = findParent(apiTreeData)
        if (parentId) sourceParentIds.add(parentId)
      }
      
      // Reload each source parent to update their children
      for (const parentId of sourceParentIds) {
        await loadNodeChildren(parentId)
      }
      
      // Clear selections
      setSelectedItems(new Set())
      setDraggedItems(new Set())
      setDropTargetId(null)
      
    } catch (error) {
      console.error('Failed to move items:', error)
      alert('Failed to move items. Please try again.')
    }
  }

  // Render tree node recursively
  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const isExpanded = expandedNodes[node.id]
    // Check both: actual children OR the hasChildren flag (for unloaded folders)
    const hasChildren = (node.children && node.children.length > 0) || node.hasChildren === true
    const isFolder = node.type === 'folder'
    const isSelected = selectedItems.has(node.id)
    const isPrimarySelected = selectedNoteId === node.id
    const isDragging = draggedItems.has(node.id)
    const isDropTarget = dropTargetId === node.id && isFolder
    
    const typeColors = {
      main: 'text-blue-400',
      note: 'text-green-400',
      explore: 'text-yellow-400',
      promote: 'text-red-400',
      folder: 'text-purple-400'
    }

    return (
      <div key={node.id} role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
        <div
          className={`group flex items-center gap-1 py-1 px-2 rounded cursor-pointer transition-all ${
            isDropTarget ? 'bg-green-600 bg-opacity-50 ring-2 ring-green-500' :
            isPrimarySelected ? 'bg-indigo-600 text-white' :
            isSelected ? 'bg-indigo-500 bg-opacity-50' :
            isDragging ? 'opacity-50' :
            'hover:bg-gray-700'
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          draggable={node.type === 'note' || isFolder}
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, node.id, isFolder)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => isFolder && handleDrop(e, node.id)}
          data-drop-zone={isFolder ? 'true' : undefined}
          onClick={(e) => {
            // Single click: Select only
            handleNoteSelect(node.id, e)
            
            // For folders, toggle expand/collapse on single click
            if (hasChildren && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
              toggleTreeNode(node.id)
            }
          }}
          onDoubleClick={(e) => {
            // Double click: Open the note
            if (node.type === 'note') {
              e.stopPropagation()
              handleNoteSelect(node.id, e, true) // true = open note
            }
          }}
        >
          {hasChildren && (
            <button 
              className="p-0.5" 
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
              onClick={(e) => {
                e.stopPropagation()
                toggleTreeNode(node.id)
              }}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
          {!hasChildren && <span className="w-5" />}
          <span className={`text-xs ${typeColors[node.type] || 'text-gray-400'}`}>
            {node.type === 'folder' ? 
              (isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />) : 
              <FileText size={14} />
            }
          </span>
          <span className="text-sm truncate flex-1">{node.name || node.title}</span>
          {isFolder && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleBrowseFolder(node, e)
              }}
              onMouseEnter={(e) => {
                e.stopPropagation()
                handleFolderHover(node, e)
              }}
              onMouseLeave={(e) => {
                e.stopPropagation()
                handleFolderHoverLeave(node.id)
              }}
              className="p-1 hover:bg-gray-600 rounded transition-colors opacity-0 group-hover:opacity-100"
            >
              <Eye className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div role="group">
            {node.children!.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div 
      data-sidebar="sidebar"
      className={`h-screen w-80 bg-gray-900 text-white flex flex-col border-r border-gray-800 fixed left-0 top-0 z-50 transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Notes</h2>
          <div className="flex items-center gap-2">
            {/* Phase indicator */}
            <div className={`px-2 py-1 rounded text-xs font-medium ${
              usePhase1API ? 'bg-green-600' : 'bg-blue-600'
            }`} title={usePhase1API ? 'Using database' : 'Using localStorage'}>
              {usePhase1API ? <Database size={12} /> : <WifiOff size={12} />}
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-800 rounded transition-colors"
              aria-label="Close sidebar"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
            aria-label="Search notes"
          />
        </div>
        
        {/* API Error */}
        {apiError && (
          <div className="mt-2 p-2 bg-red-900 text-red-200 rounded text-xs">
            {apiError}
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {/* Recent Notes Section */}
        {enableTreeView && recentNotesWithData.length > 0 && (
          <div className="p-2 border-b border-gray-800">
            <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-gray-400 uppercase">
              <Clock size={14} />
              <span>Recent</span>
            </div>
            <div className="mt-1">
              {recentNotesWithData.map(note => {
                const timeAgo = Date.now() - (note.lastAccessed || 0)
                const hours = Math.floor(timeAgo / (1000 * 60 * 60))
                const days = Math.floor(hours / 24)
                const timeStr = days > 0 ? `${days}d ago` : hours > 0 ? `${hours}h ago` : 'Just now'
                
                return (
                  <div
                    key={note.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, note.id)}
                    onDragEnd={handleDragEnd}
                    onClick={(e) => handleNoteSelect(note.id, e)}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      handleNoteSelect(note.id, e, true) // true = open note
                    }}
                    className={`group flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors ${
                      draggedItems.has(note.id) ? 'opacity-50' :
                      selectedNoteId === note.id ? 'bg-indigo-600 text-white' :
                      selectedItems.has(note.id) ? 'bg-indigo-500 bg-opacity-50' :
                      'hover:bg-gray-800'
                    }`}
                  >
                    <FileText size={14} />
                    <span className="flex-1 text-sm truncate">{note.title}</span>
                    <span className="text-xs text-gray-400">{timeStr}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteNote(note.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-600 rounded transition-all"
                      aria-label="Delete note"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Tree View - Simplified after removing Recent folder */}
        {enableTreeView && (usePhase1API ? apiTreeData.length > 0 : (selectedNoteId && treeData.length > 0)) && (
          <div className="p-2 border-b border-gray-800">
            <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-gray-400 uppercase">
              <Folder size={14} />
              <span>Organization</span>
            </div>
            {isLoadingAPI ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : (
              <div className="mt-1" role="tree" aria-label="Note organization">
                {(usePhase1API ? apiTreeData : treeData).map(node => {
                  // Auto-expand Knowledge Base since it's now the only root
                  if (usePhase1API && node.name === 'Knowledge Base' && expandedNodes[node.id] === undefined) {
                    expandedNodes[node.id] = true
                  }
                  return renderTreeNode(node)
                })}
              </div>
            )}
          </div>
        )}

        {/* All Notes List - Removed since tree view shows all notes */}
        {/* <div className="p-2">
          <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-gray-400 uppercase">
            <FileText size={14} />
            <span>All Notes</span>
          </div>
          {filteredNotes.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              {searchTerm ? 'No notes found' : 'No notes yet'}
            </div>
          ) : (
            <div className="mt-1">
              {filteredNotes.map(note => (
                <div
                  key={note.id}
                  onClick={() => handleNoteSelect(note.id)}
                  className={`group p-3 mb-2 rounded-lg cursor-pointer transition-all ${
                    selectedNoteId === note.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText size={16} />
                        <h3 className="font-medium truncate">{note.title}</h3>
                      </div>
                      <p className="text-xs text-gray-400">
                        Modified {note.lastModified.toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteNote(note.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-600 rounded transition-all"
                      aria-label="Delete note"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div> */}
      </div>

      {/* Multi-select Actions Bar */}
      {selectedItems.size > 0 && (
        <div className="p-3 bg-gray-800 border-t border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">
              {selectedItems.size} {selectedItems.size === 1 ? 'item' : 'items'} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // TODO: Implement move functionality
                  alert(`Move ${selectedItems.size} items - Coming soon!`)
                }}
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
              >
                Move
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete ${selectedItems.size} items?`)) {
                    selectedItems.forEach(id => deleteNote(id))
                    setSelectedItems(new Set())
                  }
                }}
                className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 rounded"
              >
                Delete
              </button>
              <button
                onClick={() => setSelectedItems(new Set())}
                className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Note Button */}
      <div className="p-4 border-t border-gray-800">
        <button
          onClick={() => {
            if (usePhase1API) {
              setShowCreateDialog(true) // Phase 2: Open dialog
            } else {
              createNewNote() // Phase 0: Direct creation
            }
          }}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors mb-4"
        >
          <Plus size={18} />
          <span>Create New Note</span>
        </button>
      </div>

      {/* Navigation Controls - Disabled for now */}
      {/* {selectedNoteId && (
        <div className="px-4 pb-4">
          <div className="mb-4">
            <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Navigation</div>
            <div className="space-y-2">
              <button
                onClick={onResetView}
                className="w-full flex items-center gap-3 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
              >
                <Home size={16} />
                <span>Reset View</span>
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onZoomIn}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
                >
                  <ZoomIn size={16} />
                  <span>Zoom In</span>
                </button>
                <button
                  onClick={onZoomOut}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
                >
                  <ZoomOut size={16} />
                  <span>Zoom Out</span>
                </button>
              </div>
              <div className="text-center py-2 px-3 bg-gray-800 rounded-lg text-sm font-medium text-gray-300">
                {Math.round(zoom)}%
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Connections</div>
            <button
              onClick={onToggleConnections}
              className={`w-full flex items-center justify-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                showConnections
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
              }`}
            >
              {showConnections ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              <span>Toggle Lines</span>
            </button>
          </div>
        </div>
      )} */}

      {/* Phase 2: Create Note Dialog */}
      {showCreateDialog && usePhase1API && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="bg-gray-800 rounded-lg p-6 w-96 max-w-[90vw]">
            <h2 className="text-xl font-semibold mb-4 text-white">Create New Note</h2>
            
            {/* Note Name Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Note Name
              </label>
              <input
                type="text"
                value={newNoteName}
                onChange={(e) => setNewNoteName(e.target.value)}
                placeholder="Enter note name..."
                className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
            </div>
            
            {/* Folder Selector - Phase 3 Enhanced */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Save to Folder
              </label>
              
              {!showCustomFolder ? (
                <>
                  <select
                    value={selectedFolderId || 'create-new'}
                    onChange={async (e) => {
                      const value = e.target.value
                      if (value === 'create-new') {
                        setIsCreatingFolder(true)
                        setShowCustomFolder(false)
                      } else if (value === 'type-custom') {
                        setShowCustomFolder(true)
                        setIsCreatingFolder(false)
                      } else {
                        setSelectedFolderId(value)
                        setIsCreatingFolder(false)
                        setShowCustomFolder(false)
                      }
                    }}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select a folder...</option>
                    <option value="create-new" className="font-semibold text-indigo-400">
                      + Create New Folder...
                    </option>
                    <option value="type-custom" className="font-semibold text-green-400">
                      ✏️ Type Custom Path...
                    </option>
                    <optgroup label="Existing Folders">
                      {availableFolders.map(folder => {
                        // Create visual hierarchy with indentation
                        const indent = '　'.repeat(folder.depth || 0)
                        const displayName = folder.path === '/knowledge-base' 
                          ? 'Knowledge Base' 
                          : folder.name
                        
                        return (
                          <option key={folder.id} value={folder.id}>
                            {indent}{(folder.depth || 0) > 0 ? '└─ ' : ''}{displayName}
                          </option>
                        )
                      })}
                    </optgroup>
                  </select>
                  
                  {/* New Folder Name Input */}
                  {isCreatingFolder && (
                    <div className="mt-3 space-y-2">
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="Enter folder name..."
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                      />
                      <select
                        value={selectedFolderId || ''}
                        onChange={(e) => setSelectedFolderId(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                      >
                        <option value="">Create under Knowledge Base (root)</option>
                        {availableFolders.map(folder => (
                          <option key={folder.id} value={folder.id}>
                            Create under: {folder.path.replace('/knowledge-base/', '') || 'Knowledge Base'}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={async () => {
                          if (newFolderName.trim()) {
                            const folder = await createNewFolder(newFolderName.trim(), selectedFolderId || undefined)
                            if (folder) {
                              setIsCreatingFolder(false)
                              setNewFolderName("")
                              // Re-fetch folders to update the list
                              await fetchAvailableFolders()
                            }
                          }
                        }}
                        className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium"
                      >
                        Create Folder
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* Type-to-Create Pattern */
                <div>
                  <input
                    type="text"
                    value={customFolderInput}
                    onChange={(e) => setCustomFolderInput(e.target.value)}
                    placeholder="e.g., Projects/Web/MyApp or just MyFolder"
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    autoFocus
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        setShowCustomFolder(false)
                        setCustomFolderInput("")
                      }}
                      className="text-xs text-gray-400 hover:text-gray-300"
                    >
                      ← Back to dropdown
                    </button>
                    {customFolderInput && !availableFolders.some(f => 
                      f.path.endsWith('/' + customFolderInput) || 
                      f.name === customFolderInput
                    ) && (
                      <span className="text-xs text-green-400">
                        Will create: {customFolderInput}
                      </span>
                    )}
                  </div>
                </div>
              )}
              
              {selectedFolderId && !isCreatingFolder && !showCustomFolder && (
                <p className="mt-2 text-xs text-gray-400">
                  Will be saved to: {availableFolders.find(f => f.id === selectedFolderId)?.path}
                </p>
              )}
            </div>
            
            {/* Dialog Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateDialog(false)
                  setNewNoteName("")
                  setSelectedFolderId(null)
                  setAvailableFolders([]) // Clear folders to prevent stale data
                  setIsCreatingFolder(false)
                  setNewFolderName("")
                  setShowCustomFolder(false)
                  setCustomFolderInput("")
                }}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createNewNote}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-medium"
              >
                Create Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Browse Panel - Sidebar (Non-Modal) */}
      {browseModalOpen && browseColumns.length > 0 && (
        <div 
          className="fixed top-0 h-screen bg-gray-900 border-l border-gray-800 z-30 flex"
          style={{ 
            left: '320px',
            width: `${columnWidths.reduce((sum, w) => sum + w, 0)}px`
          }}
        >
          {/* Header */}
          <div className="absolute top-0 right-0 p-4 z-10">
            <button
              onClick={closeBrowseModal}
              className="p-2 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
              title="Close"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          
          {/* Column View */}
          <div className="flex h-full overflow-x-auto relative">
            {browseColumns.map((column, columnIndex) => (
              <React.Fragment key={`${column.id}-${columnIndex}`}>
                <div 
                  className="flex-shrink-0 h-full flex flex-col relative bg-gray-900"
                  style={{ width: `${columnWidths[columnIndex] || 280}px` }}
                >
                {/* Column Header */}
                <div className="px-4 py-3 border-b border-gray-800" style={{ backgroundColor: '#1a1d23' }}>
                  <div className="flex items-center gap-2">
                    <Folder className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-medium text-white truncate">{column.name}</h3>
                  </div>
                </div>
                
                {/* Column Content */}
                <div className="flex-1 overflow-y-auto">
                  {column.children && column.children.length > 0 ? (
                    <div className="divide-y divide-gray-800">
                      {column.children.map((child) => (
                        <div
                          key={child.id}
                          className={`flex items-center gap-2 px-4 py-2 cursor-pointer transition-colors group ${
                            selectedBrowseItem === child.id 
                              ? 'bg-blue-600 bg-opacity-20 border-l-2 border-blue-400' 
                              : 'hover:bg-gray-800'
                          }`}
                          onClick={(e) => {
                            setSelectedBrowseItem(child.id)
                            if (child.type === 'note') {
                              if (e.detail === 2) { // Double click to open
                                onNoteSelect(child.id)
                                closeBrowseModal()
                              }
                            } else if (child.type === 'folder') {
                              // Single click on folder loads it in next column
                              handleBrowseSubfolder(child, columnIndex)
                            }
                          }}
                        >
                          {/* Icon */}
                          <div className="flex-shrink-0">
                            {child.type === 'folder' ? (
                              <Folder className="w-4 h-4 text-blue-400" />
                            ) : (
                              <FileText className="w-4 h-4 text-gray-400" />
                            )}
                          </div>
                          
                          {/* Name */}
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-200 truncate block">
                              {child.icon && <span className="mr-1">{child.icon}</span>}
                              {child.name || child.title || 'Untitled'}
                            </span>
                          </div>
                          
                          {/* Eye icon for folders to browse */}
                          {child.type === 'folder' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleBrowseSubfolder(child, columnIndex)
                              }}
                              onMouseEnter={(e) => {
                                e.stopPropagation()
                                handleFolderHover(child, e)
                              }}
                              onMouseLeave={(e) => {
                                e.stopPropagation()
                                handleFolderHoverLeave(child.id)
                              }}
                              className="p-1 hover:bg-gray-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Eye className="w-3.5 h-3.5 text-gray-400" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center text-gray-500">
                        <Folder className="w-12 h-12 mx-auto mb-2 text-gray-600" />
                        <p className="text-sm">Empty folder</p>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Column Footer */}
                <div className="px-4 py-2 border-t border-gray-800" style={{ backgroundColor: '#1a1d23' }}>
                  <div className="text-xs text-gray-500">
                    {column.children?.length || 0} items
                  </div>
                </div>
              </div>
              
              {/* Resize Handle */}
              {columnIndex < browseColumns.length - 1 && (
                <div
                  className={`relative w-1 flex-shrink-0 ${
                    resizingColumn === columnIndex ? 'z-50' : 'z-10'
                  }`}
                  style={{
                    background: resizingColumn === columnIndex ? '#3B82F6' : '#4B5563',
                    cursor: 'col-resize'
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setResizingColumn(columnIndex)
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#3B82F6'
                  }}
                  onMouseLeave={(e) => {
                    if (resizingColumn !== columnIndex) {
                      e.currentTarget.style.background = '#4B5563'
                    }
                  }}
                >
                  {/* Larger hit area for easier grabbing */}
                  <div className="absolute inset-y-0 -left-2 -right-2" style={{ cursor: 'col-resize' }} />
                </div>
              )}
            </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Render popups - use PopupOverlay for multi-layer mode or fallback to legacy */}
      {multiLayerEnabled && adaptedPopups ? (
        <PopupOverlay
          popups={adaptedPopups}
          draggingPopup={draggingPopup}
          onClosePopup={closePopover}
          onDragStart={handlePopupDragStart}
          onHoverFolder={handleFolderHover}
          onLeaveFolder={handleFolderHoverLeave}
        />
      ) : (
        // Legacy popup rendering
        Array.from(hoverPopovers.values()).map((popover) => (
        <div
          key={popover.id}
          id={`popup-${popover.id}`}
          className="fixed bg-gray-800 border border-gray-700 rounded-lg shadow-xl"
          style={{
            zIndex: popover.isDragging ? 10000 : 9999 + popover.level, // Highest z-index when dragging
            left: `${popover.position.x}px`,
            top: `${popover.position.y}px`,
            width: '300px',
            maxHeight: '80vh', // Use viewport height for better flexibility
            cursor: popover.isDragging ? 'grabbing' : 'default',
            transition: popover.isDragging ? 'none' : 'box-shadow 0.2s ease'
          }}
          onMouseEnter={() => {
            // Keep popover open when hovering over it
          }}
          onMouseLeave={() => {
            // Optional: could close this popover and its children
            // closePopover(popover.id)
          }}
        >
          {/* Popover Header - Draggable Area */}
          <div 
            className="px-3 py-2 border-b border-gray-700 flex items-center justify-between cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => handlePopupDragStart(popover.id, e)}
            style={{
              backgroundColor: popover.isDragging ? '#374151' : 'transparent'
            }}
          >
            <div className="flex items-center gap-2 pointer-events-none">
              <Folder className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-white truncate">
                {popover.folder?.name || 'Loading...'}
              </span>
            </div>
            <button
              onClick={() => closePopover(popover.id)}
              onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking X
              className="p-0.5 hover:bg-gray-700 rounded pointer-events-auto"
            >
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
          
          {/* Popover Content */}
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(80vh - 100px)' }}>
            {popover.isLoading ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                Loading...
              </div>
            ) : popover.folder?.children && popover.folder.children.length > 0 ? (
              <div className="py-1">
                {popover.folder.children.map((child) => (
                  <div
                    key={child.id}
                    className="group px-3 py-1.5 hover:bg-gray-700 flex items-center gap-2 cursor-default"
                  >
                    {child.type === 'folder' ? (
                      <Folder className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    )}
                    <span className="flex-1 text-sm text-gray-200 truncate">
                      {child.icon && <span className="mr-1">{child.icon}</span>}
                      {child.name || child.title || 'Untitled'}
                    </span>
                    
                    {/* Eye icon for folders within popups - cascading effect */}
                    {child.type === 'folder' && (
                      <button
                        onMouseEnter={(e) => {
                          e.stopPropagation()
                          handleFolderHover(child, e, popover.id)
                        }}
                        onMouseLeave={(e) => {
                          e.stopPropagation()
                          handleFolderHoverLeave(child.id, popover.id)
                        }}
                        className="p-0.5 hover:bg-gray-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Eye className="w-3 h-3 text-gray-400" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-gray-500 text-sm">
                Empty folder
              </div>
            )}
          </div>
          
          {/* Popover Footer */}
          <div className="px-3 py-1.5 border-t border-gray-700 text-xs text-gray-500">
            {popover.folder?.children?.length || 0} items
          </div>
        </div>
      ))
      )}
      
      {/* Connection Lines Between Related Popovers - Annotation Style Bezier Curves */}
      {!multiLayerEnabled && hoverPopovers.size > 0 && (
        <svg
          className="fixed pointer-events-none"
          style={{
            zIndex: 9998,
            left: 0,
            top: 0,
            width: '100vw',
            height: '100vh',
            position: 'fixed'
          }}
        >
          <defs>
            {/* Gradient for connection lines */}
            <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(99, 102, 241, 0.8)" />
              <stop offset="100%" stopColor="rgba(139, 92, 246, 0.6)" />
            </linearGradient>
            
            {/* Glow filter for hover/drag state */}
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
            
            {/* Arrow marker for connection direction */}
            <marker
              id="arrowEnd"
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="5"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 L 3 5 Z" fill="rgba(139, 92, 246, 0.8)" />
            </marker>
          </defs>
          
          {Array.from(hoverPopovers.values()).map((popover) => {
            if (!popover.parentId) return null
            const parent = hoverPopovers.get(popover.parentId)
            if (!parent) return null
            
            // Smart connection point calculation
            // Popup dimensions
            const popupWidth = 300
            
            // Calculate actual popup height based on content
            // Header: 45px, Footer: 30px, Each item: ~36px, Padding: 20px
            const calculatePopupHeight = (folder: TreeNode | null) => {
              if (!folder || !folder.children) return 150 // Min height for empty/loading
              const itemCount = folder.children.length
              const headerHeight = 45
              const footerHeight = 30
              const itemHeight = 36
              const padding = 20
              const contentHeight = Math.min(itemCount * itemHeight, 320) // Max content area
              return headerHeight + contentHeight + footerHeight + padding
            }
            
            const parentHeight = parent.height || calculatePopupHeight(parent.folder)
            const childHeight = popover.height || calculatePopupHeight(popover.folder)
            const headerHeight = 45
            
            // Calculate actual popup boundaries
            const parentBounds = {
              left: parent.position.x,
              right: parent.position.x + popupWidth,
              top: parent.position.y,
              bottom: parent.position.y + parentHeight,
              centerX: parent.position.x + popupWidth / 2,
              centerY: parent.position.y + parentHeight / 2
            }
            
            const childBounds = {
              left: popover.position.x,
              right: popover.position.x + popupWidth,
              top: popover.position.y,
              bottom: popover.position.y + childHeight,
              centerX: popover.position.x + popupWidth / 2,
              centerY: popover.position.y + childHeight / 2
            }
            
            // Calculate relative position more accurately
            const deltaX = childBounds.centerX - parentBounds.centerX
            const deltaY = childBounds.centerY - parentBounds.centerY
            
            // Always connect from exact center of edges
            const horizontalSeparation = Math.abs(deltaX)
            const verticalSeparation = Math.abs(deltaY)
            
            // Determine which edges to connect based on relative positions
            let startX, startY, endX, endY
            
            if (horizontalSeparation > verticalSeparation) {
              // Primarily horizontal - connect left/right edges at their exact centers
              if (deltaX > 0) {
                // Child is to the right
                startX = parentBounds.right  // Right edge
                startY = parentBounds.centerY // Exact vertical center
                endX = childBounds.left       // Left edge
                endY = childBounds.centerY    // Exact vertical center
              } else {
                // Child is to the left
                startX = parentBounds.left    // Left edge
                startY = parentBounds.centerY // Exact vertical center
                endX = childBounds.right      // Right edge
                endY = childBounds.centerY    // Exact vertical center
              }
            } else {
              // Primarily vertical - connect top/bottom edges at their exact centers
              if (deltaY > 0) {
                // Child is below
                startX = parentBounds.centerX // Exact horizontal center
                startY = parentBounds.bottom  // Bottom edge
                endX = childBounds.centerX    // Exact horizontal center
                endY = childBounds.top        // Top edge (not offset by header)
              } else {
                // Child is above
                startX = parentBounds.centerX // Exact horizontal center
                startY = parentBounds.top     // Top edge
                endX = childBounds.centerX    // Exact horizontal center
                endY = childBounds.bottom     // Bottom edge
              }
            }
            
            // Calculate smart control points for smooth bezier curves
            const distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2))
            const controlOffset = Math.min(distance * 0.5, 100)
            
            let control1X, control1Y, control2X, control2Y
            
            // Determine control points based on the connection type
            if (horizontalSeparation > verticalSeparation * 1.5) {
              // Horizontal connection - use horizontal control points
              const direction = deltaX > 0 ? 1 : -1
              control1X = startX + controlOffset * direction
              control1Y = startY
              control2X = endX - controlOffset * direction
              control2Y = endY
            } else if (verticalSeparation > horizontalSeparation * 1.5) {
              // Vertical connection - use vertical control points
              const direction = deltaY > 0 ? 1 : -1
              control1X = startX
              control1Y = startY + controlOffset * direction
              control2X = endX
              control2Y = endY - controlOffset * direction
            } else {
              // Diagonal connection - use mixed control points for smooth curve
              const xDirection = deltaX > 0 ? 1 : -1
              const yDirection = deltaY > 0 ? 1 : -1
              control1X = startX + (controlOffset * 0.7) * xDirection
              control1Y = startY + (controlOffset * 0.3) * yDirection
              control2X = endX - (controlOffset * 0.7) * xDirection
              control2Y = endY - (controlOffset * 0.3) * yDirection
            }
            
            // Create the bezier path
            const pathData = `M ${startX} ${startY} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${endX} ${endY}`
            
            // Styling based on drag state
            const isDragging = popover.isDragging || parent.isDragging
            const strokeWidth = isDragging ? 3 : 2
            const opacity = isDragging ? 1 : 0.7
            
            return (
              <g key={`connection-${popover.id}`}>
                {/* Shadow/glow path for depth */}
                <path
                  d={pathData}
                  stroke="rgba(0, 0, 0, 0.2)"
                  strokeWidth={strokeWidth + 2}
                  fill="none"
                  strokeLinecap="round"
                  transform="translate(2, 2)"
                />
                
                {/* Main connection path */}
                <path
                  d={pathData}
                  stroke="url(#connectionGradient)"
                  strokeWidth={strokeWidth}
                  fill="none"
                  opacity={opacity}
                  strokeLinecap="round"
                  filter={isDragging ? "url(#glow)" : ""}
                  markerEnd="url(#arrowEnd)"
                  style={{
                    transition: 'all 0.2s ease'
                  }}
                />
                
                {/* Connection point indicators - positioned at edge centers */}
                {/* Start point dot */}
                <g>
                  {/* Outer ring */}
                  <circle
                    cx={startX}
                    cy={startY}
                    r="6"
                    fill="rgba(99, 102, 241, 0.1)"
                    stroke="rgba(99, 102, 241, 0.6)"
                    strokeWidth="1.5"
                  />
                  {/* Inner dot */}
                  <circle
                    cx={startX}
                    cy={startY}
                    r="3"
                    fill="rgba(99, 102, 241, 0.9)"
                  />
                </g>
                
                {/* End point dot */}
                <g>
                  {/* Outer ring */}
                  <circle
                    cx={endX}
                    cy={endY}
                    r="6"
                    fill="rgba(139, 92, 246, 0.1)"
                    stroke="rgba(139, 92, 246, 0.6)"
                    strokeWidth="1.5"
                  />
                  {/* Inner dot */}
                  <circle
                    cx={endX}
                    cy={endY}
                    r="3"
                    fill="rgba(139, 92, 246, 0.9)"
                  />
                </g>
              </g>
            )
          })}
        </svg>
      )}
      
      {/* Click outside to close all popovers */}
      {hoverPopovers.size > 0 && (
        canvasContainer
          ? createPortal(
              <div
                className="absolute inset-0"
                style={{ zIndex: 9997 }}
                onClick={(e) => { if (!draggingPopup) closeAllPopovers() }}
                onMouseDown={(e) => { if (draggingPopup) e.preventDefault() }}
              />,
              canvasContainer
            )
          : (
              <div
                className="fixed"
                style={{ top: 0, left: 320, right: 0, bottom: 0, zIndex: 9997 }}
                onClick={(e) => { if (!draggingPopup) closeAllPopovers() }}
                onMouseDown={(e) => { if (draggingPopup) e.preventDefault() }}
              />
            )
      )}
      
      {/* Layer Controls UI (Phase 2) */}
      {multiLayerEnabled && (
        <>
          <LayerControls position="bottom-right" />
          <style>{layerControlsStyles}</style>
        </>
      )}
    </div>
  )
}

// Main export component that wraps with LayerProvider if needed
export function NotesExplorerPhase1(props: NotesExplorerProps) {
  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any)
  
  // LayerProvider is provided at the app level (annotation-app.tsx)
  return <NotesExplorerContent {...props} multiLayerEnabled={multiLayerEnabled} />
}
