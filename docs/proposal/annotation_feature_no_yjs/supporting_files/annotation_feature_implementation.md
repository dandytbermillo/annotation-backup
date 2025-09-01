# Annotation Feature Implementation

Note on Modes (read first)

- Snippets below are taken from the collaborative Yjs
implementation to illustrate the intended UX.
- For Option A (offline, single‑user, no Yjs), use these as
behavioral references only — do not copy Yjs code.
- Implement Option A with @/lib/provider-switcher (UnifiedProvider)
or the plain provider (lib/providers/plain-offline-provider.ts) and
CanvasContext dataStore; avoid direct @/lib/yjs-provider imports.
- Persist editor content as ProseMirror JSON/HTML via the plain
Postgres offline adapter (no CRDT/binary state).
- Preserve the UX: selection → toolbar → mark annotation → auto‑add
branch entry → auto‑create panel with quoted reference → smooth
pan → draggable panel + autosave + breadcrumb → connections (color/
update on drag) → hover previews → filtering (all/note/explore/
promote).
- Minimap: optional in Option A; gate behind a flag or omit per
project guardrails.
- Non‑goals for Option A: no live collaboration/awareness; no Yjs
CRDT storage.

This document compiles the actual code used for the annotation workflow described in `docs/annotation_workflow.md`. All snippets are taken directly from the other project where annotation(note,promote and explore) is working.

## Selection → Toolbar Display

File: `hooks/use-text-selection.ts`

```ts
"use client"
import { useEffect, type RefObject } from "react"
import { useCanvas } from "@/components/canvas/canvas-context"
export function useTextSelection(contentRef: RefObject<HTMLDivElement>, panelId: string) {
  const { dispatch } = useCanvas()
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const handleMouseUp = (e: MouseEvent) => {
      const selection = window.getSelection()
      const selectedText = selection?.toString().trim() || ""
      if (selectedText.length > 0 && selection) {
        dispatch({ type: "SET_SELECTION", payload: { text: selectedText, range: selection.getRangeAt(0), panel: panelId } })
        const toolbar = document.getElementById("annotation-toolbar")
        if (toolbar) { toolbar.style.left = e.pageX + "px"; toolbar.style.top = e.pageY - 80 + "px"; toolbar.classList.add("visible") }
      } else {
        dispatch({ type: "SET_SELECTION", payload: { text: "", range: null, panel: null } })
        const toolbar = document.getElementById("annotation-toolbar"); if (toolbar) toolbar.classList.remove("visible")
      }
    }
    content.addEventListener("mouseup", handleMouseUp)
    return () => { content.removeEventListener("mouseup", handleMouseUp) }
  }, [panelId, dispatch, contentRef])
}
```

## Editor Integration (Mark + Click + Insert)

File: `components/canvas/tiptap-editor.tsx` (annotation mark excerpt)

```tsx
const Annotation = Mark.create({
  name: 'annotation',
  addAttributes() {
    return {
      id: { default: null, parseHTML: el => el.getAttribute('data-annotation-id'), renderHTML: a => a.id ? { 'data-annotation-id': a.id } : {} },
      type: { default: null, parseHTML: el => el.getAttribute('data-type'), renderHTML: a => a.type ? { 'data-type': a.type } : {} },
      branchId: { default: null, parseHTML: el => el.getAttribute('data-branch'), renderHTML: a => a.branchId ? { 'data-branch': a.branchId } : {} },
      'data-branch': { default: null, parseHTML: el => el.getAttribute('data-branch'), renderHTML: a => a['data-branch'] ? { 'data-branch': a['data-branch'] } : {} },
    }
  },
})
```

File: `components/canvas/tiptap-editor.tsx` (annotation click → open panel)

```tsx
handleClick: (view, pos, event) => {
  const target = event.target as HTMLElement
  if (target.classList.contains('annotation') || target.closest('.annotation')) {
    const el = target.classList.contains('annotation') ? target : target.closest('.annotation') as HTMLElement
    const branchId = el.getAttribute('data-branch') || el.getAttribute('data-branch-id')
    if (branchId) window.dispatchEvent(new CustomEvent('create-panel', { detail: { panelId: branchId } }))
    return true
  }
  return false
},
```

