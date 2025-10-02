"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Eye } from "lucide-react"

type PanelKey = "recents" | "org" | "tools" | "layer" | "format" | "resize" | "branches" | "actions" | null

type FloatingToolbarProps = {
  x: number
  y: number
  onClose: () => void
  onSelectNote?: (noteId: string) => void
  onCreateNote?: () => void
}

interface RecentNote {
  id: string
  title: string
  metaLeft: string
  metaRight: string
}

interface OrgItem {
  id: string
  name: string
  type: "folder" | "note"
  icon?: string
  color?: string
  hasChildren?: boolean
  level: number
  children?: OrgItem[]
  parentId?: string
}

interface FolderPopup {
  id: string
  folderId: string
  folderName: string
  position: { x: number; y: number }
  children: OrgItem[]
  isLoading: boolean
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

const FORMAT_ACTIONS = [
  { label: "B", tooltip: "Bold", className: "font-bold" },
  { label: "I", tooltip: "Italic", className: "italic" },
  { label: "U", tooltip: "Underline", className: "underline" },
  { label: "S", tooltip: "Strikethrough" },
  { label: "{ }", tooltip: "Code" },
  { label: "H1", tooltip: "Heading 1" },
  { label: "H2", tooltip: "Heading 2" },
  { label: "H3", tooltip: "Heading 3" },
  { label: "• •", tooltip: "Bullet List" },
  { label: "1 2", tooltip: "Ordered List" },
  { label: '" "', tooltip: "Blockquote" },
  { label: "</", tooltip: "Code Block" },
  { label: "—", tooltip: "Horizontal Rule" },
  { label: "★", tooltip: "Highlight" },
  { label: "✕", tooltip: "Clear Format", className: "text-red-400" },
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
  { label: "📝 Note", desc: "Create note branch" },
  { label: "🔍 Explore", desc: "Create explore branch" },
  { label: "⭐ Promote", desc: "Create promote branch" },
]

export function FloatingToolbar({ x, y, onClose, onSelectNote, onCreateNote }: FloatingToolbarProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [activePanel, setActivePanel] = useState<PanelKey>(null)
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>([])
  const [isLoadingRecent, setIsLoadingRecent] = useState(false)
  const [orgItems, setOrgItems] = useState<OrgItem[]>([])
  const [isLoadingOrg, setIsLoadingOrg] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [folderPopups, setFolderPopups] = useState<FolderPopup[]>([])
  const popupIdCounter = useRef(0)
  const hoverTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

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
  useEffect(() => {
    const fetchRecentNotes = async () => {
      setIsLoadingRecent(true)
      try {
        const response = await fetch('/api/items/recent?limit=5')
        if (!response.ok) throw new Error('Failed to fetch recent notes')

        const data = await response.json()
        const items = data.items || []

        // Transform API data to match our UI format
        const formattedNotes: RecentNote[] = items.map((item: any) => {
          const lastAccessed = new Date(item.lastAccessedAt || '')
          const timeAgo = Date.now() - lastAccessed.getTime()
          const hours = Math.floor(timeAgo / (1000 * 60 * 60))
          const days = Math.floor(hours / 24)

          let timeText = ''
          if (days > 0) {
            timeText = `${days}d ago`
          } else if (hours > 0) {
            timeText = `${hours}h ago`
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

    fetchRecentNotes()
  }, [])

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

        // Auto-expand "Knowledge Base" folder
        const knowledgeBase = formattedItems.find(item =>
          item.name.toLowerCase() === 'knowledge base' && item.type === 'folder'
        )
        if (knowledgeBase) {
          setExpandedFolders({ [knowledgeBase.id]: true })

          // Fetch children for Knowledge Base
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

  // Toggle folder expansion and load children if needed
  const toggleFolder = async (folderId: string) => {
    const isExpanding = !expandedFolders[folderId]

    // If expanding and children not loaded yet, fetch them
    if (isExpanding) {
      const folder = findItemById(folderId, orgItems)
      if (folder && folder.type === 'folder' && (!folder.children || folder.children.length === 0)) {
        try {
          const response = await fetch(`/api/items?parentId=${folderId}`)
          if (!response.ok) throw new Error('Failed to fetch folder children')

          const data = await response.json()
          const children = data.items || []

          // Transform children
          const formattedChildren: OrgItem[] = children.map((item: any) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            icon: item.icon || (item.type === 'folder' ? '📁' : '📄'),
            color: item.color,
            hasChildren: item.type === 'folder',
            level: folder.level + 1,
            children: [],
            parentId: item.parentId
          }))

          // Update the tree with children
          const updateTree = (items: OrgItem[]): OrgItem[] => {
            return items.map(item => {
              if (item.id === folderId) {
                return { ...item, children: formattedChildren }
              }
              if (item.children && item.children.length > 0) {
                return { ...item, children: updateTree(item.children) }
              }
              return item
            })
          }

          setOrgItems(updateTree(orgItems))
        } catch (error) {
          console.error('Error fetching folder children:', error)
        }
      }
    }

    // Toggle expansion state
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: isExpanding
    }))
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

  // Flatten tree for rendering
  const flattenTree = (items: OrgItem[]): OrgItem[] => {
    const result: OrgItem[] = []
    const traverse = (nodes: OrgItem[]) => {
      for (const node of nodes) {
        result.push(node)
        if (expandedFolders[node.id] && node.children && node.children.length > 0) {
          traverse(node.children)
        }
      }
    }
    traverse(items)
    return result
  }

  // Handle folder eye icon hover to show popup
  const handleEyeHover = async (folder: OrgItem, event: React.MouseEvent) => {
    event.stopPropagation()
    console.log('[handleEyeHover] Called for folder:', folder.name, folder.id)

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
      isLoading: true
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
        color: item.color,
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
    // Close popup for this folder after a short delay
    const timeout = setTimeout(() => {
      setFolderPopups(prev => prev.filter(p => p.folderId !== folderId))
    }, 300) // 300ms delay before closing

    hoverTimeoutRef.current.set(folderId, timeout)
  }

  // Cancel close timeout when hovering over popup
  const handlePopupHover = (folderId: string) => {
    const timeout = hoverTimeoutRef.current.get(folderId)
    if (timeout) {
      clearTimeout(timeout)
      hoverTimeoutRef.current.delete(folderId)
    }
  }

  // Close all folder popups
  const closeAllPopups = () => {
    setFolderPopups([])
  }

  useEffect(() => {
    const handleClickAway = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onClose()
      }
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
    <div className="w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl" style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}>
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
          recentNotes.map((item) => (
            <button
              key={item.id}
              className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-left text-white/90 transition hover:bg-blue-500/20 hover:border-blue-400/40"
              onClick={() => {
                onSelectNote?.(item.id)
                onClose() // Close after selection - standard UX pattern
              }}
            >
              <div className="text-sm font-medium">{item.title}</div>
              <div className="mt-1 flex justify-between text-xs text-white/60">
                <span>{item.metaLeft}</span>
                <span>{item.metaRight}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )

  const renderOrg = () => {
    const flatItems = flattenTree(orgItems)

    return (
      <div className="w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl" style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
          <span>Organization</span>
          <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">
            ×
          </button>
        </div>
        <div className="max-h-64 overflow-x-auto overflow-y-auto p-3 space-y-1">
          {isLoadingOrg ? (
            <div className="text-center py-4 text-white/60 text-sm">Loading...</div>
          ) : flatItems.length === 0 ? (
            <div className="text-center py-4 text-white/60 text-sm">No items</div>
          ) : (
            flatItems.map((item) => {
              const isExpanded = expandedFolders[item.id]
              const isFolder = item.type === 'folder'
              const hasChildren = item.hasChildren

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-1"
                  style={{ paddingLeft: `${item.level * 16}px` }}
                >
                  {/* Chevron for folders */}
                  {isFolder && hasChildren ? (
                    <button
                      className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-white/60 hover:text-white transition"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFolder(item.id)
                      }}
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>
                  ) : (
                    <div className="w-5 h-5 flex-shrink-0" />
                  )}

                  {/* Item button */}
                  <button
                    className="group flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-left text-white/90 transition hover:bg-blue-500/20 hover:border-blue-400/40"
                    onClick={() => {
                      if (isFolder) {
                        toggleFolder(item.id)
                      } else {
                        onSelectNote?.(item.id)
                        onClose()
                      }
                    }}
                  >
                    <div className="text-sm font-medium flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span>{item.icon}</span>
                        <span>{item.name}</span>
                      </div>
                      {/* Eye icon for folders - appears on hover */}
                      {isFolder && (
                        <div
                          onMouseEnter={(e) => handleEyeHover(item, e)}
                          onMouseLeave={() => handleEyeHoverLeave(item.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 rounded p-0.5 cursor-pointer"
                          title="View folder contents"
                        >
                          <Eye className="w-3.5 h-3.5 text-white/40" />
                        </div>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                      {item.type === 'folder' ? 'Folder' : 'Note'}
                    </div>
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  const renderToolCategories = () => (
    <div className="flex items-center gap-2 rounded-2xl border border-white/20 bg-gray-900 px-4 py-3 shadow-xl" style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}>
      {TOOL_CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white/80 transition hover:bg-blue-500/20 hover:border-blue-400/40"
          onClick={() => setActivePanel(cat.id)}
        >
          {cat.label}
        </button>
      ))}
    </div>
  )

  const renderLayerPanel = () => (
    <div className="w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl" style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}>
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
    <div className="w-80 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl" style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
        <span>Format</span>
        <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">×</button>
      </div>
      <div className="p-3 grid grid-cols-5 gap-2">
        {FORMAT_ACTIONS.map((item) => (
          <button key={item.label} className={`rounded-xl bg-white/10 px-3 py-2 text-sm text-white/80 transition hover:bg-blue-500/30 ${item.className ?? ""}`} title={item.tooltip} onClick={onClose}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )

  const renderResizePanel = () => (
    <div className="w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl" style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}>
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

  const renderBranchesPanel = () => (
    <div className="w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl" style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
        <span>Branches</span>
        <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">×</button>
      </div>
      <div className="p-3 space-y-2">
        {BRANCH_ACTIONS.map((item) => (
          <button key={item.label} className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-left text-white/90 transition hover:bg-blue-500/20 hover:border-blue-400/40" onClick={onClose}>
            <div className="text-sm font-medium">{item.label}</div>
            <div className="mt-1 text-xs text-white/60">{item.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )

  const renderActionsPanel = () => (
    <div className="w-72 rounded-2xl border border-white/20 bg-gray-900 shadow-2xl" style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
        <span>Actions</span>
        <button className="text-white/60 hover:text-white" onClick={() => setActivePanel(null)} aria-label="Close panel">×</button>
      </div>
      <div className="p-3 space-y-2">
        {ACTION_ITEMS.map((item) => (
          <button key={item.label} className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-left text-white/90 transition hover:bg-blue-500/20 hover:border-blue-400/40" onClick={onClose}>
            <div className="text-sm font-medium">{item.label}</div>
            <div className="mt-1 text-xs text-white/60">{item.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div
      ref={containerRef}
      className="absolute z-[9999] flex flex-col items-center gap-2"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-3 rounded-full border border-white/20 bg-gray-900 px-4 py-3 shadow-2xl" style={{ backgroundColor: 'rgba(17, 24, 39, 0.98)' }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white/60 select-none">
          ⋮
        </div>
        <button
          className="rounded-full bg-gradient-to-r from-blue-400 to-blue-500 px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg hover:from-blue-300 hover:to-blue-400"
          onClick={() => {
            onCreateNote?.()
            onClose()
          }}
        >
          + Note
        </button>
        <div className="flex items-center gap-2">
          <button
            className={`rounded-full border border-white/10 px-3 py-2 text-sm text-white/80 transition hover:bg-white/15 ${activePanel === "recents" ? "bg-white/15" : ""}`}
            onClick={() => setActivePanel((prev) => (prev === "recents" ? null : "recents"))}
          >
            Recents ▾
          </button>
          <button
            className={`rounded-full border border-white/10 px-3 py-2 text-sm text-white/80 transition hover:bg-white/15 ${activePanel === "org" ? "bg-white/15" : ""}`}
            onClick={() => setActivePanel((prev) => (prev === "org" ? null : "org"))}
          >
            Org ▾
          </button>
          <button
            className={`rounded-full border border-white/10 px-3 py-2 text-sm text-white/80 transition hover:bg-white/15 ${activePanel === "tools" ? "bg-white/15" : ""}`}
            onClick={() => setActivePanel((prev) => (prev === "tools" ? null : "tools"))}
          >
            Tools ▾
          </button>
        </div>
      </div>
      {activePanel === "recents" && renderRecentNotes()}
      {activePanel === "org" && renderOrg()}
      {activePanel === "tools" && renderToolCategories()}
      {activePanel === "layer" && renderLayerPanel()}
      {activePanel === "format" && renderFormatPanel()}
      {activePanel === "resize" && renderResizePanel()}
      {activePanel === "branches" && renderBranchesPanel()}
      {activePanel === "actions" && renderActionsPanel()}
      <div className="rounded-full bg-blue-500/20 px-3 py-1 text-xs text-blue-200 shadow-lg">Last: Design Sync</div>

      {/* Folder popups - rendered outside the main toolbar */}
      {console.log('[FloatingToolbar] Rendering popups, count:', folderPopups.length, folderPopups)}
      {folderPopups.map((popup) => (
        <div
          key={popup.id}
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
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-sm text-white/80">
            <span>{popup.folderName}</span>
            <button
              className="text-white/60 hover:text-white"
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
                <button
                  key={child.id}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-left text-white/90 transition hover:bg-blue-500/20 hover:border-blue-400/40"
                  onClick={() => {
                    if (child.type === 'note') {
                      onSelectNote?.(child.id)
                      onClose()
                      closeAllPopups()
                    }
                  }}
                >
                  <div className="text-sm font-medium flex items-center gap-2">
                    <span>{child.icon}</span>
                    <span>{child.name}</span>
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    {child.type === 'folder' ? 'Folder' : 'Note'}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
