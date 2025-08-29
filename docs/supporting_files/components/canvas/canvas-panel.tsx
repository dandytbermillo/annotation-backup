"use client"

import { useRef, useState, useEffect, useReducer } from "react"
import { useCanvas } from "./canvas-context"
import type { Branch } from "@/types/canvas"
import TiptapEditor, { TiptapEditorHandle } from "./tiptap-editor"
import { EditorToolbar } from "./editor-toolbar"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { getEditorYDoc } from "@/lib/yjs-provider"

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
  const currentNoteId = noteId || contextNoteId

  const dragState = useRef({ isDragging: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 })
  const provider = UnifiedProvider.getInstance()
  const ydoc = getEditorYDoc(panelId)

  useEffect(() => { if (currentNoteId) provider.setCurrentNote(currentNoteId) }, [currentNoteId])
  useEffect(() => { if (panelRef.current) { panelRef.current.style.left = position.x + 'px'; panelRef.current.style.top = position.y + 'px' } }, [])

  const branchesMap = provider.getBranchesMap()
  const getBranchData = () => {
    const providerData = branchesMap.get(panelId)
    const storeData = dataStore.get(panelId)
    if (providerData) {
      const plainData = JSON.parse(JSON.stringify(providerData))
      if (storeData && storeData.branches) {
        const mergedBranches = [...new Set([...(plainData.branches || []), ...(storeData.branches || [])])]
        plainData.branches = mergedBranches
      }
      if (!plainData.branches) plainData.branches = []
      return plainData
    }
    const data = storeData || branch
    if (!data.branches) data.branches = []
    return data
  }
  const currentBranch = getBranchData()

  const handleUpdate = (html: string) => {
    const updatedData = { ...currentBranch, content: html }
    dataStore.update(panelId, updatedData)
    const branchData = branchesMap.get(panelId)
    if (branchData) { branchData.content = html; branchesMap.set(panelId, branchData) } else { branchesMap.set(panelId, updatedData) }
    const autoSave = document.getElementById(`auto-save-${panelId}`)
    if (autoSave) { autoSave.style.opacity = '1'; setTimeout(() => { autoSave.style.opacity = '0' }, 2000) }
    dispatch({ type: "BRANCH_UPDATED" })
  }

  const handleSelectionChange = (text: string, range: Range | null) => {
    dispatch({ type: "SET_SELECTION", payload: { text, range, panel: text.length > 0 ? panelId : null } })
    const toolbar = document.getElementById("annotation-toolbar")
    if (toolbar && text.length > 0) {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect()
        toolbar.style.left = rect.left + rect.width / 2 + "px"
        toolbar.style.top = rect.top - 80 + "px"
        toolbar.classList.add("visible")
      }
    } else if (toolbar) toolbar.classList.remove("visible")
  }

  const handleToggleEditing = () => {
    const newEditableState = !isEditing
    setIsEditing(newEditableState)
    editorRef.current?.setEditable(newEditableState)
    const toggleBtn = document.querySelector(`#toolbar-${panelId} .toolbar-btn.special`) as HTMLButtonElement
    if (toggleBtn) { toggleBtn.innerHTML = newEditableState ? '💾 Save' : '📝 Edit'; toggleBtn.title = newEditableState ? 'Save Changes' : 'Edit Content' }
    dataStore.update(panelId, { isEditable: newEditableState })
    if (newEditableState) editorRef.current?.focus()
  }

  useEffect(() => {
    const handleInsertAnnotation = (event: Event) => {
      const customEvent = event as CustomEvent
      const { type, annotationId, branchId } = customEvent.detail
      if (editorRef.current) editorRef.current.insertAnnotation(type, annotationId, branchId)
      else console.warn('Editor ref not available for annotation insertion')
    }
    const handleGlobalInsertAnnotation = (event: Event) => {
      const customEvent = event as CustomEvent
      if (customEvent.detail.panelId === panelId) handleInsertAnnotation(event)
    }
    const panel = panelRef.current
    if (panel) panel.addEventListener('insert-annotation', handleInsertAnnotation)
    window.addEventListener('insert-annotation-global', handleGlobalInsertAnnotation)
    return () => {
      if (panel) panel.removeEventListener('insert-annotation', handleInsertAnnotation)
      window.removeEventListener('insert-annotation-global', handleGlobalInsertAnnotation)
    }
  }, [panelId])

  const generateBreadcrumb = () => {
    const breadcrumbs = []
    let currentId = panelId
    while (currentId && dataStore.has(currentId)) {
      const currentBranch = dataStore.get(currentId)
      breadcrumbs.unshift({ id: currentId, title: currentBranch.title })
      currentId = currentBranch.parentId
    }
    if (breadcrumbs.length <= 1) return null
    return breadcrumbs.map((crumb, index) => (
      <span key={crumb.id}>{index === breadcrumbs.length - 1 ? (<span>{crumb.title}</span>) : (<span className="cursor-pointer text-indigo-600 hover:underline">{crumb.title}</span>)}{index < breadcrumbs.length - 1 && <span className="mx-1 text-gray-400">›</span>}</span>
    ))
  }

  useEffect(() => {
    const panel = panelRef.current; if (!panel) return
    const header = panel.querySelector('.panel-header') as HTMLElement; if (!header) return
    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.panel-close')) return
      dragState.current.isDragging = true
      const currentLeft = parseInt(panel.style.left || position.x.toString(), 10)
      const currentTop = parseInt(panel.style.top || position.y.toString(), 10)
      dragState.current.startX = e.clientX; dragState.current.startY = e.clientY
      dragState.current.offsetX = e.clientX - currentLeft
      dragState.current.offsetY = e.clientY - currentTop
      setZIndex(Date.now()); document.body.style.userSelect = 'none'; document.body.style.cursor = 'move'; panel.style.cursor = 'move'
      e.preventDefault(); e.stopPropagation()
    }
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.current.isDragging) return
      const x = e.clientX - dragState.current.offsetX
      const y = e.clientY - dragState.current.offsetY
      panel.style.left = x + 'px'; panel.style.top = y + 'px'
      e.preventDefault()
    }
    const handleMouseUp = (e: MouseEvent) => {
      if (!dragState.current.isDragging) return
      dragState.current.isDragging = false
      const finalX = parseInt(panel.style.left || '0', 10)
      const finalY = parseInt(panel.style.top || '0', 10)
      dataStore.update(panelId, { position: { x: finalX, y: finalY } })
      const branchData = branchesMap.get(panelId)
      if (branchData) { branchData.position = { x: finalX, y: finalY }; branchesMap.set(panelId, branchData) }
      document.body.style.userSelect = ''; document.body.style.cursor = ''
      e.preventDefault()
    }
    header.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      header.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [])

  const isMainPanel = panelId === 'main'
  const showToolbar = isMainPanel || isEditing
  const allBranches = provider.getBranches(panelId)
  const filteredBranches = allBranches.filter((branchId: string) => {
    if (activeFilter === 'all') return true
    const providerChild = branchesMap.get(branchId)
    const storeChild = dataStore.get(branchId)
    const childBranch = providerChild || storeChild
    if (!childBranch) return activeFilter === 'all'
    return childBranch.type === activeFilter
  })

  return (
    <div ref={panelRef} className={`panel ${currentBranch.type}`} id={`panel-${panelId}`}
      style={{ position: 'absolute', left: position.x + 'px', top: position.y + 'px', width: '800px', minHeight: '600px', background: 'white', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex }}>
      <div className="panel-header" style={{ background: currentBranch.type === 'main' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : currentBranch.type === 'note' ? 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)' : currentBranch.type === 'explore' ? 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)' : 'linear-gradient(135deg, #27ae60 0%, #229954 100%)', padding: '20px 25px', color: 'white', fontWeight: 600, fontSize: '16px', cursor: 'move', userSelect: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'auto' }}>
        <span>{currentBranch.title}</span>
        {!isMainPanel && (
          <button className="panel-close" onClick={onClose} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s ease', fontSize: '16px', color: 'white' }}>×</button>
        )}
      </div>
      <div style={{ display: 'flex', flex: 1 }}>
        <div style={{ flex: 2, padding: '20px 25px 25px 25px', borderRight: '1px solid #e9ecef', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          <div id={`auto-save-${panelId}`} style={{ position: 'absolute', top: '12px', right: '15px', padding: '4px 8px', background: '#28a745', color: 'white', borderRadius: '12px', fontSize: '10px', opacity: 0, transition: 'opacity 0.3s ease', zIndex: 2 }} className="auto-save">Saved</div>
          <div style={{ marginBottom: '20px', paddingBottom: '15px', borderBottom: '2px solid #f1f3f4' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#2c3e50', marginBottom: '8px' }} className="editor-title">{currentBranch.title}</div>
            {generateBreadcrumb() && (<div className="breadcrumb" style={{ display: 'flex', alignItems: 'center', fontSize: '12px', color: '#6c757d', gap: '5px' }}>{generateBreadcrumb()}</div>)}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div className="rich-editor-wrapper">
              {showToolbar && (<EditorToolbar panelId={panelId} editorRef={editorRef} isMainPanel={isMainPanel} onToggleEditing={isMainPanel ? handleToggleEditing : undefined} />)}
              <TiptapEditor ref={editorRef} content={currentBranch.content} isEditable={isEditing} panelId={panelId} onUpdate={handleUpdate} onSelectionChange={handleSelectionChange} placeholder={isEditing ? "Start typing..." : ""} ydoc={ydoc} provider={provider.getProvider()} />
            </div>
          </div>
        </div>
        <div style={{ flex: 1, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ color: 'white', fontSize: '16px', fontWeight: 600, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📌</span> Branches ({allBranches.length})
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', background: 'rgba(255,255,255,0.1)', padding: '4px', borderRadius: '8px' }}>
            {['all', 'note', 'explore', 'promote'].map(filter => (
              <button key={filter} onClick={() => setActiveFilter(filter as any)} style={{ flex: 1, padding: '6px 12px', border: 'none', borderRadius: '6px', background: activeFilter === filter ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)', color: 'white', fontSize: '12px', fontWeight: activeFilter === filter ? 600 : 500, cursor: 'pointer', transition: 'all 0.2s ease', textTransform: 'capitalize' }}>{filter}</button>
            ))}
          </div>
          <div style={{ flex: 1 }}>
            {filteredBranches.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontSize: '14px', marginTop: '20px' }}>No {activeFilter !== 'all' ? `${activeFilter} ` : ''}branches yet</div>
            ) : (
              filteredBranches.map((childId: string) => {
                const providerChild = branchesMap.get(childId)
                const storeChild = dataStore.get(childId)
                const childBranch = providerChild || storeChild
                if (!childBranch) return null
                return (
                  <div key={childId} className={`branch-item ${childBranch.type}`} onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('create-panel', { detail: { panelId: childId }, bubbles: true })) }} style={{ background: 'rgba(255,255,255,0.95)', borderRadius: '12px', padding: '16px', marginBottom: '12px', cursor: 'pointer', transition: 'all 0.3s ease', borderLeft: `4px solid ${childBranch.type === 'note' ? '#2196f3' : childBranch.type === 'explore' ? '#ff9800' : '#4caf50'}` }}>
                    {childBranch.title}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