File: `components/canvas/tiptap-editor.tsx` (imperative insertion)

```tsx
insertAnnotation: (type: string, annotationId: string, branchId: string) => {
  if (!editor) return
  const { from, to } = editor.state.selection
  if (from === to) return
  editor.chain().focus().setMark('annotation', { id: annotationId, type, branchId, 'data-branch': branchId }).run()
  const html = editor.getHTML(); onUpdate?.(html)
}
```

## Toolbar → Branch/Panel Creation

File: `components/canvas/annotation-toolbar.tsx` (excerpt)

```tsx
const annotationId = uuidv4()
const branchId = `branch-${annotationId}`
const branchData = { id: branchId, title: `${type.charAt(0).toUpperCase() + type.slice(1)} on "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`, content: `<p>Start writing your ${type} here...</p>`, type, parentId: panel, originalText: text, branches: [], position: { x: 0, y: 0 }, isEditable: true }
dataStore.set(branchId, branchData)
const provider = CollaborationProvider.getInstance(); if (noteId) provider.setCurrentNote(noteId)
provider.addBranch(panel, branchId, branchData)
// position calculation omitted
// Dispatch events
window.dispatchEvent(new CustomEvent('insert-annotation-global', { detail: { type, annotationId, branchId, panelId: panel, text } }))
window.dispatchEvent(new CustomEvent('create-panel', { detail: { panelId: branchId } }))
```

## Panel Wiring

File: `components/canvas/canvas-panel.tsx` (hooking insertion + editor)

```tsx
useEffect(() => {
  const handleInsertAnnotation = (event: Event) => {
    const { type, annotationId, branchId } = (event as CustomEvent).detail
    editorRef.current?.insertAnnotation(type, annotationId, branchId)
  }
  const panel = panelRef.current
  if (panel) panel.addEventListener('insert-annotation', handleInsertAnnotation)
  window.addEventListener('insert-annotation-global', handleGlobalInsertAnnotation)
  return () => {
    if (panel) panel.removeEventListener('insert-annotation', handleInsertAnnotation)
    window.removeEventListener('insert-annotation-global', handleGlobalInsertAnnotation)
  }
}, [panelId])

<TiptapEditor
  ref={editorRef}
  content={currentBranch.content}
  isEditable={isEditing}
  panelId={panelId}
  onUpdate={handleUpdate}
  onSelectionChange={handleSelectionChange}
  placeholder={isEditing ? "Start typing..." : ""}
  ydoc={ydoc}
  provider={provider.getProvider()}
