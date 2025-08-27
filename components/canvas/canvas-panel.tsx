"use client"

import { useRef, useState, useEffect, useReducer } from "react"
import { useCanvas } from "./canvas-context"
import type { Branch } from "@/types/canvas"
import TiptapEditor, { TiptapEditorHandle } from "./tiptap-editor"
import { EditorToolbar } from "./editor-toolbar"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { getEditorYDoc } from "@/lib/yjs-provider"
import { EnhancedCollaborationProvider } from "@/lib/enhanced-yjs-provider"

interface CanvasPanelProps {
  panelId: string
  branch: Branch
  position: { x: number; y: number }
  onClose?: () => void
  noteId?: string
}

export function CanvasPanel({ panelId, branch, position, onClose, noteId }: CanvasPanelProps) {
  const { dispatch, state, dataStore, noteId: contextNoteId } = useCanvas()
  const editorRef = useRef<TiptapEditorHandle>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [isEditing, setIsEditing] = useState(branch.isEditable ?? true)
  const [zIndex, setZIndex] = useState(1)
  const [activeFilter, setActiveFilter] = useState<'all' | 'note' | 'explore' | 'promote'>('all')
  const [lastBranchUpdate, setLastBranchUpdate] = useState(Date.now())
  const forceUpdate = useReducer(() => ({}), {})[1]
  const [isContentLoading, setIsContentLoading] = useState(true)
  
  // Use noteId from props or context
  const currentNoteId = noteId || contextNoteId
  
  // Use ref to maintain dragging state across renders
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0
  })

  // Get collaboration provider and YJS document for this editor
  const provider = UnifiedProvider.getInstance()
  // Use enhanced provider to get subdoc with PostgreSQL persistence
  const enhancedProvider = EnhancedCollaborationProvider.getInstance()
  // Note: getEditorSubdoc is async, so we'll use the synchronous method
  // Fixed: Using getEditorYDoc which now has PostgreSQL persistence built-in
  // Pass noteId to ensure proper isolation between notes
  const ydoc = getEditorYDoc(panelId, currentNoteId)
  
  // Set the current note context if provided
  useEffect(() => {
    if (currentNoteId) {
      provider.setCurrentNote(currentNoteId)
    }
  }, [currentNoteId])
  
  // Wait for Y.Doc content to load
  useEffect(() => {
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
  }, [currentNoteId, panelId])
  
  // Ensure panel position is set on mount
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.style.left = position.x + 'px'
      panelRef.current.style.top = position.y + 'px'
    }
  }, [])
  
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
    
    const handleMouseDown = (e: MouseEvent) => {
      // Don't start drag if clicking on close button
      if ((e.target as HTMLElement).closest('.panel-close')) {
        return
      }
      
      dragState.current.isDragging = true
      
      // Get current panel position from style
      const currentLeft = parseInt(panel.style.left || position.x.toString(), 10)
      const currentTop = parseInt(panel.style.top || position.y.toString(), 10)
      
      // Calculate offset from mouse to panel position
      dragState.current.startX = e.clientX
      dragState.current.startY = e.clientY
      dragState.current.offsetX = e.clientX - currentLeft
      dragState.current.offsetY = e.clientY - currentTop

      // Bring panel to front
      setZIndex(Date.now())
      
      // Prevent text selection while dragging
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'move'
      panel.style.cursor = 'move'
      
      e.preventDefault()
      e.stopPropagation()
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.current.isDragging) return
      
      // Calculate new position based on mouse movement
      const x = e.clientX - dragState.current.offsetX
      const y = e.clientY - dragState.current.offsetY
      
      // Update panel position
      panel.style.left = x + 'px'
      panel.style.top = y + 'px'
      
      e.preventDefault()
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragState.current.isDragging) return
      
      dragState.current.isDragging = false
      
      // Get final position
      const finalX = parseInt(panel.style.left || '0', 10)
      const finalY = parseInt(panel.style.top || '0', 10)
      
      // Update position in both stores
      dataStore.update(panelId, { position: { x: finalX, y: finalY } })
      const branchData = branchesMap.get(panelId)
      if (branchData) {
        branchData.position = { x: finalX, y: finalY }
        branchesMap.set(panelId, branchData)
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
      
      // Reset any lingering styles
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, []) // Remove dependencies to prevent recreating handlers

  const isMainPanel = panelId === 'main'
  const showToolbar = isMainPanel || isEditing

  // Filter branches based on active filter using YJS native types
  const allBranches = provider.getBranches(panelId) // Get branches using YJS native types
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
    const updateHandler = (event: any) => {
      // Check if this panel's branches were updated
      if (event && event.keysChanged && event.keysChanged.has(panelId)) {
        setLastBranchUpdate(Date.now())
      }
      
      forceUpdate({})
    }
    
    // Listen for changes to the YJS native structure
    const branchesArrayUpdateHandler = () => {
      setLastBranchUpdate(Date.now())
      forceUpdate({})
    }
    
    // Listen for any changes to the branches map (legacy)
    branchesMap.observe(updateHandler)
    
    // Listen for changes to the YJS native branches array
    try {
      const structure = provider.getDocumentStructure()
      const branchesArray = structure.getBranchesArray(panelId)
      branchesArray.observe(branchesArrayUpdateHandler)
      
      return () => {
        branchesMap.unobserve(updateHandler)
        branchesArray.unobserve(branchesArrayUpdateHandler)
      }
    } catch {
      // Fallback to legacy observation only
      return () => {
        branchesMap.unobserve(updateHandler)
      }
    }
  }, [panelId, forceUpdate, branchesMap, provider])

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
      style={{
        position: 'absolute',
        left: position.x + 'px',
        top: position.y + 'px',
        width: '800px',
        minHeight: '600px',
        background: 'white',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: zIndex,
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
        }}
      >
        <span>{currentBranch.title}</span>
        {!isMainPanel && (
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
          >
            ×
          </button>
        )}
      </div>

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
                  onToggleEditing={isMainPanel ? handleToggleEditing : undefined}
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
              ) : (
                <TiptapEditor
                  ref={editorRef}
                  content={ydoc ? '' : currentBranch.content}
                  isEditable={isEditing}
                  panelId={panelId}
                  onUpdate={handleUpdate}
                  onSelectionChange={handleSelectionChange}
                  placeholder={isEditing ? "Start typing..." : ""}
                  ydoc={ydoc}
                  provider={provider.getProvider()}
                />
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