"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { 
  Trash2, Plus, FileText, Search, X, Home, ZoomIn, ZoomOut, 
  ToggleLeft, ToggleRight, ChevronRight, ChevronDown, Clock,
  FolderOpen, Folder, Database, WifiOff
} from "lucide-react"

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
  // Navigation controls props
  zoom?: number
  onZoomIn?: () => void
  onZoomOut?: () => void
  onResetView?: () => void
  onToggleConnections?: () => void
  showConnections?: boolean
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

export function NotesExplorerPhase1({ 
  onNoteSelect, 
  isOpen, 
  onClose,
  zoom = 100,
  onZoomIn,
  onZoomOut,
  onResetView,
  onToggleConnections,
  showConnections = true,
  enableTreeView = true,
  usePhase1API = false // Default to Phase 0 behavior
}: NotesExplorerProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  
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

  const handleNoteSelect = (noteId: string) => {
    setSelectedNoteId(noteId)
    trackNoteAccess(noteId)
    onNoteSelect(noteId)
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

  // Render tree node recursively
  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const isExpanded = expandedNodes[node.id]
    // Check both: actual children OR the hasChildren flag (for unloaded folders)
    const hasChildren = (node.children && node.children.length > 0) || node.hasChildren === true
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
          className="flex items-center gap-1 py-1 px-2 hover:bg-gray-700 rounded cursor-pointer"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            if (hasChildren) toggleTreeNode(node.id)
            if (node.type === 'note') handleNoteSelect(node.id)
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
                    onClick={() => handleNoteSelect(note.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors ${
                      selectedNoteId === note.id
                        ? 'bg-indigo-600 text-white'
                        : 'hover:bg-gray-800'
                    }`}
                  >
                    <FileText size={14} />
                    <span className="flex-1 text-sm truncate">{note.title}</span>
                    <span className="text-xs text-gray-400">{timeStr}</span>
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

        {/* All Notes List */}
        <div className="p-2">
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
        </div>
      </div>

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

      {/* Navigation Controls */}
      {selectedNoteId && (
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
      )}

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
    </div>
  )
}