/>
```

## Canvas Orchestration

File: `components/annotation-canvas-modern.tsx` (listen for create-panel)

```tsx
useEffect(() => {
  const handlePanelEvent = (event: CustomEvent) => {
    if (event.detail?.panelId) handleCreatePanel(event.detail.panelId)
  }
  window.addEventListener('create-panel' as any, handlePanelEvent)
  return () => window.removeEventListener('create-panel' as any, handlePanelEvent)
}, [noteId])
```

---

## Initialization and Panel Orchestration (full context)

File: `components/annotation-canvas-modern.tsx` (initialize default data and panels)

```tsx
useEffect(() => {
  const provider = CollaborationProvider.getInstance()
  const defaultData = {
    'main': {
      title: 'New Document',
      type: 'main',
      content: `<p>Start writing your document here...</p>`,
      branches: [],
      position: { x: 2000, y: 1500 },
      isEditable: true
    }
  }
  provider.initializeDefaultData(noteId, defaultData)
  setPanels(['main'])
  return () => { provider.destroyNote(noteId) }
}, [noteId])
```

---

## Creation-Time Positioning and Branch Item Click

File: `components/canvas/annotation-toolbar.tsx` (position new panel)

```tsx
const currentBranches = provider.getBranches(panel)
const siblingCount = currentBranches.length - 1
const targetX = parentBranch.position.x + 900
const targetY = parentBranch.position.y + siblingCount * 650
dataStore.update(branchId, { position: { x: targetX, y: targetY } })
const branchData = branchesMap.get(branchId)
if (branchData) { branchData.position = { x: targetX, y: targetY } }
```

File: `components/canvas/branch-item.tsx` (click to open panel and set position)

```tsx
const allSiblings = provider.getBranches(parentId)
const siblingCount = allSiblings.length
const targetX = parentBranch.position.x + 900
const targetY = parentBranch.position.y + siblingCount * 650
dataStore.update(branchId, { position: { x: targetX, y: targetY } })
const branchData = branchesMap.get(branchId)
if (branchData) { branchData.position = { x: targetX, y: targetY }; branchesMap.set(branchId, branchData) }
window.dispatchEvent(new CustomEvent('create-panel', { detail: { panelId: branchId }, bubbles: true }))
```

---

## Branches Filtering UI

File: `components/canvas/branches-section.tsx` (filter and render)

```tsx
const activeFilter = state.branchFilters.get(panelId) || "all"
const handleFilterChange = (filterType: string) => {
  dispatch({ type: "SET_FILTER", payload: { panelId, filterType } })
}
{["all", "note", "explore", "promote"].map((filterType) => (
  <button key={filterType} onClick={() => handleFilterChange(filterType)}>{filterType}</button>
))}
{filteredBranches.map((branchId) => (
  <BranchItem key={branchId} branchId={branchId} parentId={panelId} />
))}
```

---

## Breadcrumbs in Editor Section

File: `components/canvas/editor-section.tsx` (generate breadcrumb trail)

```tsx
const generateBreadcrumb = (branchId: string) => {
  const breadcrumbs = []
  let currentId = branchId
  while (currentId && dataStore.has(currentId)) {
    const currentBranch = dataStore.get(currentId)
    breadcrumbs.unshift({ id: currentId, title: currentBranch.title })
    currentId = currentBranch.parentId
  }
  if (breadcrumbs.length <= 1) return null
  return breadcrumbs.map((crumb, index) => (
    <span key={crumb.id}>{/* link or label with › separator */}</span>
  ))
}
```

---

## Panel Dragging Logic and Position Persistence

File: `components/canvas/canvas-panel.tsx` (drag handlers and updates)

```tsx
const handleMouseDown = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('.panel-close')) return
  dragState.current.isDragging = true
  const currentLeft = parseInt(panel.style.left || position.x.toString(), 10)
  const currentTop = parseInt(panel.style.top || position.y.toString(), 10)
  dragState.current.startX = e.clientX; dragState.current.startY = e.clientY
  dragState.current.offsetX = e.clientX - currentLeft
  dragState.current.offsetY = e.clientY - currentTop
  setZIndex(Date.now())
  document.body.style.userSelect = 'none'; document.body.style.cursor = 'move'; panel.style.cursor = 'move'
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
```

---

## Editor Toolbar Commands

File: `components/canvas/editor-toolbar.tsx` (execute commands)

```tsx
const executeCommand = (command: string, value?: any) => {
  editorRef.current?.executeCommand(command, value)
}
// Buttons call executeCommand('bold'|'italic'|'underline'|'heading'|'bulletList'|'orderedList'|'blockquote'|'highlight'|'removeFormat')
```

---

## Autosave Indicators and Updates

File: `components/canvas/canvas-panel.tsx` (save to store/provider and indicate)

```tsx
const handleUpdate = (html: string) => {
  const updatedData = { ...currentBranch, content: html }
  dataStore.update(panelId, updatedData)
  const branchData = branchesMap.get(panelId)
  if (branchData) { branchData.content = html; branchesMap.set(panelId, branchData) }
  else { branchesMap.set(panelId, updatedData) }
  const autoSave = document.getElementById(`auto-save-${panelId}`)
  if (autoSave) { autoSave.style.opacity = '1'; setTimeout(() => { autoSave.style.opacity = '0' }, 2000) }
  dispatch({ type: "BRANCH_UPDATED" })
}
```

File: `components/canvas/editor-section.tsx` (plain mode autosave indicator)

```tsx
const handleUpdate = (html: string) => {
  const indicator = document.getElementById(`auto-save-${panelId}`)
  if (indicator) { indicator.textContent = "Saving..."; indicator.classList.add("!bg-yellow-500","!text-gray-800"); indicator.classList.remove("!bg-green-500"); indicator.style.opacity = "1" }
  setTimeout(() => {
    dataStore.update(panelId, { content: html })
    if (indicator) { indicator.textContent = "Saved"; indicator.classList.remove("!bg-yellow-500","!text-gray-800"); indicator.classList.add("!bg-green-500"); setTimeout(() => { indicator.style.opacity = "0"; setTimeout(() => (indicator.style.opacity = "1"), 2000) }, 1500) }
  }, 500)
}
```

---

## Connections and Minimap

File: `components/canvas/connection-lines.tsx` (build lines)

```tsx
panels.forEach(panelId => {
  const branch = branches.get(panelId)
  if (!branch || !branch.parentId) return
  const parentBranch = branches.get(branch.parentId)
  if (!parentBranch || !panels.includes(branch.parentId)) return
  const fromX = parentBranch.position.x + 800, fromY = parentBranch.position.y + 300
  const toX = branch.position.x, toY = branch.position.y + 300
  connections.push({ from: { x: fromX, y: fromY }, to: { x: toX, y: toY } })
})
```

File: `components/canvas/minimap.tsx` (mini panels and viewport)

```tsx
{panels.map(panelId => {
  const provider = CollaborationProvider.getInstance()
  const branch = provider.getBranchesMap().get(panelId)
  if (!branch) return null
  return (
    <div key={panelId} className="absolute rounded ..." style={{ left: `${branch.position.x}px`, top: `${branch.position.y}px`, width: '800px', height: '600px' }} />
  )
})}
<div className="absolute border-2 border-red-500 bg-red-500/10" style={{ left: `${(-canvasState.translateX) * scale}px`, top: `${(-canvasState.translateY) * scale}px`, width: `${(windowSize.width / canvasState.zoom) * scale}px`, height: `${(windowSize.height / canvasState.zoom) * scale}px` }} />
```

---

## Hover Previews and Decorations

File: `components/canvas/annotation-decorations.ts` (adds hover targets, tooltip, ripple)

```ts
export const AnnotationDecorations = () => new Plugin({
  key: annotationDecorationsKey,
  state: {
    init() { return { decorations: DecorationSet.empty, hoveredAnnotation: null, tooltipVisible: false } },
    apply(tr, value, _old, newState) {
      const annotationDecorations: Decoration[] = []
      tr.doc.descendants((node, pos) => {
        if (!node.isText) return
        node.marks.forEach(mark => {
          if (mark.type.name === 'annotation') {
            const from = pos
            const to = pos + node.nodeSize
            const branchId = mark.attrs.branchId || mark.attrs['data-branch']
            annotationDecorations.push(Decoration.inline(from, to, { class: 'annotation-hover-target', 'data-branch-id': branchId, 'data-annotation-type': mark.attrs.type }))
          }
        })
      })
      return { decorations: DecorationSet.create(newState.doc, annotationDecorations), hoveredAnnotation: value.hoveredAnnotation, tooltipVisible: value.tooltipVisible }
    }
  },
  props: {
    decorations(state) { return this.getState(state)?.decorations },
    handleDOMEvents: {
      mouseover(_view, event) {
        const el = (event.target as HTMLElement).closest('.annotation-hover-target') as HTMLElement
        if (el) { const id = el.getAttribute('data-branch-id'); const t = el.getAttribute('data-annotation-type') || 'note'; if (id) { showAnnotationTooltip(el, id, t); el.classList.add('annotation-hovered') } }
        return false
      },
      mouseout(_view, event) {
        const el = (event.target as HTMLElement).closest('.annotation-hover-target') as HTMLElement
        if (el) { hideAnnotationTooltip(); el.classList.remove('annotation-hovered') }
        return false
      },
      click(_view, event) {
        const el = (event.target as HTMLElement).closest('.annotation-hover-target') as HTMLElement
        if (el) { el.classList.add('annotation-clicked'); setTimeout(() => el.classList.remove('annotation-clicked'), 300); createRippleEffect(el, event as MouseEvent) }
        return false
      }
    }
  }
})
```

Registering in editor: `components/canvas/tiptap-editor.tsx`

```tsx
plugins: [
  AnnotationDecorations(),
  PerformanceMonitor(),
],
```

---

## Full Annotation Toolbar Buttons

File: `components/canvas/annotation-toolbar.tsx` (buttons for Note/Explore/Promote)

```tsx
<button onClick={() => createAnnotation('note')} className="annotation-btn note" title="Create Note" style={{ background: "linear-gradient(135deg, #3498db 0%, #2980b9 100%)", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "14px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", transition: "transform 0.2s ease" }} onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"} onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)">📝 Note</button>
<button onClick={() => createAnnotation('explore')} className="annotation-btn explore" title="Create Exploration" style={{ background: "linear-gradient(135deg, #f39c12 0%, #e67e22 100%)", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "14px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", transition: "transform 0.2s ease" }} onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"} onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)">🔍 Explore</button>
<button onClick={() => createAnnotation('promote')} className="annotation-btn promote" title="Create Promotion" style={{ background: "linear-gradient(135deg, #27ae60 0%, #229954 100%)", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "14px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", transition: "transform 0.2s ease" }} onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"} onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)">⭐ Promote</button>
```

---

## Smooth Pan to New Panel (Note)

The workflow mentions automatically panning to reveal a new panel. The current modern canvas renders panels but does not implement an automatic pan routine in `components/annotation-canvas-modern.tsx`.

---

## Event Flow Overview

This summarizes the end-to-end flow using code that exists in the project.

1) Selection → Toolbar shows
- `hooks/use-text-selection.ts`: On mouseup, if there’s a selection, dispatches `SET_SELECTION` and makes `#annotation-toolbar` visible.

