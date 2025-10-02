"use client"

import { useState } from "react"
import { Save } from "lucide-react"
import { useCanvas } from "./canvas-context"
import type { Branch } from "@/types/canvas"
import { NoteCreationDialog } from "@/components/shared/note-creation-dialog"
import { createNote } from "@/lib/utils/note-creator"

interface PanelHeaderProps {
  panelId: string
  branch: Branch
}

export function PanelHeader({ panelId, branch }: PanelHeaderProps) {
  const { dispatch, dataStore } = useCanvas()
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false)

  const handleClose = () => {
    // Update parent's branches list
    if (branch.parentId) {
      const parent = dataStore.get(branch.parentId)
      if (parent && parent.branches) {
        const updatedBranches = parent.branches.filter((id: string) => id !== panelId)
        dataStore.update(branch.parentId, { branches: updatedBranches })
      }
    }

    dispatch({
      type: "REMOVE_PANEL",
      payload: { id: panelId },
    })
  }

  // Handle Save As - creates a new note with the branch content
  const handleSaveAs = async (noteName: string, folderId: string | null, customPath?: string) => {
    try {
      // TODO: Handle custom folder path creation if provided
      // For now, we'll just use the selected folder

      const result = await createNote({
        name: noteName,
        parentId: folderId,
        metadata: {
          branchType: branch.type,
          savedFrom: panelId,
          savedAt: new Date().toISOString()
        }
      })

      if (result.success && result.noteId) {
        // TODO: Save the actual branch content to the note
        // This would require extracting content from the editor
        alert(`Note "${noteName}" created successfully!`)
      } else {
        throw new Error(result.error || 'Failed to create note')
      }
    } catch (error) {
      console.error('[PanelHeader] Save As failed:', error)
      alert('Failed to save note. Please try again.')
      throw error
    }
  }

  return (
    <>
      <div
        className="panel-header relative bg-white/5 text-indigo-600 p-3 border-b border-indigo-200 text-sm font-semibold flex justify-between items-center cursor-grab select-none"
        style={{ userSelect: "none" }}
      >
        <span>{branch.title}</span>
        <div className="flex items-center gap-2">
          {/* Save As button */}
          <button
            className="bg-blue-100 border border-blue-300 text-blue-600 px-3 h-6 rounded-full cursor-pointer text-xs flex items-center gap-1 transition-all duration-200 hover:bg-blue-200 hover:border-blue-500"
            onClick={(e) => {
              e.stopPropagation()
              setShowSaveAsDialog(true)
            }}
            title="Save branch as new note"
          >
            <Save className="w-3 h-3" />
            <span>Save As</span>
          </button>
          {/* Close button */}
          {panelId !== "main" && (
            <button
              className="panel-close bg-red-100 border border-red-300 text-red-500 w-6 h-6 rounded-full cursor-pointer text-sm flex items-center justify-center transition-all duration-200 hover:bg-red-200 hover:border-red-500 hover:scale-110"
              onClick={handleClose}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Save As Dialog - reuses the shared note creation dialog */}
      <NoteCreationDialog
        isOpen={showSaveAsDialog}
        onClose={() => setShowSaveAsDialog(false)}
        onCreateNote={handleSaveAs}
        defaultNoteName={branch.title || "Untitled"}
        title="Save Branch As Note"
        submitButtonText="Save Note"
      />
    </>
  )
}
