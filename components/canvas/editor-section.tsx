"use client"

import { useRef, useState, useEffect } from "react"
import { useCanvas } from "./canvas-context"
import type { Branch } from "@/types/canvas"
import { useAutoSave } from "@/hooks/use-auto-save"
import TiptapEditor, { TiptapEditorHandle } from "./tiptap-editor"
import { EditorToolbar } from "./editor-toolbar"

interface EditorSectionProps {
  panelId: string
  branch: Branch
}

export function EditorSection({ panelId, branch }: EditorSectionProps) {
  const { dataStore, dispatch } = useCanvas()
  const editorRef = useRef<TiptapEditorHandle>(null)
  const [isEditing, setIsEditing] = useState(branch.isEditable !== false)

  const handleUpdate = (html: string) => {
    // Show saving indicator
    const indicator = document.getElementById(`auto-save-${panelId}`)
    if (indicator) {
      indicator.textContent = "Saving..."
      indicator.classList.add("!bg-yellow-500", "!text-gray-800")
      indicator.classList.remove("!bg-green-500")
      indicator.style.opacity = "1"
    }

    // Save after a short delay
    setTimeout(() => {
      dataStore.update(panelId, { content: html })

      if (indicator) {
        indicator.textContent = "Saved"
        indicator.classList.remove("!bg-yellow-500", "!text-gray-800")
        indicator.classList.add("!bg-green-500")

        setTimeout(() => {
          indicator.style.opacity = "0"
          setTimeout(() => (indicator.style.opacity = "1"), 2000)
        }, 1500)
      }
    }, 500)
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

    // Show/hide annotation toolbar
    const toolbar = document.getElementById("annotation-toolbar")
    if (toolbar && text.length > 0) {
      // Get mouse position from current selection
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
    
    // Update the button text
    const toggleBtn = document.querySelector(`#toolbar-${panelId} .toolbar-btn.special`) as HTMLButtonElement
    if (toggleBtn) {
      toggleBtn.innerHTML = newEditableState ? '💾 Save' : '📝 Edit'
      toggleBtn.title = newEditableState ? 'Save Changes' : 'Edit Content'
    }
    
    // Update branch data
    dataStore.update(panelId, { isEditable: newEditableState })
    
    // Focus editor if now editable
    if (newEditableState) {
      editorRef.current?.focus()
    }
  }

  // Listen for insert-annotation events
  useEffect(() => {
    const handleInsertAnnotation = (event: CustomEvent) => {
      const { type, annotationId, branchId } = event.detail
      
      // Check if this event is for this editor
      const editorElement = event.target as HTMLElement
      const editorPanel = editorElement.querySelector('[data-panel]')
      
      if (editorPanel && editorPanel.getAttribute('data-panel') === panelId) {
        // Insert the annotation using the editor's command
        editorRef.current?.insertAnnotation(type, annotationId, branchId)
      }
    }

    // Add event listener to the wrapper element
    const wrapper = document.querySelector(`[data-panel="${panelId}"]`)?.closest('.rich-editor-wrapper')
    if (wrapper) {
      wrapper.addEventListener('insert-annotation' as any, handleInsertAnnotation)
      
      return () => {
        wrapper.removeEventListener('insert-annotation' as any, handleInsertAnnotation)
      }
    }
  }, [panelId])

  const generateBreadcrumb = (branchId: string) => {
    const breadcrumbs = []
    let currentId = branchId

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
          <a
            href="#"
            className="breadcrumb-item text-indigo-600 cursor-pointer no-underline px-1 py-0.5 rounded transition-colors hover:bg-indigo-100"
            onClick={(e) => {
              e.preventDefault()
              // Handle pan to panel
            }}
          >
            {crumb.title}
          </a>
        )}
        {index < breadcrumbs.length - 1 && <span className="breadcrumb-separator text-gray-400 mx-1">›</span>}
      </span>
    ))
  }

  const isMainPanel = panelId === 'main'
  const showToolbar = isMainPanel || isEditing

  return (
    <div
      style={{
        flex: 2,
        padding: "20px 25px 25px 25px",
        borderRight: "1px solid #e9ecef",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Auto Save Indicator */}
      <div
        id={`auto-save-${panelId}`}
        style={{
          position: "absolute",
          top: "12px",
          right: "15px",
          padding: "4px 8px",
          background: "#28a745",
          color: "white",
          borderRadius: "12px",
          fontSize: "10px",
          opacity: 0,
          transition: "opacity 0.3s ease",
          zIndex: 2,
        }}
        className="auto-save"
      >
        Saved
      </div>

      {/* Editor Header */}
      <div
        style={{
          marginBottom: "20px",
          paddingBottom: "15px",
          borderBottom: "2px solid #f1f3f4",
        }}
      >
        <div
          style={{
            fontSize: "20px",
            fontWeight: 700,
            color: "#2c3e50",
            marginBottom: "8px",
          }}
          className="editor-title"
        >
          {branch.title}
        </div>
        {generateBreadcrumb(panelId) && (
          <div className="breadcrumb" style={{ display: "flex", alignItems: "center", fontSize: "12px", color: "#6c757d", gap: "5px" }}>
            {generateBreadcrumb(panelId)}
          </div>
        )}
      </div>

      {/* Editor Content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
        }}
      >
        {branch.originalText && (
          <div
            style={{
              background: "linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)",
              padding: "15px",
              borderLeft: "4px solid #2196f3",
              marginBottom: "20px",
              fontStyle: "italic",
              borderRadius: "0 8px 8px 0",
              color: "#1565c0",
              fontSize: "14px",
            }}
            className="quoted-text"
          >
            "{branch.originalText}"
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
          
          <TiptapEditor
            ref={editorRef}
            content={branch.content}
            isEditable={isEditing}
            panelId={panelId}
            onUpdate={handleUpdate}
            onSelectionChange={handleSelectionChange}
            placeholder={isEditing ? "Start typing..." : ""}
          />
        </div>
      </div>
    </div>
  )
}