2) Toolbar click → Branch data + events
- `components/canvas/annotation-toolbar.tsx`:
  - Builds `branchData`, updates `dataStore`, calls `provider.addBranch(panel, branchId, branchData)`.
  - Computes initial position and updates both `dataStore` and `branchesMap`.
  - Dispatches events:

```tsx
window.dispatchEvent(new CustomEvent('insert-annotation-global', { 
  detail: { type, annotationId, branchId, panelId: panel, text }
}))
window.dispatchEvent(new CustomEvent('create-panel', { 
  detail: { panelId: branchId }
}))
```

3) Editor inserts annotation mark
- `components/canvas/canvas-panel.tsx` registers listeners and forwards to the editor:

```tsx
const handleInsertAnnotation = (event: Event) => {
  const { type, annotationId, branchId } = (event as CustomEvent).detail
  editorRef.current?.insertAnnotation(type, annotationId, branchId)
}
panel.addEventListener('insert-annotation', handleInsertAnnotation)
window.addEventListener('insert-annotation-global', handleGlobalInsertAnnotation)
```

4) Canvas creates and renders the panel
- `components/annotation-canvas-modern.tsx` listens for `create-panel`:

```tsx
useEffect(() => {
  const handlePanelEvent = (event: CustomEvent) => {
    if (event.detail?.panelId) handleCreatePanel(event.detail.panelId)
  }
  window.addEventListener('create-panel' as any, handlePanelEvent)
  return () => window.removeEventListener('create-panel' as any, handlePanelEvent)
}, [noteId])
```

5) Panel wiring and persistence
- `components/canvas/canvas-panel.tsx` mounts `TiptapEditor` with `onUpdate`, optional `provider/ydoc`, and autosave UI; drag handlers persist position to both stores.

6) Visuals update
- `components/canvas/connection-lines.tsx` draws lines using panel positions.
- `components/canvas/minimap.tsx` renders mini panels and the viewport rectangle.
