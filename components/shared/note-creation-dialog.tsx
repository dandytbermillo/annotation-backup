"use client"

import { useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"

interface Folder {
  id: string
  name: string
  path: string
  parentId?: string | null
  depth?: number
}

interface NoteCreationDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreateNote: (noteName: string, folderId: string | null, customPath?: string) => Promise<void>
  defaultNoteName?: string
  title?: string
  submitButtonText?: string
}

export function NoteCreationDialog({
  isOpen,
  onClose,
  onCreateNote,
  defaultNoteName = "",
  title = "Create New Note",
  submitButtonText = "Create Note"
}: NoteCreationDialogProps) {
  const [newNoteName, setNewNoteName] = useState(defaultNoteName)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [availableFolders, setAvailableFolders] = useState<Folder[]>([])
  const [lastUsedFolderId, setLastUsedFolderId] = useState<string | null>(null)

  // New folder creation
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")

  // Custom path
  const [showCustomFolder, setShowCustomFolder] = useState(false)
  const [customFolderInput, setCustomFolderInput] = useState("")

  // Update note name when default changes
  useEffect(() => {
    if (defaultNoteName) {
      setNewNoteName(defaultNoteName)
    }
  }, [defaultNoteName])

  // Fetch available folders
  const fetchAvailableFolders = useCallback(async () => {
    try {
      const response = await fetch('/api/items?parentId=null')
      if (!response.ok) return

      const data = await response.json()
      const folders = data.items?.filter((item: any) => item.type === 'folder').map((folder: any) => ({
        id: folder.id,
        name: folder.name,
        path: folder.path || '/',
        parentId: folder.parentId,
        depth: 0
      })) || []

      setAvailableFolders(folders)
    } catch (error) {
      console.error('[NoteCreationDialog] Failed to fetch folders:', error)
    }
  }, [])

  // Load folders when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchAvailableFolders()
      // Restore last used folder or default to Uncategorized
      if (lastUsedFolderId) {
        setSelectedFolderId(lastUsedFolderId)
      }
    }
  }, [isOpen, fetchAvailableFolders, lastUsedFolderId])

  // Set default folder once folders are loaded
  useEffect(() => {
    if (isOpen && availableFolders.length > 0 && !selectedFolderId && !lastUsedFolderId) {
      const uncategorized = availableFolders.find(f => f.name === 'Uncategorized')
      if (uncategorized) {
        setSelectedFolderId(uncategorized.id)
      }
    }
  }, [availableFolders, isOpen, selectedFolderId, lastUsedFolderId])

  // Create new folder
  const createNewFolder = async (folderName: string, parentId?: string) => {
    try {
      const response = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'folder',
          name: folderName,
          parentId: parentId || null,
          metadata: {}
        })
      })

      if (!response.ok) throw new Error('Failed to create folder')

      const data = await response.json()
      return data.item
    } catch (error) {
      console.error('[NoteCreationDialog] Failed to create folder:', error)
      return null
    }
  }

  // Handle submit
  const handleSubmit = async () => {
    try {
      await onCreateNote(
        newNoteName.trim() || `New Note`,
        selectedFolderId,
        showCustomFolder ? customFolderInput : undefined
      )

      // Remember folder for next time
      if (selectedFolderId) {
        setLastUsedFolderId(selectedFolderId)
      }

      // Reset and close
      handleClose()
    } catch (error) {
      console.error('[NoteCreationDialog] Failed to create note:', error)
    }
  }

  // Handle close
  const handleClose = () => {
    setNewNoteName(defaultNoteName)
    setSelectedFolderId(null)
    setIsCreatingFolder(false)
    setNewFolderName("")
    setShowCustomFolder(false)
    setCustomFolderInput("")
    onClose()
  }

  if (!isOpen) return null

  // Only render on client side
  if (typeof window === 'undefined') return null

  console.log('[NoteCreationDialog] Rendering dialog with title:', title)

  return createPortal(
    <div
      onClick={(e) => {
        console.log('[NoteCreationDialog] Overlay clicked')
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
      }}
    >
      <div
        onClick={(e) => {
          console.log('[NoteCreationDialog] Dialog content clicked')
          e.stopPropagation()
        }}
        style={{
          backgroundColor: '#1f2937',
          borderRadius: '8px',
          padding: '24px',
          width: '384px',
          maxWidth: '90vw',
          pointerEvents: 'auto',
          position: 'relative',
          zIndex: 100000,
        }}
      >
        <h2 className="text-xl font-semibold mb-4 text-white">{title}</h2>

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

        {/* Folder Selector */}
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
            onClick={handleClose}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors font-medium"
          >
            {submitButtonText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
